import {
  cents,
  calendarDate,
  equivalents,
  type Subscription,
  type Expense,
} from "@/lib/domain";
import { z } from "zod";
const optionalId = z.union([z.string().uuid(), z.literal("")]).optional();
const optionalDate = z.union([calendarDate, z.literal("")]).optional();
export const reportFilters = z
  .object({
    report: z.enum(["register", "expenses"]).default("register"),
    format: z.enum(["csv", "xlsx"]).default("csv"),
    from: optionalDate,
    to: optionalDate,
    team: optionalId,
    payment: optionalId,
    vendor: optionalId,
    status: z
      .enum([
        "",
        "active",
        "trial",
        "pending_cancellation",
        "cancelled",
        "expired",
        "archived",
      ])
      .optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Start date must be on or before end date.",
  });
export type Filters = z.infer<typeof reportFilters>;
export function matchesSoftware(s: Subscription, f: Filters) {
  return (
    (!f.team || s.team_id === f.team) &&
    (!f.payment || s.payment_method_id === f.payment) &&
    (!f.vendor || s.vendor_id === f.vendor) &&
    (!f.status || s.status === f.status)
  );
}
export function registerRows(software: Subscription[], f: Filters) {
  return software
    .filter(
      (s) =>
        matchesSoftware(s, f) &&
        (!f.from || s.purchase_date >= f.from) &&
        (!f.to || s.purchase_date <= f.to),
    )
    .map((s) => ({
      ID: s.id,
      Software: s.name,
      Vendor: s.vendors?.name || "",
      Website: s.website,
      Category: s.category,
      Description: s.description,
      Department: s.teams?.name || "",
      Owner: s.profiles?.full_name || "Unassigned",
      "Cost centre": s.cost_centre,
      "Purchase date": s.purchase_date,
      "Purchase type": s.purchase_type,
      "Billing amount": cents(s.amount) / 100,
      Currency: s.currency,
      "Billing cycle": s.billing_cycle,
      "Interval months": s.custom_interval_months,
      "Monthly equivalent": equivalents(s).monthly / 100,
      "Annual equivalent": equivalents(s).annual / 100,
      "Billing anchor": s.billing_start_date,
      "Next billing date": s.next_billing_date || "",
      "Auto renew": s.auto_renew ? "Yes" : "No",
      "Cancellation notice days": s.cancellation_notice_days,
      "Payment reference": s.payment_methods?.nickname || "",
      "Card brand": s.payment_methods?.brand || "",
      "Last four": s.payment_methods?.last_four || "",
      "Licenses purchased": s.licenses_purchased,
      "Licenses used": s.licenses_used ?? "",
      "License notes": s.license_notes,
      "Invoice reference": s.invoice_reference,
      "Internal reference": s.internal_reference,
      Status: s.status,
      Notes: s.notes,
    }));
}
export type RecordedExpense = Expense & {
  vendor_name: string;
  team_name: string;
  team_id: string;
  cost_centre: string;
  payment_reference: string;
  payment_method_id: string | null;
};
export function filteredExpenses(
  expenses: RecordedExpense[],
  software: Subscription[],
  f: Filters,
) {
  const byId = new Map(software.map((s) => [s.id, s]));
  return expenses.filter((e) => {
    const s = byId.get(e.subscription_id);
    return (
      s &&
      (!f.from || e.transaction_date >= f.from) &&
      (!f.to || e.transaction_date <= f.to) &&
      (!f.team || e.team_id === f.team) &&
      (!f.payment || e.payment_method_id === f.payment) &&
      (!f.vendor || s.vendor_id === f.vendor) &&
      (!f.status || s.status === f.status)
    );
  });
}
export function expenseRows(
  expenses: RecordedExpense[],
  software: Subscription[],
  f: Filters,
) {
  const byId = new Map(software.map((s) => [s.id, s]));
  return filteredExpenses(expenses, software, f).map((e) => ({
    ID: e.id,
    Software: byId.get(e.subscription_id)?.name || "",
    Vendor: e.vendor_name,
    Department: e.team_name,
    "Cost centre": e.cost_centre,
    "Transaction date": e.transaction_date,
    "Accounting period": e.transaction_date.slice(0, 7),
    "Amount excluding tax": cents(e.amount) / 100,
    Tax: cents(e.tax) / 100,
    Total: (cents(e.amount) + cents(e.tax)) / 100,
    Currency: e.currency,
    "Payment reference": e.payment_reference,
    "Invoice reference": e.invoice_reference,
    Notes: e.notes,
  }));
}
