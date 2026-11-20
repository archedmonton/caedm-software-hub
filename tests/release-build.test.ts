import { afterEach, test, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  buildInformation,
  applicationVersion,
  currentRelease,
} from "@/lib/release-info";
afterEach(() => vi.unstubAllEnvs());
test("About and navigation expose the package version and latest matching release", () => {
  expect(applicationVersion).toBe(currentRelease.version);
});
test("local builds never invent a commit", () => {
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
  expect(buildInformation()).toEqual({
    commit: null,
    environment: "Local development",
  });
});
test("deployed builds use the full valid Vercel SHA and reject invalid metadata", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
  expect(buildInformation()).toEqual({
    commit: "a".repeat(40),
    environment: "Production",
  });
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "not-a-real-commit");
  expect(buildInformation().commit).toBeNull();
});
