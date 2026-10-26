import "server-only";
import nodemailer from "nodemailer";
export type Message = { id: string; to: string; subject: string; text: string };
export interface EmailProvider {
  name: string;
  send(message: Message): Promise<void>;
}
export function emailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER || "local";
  if (provider === "local") {
    if (process.env.NODE_ENV === "production")
      throw new Error("Configure SMTP before production reminder delivery.");
    return {
      name: "local",
      async send() {
        /* Content is persisted by finish_notification and previewed in Settings. */
      },
    };
  }
  if (provider !== "smtp" || !process.env.SMTP_HOST)
    throw new Error("Email provider is not configured.");
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  return {
    name: "smtp",
    async send(message) {
      await transport.sendMail({
        from: process.env.EMAIL_FROM || "Software Hub <software-hub@caedm.ca>",
        to: message.to,
        subject: message.subject,
        text: message.text,
        messageId: `<${message.id}@software-hub.caedm.ca>`,
      });
    },
  };
}
