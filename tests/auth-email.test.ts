import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { Webhook } from "standardwebhooks";
const mock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/email", () => ({ emailProvider: () => ({ send: mock.send }) }));
import { authEmailMessages } from "@/lib/auth-email";
import { POST } from "@/app/api/auth/send-email/route";
const origin = "https://caedm-software-hub.vercel.app";
const supabase = "https://test-project.supabase.co";
const secret = Buffer.alloc(32, 7).toString("base64");
const payload = {
  user: {
    id: "90000000-0000-4000-8000-000000000003",
    email: "staff@caedm.ca",
    user_metadata: {
      full_name: '<script>alert("x")</script>',
      role: "super_admin",
    },
  },
  email_data: {
    email_action_type: "signup",
    token: "123456",
    token_hash: "a".repeat(64),
    redirect_to: "https://evil.example",
    site_url: "https://evil.example",
  },
};
function signed(data: unknown = payload, date = new Date(), bodyChange = "") {
  const body = JSON.stringify(data);
  const signature = new Webhook(secret).sign("auth-event-1", date, body);
  return new Request("http://localhost/api/auth/send-email", {
    method: "POST",
    headers: {
      "webhook-id": "auth-event-1",
      "webhook-timestamp": String(Math.floor(date.getTime() / 1000)),
      "webhook-signature": signature,
      "Content-Type": "application/json",
    },
    body: body + bodyChange,
  });
}
beforeEach(() => {
  vi.stubEnv("SUPABASE_SEND_EMAIL_HOOK_SECRET", `v1,whsec_${secret}`);
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabase);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "unit-test-public");
  mock.send.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
test("signed signup and recovery hooks send from noreply with trusted token links and no role grants", async () => {
  expect((await POST(signed())).status).toBe(200);
  const message = mock.send.mock.calls[0][0];
  expect(message.purpose).toBe("authentication");
  expect(message.to).toBe("staff@caedm.ca");
  expect(message.html).not.toContain("<script>");
  expect(message.html).toContain("&lt;script&gt;");
  expect(message.text).not.toContain("evil.example");
  expect(message.text).not.toContain("super_admin");
  const [recovery] = authEmailMessages(
    {
      ...payload,
      email_data: { ...payload.email_data, email_action_type: "recovery" },
    },
    "retry-event",
    origin,
    supabase,
  );
  const url = new URL(
    recovery.text.match(/https:\/\/caedm-software-hub[^\s]+/)![0],
  );
  expect(url.pathname).toBe("/auth/confirm");
  expect(url.searchParams.get("token_hash")).toBe("a".repeat(64));
  expect(url.searchParams.get("type")).toBe("recovery");
  expect(url.searchParams.has("redirect_to")).toBe(false);
});
test("forged, altered, missing and expired signatures cannot send", async () => {
  const bad = [
    new Request("http://localhost/api/auth/send-email", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    signed(payload, new Date(), " "),
    signed(payload, new Date(Date.now() - 600000)),
  ];
  for (const request of bad) expect((await POST(request)).status).toBe(401);
  expect(mock.send).not.toHaveBeenCalled();
});
test("a valid hook rejects unsupported actions, foreign recipients and oversized bodies", async () => {
  for (const data of [
    { ...payload, email_data: { email_action_type: "forged_action" } },
    { ...payload, user: { ...payload.user, email: "external@example.com" } },
  ])
    expect((await POST(signed(data))).status).toBe(400);
  expect(
    (await POST(signed({ ...payload, padding: "x".repeat(66000) }))).status,
  ).toBe(413);
  expect(mock.send).not.toHaveBeenCalled();
});
test("secure email changes use the documented reverse token-hash mapping", () => {
  const messages = authEmailMessages(
    {
      ...payload,
      user: { ...payload.user, new_email: "new@caedm.ca" },
      email_data: {
        ...payload.email_data,
        email_action_type: "email_change",
        token_hash_new: "b".repeat(64),
      },
    },
    "change-event",
    origin,
    supabase,
  );
  expect(messages).toHaveLength(2);
  expect(messages[0].to).toBe("staff@caedm.ca");
  expect(messages[0].text).toContain(`token=${"b".repeat(64)}`);
  expect(messages[1].to).toBe("new@caedm.ca");
  expect(messages[1].text).toContain(`token=${"a".repeat(64)}`);
});
test("Supabase security events use security-alerts and reauthentication uses a code", () => {
  for (const event of [
    "password_changed_notification",
    "email_changed_notification",
    "mfa_factor_enrolled_notification",
    "mfa_factor_unenrolled_notification",
    "identity_linked_notification",
    "identity_unlinked_notification",
    "phone_changed_notification",
  ]) {
    const messages = authEmailMessages(
      {
        ...payload,
        email_data: { email_action_type: event, old_email: "old@caedm.ca" },
      },
      event,
      origin,
      supabase,
    );
    for (const message of messages) {
      expect(message.purpose).toBe("security");
      expect(message.text).not.toContain("token=");
    }
  }
  const [code] = authEmailMessages(
    {
      ...payload,
      email_data: { email_action_type: "reauthentication", token: "123456" },
    },
    "reauth",
    origin,
    supabase,
  );
  expect(code.purpose).toBe("authentication");
  expect(code.text).toContain("123456");
});
test("missing configuration and failed delivery return retryable safe errors", async () => {
  vi.stubEnv("SUPABASE_SEND_EMAIL_HOOK_SECRET", "");
  expect((await POST(signed())).status).toBe(503);
  vi.stubEnv("SUPABASE_SEND_EMAIL_HOOK_SECRET", `v1,whsec_${secret}`);
  mock.send.mockRejectedValueOnce(
    new Error("private key token and provider response"),
  );
  const response = await POST(signed());
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("1");
  expect(await response.text()).not.toContain("private key");
});
test("secret rotation and repeated webhook delivery preserve the logical message identity", async () => {
  vi.stubEnv(
    "SUPABASE_SEND_EMAIL_HOOK_SECRET",
    `v1,whsec_${Buffer.alloc(32, 5).toString("base64")}|v1,whsec_${secret}`,
  );
  expect((await POST(signed())).status).toBe(200);
  expect((await POST(signed())).status).toBe(200);
  expect(mock.send.mock.calls[0][0]).toEqual(mock.send.mock.calls[1][0]);
});
