import { describe, test, expect } from "vitest";
import {
  billingReminderDefaults,
  billingReminderSchema,
  billingReminderMessage,
  type BillingNotification,
} from "@/lib/billing-reminders";
const notice: BillingNotification = {
  id: "10000000-0000-4000-8000-000000000001",
  claim_token: "private-test-token",
  email: "employee@caedm.ca",
  full_name: "Example <Employee>",
  subscription_id: "20000000-0000-4000-8000-000000000001",
  software_name: "Research & Planning",
  billing_date: "2026-12-14",
  notice_days: 14,
  days_until_billing: 14,
  amount: "100.00",
  currency: "CAD",
};
describe("billing reminder preferences and professional email content", () => {
  test("defaults are enabled with 14-day and 7-day notices", () =>
    expect(billingReminderSchema.parse(billingReminderDefaults)).toEqual({
      enabled: true,
      only_owned: true,
      first_notice_days: 14,
      second_notice_days: 7,
    }));
  test.each([
    [7, 7],
    [3, 7],
    [1, 0],
    [366, 7],
    [14, 1.5],
  ])(
    "rejects invalid or reversed offsets %s/%s",
    (first_notice_days, second_notice_days) =>
      expect(
        billingReminderSchema.safeParse({
          enabled: true,
          first_notice_days,
          second_notice_days,
        }).success,
      ).toBe(false),
  );
  test("opt-out retains a valid schedule and strips caller-supplied identity", () =>
    expect(
      billingReminderSchema.parse({
        ...billingReminderDefaults,
        enabled: false,
        profile_id: "other-user",
      }),
    ).toEqual({ ...billingReminderDefaults, enabled: false }));
  test("email carries CAEDM branding, exact date, original currency, safe links and escaped user content", () => {
    const message = billingReminderMessage(
      notice,
      "https://caedm-software-hub.vercel.app",
    );
    expect(message.subject).toBe(
      "Upcoming software billing in 14 days: Research & Planning",
    );
    expect(message.text).toContain("2026-12-14");
    expect(message.text).toContain("CAD");
    expect(message.text).toContain("not an invoice");
    expect(message.html).toContain("Example &lt;Employee&gt;");
    expect(message.html).toContain("Research &amp; Planning");
    expect(message.html).toContain("cid:caedm-logo@software-hub.caedm.ca");
    expect(message.html).toContain("/settings#notifications");
    expect(message.text).toContain("Manage your software email notifications");
    expect(message.html).not.toContain(notice.claim_token);
    expect(message.inlineBrandLogo).toBe(true);
  });
  test("email uses singular day and refuses insecure or malformed application targets", () => {
    expect(
      billingReminderMessage(
        { ...notice, days_until_billing: 1 },
        "http://localhost:3100",
      ).subject,
    ).toContain("in 1 day:");
    for (const origin of ["http://example.org", "javascript:alert(1)"])
      expect(() => billingReminderMessage(notice, origin)).toThrow();
    expect(() =>
      billingReminderMessage(
        { ...notice, subscription_id: "../../external" },
        "https://example.org",
      ),
    ).toThrow();
  });
});
