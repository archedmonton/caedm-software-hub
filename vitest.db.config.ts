import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/database.test.mjs", "tests/reminders.test.mjs"],
    testTimeout: 15000,
  },
});
