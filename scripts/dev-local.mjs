import { spawn } from "node:child_process";
import { localConfig } from "./local-config.mjs";
const config = localConfig();
const port = process.env.PORT || "3100";
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--port", port],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-local",
      NEXT_PUBLIC_SUPABASE_URL: config.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        config.PUBLISHABLE_KEY || config.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY,
      APP_URL: `http://localhost:${port}`,
      EMAIL_PROVIDER: "local",
      CRON_SECRET:
        process.env.CRON_SECRET ||
        "local-development-job-secret-at-least-32-characters",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
