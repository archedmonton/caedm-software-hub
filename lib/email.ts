import "server-only";
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { professionalSender } from "@/lib/invitation-content";
import { emailBrand } from "@/lib/email-brand";
import { createHash } from "node:crypto";
import { z } from "zod";
import { emailSenders, type EmailPurpose } from "@/lib/email-senders";
import { setTimeout as delay } from "node:timers/promises";
let nextResendRequestAt = 0;
export type Message = {
  id: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  inlineBrandLogo?: boolean;
  purpose?: EmailPurpose;
};
export interface EmailProvider {
  name: string;
  send(message: Message): Promise<void>;
}
export function emailProvider(
  options: { timeoutMs?: number } = {},
): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER || "local";
  const sender = (message: Message) =>
    professionalSender(
      provider === "smtp" && process.env.EMAIL_FROM
        ? process.env.EMAIL_FROM
        : emailSenders[message.purpose || "notifications"],
    );
  const send = (
    transport: ReturnType<typeof nodemailer.createTransport>,
    message: Message,
  ) => {
    const from = sender(message);
    return transport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo,
      attachments:
        message.inlineBrandLogo && message.html
          ? [
              {
                filename: emailBrand.logoFilename,
                content: readFileSync(
                  join(process.cwd(), "lib", "assets", "caedm-logo.png"),
                ),
                contentType: "image/png",
                contentDisposition: "inline",
                cid: emailBrand.logoCid,
              },
            ]
          : undefined,
      messageId: `<${message.id}@${from.address.split("@")[1]}>`,
    });
  };
  if (provider === "resend") {
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) throw new Error("Resend email delivery is not configured.");
    return {
      name: "resend",
      async send(message) {
        const purpose = message.purpose || "notifications";
        try {
          const from = sender(message);
          const payload = {
            from: `${from.name} <${from.address}>`,
            to: [z.string().email().parse(message.to)],
            subject: z
              .string()
              .min(1)
              .max(998)
              .regex(/^[^\r\n]+$/)
              .parse(message.subject),
            text: message.text,
            html: message.html,
            reply_to: message.replyTo
              ? z.string().email().parse(message.replyTo)
              : undefined,
            headers: {
              "Message-ID": `<${createHash("sha256").update(message.id).digest("hex")}@caedm.ca>`,
            },
            tags: [{ name: "purpose", value: purpose }],
            attachments:
              message.inlineBrandLogo && message.html
                ? [
                    {
                      filename: emailBrand.logoFilename,
                      content: readFileSync(
                        join(process.cwd(), "lib", "assets", "caedm-logo.png"),
                      ).toString("base64"),
                      content_type: "image/png",
                      content_id: emailBrand.logoCid,
                    },
                  ]
                : undefined,
          };
          const body = JSON.stringify(payload);
          // Identical retries share a key; a rotated invitation or changed payload does not.
          const idempotency = createHash("sha256")
            .update(message.id)
            .update(body)
            .digest("hex");
          // Pace this process below Resend's default two-requests/second limit.
          // Cross-instance quota failures are retained by the database delivery queues.
          const signal = AbortSignal.timeout(options.timeoutMs || 10000);
          const wait = Math.max(0, nextResendRequestAt - Date.now());
          nextResendRequestAt = Date.now() + wait + 550;
          if (wait) await delay(wait, undefined, { signal });
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            redirect: "error",
            cache: "no-store",
            signal,
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              "Idempotency-Key": `caedm-${idempotency}`,
            },
            body,
          });
          if (!response.ok) {
            const reason =
              response.status === 429
                ? "rate_limited"
                : response.status >= 500
                  ? "provider_unavailable"
                  : "provider_rejected";
            console.error("email_delivery_failed", {
              provider,
              purpose,
              reason,
              status: response.status,
            });
            throw new Error(
              "Email delivery failed. Check email provider settings and delivery logs.",
            );
          }
          const result = await response.json();
          if (!result || typeof result.id !== "string" || !result.id)
            throw new Error("Invalid email provider response.");
        } catch (error) {
          // Never log API keys, addresses, content, tokens, or raw provider responses.
          if (!(
            error instanceof Error &&
            error.message.startsWith("Email delivery failed.")
          ))
            console.error("email_delivery_failed", {
              provider,
              purpose,
              reason: "request_failed",
            });
          throw new Error(
            "Email delivery failed. Check email provider settings and delivery logs.",
          );
        }
      },
    };
  }
  if (provider === "local") {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "Configure an email provider before production email delivery.",
      );
    return {
      name: "local",
      async send(message) {
        if (!message.html) return; // Existing reminder previews are retained in notification activity.
        const target = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
        if (!["localhost", "127.0.0.1"].includes(target.hostname))
          throw new Error(
            "Local email delivery requires the local Supabase stack.",
          );
        const transport = nodemailer.createTransport({
          host: "127.0.0.1",
          port: Number(process.env.LOCAL_SMTP_PORT || 54325),
          ignoreTLS: true,
          connectionTimeout: 10000,
          socketTimeout: 15000,
        });
        await send(transport, message);
      },
    };
  }
  if (provider !== "smtp" || !process.env.SMTP_HOST)
    throw new Error("Email provider is not configured.");
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP port is invalid.");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return {
    name: "smtp",
    async send(message) {
      await send(transport, message);
    },
  };
}
