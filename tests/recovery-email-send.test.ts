import { test, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  send: vi.fn(),
  generate: vi.fn(),
  access: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAccess: mock.access }));
vi.mock("@/lib/email", () => ({
  emailProvider: () => ({ name: "resend", send: mock.send }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { admin: { generateLink: mock.generate } } }),
}));
vi.mock("@/lib/developer-auth", () => ({
  withFreshVerifiedPassword: async (
    _context: unknown,
    _password: string,
    _code: string,
    recheck: () => Promise<void>,
    operation: (db: { rpc: typeof mock.rpc }) => Promise<void>,
  ) => {
    await recheck();
    await operation({ rpc: mock.rpc });
  },
}));
vi.mock("@/lib/recovery-capability", () => ({
  sealRecoveryToken: () => "sealed-token",
}));
vi.mock("@/lib/env", () => ({
  appUrl: () => "https://hub.caedm.ca",
  publicConfig: () => ({ url: "https://fixture.supabase.co", key: "public" }),
}));
import { sendAssistedRecovery } from "@/lib/account-recovery";
const id = "90000000-0000-4000-8000-000000000003";
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unit-fixture-server-credential");
  mock.rpc.mockReset().mockImplementation(async (name: string) => ({
    data:
      name === "account_recovery_console"
        ? {
            require_mfa: false,
            history: [],
            people: [{ id, full_name: "Jane", email: "jane@caedm.ca" }],
          }
        : name === "begin_account_recovery"
          ? {
              id,
              profile_id: id,
              email: "jane@caedm.ca",
              expires_at: "2026-11-20T12:00:00Z",
            }
          : null,
  }));
  mock.access.mockReset().mockResolvedValue({
    actualProfile: { role: "super_admin" },
    access: { tools_allowed: false, preview_role: null },
    db: { rpc: mock.rpc },
  });
  mock.generate.mockReset().mockResolvedValue({
    data: { user: { id }, properties: { hashed_token: "a".repeat(56) } },
  });
  mock.send
    .mockReset()
    .mockResolvedValue({ provider: "resend", providerId: "test-receipt" });
});
test("reset link goes only into the employee email, never the action result", async () => {
  const result = await sendAssistedRecovery(id, "test-password", "");
  expect(result).toEqual({
    email: "jane@caedm.ca",
    expiresAt: "2026-11-20T12:00:00Z",
  });
  expect(JSON.stringify(result)).not.toContain("code=");
  expect(mock.send.mock.calls[0][0]).toMatchObject({
    to: "jane@caedm.ca",
    purpose: "authentication",
  });
  expect(mock.send.mock.calls[0][0].text).toContain(
    "https://hub.caedm.ca/reset-password#",
  );
  expect(mock.rpc).toHaveBeenCalledWith("record_account_recovery_email", {
    recovery: id,
    accepted: true,
    email_provider: "resend",
  });
});
test("delivery rejection is recorded and cannot be reported as success", async () => {
  mock.send.mockRejectedValue(new Error("private transport error"));
  await expect(sendAssistedRecovery(id, "test-password", "")).rejects.toThrow(
    "could not be confirmed",
  );
  expect(mock.rpc).toHaveBeenCalledWith("record_account_recovery_email", {
    recovery: id,
    accepted: false,
    email_provider: null,
  });
});
test("an Auth identity mismatch prevents sending or exposing any capability", async () => {
  mock.generate.mockResolvedValue({
    data: {
      user: { id: "other-user" },
      properties: { hashed_token: "a".repeat(56) },
    },
  });
  await expect(sendAssistedRecovery(id, "test-password", "")).rejects.toThrow(
    "preparation failed",
  );
  expect(mock.send).not.toHaveBeenCalled();
});
