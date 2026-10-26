import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth";
import { subscriptionSelect } from "@/lib/data";
import { cents, money, type Review } from "@/lib/domain";
import { PageHeading, Status } from "@/components/hub/common";
import { ReviewForm } from "@/components/hub/review-form";
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db, profile } = await requireAccess();
  const { data } = await db
    .from("usage_reviews")
    .select("*,software_subscriptions(" + subscriptionSelect + ")")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const r = data as unknown as Review;
  const s = r.software_subscriptions;
  return (
    <>
      <PageHeading
        eyebrow="USAGE CONFIRMATION"
        title={s?.name || "Software review"}
        description="Help us understand whether this software is still needed."
      />
      <section className="panel p-7 max-w-4xl">
        <dl className="detail-grid mb-8">
          <div>
            <dt>Responsible owner</dt>
            <dd>{s?.profiles?.full_name || "Unassigned"}</dd>
          </div>
          <div>
            <dt>Renewal date</dt>
            <dd>{r.renewal_date}</dd>
          </div>
          <div>
            <dt>Decision deadline</dt>
            <dd>{r.deadline}</dd>
          </div>
          <div>
            <dt>Billing amount</dt>
            <dd>
              {s ? `${money(cents(s.amount), s.currency)} ${s.currency}` : "—"}
            </dd>
          </div>
        </dl>
        {r.response ? (
          <div className="notice">
            <Status value={r.response} />
            <p className="mt-4 whitespace-pre-wrap">
              {r.comment || "No additional comment."}
            </p>
            <p className="text-xs mt-3">Recorded {r.responded_at}</p>
          </div>
        ) : r.owner_id === profile.id ? (
          <ReviewForm id={id} />
        ) : (
          <p className="notice">
            This review is awaiting a response from its assigned owner.
          </p>
        )}
        <Link
          className="back-link mt-6"
          href={s ? `/software/${s.id}` : "/reviews"}
        >
          View software record →
        </Link>
      </section>
    </>
  );
}
