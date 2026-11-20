import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { Webhook } from "standardwebhooks";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mock.rpc }),
}));
import { POST } from "@/app/api/webhooks/resend/route";
const secret = Buffer.alloc(32, 11).toString("base64");
const payload = {
  type: "email.delivered",
  created_at: new Date().toISOString(),
  data: {
    email_id: "provider-id",
    tags: { delivery_ref: "90000000-0000-4000-8000-000000000002" },
  },
};
function request(data = payload, changed = false, date = new Date()) {
  const raw = JSON.stringify(data);
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: {
      "svix-id": "event-1",
      "svix-timestamp": String(Math.floor(date.getTime() / 1000)),
      "svix-signature": new Webhook(secret).sign("event-1", date, raw),
    },
    body: raw + (changed ? " " : ""),
  });
}
beforeEach(() => {
  vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${secret}`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test");
  mock.rpc.mockReset().mockResolvedValue({ data: true, error: null });
});
afterEach(() => vi.unstubAllEnvs());
test("valid signed event records only the bound delivery receipt", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith(
    "record_announcement_receipt",
    expect.objectContaining({
      delivery_capability: payload.data.tags.delivery_ref,
      provider_message_id: "provider-id",
      event_key: "event-1",
      event_kind: "delivered",
    }),
  );
});
test("altered body, missing signature and expired signed events cannot write receipts", async () => {
  expect((await POST(request(payload, true))).status).toBe(401);
  expect(
    (await POST(request(payload, false, new Date(Date.now() - 600000)))).status,
  ).toBe(401);
  expect(mock.rpc).not.toHaveBeenCalled();
});
test("unrelated valid events are acknowledged without querying business data", async () => {
  expect(
    (await POST(request({ ...payload, type: "email.opened" }))).status,
  ).toBe(200);
  expect(mock.rpc).not.toHaveBeenCalled();
});
test("storage failures remain retryable and no provider secrets are returned", async () => {
  mock.rpc.mockResolvedValue({ error: { message: "private server detail" } });
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private server detail");
});
