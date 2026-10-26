import Link from "next/link";
import { addDays, format, parseISO } from "date-fns";
import { requireAccess } from "@/lib/auth";
import { subscriptions } from "@/lib/data";
import {
  cents,
  currencyTotals,
  decisionDeadline,
  dueIn,
  money,
  projectedEvents,
  today,
} from "@/lib/domain";
import { Empty, PageHeading, Status, Totals } from "@/components/hub/common";
export default async function Renewals({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { db } = await requireAccess();
  const q = await searchParams;
  const days = [7, 30, 60, 90].includes(Number(q.days)) ? Number(q.days) : 30;
  const now = today();
  const end = format(addDays(parseISO(now), days), "yyyy-MM-dd");
  const software = await subscriptions(db);
  const events = software
    .flatMap((s) => projectedEvents(s, now, end))
    .filter(
      (e) =>
        (!q.team || e.subscription.team_id === q.team) &&
        (!q.currency || e.currency === q.currency) &&
        (!q.status || e.subscription.status === q.status),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <PageHeading
        eyebrow="PLAN AHEAD"
        title="Upcoming renewals"
        description="See the next commitment before it becomes the next charge."
      />
      <div className="panel p-6 mb-6 flex justify-between gap-5 flex-wrap">
        <div>
          <span className="eyebrow">PROJECTED PAYMENTS · NEXT {days} DAYS</span>
          <div className="text-2xl mt-3">
            <Totals
              totals={currencyTotals(
                events,
                (e) => e.amount,
                (e) => e.currency,
              )}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground self-center">
          {events.length} billing events · Projections are not confirmed
          expenses
        </p>
      </div>
      <section className="panel">
        <form className="table-toolbar">
          <label>
            Horizon
            <select name="days" defaultValue={days}>
              {[7, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  Next {d} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Department
            <select name="team" defaultValue={q.team || ""}>
              <option value="">All departments</option>
              {Array.from(
                new Map(software.map((s) => [s.team_id, s.teams?.name])),
              ).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Currency
            <select name="currency" defaultValue={q.currency || ""}>
              <option value="">All currencies</option>
              {[...new Set(software.map((s) => s.currency))].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={q.status || ""}>
              <option value="">All eligible</option>
              {["active", "trial", "pending_cancellation"].map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button">Apply filters</button>
        </form>
        {events.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Software / vendor</th>
                  <th>Amount</th>
                  <th>Payment reference</th>
                  <th>Renewal</th>
                  <th>Decision deadline</th>
                  <th>Owner</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map(({ subscription: s, date }) => (
                  <tr key={`${s.id}-${date}`}>
                    <td>
                      <Link className="record-link" href={`/software/${s.id}`}>
                        {s.name}
                      </Link>
                      <small>{s.vendors?.name}</small>
                    </td>
                    <td>
                      {money(cents(s.amount), s.currency)}
                      <small>
                        {s.currency} · {s.billing_cycle}
                      </small>
                    </td>
                    <td>
                      {s.payment_methods?.nickname || "Unassigned"}
                      <small>{s.payment_methods?.last_four}</small>
                    </td>
                    <td>
                      {date}
                      <small>In {dueIn(date, now)} days</small>
                    </td>
                    <td>
                      <span
                        className={
                          dueIn(decisionDeadline(s, date)!, now) < 0
                            ? "text-amber-700"
                            : ""
                        }
                      >
                        {decisionDeadline(s, date)}
                      </span>
                      <small>
                        {dueIn(decisionDeadline(s, date)!, now) < 0
                          ? "Deadline passed"
                          : `${s.cancellation_notice_days}-day notice`}
                      </small>
                    </td>
                    <td>{s.profiles?.full_name || "Unassigned"}</td>
                    <td>
                      <Status value={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No renewals in this window"
            text="Try a longer horizon or adjust your filters."
          />
        )}
      </section>
    </>
  );
}
