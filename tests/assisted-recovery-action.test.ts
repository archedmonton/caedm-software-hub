import { beforeEach, afterEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  worker: vi.fn(),
  otp: vi.fn(),
  update: vi.fn(),
  out: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: mock.rpc,
    auth: { verifyOtp: mock.otp, updateUser: mock.update, signOut: mock.out },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mock.worker }),
}));
vi.mock("@/lib/rate-limit", () => ({ limitAuth: mock.limit }));
vi.mock("@/lib/recovery-capability", () => ({
  openRecoveryToken: () => "a".repeat(64),
}));
import { completeRecovery } from "@/app/auth/assisted-recovery/actions";
const id = "90000000-0000-4000-8000-000000000003";
function form() {
  const f = new FormData();
  f.set("recovery", id);
  f.set("code", "b".repeat(64));
  f.set("password", "PrivateNewPassword123");
  f.set("confirmation", "PrivateNewPassword123");
  return f;
}
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "local-auth-only-fixture");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-fixture");
  mock.rpc.mockReset().mockResolvedValue({ data: id });
  mock.worker
    .mockReset()
    .mockResolvedValue({
      data: { profile_id: id, sealed_token: "ciphertext" },
    });
  mock.otp.mockReset().mockResolvedValue({ data: { user: { id } } });
  mock.update.mockReset().mockResolvedValue({});
  mock.out.mockReset().mockResolvedValue({});
  mock.limit.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
test("invalid/expired/replaced code cannot create an Auth session or reach the recovery worker", async () => {
  mock.rpc.mockResolvedValue({ data: null });
  expect((await completeRecovery({}, form())).error).toContain(
    "invalid, expired or replaced",
  );
  expect(mock.worker).not.toHaveBeenCalled();
  expect(mock.otp).not.toHaveBeenCalled();
  expect(mock.update).not.toHaveBeenCalled();
});
test("a reissue or lease denial between validation and claim fails before OTP", async () => {
  mock.worker.mockResolvedValue({ data: null });
  expect((await completeRecovery({}, form())).error).toContain(
    "invalid, expired or replaced",
  );
  expect(mock.otp).not.toHaveBeenCalled();
});
test("successful recovery changes only the verified user's password and signs out", async () => {
  expect(await completeRecovery({}, form())).toEqual({ success: true });
  expect(mock.otp).toHaveBeenCalledWith({
    type: "recovery",
    token_hash: "a".repeat(64),
  });
  expect(mock.update).toHaveBeenCalledWith({
    password: "PrivateNewPassword123",
  });
  expect(mock.out).toHaveBeenCalledWith({ scope: "local" });
});
test("unexpected Auth identity never receives a password update", async () => {
  mock.otp.mockResolvedValue({ data: { user: { id: "another-identity" } } });
  expect((await completeRecovery({}, form())).error).toContain("already used");
  expect(mock.update).not.toHaveBeenCalled();
  expect(mock.out).toHaveBeenCalled();
});
test("mismatched passwords and malformed codes fail before any privileged operation", async () => {
  const f = form();
  f.set("confirmation", "different");
  expect((await completeRecovery({}, f)).error).toContain("do not match");
  f.set("code", "bad");
  await completeRecovery({}, f);
  expect(mock.limit).not.toHaveBeenCalled();
  expect(mock.worker).not.toHaveBeenCalled();
});
