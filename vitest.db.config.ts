import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/database.test.mjs",
      "tests/reminders.test.mjs",
      "tests/invitations.test.mjs",
      "tests/feature-requests.test.mjs",
      "tests/super-admin.test.mjs",
    ],
    testTimeout: 15000,
  },
});
