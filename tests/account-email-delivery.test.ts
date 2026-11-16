import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/email", () => ({
  emailProvider: () => ({ name: "resend", send: mocks.send }),
}));
import {
  accountEmailMessage,
  runAccountEmails,
  type AccountNotice,
} from "@/lib/account-emails";
import { POST } from "@/app/api/jobs/account-emails/route";
const notice: AccountNotice = {
  id: "90000000-0000-4000-8000-000000000001",
  claim_token: "private-claim",
  kind: "role_changed",
  email: "employee@caedm.ca",
  full_name: "Alex <unsafe>",
  before_role: "staff",
  after_role: "admin",
  before_status: "active",
  after_status: "active",
  created_at: "2026-11-12T10:00:00Z",
};
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unit-test-service");
  vi.stubEnv("APP_URL", "https://caedm-software-hub.vercel.app");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "unit-test-public");
  mocks.rpc.mockReset();
  mocks.send.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
test("privilege notices use security-alerts, approvals use approvals, and content is escaped", () => {
  const security = accountEmailMessage(
    notice,
    "https://caedm-software-hub.vercel.app",
  );
  expect(security.purpose).toBe("security");
  expect(security.html).not.toContain("Alex <unsafe>");
  expect(security.text).toContain("Administrator");
  expect(security.text).not.toContain(notice.claim_token);
  expect(
    accountEmailMessage({ ...notice, kind: "approval" }, "https://example.com")
      .purpose,
  ).toBe("approvals");
});
test("the worker acknowledges only accepted deliveries and preserves uncertain acknowledgements", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: [notice], error: null })
    .mockResolvedValueOnce({ data: true, error: null });
  expect(await runAccountEmails()).toEqual({ sent: 1, failed: 0 });
  expect(mocks.rpc).toHaveBeenLastCalledWith("finish_account_email", {
    notification: notice.id,
    token: notice.claim_token,
    successful: true,
    email_provider: "resend",
  });
  mocks.rpc
    .mockResolvedValueOnce({ data: [notice], error: null })
    .mockResolvedValueOnce({ data: false, error: null });
  await expect(runAccountEmails()).rejects.toThrow("state could not be saved");
});
test("failed sends are saved as failed without disclosing responses", async () => {
  mocks.send.mockRejectedValueOnce(new Error("private provider response"));
  mocks.rpc
    .mockResolvedValueOnce({ data: [notice], error: null })
    .mockResolvedValueOnce({ data: true, error: null });
  expect(await runAccountEmails()).toEqual({ sent: 0, failed: 1 });
  expect(mocks.rpc.mock.calls.at(-1)![1].successful).toBe(false);
});
test("account jobs require scheduler authorization and never expose raw job errors", async () => {
  vi.stubEnv("CRON_SECRET", "unit-test-".padEnd(40, "x"));
  expect(
    (
      await POST(
        new Request("http://localhost/api/jobs/account-emails", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockRejectedValueOnce(new Error("private database response"));
  const response = await POST(
    new Request("http://localhost/api/jobs/account-emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private database");
});
