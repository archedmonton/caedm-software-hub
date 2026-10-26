import Link from "next/link";
import { requireAccess } from "@/lib/auth";
import { reviews } from "@/lib/data";
import { cents, dueIn, money } from "@/lib/domain";
import { Empty, PageHeading, Status } from "@/components/hub/common";
export default async function Reviews({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { db, profile } = await requireAccess();
  const q = await searchParams;
  const rows = (await reviews(db))
    .filter((r) =>
      q.status === "all" || q.status === "completed"
        ? q.status === "all" || Boolean(r.response)
        : !r.response,
    )
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  return (
    <>
      <PageHeading
        eyebrow="KEEP THE RIGHT TOOLS"
        title="Usage reviews"
        description="A small check-in before renewal. A better decision for everyone."
      />
      <section className="panel">
        <div className="table-toolbar">
          <Link
            className={!q.status ? "filter-tab active" : "filter-tab"}
            href="/reviews"
          >
            Awaiting response
          </Link>
          <Link
            className={
              q.status === "completed" ? "filter-tab active" : "filter-tab"
            }
            href="/reviews?status=completed"
          >
            Completed
          </Link>
          <Link
            className={q.status === "all" ? "filter-tab active" : "filter-tab"}
            href="/reviews?status=all"
          >
            All reviews
          </Link>
          <span className="ml-auto text-sm text-muted-foreground">
            {profile.role === "staff"
              ? "Your assigned reviews"
              : "Organization reviews"}
          </span>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Software</th>
                  <th>Renewal amount</th>
                  <th>Decision deadline</th>
                  <th>Response</th>
                  <th>Finance attention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="record-link" href={`/reviews/${r.id}`}>
                        {r.software_subscriptions?.name || "Software"}
                      </Link>
                      <small>Renewal {r.renewal_date}</small>
                    </td>
                    <td>
                      {r.software_subscriptions
                        ? `${money(cents(r.software_subscriptions.amount), r.software_subscriptions.currency)} ${r.software_subscriptions.currency}`
                        : "—"}
                    </td>
                    <td>
                      {r.deadline}
                      <small>
                        {!r.response && dueIn(r.deadline) < 0 ? "Overdue" : ""}
                      </small>
                    </td>
                    <td>
                      <Status value={r.response || "pending_approval"} />
                    </td>
                    <td>
                      {r.escalated_at
                        ? "Escalated"
                        : r.response && r.response !== "still_needed"
                          ? "Decision needed"
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No reviews to show"
            text="Review requests will appear here before a decision is due."
          />
        )}
      </section>
    </>
  );
}
