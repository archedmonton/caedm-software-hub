import "server-only";
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { professionalSender } from "@/lib/invitation-content";
import { emailBrand } from "@/lib/email-brand";
export type Message = {
  id: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  inlineBrandLogo?: boolean;
};
export interface EmailProvider {
  name: string;
  send(message: Message): Promise<void>;
}
export function emailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER || "local";
  const from = professionalSender(
    process.env.EMAIL_FROM ||
      (process.env.NODE_ENV !== "production"
        ? "notifications@caedm.ca"
        : undefined),
  );
  const send = (
    transport: ReturnType<typeof nodemailer.createTransport>,
    message: Message,
  ) =>
    transport.sendMail({
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
  if (provider === "local") {
    if (process.env.NODE_ENV === "production")
      throw new Error("Configure SMTP before production email delivery.");
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
