"use client";
import { useId, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/hub/controls";
import { FieldHelp } from "@/components/hub/field-help";
import {
  SoftwareReferenceDialog,
  type EditorDialogKind,
} from "@/components/hub/software-reference-dialog";
import {
  softwareFieldHelp,
  type EditorEmployee,
  type NamedReference,
  type PaymentReference,
  type EditorMember,
  type ReferenceKind,
  type ReferenceResult,
} from "@/lib/software-reference";
import { saveSoftware, type Result } from "@/app/(hub)/actions";
import {
  subscriptionSchema,
  adminRole,
  financeRole,
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
  role,
  categories,
  employeeCandidates,
}: {
  existing?: Subscription;
  teams: Team[];
  vendors: Reference[];
  people: Profile[];
  payments: Payment[];
  members: Member[];
  currencies: string[];
  role: Profile["role"];
  categories: string[];
  employeeCandidates: EditorEmployee[];
}) {
  const formId = useId();
  const [dialog, setDialog] = useState<EditorDialogKind | null>(null);
  const [created, setCreated] = useState<{
    vendors: NamedReference[];
    teams: Team[];
    categories: string[];
    payments: PaymentReference[];
    members: EditorMember[];
  }>({ vendors: [], teams: [], categories: [], payments: [], members: [] });
  const mergeById = <T extends { id: string }>(original: T[], added: T[]) => [
    ...new Map([...original, ...added].map((r) => [r.id, r])).values(),
  ];
  const vendorOptions = mergeById(vendors, created.vendors).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const teamOptions = mergeById(teams, created.teams).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const paymentOptions = mergeById(payments, created.payments);
  const memberOptions = [
    ...members.filter(
      (m) =>
        !created.members.some(
          (n) => n.team_id === m.team_id && n.profile_id === m.profile_id,
        ),
    ),
    ...created.members,
  ];
  const categoryOptions = [
    ...new Set([
      "Productivity",
      ...categories,
      ...created.categories,
      ...(existing ? [existing.category] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b));
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
    setValue,
    getValues,
    clearErrors,
    formState: { errors },
  } = useForm<Record<string, string | boolean>>({ defaultValues: defaults });
  const watchedValues = useWatch({ control });
  const team = watchedValues.team_id;
  const cycle = watchedValues.billing_cycle;
  const [result, setResult] = useState<Result>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const [referenceNotice, setReferenceNotice] = useState("");
  const changeDepartment = (department: string) => {
    const owner = String(getValues("owner_id") || "");
    const payment = String(getValues("payment_method_id") || "");
    if (
      owner &&
      !memberOptions.some(
        (m) => m.team_id === department && m.profile_id === owner,
      )
    )
      setValue("owner_id", "", { shouldDirty: true });
    if (
      payment &&
      !paymentOptions.some((p) => p.team_id === department && p.id === payment)
    )
      setValue("payment_method_id", "", { shouldDirty: true });
    clearErrors(["owner_id", "payment_method_id"]);
  };
  const selectCreated = (kind: ReferenceKind, outcome: ReferenceResult) => {
    const reference = outcome.reference;
    if (kind === "payment" && outcome.payment) {
      const saved = outcome.payment;
      setCreated((previous) => ({
        ...previous,
        payments: [...previous.payments, saved],
      }));
      setValue("payment_method_id", saved.id, { shouldDirty: true });
      clearErrors("payment_method_id");
      setReferenceNotice(
        `${saved.nickname} is saved and selected. Save software when your draft is ready.`,
      );
    } else if (reference) {
      setCreated((previous) => ({
        ...previous,
        ...(kind === "vendor"
          ? { vendors: [...previous.vendors, reference] }
          : kind === "department"
            ? { teams: [...previous.teams, reference] }
            : { categories: [...previous.categories, reference.name] }),
      }));
      if (kind === "department") changeDepartment(reference.id);
      const field =
        kind === "vendor"
          ? "vendor_id"
          : kind === "department"
            ? "team_id"
            : "category";
      setValue(field, kind === "category" ? reference.name : reference.id, {
        shouldDirty: true,
      });
      clearErrors(field);
      setReferenceNotice(
        `${reference.name} is saved and selected. Save software when your draft is ready.`,
      );
    }
  };
  const labelFor = (name: string, label: string) => (
    <div className="editor-field-label">
      <label htmlFor={`${formId}-${name}`}>{label}</label>
      {softwareFieldHelp[name] && (
        <FieldHelp id={`${formId}-${name}-help`} {...softwareFieldHelp[name]} />
      )}
    </div>
  );
  const input = (
    name: string,
    label: string,
    type = "text",
    extra: Record<string, unknown> = {},
  ) => (
    <div className="editor-field" key={name}>
      {labelFor(name, label)}
      <input
        id={`${formId}-${name}`}
        type={type}
        {...register(name)}
        {...extra}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={
          [
            softwareFieldHelp[name] ? `${formId}-${name}-help` : null,
            errors[name] ? `${formId}-${name}-error` : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {errors[name] && (
        <span id={`${formId}-${name}-error`} className="field-error">
          {errors[name]?.message}
        </span>
      )}
    </div>
  );
  const select = (
    name: string,
    label: string,
    options: [string, string][],
    required = true,
    createKind?: EditorDialogKind,
  ) => {
    const field = register(name);
    const canCreate =
      createKind === "employee" || createKind === "department"
        ? adminRole(role)
        : financeRole(role);
    return (
      <div className="editor-field">
        {labelFor(name, label)}
        <select
          id={`${formId}-${name}`}
          {...field}
          value={String(watchedValues[name] ?? defaults[name] ?? "")}
          onChange={(event) => {
            if (event.target.value === "__create__") {
              event.target.value = String(getValues(name) || "");
              if (createKind && canCreate) setDialog(createKind);
              return;
            }
            field.onChange(event);
            if (name === "team_id") changeDepartment(event.target.value);
          }}
          required={required}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={
            [
              softwareFieldHelp[name] ? `${formId}-${name}-help` : null,
              errors[name] ? `${formId}-${name}-error` : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {options.slice(0, 1).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
          {createKind && canCreate && (
            <option
              value="__create__"
              disabled={
                (createKind === "payment" || createKind === "employee") && !team
              }
            >
              {createKind === "employee"
                ? "+ Add responsible employee…"
                : createKind === "payment"
                  ? "+ Add payment reference…"
                  : `+ Add ${createKind}…`}
              {(createKind === "payment" || createKind === "employee") && !team
                ? " (select a department first)"
                : ""}
            </option>
          )}
          {options.slice(1).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        {errors[name] && (
          <span id={`${formId}-${name}-error`} className="field-error">
            {errors[name]?.message}
          </span>
        )}
      </div>
    );
  };
  return (
    <>
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
        {referenceNotice && (
          <p className="notice" role="status">
            {referenceNotice}
          </p>
        )}
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
            {select(
              "vendor_id",
              "Vendor",
              [
                ["", "Select a vendor"],
                ...vendorOptions.map((v) => [v.id, v.name] as [string, string]),
              ],
              true,
              "vendor",
            )}
            {input("website", "Software website", "url", {
              placeholder: "https://",
            })}
            {select(
              "category",
              "Category",
              [
                ["", "Select a category"],
                ...categoryOptions.map((c) => [c, c] as [string, string]),
              ],
              true,
              "category",
            )}
            {select(
              "team_id",
              "Department",
              [
                ["", "Select a department"],
                ...teamOptions.map((t) => [t.id, t.name] as [string, string]),
              ],
              true,
              "department",
            )}
            {select(
              "owner_id",
              "Responsible employee",
              [
                ["", "Unassigned"],
                ...people
                  .filter(
                    (p) =>
                      memberOptions.some(
                        (m) => m.team_id === team && m.profile_id === p.id,
                      ) && p.status === "active",
                  )
                  .map((p) => [p.id, p.full_name] as [string, string]),
              ],
              false,
              "employee",
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
            {input("purchase_date", "Purchase date", "date", {
              required: true,
            })}
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
            <div className="editor-checkbox-field">
              <label className="checkbox-label">
                <input type="checkbox" {...register("auto_renew")} />
                Automatically renews with vendor
              </label>
              <FieldHelp
                id={`${formId}-auto-renew-help`}
                {...softwareFieldHelp.auto_renew}
              />
            </div>
            <div className="editor-checkbox-field">
              <label className="checkbox-label">
                <input type="checkbox" {...register("billing_paused")} />
                Billing is paused
              </label>
              <FieldHelp
                id={`${formId}-billing-paused-help`}
                {...softwareFieldHelp.billing_paused}
              />
            </div>
            <p className="field-hint wide">
              The billing anchor preserves month-end renewal dates. One-time
              purchases have no recurring projections. Cancellation deadlines
              use calendar days.
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
                ...paymentOptions
                  .filter((p) => p.team_id === team)
                  .map(
                    (p) =>
                      [
                        p.id,
                        `${p.nickname}${p.last_four ? ` · ${p.last_four}` : ""}`,
                      ] as [string, string],
                  ),
              ],
              false,
              "payment",
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
              Finance and administrators can add vendors, categories and payment
              references from their dropdowns. Administrators can also add
              departments and employees. Use the information buttons for field
              guidance. Never enter full card numbers, CVV, bank credentials, or
              vendor passwords.
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
      {dialog && (
        <SoftwareReferenceDialog
          key={dialog}
          kind={dialog}
          team={teamOptions.find((t) => t.id === team)}
          existingNames={
            dialog === "vendor"
              ? vendorOptions.map((v) => v.name)
              : dialog === "category"
                ? categoryOptions
                : dialog === "department"
                  ? teamOptions.map((t) => t.name)
                  : dialog === "payment"
                    ? paymentOptions
                        .filter((p) => p.team_id === team)
                        .map((p) => p.nickname)
                    : []
          }
          candidates={employeeCandidates.filter(
            (p) =>
              !memberOptions.some(
                (m) => m.team_id === team && m.profile_id === p.id,
              ),
          )}
          onClose={() => setDialog(null)}
          onCreated={selectCreated}
          onEmployee={(employee, canManage) => {
            setCreated((previous) => ({
              ...previous,
              members: [
                ...previous.members,
                {
                  team_id: String(team),
                  profile_id: employee.id,
                  can_manage: canManage,
                },
              ],
            }));
            setValue("owner_id", employee.id, { shouldDirty: true });
            clearErrors("owner_id");
            setReferenceNotice(
              `${employee.full_name} now has department access and is selected as owner. Save software when your draft is ready.`,
            );
          }}
        />
      )}
    </>
  );
}
