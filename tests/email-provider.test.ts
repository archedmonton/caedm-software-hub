import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const transport = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => transport) },
}));
import { emailProvider } from "@/lib/email";
import { emailSenders, type EmailPurpose } from "@/lib/email-senders";
const api = vi.fn();
const log = vi.spyOn(console, "error").mockImplementation(() => {});
const message = {
  id: "delivery-unit-test",
  to: "employee@caedm.ca",
  subject: "Invitation test",
  text: "Private one-time token",
  html: '<img src="cid:caedm-logo@software-hub.caedm.ca">',
  inlineBrandLogo: true,
  replyTo: "ruban.peppin@caedm.ca",
};
beforeEach(() => {
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "unit-test-api-key");
  vi.stubEnv("EMAIL_FROM", "Legacy sender <notifications@caedm.ca>");
  api.mockReset().mockImplementation(
    async () =>
      new Response(JSON.stringify({ id: "accepted-unit-test" }), {
        status: 200,
      }),
  );
  vi.stubGlobal("fetch", api);
  log.mockClear();
  transport.sendMail.mockReset().mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
test("all six purposes use their approved sender, preserving branding and Reply-To", async () => {
  for (const purpose of Object.keys(emailSenders) as EmailPurpose[]) {
    await emailProvider().send({ ...message, purpose });
    const [url, init] = api.mock.calls.at(-1)!;
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body);
    expect(body.from).toBe(`CAEDM Software Hub <${emailSenders[purpose]}>`);
    expect(body.to).toEqual([message.to]);
    expect(body.reply_to).toBe(message.replyTo);
    expect(body.attachments[0]).toMatchObject({
      filename: "caedm-logo.png",
      content_id: "caedm-logo@software-hub.caedm.ca",
    });
    expect(
      Buffer.from(body.attachments[0].content, "base64")
        .subarray(0, 4)
        .toString("hex"),
    ).toBe("89504e47");
    expect(init.headers.Authorization).toBe("Bearer unit-test-api-key");
    expect(init.redirect).toBe("error");
    expect(body.headers["Message-ID"]).not.toContain(message.id);
  }
});
test("identical queue retries share a key; a rotated invitation produces a new key", async () => {
  await emailProvider().send(message);
  await emailProvider().send(message);
  const key = api.mock.calls[0][1].headers["Idempotency-Key"];
  expect(api.mock.calls[1][1].headers["Idempotency-Key"]).toBe(key);
  await emailProvider().send({ ...message, text: "Rotated token" });
  expect(api.mock.calls[2][1].headers["Idempotency-Key"]).not.toBe(key);
  expect(key).not.toContain("token");
});
test("provider rejection, quota, network errors and malformed responses never expose secrets", async () => {
  for (const status of [401, 403, 422, 429, 500]) {
    api.mockResolvedValueOnce(
      new Response("private provider response unit-test-api-key", { status }),
    );
    await expect(emailProvider().send(message)).rejects.toThrow(
      "Check email provider settings",
    );
  }
  api.mockRejectedValueOnce(new Error("private network details"));
  await expect(emailProvider().send(message)).rejects.toThrow(
    "Check email provider settings",
  );
  api.mockResolvedValueOnce(new Response("{}"));
  await expect(emailProvider().send(message)).rejects.toThrow(
    "Check email provider settings",
  );
  const logs = JSON.stringify(log.mock.calls);
  for (const secret of [
    "unit-test-api-key",
    "private provider",
    "private network",
    message.to,
    message.text,
  ])
    expect(logs).not.toContain(secret);
  expect(logs).toContain("rate_limited");
});
test("missing API key and header injection fail closed without requesting delivery", async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  expect(() => emailProvider()).toThrow("not configured");
  vi.stubEnv("RESEND_API_KEY", "unit-test-api-key");
  await expect(
    emailProvider().send({
      ...message,
      subject: "hello\r\nBcc: other@example.com",
    }),
  ).rejects.toThrow();
  await expect(
    emailProvider().send({ ...message, to: "bad\r\n@example.com" }),
  ).rejects.toThrow();
  expect(api).not.toHaveBeenCalled();
});
test("SMTP remains available with the existing authorized sender and TLS", async () => {
  vi.stubEnv("EMAIL_PROVIDER", "smtp");
  vi.stubEnv("SMTP_HOST", "mail2.caedm.ca");
  vi.stubEnv("SMTP_PORT", "587");
  vi.stubEnv("SMTP_USER", "notifications");
  vi.stubEnv("SMTP_PASSWORD", "local-unit-secret");
  await emailProvider().send({ ...message, purpose: "invitations" });
  expect(transport.sendMail.mock.calls[0][0].from.address).toBe(
    "notifications@caedm.ca",
  );
  expect(api).not.toHaveBeenCalled();
});
test("production cannot fall back to the local mail provider", () => {
  vi.stubEnv("EMAIL_PROVIDER", "local");
  vi.stubEnv("NODE_ENV", "production");
  expect(() => emailProvider()).toThrow("Configure an email provider");
});
