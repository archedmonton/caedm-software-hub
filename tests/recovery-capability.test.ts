import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  openRecoveryToken,
  sealRecoveryToken,
} from "@/lib/recovery-capability";
beforeEach(() =>
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "local-test-key-never-production"),
);
afterEach(() => vi.unstubAllEnvs());
test("Auth recovery token stays encrypted with independently randomized authenticated ciphertext", () => {
  const token = "a".repeat(64);
  const first = sealRecoveryToken(token);
  expect(first).not.toContain(token);
  expect(sealRecoveryToken(token)).not.toBe(first);
  expect(openRecoveryToken(first)).toBe(token);
});
test("tampering, malformed payloads and key rotation fail closed", () => {
  const sealed = sealRecoveryToken("a".repeat(64));
  const parts = sealed.split(".");
  parts[3] = Buffer.alloc(64, 9).toString("base64url");
  expect(() => openRecoveryToken(parts.join("."))).toThrow();
  expect(() => openRecoveryToken("bad")).toThrow();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "rotated-local-test-key");
  expect(() => openRecoveryToken(sealed)).toThrow();
});
