import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const context = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  run: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  requireAccess: async () => ({
    profile: { id: "90000000-0000-4000-8000-000000000003" },
    db: { from: context.from },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ runReminders: context.run }));
import { saveBillingReminderPreferences } from "@/app/(hub)/settings/reminder-actions";
import { GET, POST } from "@/app/api/jobs/reminders/route";
beforeEach(() => {
  context.from.mockReset().mockReturnValue({ upsert: context.upsert });
  context.upsert.mockReset().mockResolvedValue({ error: null });
  context.run.mockReset().mockResolvedValue({ sent: 1, failed: 0 });
});
afterEach(() => vi.unstubAllEnvs());
test("personal preference actions bind identity to the signed-in user and discard forged fields", async () => {
  const result = await saveBillingReminderPreferences({
    profile_id: "other-user",
    enabled: true,
    first_notice_days: 21,
    second_notice_days: 3,
    role: "admin",
  });
  expect(result.success).toBeTruthy();
  expect(context.upsert).toHaveBeenCalledWith(
    {
      profile_id: "90000000-0000-4000-8000-000000000003",
      enabled: true,
      only_owned: true,
      first_notice_days: 21,
      second_notice_days: 3,
    },
    { onConflict: "profile_id" },
  );
});
test("invalid schedule is rejected before any write and database errors never expose raw responses", async () => {
  expect(
    await saveBillingReminderPreferences({
      enabled: true,
      first_notice_days: 3,
      second_notice_days: 7,
    }),
  ).toHaveProperty("error");
  expect(context.from).not.toHaveBeenCalled();
  context.upsert.mockResolvedValue({
    error: { message: "raw database detail" },
  });
  expect(
    (
      await saveBillingReminderPreferences({
        enabled: true,
        first_notice_days: 14,
        second_notice_days: 7,
      })
    ).error,
  ).not.toContain("raw database");
});
test("GET cron and POST job endpoints both reject missing or incorrect credentials", async () => {
  vi.stubEnv("CRON_SECRET", "test-only-".padEnd(40, "x"));
  for (const handler of [GET, POST])
    for (const authorization of ["", "Bearer incorrect"])
      expect(
        (
          await handler(
            new NextRequest("http://localhost/api/jobs/reminders", {
              headers: { authorization },
            }),
          )
        ).status,
      ).toBe(401);
  expect(context.run).not.toHaveBeenCalled();
});
test("authenticated Vercel cron uses the same worker and disables response caching", async () => {
  const secret = "test-only-".padEnd(40, "x");
  vi.stubEnv("CRON_SECRET", secret);
  const response = await GET(
    new NextRequest("http://localhost/api/jobs/reminders", {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(context.run).toHaveBeenCalledOnce();
});
