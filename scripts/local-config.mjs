import { execFileSync } from "node:child_process";
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
