import { z } from "zod";
import type { Profile } from "@/lib/domain";

export const referenceKinds = [
  "vendor",
  "category",
  "department",
  "payment",
] as const;
export type ReferenceKind = (typeof referenceKinds)[number];
export type NamedReference = { id: string; name: string };
export type PaymentReference = {
  id: string;
  team_id: string;
  nickname: string;
  last_four: string;
};
export type EditorEmployee = Pick<Profile, "id" | "full_name" | "email">;
export type EditorMember = {
  team_id: string;
  profile_id: string;
  can_manage: boolean;
};
export type ReferenceResult = {
  error?: string;
  field?: "name" | "nickname";
  reference?: NamedReference;
  payment?: PaymentReference;
};
export const referenceNameKey = (name: string) => name.trim().toLowerCase();
export function duplicateReferenceMessage(kind: ReferenceKind) {
  return kind === "payment"
    ? "This payment reference nickname is already in the list for this department. Select the existing reference or use a different nickname."
    : `This ${kind} name is already in the list. Select the existing ${kind} or use a different name.`;
}
export const referenceSchemas = {
  vendor: z.object({
    name: z.string().trim().min(1, "Enter the vendor name.").max(150),
  }),
  category: z.object({
    name: z.string().trim().min(1, "Enter a category name.").max(80),
  }),
  department: z.object({
    name: z.string().trim().min(1, "Enter the department name.").max(100),
  }),
  payment: z.object({
    team_id: z.string().uuid("Select a department first."),
    nickname: z
      .string()
      .trim()
      .min(1, "Enter a payment reference nickname.")
      .max(100),
    brand: z.string().trim().max(40),
    last_four: z.union([
      z.literal(""),
      z
        .string()
        .regex(
          /^\d{4}$/,
          "Enter only the last four digits, or leave this blank.",
        ),
    ]),
    notes: z.string().trim().max(2000),
  }),
};
export const employeeMembershipSchema = z.object({
  team_id: z.string().uuid("Select a department first."),
  profile_id: z.string().uuid("Select an active employee."),
});

export const softwareFieldHelp: Record<
  string,
  { title: string; text: string }
> = {
  vendor_id: {
    title: "Vendor",
    text: "The company supplying or billing for this software. Finance and administrators can choose Add vendor directly below Select a vendor. Existing names, ignoring case and surrounding spaces, must be selected instead of added again.",
  },
  category: {
    title: "Category",
    text: "Group similar software for inventory filters and reports. Add category is directly below Select a category for Finance and administrators. Choose an existing category when its name is already listed; changing case or surrounding spaces does not create a new category.",
  },
  team_id: {
    title: "Department",
    text: "The department responsible for this purchase. Staff access, eligible owners and payment references follow this department. Administrators find Add department directly below Select a department. Existing department names cannot be added again, including case or surrounding-space variants.",
  },
  owner_id: {
    title: "Responsible employee",
    text: "An active, verified department member who receives usage reviews. Add responsible employee appears directly below Unassigned for administrators. Select people already listed; Existing employee adds someone who is not yet a department member. Invite new employee is for a new work email, and password setup must finish before ownership. People are identified by email, since names may be shared. Ownership does not grant edit access.",
  },
  cost_centre: {
    title: "Cost centre",
    text: "Your department's accounting or budget code. Use the code supplied by Finance; this field does not create a department or change access.",
  },
  purchase_type: {
    title: "Purchase type",
    text: "Choose Subscription for recurring charges and One-time purchase for a single payment. A one-time purchase must also use the One-time billing cycle and has no recurring forecast.",
  },
  amount: {
    title: "Billing amount",
    text: "Enter the total charged for one billing cycle in the selected currency, not an annual equivalent or a per-seat estimate. This creates a forecast; Finance records actual expenses separately.",
  },
  currency: {
    title: "Currency",
    text: "Use the currency charged by the vendor. Reports keep currencies separate and do not automatically convert exchange rates.",
  },
  billing_cycle: {
    title: "Billing cycle",
    text: "How often the vendor charges this amount. For Custom, enter the number of months between charges. Keep this consistent with the purchase type.",
  },
  custom_interval_months: {
    title: "Custom interval",
    text: "The whole number of months between recurring charges, from 1 to 120. For example, enter 6 for a charge every six months.",
  },
  billing_start_date: {
    title: "Billing anchor date",
    text: "The original date used to calculate recurring billing dates. A month-end anchor stays aligned with month-end when months have different lengths.",
  },
  next_billing_date: {
    title: "Next billing date",
    text: "The next expected charge or renewal date. Required for subscriptions and on or after the billing anchor date. This is a forecast, not a recorded expense.",
  },
  cancellation_notice_days: {
    title: "Cancellation notice",
    text: "The calendar days of notice required by the vendor before renewal. The decision deadline is the renewal date minus this number; enter 0 when no advance notice is required.",
  },
  review_frequency_months: {
    title: "Usage review frequency",
    text: "The minimum number of months between usage reviews. Reminder rules and the renewal decision deadline determine when an eligible owner is contacted.",
  },
  auto_renew: {
    title: "Automatic renewal",
    text: "Indicates whether the vendor renews the subscription automatically. Changing this record does not change or cancel the vendor contract.",
  },
  billing_paused: {
    title: "Billing paused",
    text: "Temporarily excludes this subscription from recurring payment forecasts and reminder delivery. Historical expenses remain. Resume billing here when charges restart.",
  },
  license_expiry_date: {
    title: "License expiry date",
    text: "When the right to use the software ends. Leave blank if unknown or not applicable. This can differ from the next payment date.",
  },
  licenses_purchased: {
    title: "Licenses purchased",
    text: "The total number of seats or licenses paid for. Use a whole number. This does not multiply the billing amount automatically.",
  },
  licenses_used: {
    title: "Licenses in use",
    text: "How many purchased licenses are currently assigned or used. Leave blank if unknown; this cannot exceed licenses purchased.",
  },
  payment_method_id: {
    title: "Payment reference",
    text: "A department-specific nickname with optional card brand and last four digits. Finance and administrators find Add payment reference directly below No payment reference after selecting a department. Duplicate nicknames are rejected within that department, ignoring case and surrounding spaces. Never enter a full card number, CVV, bank credentials or passwords.",
  },
  invoice_reference: {
    title: "Invoice reference",
    text: "An invoice number or a link to the invoice in an approved document system. Do not include credentials or confidential access tokens in a URL.",
  },
  internal_reference: {
    title: "Internal reference",
    text: "Your purchase order, approval or internal tracking reference. It does not record a payment or grant access to a document.",
  },
  status: {
    title: "Status",
    text: "Active and Trial are current purchases. Pending cancellation remains in forecasts until marked Cancelled. Cancelled, Expired and Archived are excluded from active forecasts; historical expenses remain.",
  },
};
