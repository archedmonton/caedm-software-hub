import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  parseISO,
} from "date-fns";
import { z } from "zod";

export const roles = ["admin", "finance", "staff"] as const;
export const statuses = [
  "trial",
  "active",
  "pending_cancellation",
  "cancelled",
  "expired",
  "archived",
] as const;
export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: (typeof roles)[number];
  status: string;
};
export type Team = { id: string; name: string };
export type Subscription = {
  id: string;
  name: string;
  vendor_id: string;
  team_id: string;
  owner_id: string | null;
  category: string;
  description: string;
  website: string;
  cost_centre: string;
  purchase_date: string;
  purchase_type: "subscription" | "one_time";
  amount: string | number;
  currency: string;
  billing_cycle: "monthly" | "quarterly" | "annually" | "custom" | "one_time";
  custom_interval_months: number;
  billing_start_date: string;
  next_billing_date: string | null;
  auto_renew: boolean;
  billing_paused: boolean;
  license_expiry_date: string | null;
  cancellation_notice_days: number;
  licenses_purchased: number;
  licenses_used: number | null;
  license_notes: string;
  payment_method_id: string | null;
  invoice_reference: string;
  internal_reference: string;
  notes: string;
  status: (typeof statuses)[number];
  review_frequency_months: number;
  last_reviewed_at: string | null;
  created_at: string;
  vendors?: { name: string };
  teams?: { name: string };
  profiles?: { full_name: string };
  payment_methods?: {
    nickname: string;
    last_four: string;
    brand: string;
  } | null;
};
export type Expense = {
  id: string;
  subscription_id: string;
  transaction_date: string;
  amount: string | number;
  tax: string | number;
  currency: string;
  invoice_reference: string;
  notes: string;
  subscription?: Subscription;
};
export type Review = {
  id: string;
  subscription_id: string;
  owner_id: string | null;
  renewal_date: string;
  deadline: string;
  response: string | null;
  comment: string;
  responded_at: string | null;
  escalated_at: string | null;
  software_subscriptions?: Subscription;
};
export const workEmail = z
  .string()
  .trim()
  .email()
  .refine(
    (v) => v.toLowerCase().split("@")[1] === "caedm.ca",
    "Use your @caedm.ca work email.",
  );
export const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128)
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.");
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(parseISO(v).getTime()) &&
      format(parseISO(v), "yyyy-MM-dd") === v,
    "Enter a valid date.",
  );
const optionalDate = z
  .union([calendarDate, z.literal("")])
  .transform((v) => v || null);
const url = z.union([
  z.literal(""),
  z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), "Use an HTTP or HTTPS link."),
]);
export const moneyInput = z
  .string()
  .regex(
    /^\d{1,10}(\.\d{1,2})?$/,
    "Enter a positive amount with at most two decimal places.",
  );
export const subscriptionSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    vendor_id: z.string().uuid(),
    team_id: z.string().uuid(),
    owner_id: z
      .union([z.string().uuid(), z.literal("")])
      .transform((v) => v || null),
    category: z.string().trim().min(1).max(80),
    description: z.string().max(3000),
    website: url,
    cost_centre: z.string().max(80),
    purchase_date: calendarDate,
    purchase_type: z.enum(["subscription", "one_time"]),
    amount: moneyInput,
    currency: z.string().regex(/^[A-Z]{3}$/),
    billing_cycle: z.enum([
      "monthly",
      "quarterly",
      "annually",
      "custom",
      "one_time",
    ]),
    custom_interval_months: z.coerce.number().int().min(1).max(120),
    billing_start_date: calendarDate,
    next_billing_date: optionalDate,
    auto_renew: z.boolean(),
    billing_paused: z.boolean().default(false),
    license_expiry_date: optionalDate,
    cancellation_notice_days: z.coerce.number().int().min(0).max(730),
    licenses_purchased: z.coerce.number().int().min(0).max(1000000),
    licenses_used: z
      .union([z.literal(""), z.coerce.number().int().min(0)])
      .transform((v) => (v === "" ? null : v)),
    license_notes: z.string().max(3000),
    payment_method_id: z
      .union([z.string().uuid(), z.literal("")])
      .transform((v) => v || null),
    invoice_reference: z.string().max(500),
    internal_reference: z.string().max(100),
    notes: z.string().max(5000),
    status: z.enum(statuses),
    review_frequency_months: z.coerce.number().int().min(1).max(120),
  })
  .superRefine((v, ctx) => {
    if (v.licenses_used !== null && v.licenses_used > v.licenses_purchased)
      ctx.addIssue({
        code: "custom",
        path: ["licenses_used"],
        message: "Used licenses cannot exceed purchased licenses.",
      });
    if ((v.purchase_type === "one_time") !== (v.billing_cycle === "one_time"))
      ctx.addIssue({
        code: "custom",
        path: ["billing_cycle"],
        message: "Purchase type and billing cycle must agree.",
      });
    if (v.purchase_type === "subscription" && !v.next_billing_date)
      ctx.addIssue({
        code: "custom",
        path: ["next_billing_date"],
        message: "A renewal date is required.",
      });
    if (v.next_billing_date && v.next_billing_date < v.billing_start_date)
      ctx.addIssue({
        code: "custom",
        path: ["next_billing_date"],
        message: "Renewal must be on or after the billing start date.",
      });
  });
export const expenseSchema = z.object({
  subscription_id: z.string().uuid(),
  transaction_date: calendarDate,
  amount: moneyInput,
  tax: moneyInput,
  currency: z.string().regex(/^[A-Z]{3}$/),
  invoice_reference: z.string().max(500),
  notes: z.string().max(3000),
});
export const reviewSchema = z.object({
  id: z.string().uuid(),
  response: z.enum(["still_needed", "not_needed", "unsure"]),
  comment: z.string().max(3000),
});
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function cents(value: string | number): number {
  const [whole, frac = ""] = String(value).split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
}
export function intervalMonths(
  s: Pick<Subscription, "billing_cycle" | "custom_interval_months">,
) {
  return {
    monthly: 1,
    quarterly: 3,
    annually: 12,
    custom: s.custom_interval_months,
    one_time: 0,
  }[s.billing_cycle];
}
export function recurring(s: Subscription) {
  return (
    !s.billing_paused &&
    s.purchase_type === "subscription" &&
    ["active", "trial"].includes(s.status)
  );
}
export function equivalents(s: Subscription) {
  const months = intervalMonths(s);
  const annual =
    recurring(s) && months ? Math.round((cents(s.amount) * 12) / months) : 0;
  return { monthly: Math.round(annual / 12), annual };
}
export function decisionDeadline(
  s: Subscription,
  renewal = s.next_billing_date,
) {
  return renewal
    ? format(
        addDays(parseISO(renewal), -s.cancellation_notice_days),
        "yyyy-MM-dd",
      )
    : null;
}
export type BillingEvent = {
  subscription: Subscription;
  date: string;
  amount: number;
  currency: string;
};
// Every occurrence is derived from the original billing anchor, preserving Jan 31 / leap-day intent.
export function projectedEvents(
  s: Subscription,
  from: string,
  to: string,
): BillingEvent[] {
  if (
    s.billing_paused ||
    from > to ||
    !s.next_billing_date ||
    !["active", "trial", "pending_cancellation"].includes(s.status) ||
    s.purchase_type === "one_time"
  )
    return [];
  const months = intervalMonths(s);
  if (!months) return [];
  const anchor = parseISO(s.billing_start_date);
  const next = s.next_billing_date;
  const start = parseISO(from);
  const delta =
    (start.getFullYear() - anchor.getFullYear()) * 12 +
    start.getMonth() -
    anchor.getMonth();
  let index = Math.max(0, Math.floor(delta / months) - 1);
  const events: BillingEvent[] = [];
  // The explicitly recorded next charge is authoritative, even after an exceptional billing date adjustment.
  if (next >= from && next <= to)
    events.push({
      subscription: s,
      date: next,
      amount: cents(s.amount),
      currency: s.currency,
    });
  if (!s.auto_renew || s.status === "pending_cancellation") return events;
  for (let guard = 0; guard < 2400; guard++, index++) {
    const occurrence = format(addMonths(anchor, index * months), "yyyy-MM-dd");
    if (occurrence > to) break;
    if (occurrence > next && occurrence >= from)
      events.push({
        subscription: s,
        date: occurrence,
        amount: cents(s.amount),
        currency: s.currency,
      });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
export function currencyTotals<T>(
  rows: T[],
  amount: (row: T) => number,
  currency: (row: T) => string,
) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const code = currency(row);
    acc[code] = (acc[code] || 0) + amount(row);
    if (!Number.isSafeInteger(acc[code]))
      throw new Error("Currency total exceeds safe reporting precision.");
    return acc;
  }, {});
}
export function money(value: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    value / 100,
  );
}
export function dueIn(dateValue: string, reference = today()) {
  return differenceInCalendarDays(parseISO(dateValue), parseISO(reference));
}
export function financeRole(role: string) {
  return role === "admin" || role === "finance";
}
export function safeCell(value: unknown): string {
  const text = String(value ?? "");
  return /^[\s\u0000-\u001f]*[=+@-]/.test(text)
    ? "'" + text
    : text.replace(/\u0000/g, "");
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  return (
    "\uFEFF" +
    [keys, ...rows.map((row) => keys.map((k) => safeCell(row[k])))]
      .map((row) =>
        row
          .map((cell) => '"' + String(cell).replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\r\n")
  );
}
