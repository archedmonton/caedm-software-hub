import { execFileSync } from "node:child_process";
// Public test fixture, used only after validating the loopback Supabase target.
// Never configure this value in a hosted deployment.
export const localEmailHookSecret = `v1,whsec_${Buffer.from("local-only-email-hook-test-key-32").toString("base64")}`;
export const localResendWebhookSecret = `whsec_${Buffer.from("local-only-resend-webhook-test-32").toString("base64")}`;
export function localConfig() {
  const output = execFileSync(
    process.execPath,
    ["node_modules/supabase/dist/supabase.js", "status", "-o", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const config = JSON.parse(output.slice(output.indexOf("{")));
  if (!["127.0.0.1", "localhost"].includes(new URL(config.API_URL).hostname))
    throw new Error("Refusing to use a non-local integration-test target.");
  return config;
}
