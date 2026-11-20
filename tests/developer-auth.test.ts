import { beforeEach, afterEach, test, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  originalRpc: vi.fn(),
  password: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
  signOut: vi.fn(),
  limit: vi.fn(),
  access: { tools_allowed: true },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({
  requireAccess: async () => ({
    user: { id: "actor", email: "actor@caedm.ca" },
    db: { rpc: mock.originalRpc },
    access: mock.access,
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ limitAuth: mock.limit }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mock.password,
      signOut: mock.signOut,
      mfa: { challenge: mock.challenge, verify: mock.verify },
    },
    isolated: true,
  }),
}));
import { withFreshDeveloperPassword } from "@/lib/developer-auth";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://unit.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  mock.access.tools_allowed = true;
  mock.originalRpc
    .mockReset()
    .mockResolvedValue({ data: { require_mfa: false, people: [] } });
  mock.password
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "actor", factors: [] } } });
  mock.signOut.mockReset().mockResolvedValue({});
  mock.limit.mockReset().mockResolvedValue(undefined);
  mock.challenge.mockReset().mockResolvedValue({ data: { id: "challenge" } });
  mock.verify.mockReset().mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());
test("fresh password uses an isolated client and never replaces the actor browser session", async () => {
  const operation = vi.fn().mockResolvedValue(undefined);
  await withFreshDeveloperPassword("current-password", "", operation);
  expect(mock.password).toHaveBeenCalledWith({
    email: "actor@caedm.ca",
    password: "current-password",
  });
  expect(operation.mock.calls[0][0].isolated).toBe(true);
  expect(mock.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(mock.originalRpc).toHaveBeenCalledTimes(2);
});
test("wrong password and a mismatched identity cannot grant access", async () => {
  const operation = vi.fn();
  mock.password.mockResolvedValue({
    error: new Error("bad password"),
    data: {},
  });
  await expect(
    withFreshDeveloperPassword("bad", "", operation),
  ).rejects.toThrow(/verification failed/);
  expect(operation).not.toHaveBeenCalled();
  expect(mock.signOut).toHaveBeenCalled();
});
test("enrolled MFA requires a valid current code before the guarded action", async () => {
  mock.password.mockResolvedValue({
    data: {
      user: {
        id: "actor",
        factors: [{ id: "factor", status: "verified", factor_type: "totp" }],
      },
    },
  });
  const operation = vi.fn();
  await expect(
    withFreshDeveloperPassword("password", "", operation),
  ).rejects.toThrow(/MFA code/);
  await withFreshDeveloperPassword("password", "123456", operation);
  expect(mock.verify).toHaveBeenCalledWith({
    factorId: "factor",
    challengeId: "challenge",
    code: "123456",
  });
  expect(operation).toHaveBeenCalledTimes(1);
});
test("the shared database MFA policy blocks grants if the actor has no verified authenticator", async () => {
  mock.originalRpc.mockResolvedValue({ data: { require_mfa: true } });
  const operation = vi.fn();
  await expect(
    withFreshDeveloperPassword("password", "123456", operation),
  ).rejects.toThrow(/verified authenticator/);
  expect(operation).not.toHaveBeenCalled();
});
test("revocation during step-up is rechecked against the original session", async () => {
  mock.originalRpc
    .mockResolvedValueOnce({ data: { require_mfa: false } })
    .mockResolvedValueOnce({ error: { message: "revoked" } });
  const operation = vi.fn();
  await expect(
    withFreshDeveloperPassword("password", "", operation),
  ).rejects.toThrow(/no longer valid/);
  expect(operation).not.toHaveBeenCalled();
});
test("preview blocks the step-up action before password authentication", async () => {
  mock.access.tools_allowed = false;
  await expect(
    withFreshDeveloperPassword("password", "", vi.fn()),
  ).rejects.toThrow(/redirect/);
  expect(mock.password).not.toHaveBeenCalled();
});
