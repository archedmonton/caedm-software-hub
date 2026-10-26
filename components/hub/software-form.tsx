"use client";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/hub/controls";
import { saveSoftware, type Result } from "@/app/(hub)/actions";
import {
  subscriptionSchema,
  statuses,
  today,
  type Subscription,
  type Team,
  type Profile,
} from "@/lib/domain";
type Reference = { id: string; name: string };
type Payment = {
  id: string;
  team_id: string;
  nickname: string;
  last_four: string;
};
type Member = { team_id: string; profile_id: string; can_manage: boolean };
export function SoftwareForm({
  existing,
  teams,
  vendors,
  people,
  payments,
  members,
  currencies,
}: {
  existing?: Subscription;
  teams: Team[];
  vendors: Reference[];
  people: Profile[];
  payments: Payment[];
  members: Member[];
  currencies: string[];
}) {
  const defaults: Record<string, string | boolean> = {
    name: "",
    vendor_id: "",
    team_id: "",
    owner_id: "",
    category: "Productivity",
    description: "",
    website: "",
    cost_centre: "",
    purchase_date: today(),
    purchase_type: "subscription",
    amount: "0.00",
    currency: "CAD",
    billing_cycle: "monthly",
    custom_interval_months: "1",
    billing_start_date: today(),
    next_billing_date: today(),
    auto_renew: true,
    billing_paused: false,
    license_expiry_date: "",
    cancellation_notice_days: "0",
    licenses_purchased: "1",
    licenses_used: "",
    license_notes: "",
    payment_method_id: "",
    invoice_reference: "",
    internal_reference: "",
    notes: "",
    status: "active",
    review_frequency_months: "12",
  };
  if (existing)
    for (const key of Object.keys(defaults)) {
      const value = existing[key as keyof Subscription];
      defaults[key] = typeof value === "boolean" ? value : String(value ?? "");
    }
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<Record<string, string | boolean>>({ defaultValues: defaults });
  const team = useWatch({ control, name: "team_id" });
  const cycle = useWatch({ control, name: "billing_cycle" });
  const [result, setResult] = useState<Result>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const input = (
    name: string,
    label: string,
    type = "text",
    extra: Record<string, unknown> = {},
  ) => (
    <label key={name}>
      {label}
      <input
        type={type}
        {...register(name)}
        {...extra}
        aria-invalid={Boolean(errors[name])}
      />
      {errors[name] && (
        <span className="field-error">{errors[name]?.message}</span>
      )}
    </label>
  );
  const select = (
    name: string,
    label: string,
    options: [string, string][],
    required = true,
  ) => (
    <label>
      {label}
      <select
        {...register(name)}
        required={required}
        aria-invalid={Boolean(errors[name])}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {errors[name] && (
        <span className="field-error">{errors[name]?.message}</span>
      )}
    </label>
  );
  return (
    <form
      onSubmit={handleSubmit((values) => {
        const parsed = subscriptionSchema.safeParse(values);
        if (!parsed.success) {
          parsed.error.issues.forEach((issue) =>
            setError(String(issue.path[0]), { message: issue.message }),
          );
          setResult({ error: "Please review the highlighted fields." });
          return;
        }
        if (
          existing &&
          values.status !== existing.status &&
          !window.confirm(
            "Confirm the subscription status change? This does not change your subscription with the vendor.",
          )
        )
          return;
        start(async () => {
          const outcome = await saveSoftware(existing?.id || null, values);
          setResult(outcome);
          if (outcome.id) {
            router.push(`/software/${outcome.id}`);
            router.refresh();
          }
        });
      })}
      className="software-form"
    >
      <section className="panel form-section">
        <div>
          <span className="section-number">01</span>
          <h2>Basic information</h2>
          <p>Identify the software and who looks after it.</p>
        </div>
        <div className="form-grid">
          {input("name", "Software name", "text", {
            required: true,
            maxLength: 150,
          })}
          {select("vendor_id", "Vendor", [
            ["", "Select a vendor"],
            ...vendors.map((v) => [v.id, v.name] as [string, string]),
          ])}
          {input("website", "Software website", "url", {
            placeholder: "https://",
          })}
          {input("category", "Category", "text", { required: true })}
          {select("team_id", "Department", [
            ["", "Select a department"],
            ...teams.map((t) => [t.id, t.name] as [string, string]),
          ])}
          {select(
            "owner_id",
            "Responsible employee",
            [
              ["", "Unassigned"],
              ...people
                .filter(
                  (p) =>
                    members.some(
                      (m) => m.team_id === team && m.profile_id === p.id,
                    ) && p.status === "active",
                )
                .map((p) => [p.id, p.full_name] as [string, string]),
            ],
            false,
          )}
          {input("cost_centre", "Cost centre")}
          <label className="wide">
            Description
            <textarea {...register("description")} rows={2} />
          </label>
        </div>
      </section>
      <section className="panel form-section">
        <div>
          <span className="section-number">02</span>
          <h2>Purchase & billing</h2>
          <p>Amounts and dates drive your renewal projections.</p>
        </div>
        <div className="form-grid">
          {input("purchase_date", "Purchase date", "date", { required: true })}
          {select("purchase_type", "Purchase type", [
            ["subscription", "Subscription"],
            ["one_time", "One-time purchase"],
          ])}
          {input("amount", "Billing amount", "number", {
            step: "0.01",
            min: 0,
            required: true,
          })}
          {select(
            "currency",
            "Currency",
            currencies.map((c) => [c, c]),
          )}
          {select("billing_cycle", "Billing cycle", [
            ["monthly", "Monthly"],
            ["quarterly", "Quarterly"],
            ["annually", "Annually"],
            ["custom", "Custom"],
            ["one_time", "One-time"],
          ])}
          {cycle === "custom" &&
            input(
              "custom_interval_months",
              "Custom interval (months)",
              "number",
              { min: 1, max: 120 },
            )}
          {input("billing_start_date", "Billing anchor date", "date", {
            required: true,
          })}
          {input("next_billing_date", "Next billing date", "date")}
          {input(
            "cancellation_notice_days",
            "Cancellation notice (days)",
            "number",
            { min: 0, max: 730 },
          )}
          {input(
            "review_frequency_months",
            "Usage review frequency (months)",
            "number",
            { min: 1, max: 120 },
          )}
          <label className="checkbox-label">
            <input type="checkbox" {...register("auto_renew")} />
            Automatically renews with vendor
          </label>
          <label className="checkbox-label">
            <input type="checkbox" {...register("billing_paused")} />
            Billing is paused
          </label>
          <p className="field-hint wide">
            The billing anchor preserves month-end renewal dates. One-time
            purchases have no recurring projections. Cancellation deadlines use
            calendar days.
          </p>
        </div>
      </section>
      <section className="panel form-section">
        <div>
          <span className="section-number">03</span>
          <h2>Licenses & payment</h2>
          <p>Keep references useful and card information limited.</p>
        </div>
        <div className="form-grid">
          {input(
            "license_expiry_date",
            "License expiry date (optional)",
            "date",
          )}
          {input("licenses_purchased", "Licenses purchased", "number", {
            min: 0,
          })}
          {input("licenses_used", "Licenses in use (optional)", "number", {
            min: 0,
          })}
          {select(
            "payment_method_id",
            "Payment reference",
            [
              ["", "No payment reference"],
              ...payments
                .filter((p) => p.team_id === team)
                .map(
                  (p) =>
                    [p.id, `${p.nickname} · ${p.last_four}`] as [
                      string,
                      string,
                    ],
                ),
            ],
            false,
          )}
          {input("invoice_reference", "Invoice reference or URL")}
          {input("internal_reference", "Internal reference")}
          {select(
            "status",
            "Status",
            statuses.map((s) => [s, s.replaceAll("_", " ")]),
          )}
          <label className="wide">
            License notes
            <textarea {...register("license_notes")} rows={2} />
          </label>
          <label className="wide">
            Internal notes
            <textarea {...register("notes")} rows={3} />
          </label>
          <p className="field-hint wide">
            Finance manages vendors and payment references in Settings. Never
            enter full card numbers, CVV, bank credentials, or vendor passwords.
          </p>
        </div>
      </section>
      <Feedback result={result} />
      <div className="form-actions">
        <Button asChild variant="outline">
          <Link href={existing ? `/software/${existing.id}` : "/software"}>
            Cancel
          </Link>
        </Button>
        <Button disabled={pending}>
          <Save size={16} />
          {pending ? "Saving…" : "Save software"}
        </Button>
      </div>
    </form>
  );
}
