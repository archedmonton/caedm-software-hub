import { describe, it, expect } from "vitest";
import {
  workEmail,
  password,
  projectedEvents,
  equivalents,
  currencyTotals,
  cents,
  decisionDeadline,
  financeRole,
  csv,
  safeCell,
  type Subscription,
} from "../lib/domain";
import {
  registerRows,
  expenseRows,
  reportFilters,
  type RecordedExpense,
} from "../lib/reports";
const base = {
  id: "40000000-0000-4000-8000-000000000001",
  name: "Demo",
  vendor_id: "20000000-0000-4000-8000-000000000001",
  team_id: "10000000-0000-4000-8000-000000000001",
  owner_id: null,
  category: "Productivity",
  description: "",
  website: "",
  cost_centre: "DEMO",
  purchase_date: "2026-01-31",
  purchase_type: "subscription",
  amount: "120.00",
  currency: "CAD",
  billing_cycle: "monthly",
  custom_interval_months: 1,
  billing_start_date: "2026-01-31",
  next_billing_date: "2026-01-31",
  auto_renew: true,
  billing_paused: false,
  license_expiry_date: null,
  cancellation_notice_days: 30,
  licenses_purchased: 1,
  licenses_used: null,
  license_notes: "",
  payment_method_id: null,
  invoice_reference: "",
  internal_reference: "",
  notes: "",
  status: "active",
  review_frequency_months: 12,
  last_reviewed_at: null,
  created_at: "2026-01-31T00:00:00Z",
} satisfies Subscription;
const dates = (s: Subscription, from: string, to: string) =>
  projectedEvents(s, from, to).map((e) => e.date);
describe("organization access", () => {
  it.each(["one@caedm.ca", "ONE@CAEDM.CA"])(
    "accepts exact work domain %s",
    (email) => expect(workEmail.safeParse(email).success).toBe(true),
  );
  it.each([
    "one@gmail.com",
    "one@caedm.ca.evil.test",
    "one@sub.caedm.ca",
    "one@@caedm.ca",
  ])("rejects lookalike %s", (email) =>
    expect(workEmail.safeParse(email).success).toBe(false),
  );
  it("requires a strong password", () => {
    expect(password.safeParse("StrongPassword123").success).toBe(true);
    expect(password.safeParse("short1A").success).toBe(false);
  });
  it("grants financial exports only to finance and admins", () => {
    expect(["admin", "finance", "staff", "pending"].map(financeRole)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
describe("billing anchors and recurrence", () => {
  it("preserves Jan 31 through February and March", () =>
    expect(dates(base, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]));
  it("preserves leap-day intent in annual billing", () =>
    expect(
      dates(
        {
          ...base,
          billing_cycle: "annually",
          billing_start_date: "2024-02-29",
          next_billing_date: "2024-02-29",
        },
        "2025-01-01",
        "2028-03-01",
      ),
    ).toEqual(["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]));
  it("handles quarterly month ends", () =>
    expect(
      dates(
        { ...base, billing_cycle: "quarterly" },
        "2026-02-01",
        "2026-12-31",
      ),
    ).toEqual(["2026-04-30", "2026-07-31", "2026-10-31"]));
  it("supports custom intervals", () =>
    expect(
      dates(
        { ...base, billing_cycle: "custom", custom_interval_months: 2 },
        "2026-01-01",
        "2026-06-01",
      ),
    ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]));
  it("finds future occurrences when next billing is stale", () =>
    expect(dates(base, "2026-09-01", "2026-11-30")).toEqual([
      "2026-09-30",
      "2026-10-31",
      "2026-11-30",
    ]));
  it("treats explicit next date as authoritative without double counting", () =>
    expect(
      dates(
        { ...base, next_billing_date: "2026-02-15" },
        "2026-02-01",
        "2026-03-31",
      ),
    ).toEqual(["2026-02-15", "2026-02-28", "2026-03-31"]));
  it("does not project beyond a pending cancellation", () =>
    expect(
      dates(
        { ...base, status: "pending_cancellation" },
        "2026-01-01",
        "2026-05-01",
      ),
    ).toEqual(["2026-01-31"]));
  it("does not project beyond a disabled auto-renew", () =>
    expect(
      dates({ ...base, auto_renew: false }, "2026-01-01", "2026-05-01"),
    ).toEqual(["2026-01-31"]));
  it.each(["cancelled", "archived", "expired"] as const)(
    "excludes %s records from projections",
    (status) =>
      expect(
        projectedEvents({ ...base, status }, "2026-01-01", "2026-12-31"),
      ).toEqual([]),
  );
  it("excludes one-time purchases from all recurring calculations", () => {
    const once = {
      ...base,
      purchase_type: "one_time" as const,
      billing_cycle: "one_time" as const,
    };
    expect(equivalents(once)).toEqual({ monthly: 0, annual: 0 });
    expect(projectedEvents(once, "2026-01-01", "2026-12-31")).toEqual([]);
  });
  it("calculates notice deadlines across year boundaries", () =>
    expect(decisionDeadline({ ...base, next_billing_date: "2027-01-15" })).toBe(
      "2026-12-16",
    ));
  it("calculates annual/monthly equivalents without adding currencies", () => {
    expect(equivalents({ ...base, billing_cycle: "annually" })).toEqual({
      monthly: 1000,
      annual: 12000,
    });
    expect(
      currencyTotals(
        [base, { ...base, currency: "USD", amount: "10.25" }],
        (s) => cents(s.amount),
        (s) => s.currency,
      ),
    ).toEqual({ CAD: 12000, USD: 1025 });
  });
  it("stores arithmetic in cents", () =>
    expect(cents("0.29") + cents("0.01")).toBe(30));
});
describe("finance exports", () => {
  it.each(["=SUM(A1)", "+1", "-1", "@SUM(A1)", "\t=1", "\r+1"])(
    "escapes formula-like text %s",
    (value) => expect(safeCell(value).startsWith("'")).toBe(true),
  );
  it("quotes commas, newlines, and quotation marks in CSV", () =>
    expect(csv([{ Name: 'A,"B"\nC' }])).toContain('"A,""B""\nC"'));
  it("exports register rows independently from expenses", () => {
    const filters = reportFilters.parse({});
    expect(registerRows([base], filters)).toHaveLength(1);
    expect(expenseRows([], [base], filters)).toHaveLength(0);
  });
  it("uses recorded historical snapshots for expense reports", () => {
    const e = {
      id: "x",
      subscription_id: base.id,
      transaction_date: "2026-03-01",
      amount: "10.00",
      tax: "0.50",
      currency: "USD",
      invoice_reference: "INV",
      notes: "",
      vendor_name: "Historic Vendor",
      team_name: "Historic Team",
      team_id: base.team_id,
      cost_centre: "OLD",
      payment_reference: "Historic Card",
      payment_method_id: null,
    } satisfies RecordedExpense;
    const rows = expenseRows(
      [e],
      [base],
      reportFilters.parse({ report: "expenses" }),
    );
    expect(rows[0]).toMatchObject({
      Vendor: "Historic Vendor",
      Department: "Historic Team",
      Total: 10.5,
      Currency: "USD",
    });
  });
  it("rejects inverted report date ranges", () =>
    expect(
      reportFilters.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success,
    ).toBe(false));
});

it("paused billing removes projected and recurring commitments", () => {
  const s = { ...base, billing_paused: true };
  expect(equivalents(s)).toEqual({ monthly: 0, annual: 0 });
  expect(projectedEvents(s, "2026-01-01", "2026-12-31")).toEqual([]);
});
it("rejects impossible calendar dates in report filters", () =>
  expect(reportFilters.safeParse({ from: "2026-02-30" }).success).toBe(false));
it("fails visibly rather than silently rounding unsafe currency totals", () =>
  expect(() =>
    currencyTotals(
      [Number.MAX_SAFE_INTEGER, 1],
      (v) => v,
      () => "CAD",
    ),
  ).toThrow("precision"));
