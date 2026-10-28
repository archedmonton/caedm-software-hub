import Link from "next/link";
import { AuditHistory } from "@/components/hub/audit-history";
import { notFound } from "next/navigation";
import { Pencil, ArrowLeft, ExternalLink } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { subscriptionSelect } from "@/lib/data";
import {
  adminRole,
  cents,
  decisionDeadline,
  equivalents,
  money,
  type Subscription,
} from "@/lib/domain";
import { PageHeading, Status } from "@/components/hub/common";
import { ActionButton } from "@/components/hub/controls";
import { Button } from "@/components/ui/button";
export default async function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db, profile } = await requireAccess();
  const { data } = await db
    .from("software_subscriptions")
    .select(subscriptionSelect)
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const s = data as unknown as Subscription;
  const eq = equivalents(s);
  const fields = [
    ["Vendor", s.vendors?.name],
    ["Department", s.teams?.name],
    ["Responsible employee", s.profiles?.full_name || "Unassigned"],
    ["Category", s.category],
    ["Cost centre", s.cost_centre],
    ["Purchase date", s.purchase_date],
    ["Purchase type", s.purchase_type.replaceAll("_", " ")],
    [
      "Billing cycle",
      s.billing_cycle === "custom"
        ? `Every ${s.custom_interval_months} months`
        : s.billing_cycle.replaceAll("_", " "),
    ],
    ["Billing anchor", s.billing_start_date],
    ["Next billing", s.next_billing_date],
    ["Auto renewal", s.auto_renew ? "Enabled" : "Disabled"],
    ["Billing paused", s.billing_paused ? "Yes" : "No"],
    ["License expiry", s.license_expiry_date],
    ["Cancellation notice", `${s.cancellation_notice_days} days`],
    ["Decision deadline", decisionDeadline(s)],
    [
      "Licenses",
      `${s.licenses_used ?? "Unknown"} used / ${s.licenses_purchased} purchased`,
    ],
    [
      "Payment reference",
      s.payment_methods
        ? `${s.payment_methods.nickname} · ${s.payment_methods.brand} ${s.payment_methods.last_four}`
        : "None",
    ],
    ["Invoice reference", s.invoice_reference],
    ["Internal reference", s.internal_reference],
    ["Review frequency", `Every ${s.review_frequency_months} months`],
    ["Last usage review", s.last_reviewed_at],
  ];
  return (
    <>
      <Link className="back-link" href="/software">
        <ArrowLeft size={14} />
        Software inventory
      </Link>
      <PageHeading
        eyebrow={s.vendors?.name || "SOFTWARE"}
        title={s.name}
        description={
          s.description || "Software ownership, billing, and renewal details."
        }
      >
        <Status value={s.status} />
        <Button asChild>
          <Link href={`/software/${id}/edit`}>
            <Pencil />
            Edit software
          </Link>
        </Button>
      </PageHeading>
      <div className="detail-kpis">
        <section className="panel p-6">
          <p className="text-muted-foreground text-sm">Billing amount</p>
          <h2 className="text-2xl mt-3">
            {money(cents(s.amount), s.currency)} <small>{s.currency}</small>
          </h2>
        </section>
        <section className="panel p-6">
          <p className="text-muted-foreground text-sm">Monthly equivalent</p>
          <h2 className="text-2xl mt-3">{money(eq.monthly, s.currency)}</h2>
        </section>
        <section className="panel p-6">
          <p className="text-muted-foreground text-sm">Annual equivalent</p>
          <h2 className="text-2xl mt-3">{money(eq.annual, s.currency)}</h2>
        </section>
      </div>
      <section className="panel p-7 mt-6">
        <h2>Record details</h2>
        <dl className="detail-grid">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || "—"}</dd>
            </div>
          ))}
        </dl>
        {s.website && (
          <a
            href={s.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-2 mt-4"
          >
            Vendor website <ExternalLink size={14} />
          </a>
        )}
      </section>
      {(s.notes || s.license_notes) && (
        <section className="panel p-7 mt-6">
          <h2>Notes</h2>
          <p className="whitespace-pre-wrap my-4">{s.notes}</p>
          <p className="whitespace-pre-wrap text-muted-foreground">
            {s.license_notes}
          </p>
        </section>
      )}
      <section className="panel p-7 mt-6">
        <h2>Record actions</h2>
        <p className="text-muted-foreground text-sm mt-2 mb-5">
          These actions update internal records. Vendor subscriptions must be
          managed separately.
        </p>
        <div className="flex gap-3 flex-wrap">
          {adminRole(profile.role) && (
            <ActionButton action="review" id={id}>
              Request usage review
            </ActionButton>
          )}
          <ActionButton action="cancelled" id={id}>
            Mark cancelled
          </ActionButton>
          <ActionButton action="archived" id={id}>
            Archive record
          </ActionButton>
        </div>
      </section>
      <AuditHistory recordId={id} />
    </>
  );
}
