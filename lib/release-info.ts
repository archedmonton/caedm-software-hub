import "server-only";
import pkg from "@/package.json";
import { releases } from "@/src/lib/releases";
export const currentRelease = releases[0];
export const applicationVersion = pkg.version;
export function buildInformation() {
  const value = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    commit: value && /^[a-f0-9]{40,64}$/i.test(value) ? value : null,
    environment:
      process.env.VERCEL_ENV === "production"
        ? "Production"
        : process.env.VERCEL_ENV === "preview"
          ? "Preview deployment"
          : "Local development",
  };
}
