import { test, expect } from "vitest";
import { dashboardAttention } from "@/lib/dashboard";
import type { Subscription, Review } from "@/lib/domain";
const now = "2026-11-05";
const record = (values: Partial<Subscription> = {}) =>
  ({
    id: "a",
    name: "Software A",
    status: "active",
    purchase_type: "subscription",
    billing_paused: false,
    next_billing_date: "2026-12-20",
    cancellation_notice_days: 0,
    license_expiry_date: null,
    teams: { name: "Mission Services" },
    ...values,
  }) as Subscription;
const review = (values: Partial<Review> = {}) =>
  ({
    id: "review-a",
    subscription_id: "a",
    owner_id: "me",
    deadline: "2026-11-10",
    response: null,
    ...values,
  }) as Review;
test("overdue work appears before upcoming work, with the earliest deadline first", () => {
  const rows = dashboardAttention(
    [
      record({ id: "next", next_billing_date: "2026-11-08" }),
      record({ id: "recent", license_expiry_date: "2026-11-04" }),
      record({ id: "oldest", license_expiry_date: "2026-10-20" }),
    ],
    [],
    "me",
    now,
  );
  expect(rows.map((r) => r.id)).toEqual(["oldest", "recent", "next"]);
});
test("one software row retains all of its review, decision and expiry reasons", () => {
  const rows = dashboardAttention(
    [
      record({
        next_billing_date: "2026-11-10",
        license_expiry_date: "2026-11-12",
      }),
    ],
    [review()],
    "me",
    now,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].issues.map((i) => i.kind)).toEqual([
    "review",
    "decision",
    "license",
  ]);
  expect(rows[0].issues[0]).toMatchObject({
    mine: true,
    href: "/reviews/review-a",
    action: "Answer review",
  });
});
test("another owner’s review links to viewing and never offers answering", () => {
  expect(
    dashboardAttention(
      [record()],
      [review({ owner_id: "other" })],
      "me",
      now,
    )[0].issues[0],
  ).toMatchObject({ mine: false, action: "View review" });
});
test("expired records remain actionable even when no deadline or license date is present", () => {
  expect(
    dashboardAttention(
      [record({ status: "expired", next_billing_date: null })],
      [],
      "me",
      now,
    )[0].issues[0],
  ).toMatchObject({ kind: "expired", overdue: true, href: "/software/a" });
});
test("archived, cancelled, inaccessible and completed review records do not become attention rows", () => {
  expect(
    dashboardAttention(
      [
        record({ status: "archived" }),
        record({
          id: "cancelled",
          status: "cancelled",
          license_expiry_date: now,
        }),
      ],
      [
        review(),
        review({ subscription_id: "not-in-authorized-input" }),
        review({ subscription_id: "cancelled" }),
      ],
      "me",
      now,
    ),
  ).toEqual([]);
  expect(
    dashboardAttention(
      [record()],
      [review({ response: "still_needed" })],
      "me",
      now,
    ),
  ).toEqual([]);
});
test("paused and one-time records do not create billing decisions, but license expiry still matters", () => {
  expect(
    dashboardAttention(
      [
        record({ billing_paused: true, next_billing_date: now }),
        record({
          id: "once",
          purchase_type: "one_time",
          next_billing_date: now,
        }),
      ],
      [],
      "me",
      now,
    ),
  ).toEqual([]);
  expect(
    dashboardAttention(
      [record({ billing_paused: true, license_expiry_date: now })],
      [],
      "me",
      now,
    )[0].issues[0].kind,
  ).toBe("license");
});
test("only approaching dates within 30 days count; a deadline today is not overdue", () => {
  const rows = dashboardAttention(
    [
      record({ next_billing_date: now }),
      record({ id: "later", license_expiry_date: "2026-12-06" }),
    ],
    [],
    "me",
    now,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].issues[0].overdue).toBe(false);
});
