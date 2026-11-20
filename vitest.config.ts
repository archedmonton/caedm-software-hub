import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    env: {
      DEVELOPER_EMAIL: "ruban.peppin@caedm.ca",
      DEVELOPER_NAME: "Ruban Peppin",
    },
  },
  resolve: { alias: { "@": process.cwd() } },
});
