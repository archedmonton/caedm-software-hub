import Link from "next/link";
import {
  Plus,
  ArrowUpRight,
  Layers3,
  Wallet,
  TrendingUp,
  CalendarDays,
  CircleAlert,
  ClipboardCheck,
  ArrowRight,
} from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { requireAccess } from "@/lib/auth";
import { allRows, reviews, subscriptions } from "@/lib/data";
import {
  currencyTotals,
  decisionDeadline,
  dueIn,
  equivalents,
  money,
  projectedEvents,
  today,
} from "@/lib/domain";
import { PageHeading, Empty, Status, Totals } from "@/components/hub/common";
import { SpendingCharts } from "@/components/hub/charts";
import { Button } from "@/components/ui/button";
export default async function Dashboard() {
  const { db, profile } = await requireAccess();
  const [software, reviewRows, activity] = await Promise.all([
    subscriptions(db),
    reviews(db),
    allRows<{
      id: string;
      entity: string;
      action: string;
      created_at: string;
      after_data: Record<string, string>;
    }>(db, "audit_logs"),
  ]);
  const now = today();
  const end = format(addDays(parseISO(now), 30), "yyyy-MM-dd");
  const active = software.filter(
    (s) =>
      s.purchase_type === "subscription" &&
      ["active", "trial"].includes(s.status),
  );
  const events = software
    .flatMap((s) => projectedEvents(s, now, end))
    .sort((a, b) => a.date.localeCompare(b.date));
  const unanswered = reviewRows.filter((r) => !r.response);
  const needs = software.filter(
    (s) =>
      ["active", "trial", "pending_cancellation"].includes(s.status) &&
      decisionDeadline(s) &&
      dueIn(decisionDeadline(s)!, now) <= 30,
  );
  const expiring = software.filter(
    (s) =>
      s.license_expiry_date &&
      dueIn(s.license_expiry_date, now) <= 30 &&
      !["archived", "cancelled"].includes(s.status),
  );
  const attention = new Set([
    ...needs.map((s) => s.id),
    ...expiring.map((s) => s.id),
    ...unanswered.map((r) => r.subscription_id),
    ...software.filter((s) => s.status === "expired").map((s) => s.id),
  ]);
  const kpis = [
    {
      label: "Active subscriptions",
      value: active.length,
      detail: "Active and trial subscriptions",
      Icon: Layers3,
    },
    {
      label: "Monthly recurring",
      value: (
        <Totals
          totals={currencyTotals(
            active,
            (s) => equivalents(s).monthly,
            (s) => s.currency,
          )}
        />
      ),
      detail: "Normalized monthly commitment",
      Icon: Wallet,
    },
    {
      label: "Annual recurring",
      value: (
        <Totals
          totals={currencyTotals(
            active,
            (s) => equivalents(s).annual,
            (s) => s.currency,
          )}
        />
      ),
      detail: "Normalized annual commitment",
      Icon: TrendingUp,
    },
    {
      label: "Payments in 30 days",
      value: (
        <Totals
          totals={currencyTotals(
            events,
            (e) => e.amount,
            (e) => e.currency,
          )}
        />
      ),
      detail: `${events.length} projected billing events`,
      Icon: CalendarDays,
    },
    {
      label: "Requires attention",
      value: attention.size,
      detail: "Reviews, deadlines and expired records",
      Icon: CircleAlert,
    },
    {
      label: "Pending usage reviews",
      value: unanswered.length,
      detail: "Awaiting an owner's confirmation",
      Icon: ClipboardCheck,
    },
  ];
  const recent = activity
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORKSPACE AT A GLANCE"
        title={`Good to see you, ${profile.full_name.split(" ")[0]}.`}
        description="A clearer picture of your software commitments and what comes next."
      >
        <span className="date-chip">
          <CalendarDays size={15} />
          {format(parseISO(now), "MMMM d, yyyy")}
        </span>
        <Button asChild>
          <Link href="/software/new">
            <Plus />
            Add software
          </Link>
        </Button>
      </PageHeading>
      <div className="scope-note">
        <span className="live-dot" />
        Live workspace data <span>·</span>{" "}
        {profile.role === "staff"
          ? "Your departments"
          : "Organization overview"}
        <span className="ml-auto hidden sm:block">
          CAD primary · Currencies kept separate
        </span>
      </div>
      <div className="kpi-grid">
        {kpis.map(({ label, value, detail, Icon }) => (
          <section className="panel kpi" key={label}>
            <div className="kpi-label">
              {label}
              <span className="kpi-icon">
                <Icon size={17} />
              </span>
            </div>
            <div className="kpi-value">{value}</div>
            <p>{detail}</p>
          </section>
        ))}
      </div>
      <SpendingCharts software={software} />
      <div className="dashboard-lower">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Coming up next</h2>
              <p>Projected renewals over the next 30 days</p>
            </div>
            <Link className="subtle-link" href="/renewals">
              View all <ArrowUpRight size={15} />
            </Link>
          </div>
          {events.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Software</th>
                    <th>Payment</th>
                    <th>Renewal</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, 6).map((e) => (
                    <tr key={`${e.subscription.id}-${e.date}`}>
                      <td>
                        <Link
                          className="record-link"
                          href={`/software/${e.subscription.id}`}
                        >
                          {e.subscription.name}
                        </Link>
                        <small>{e.subscription.vendors?.name}</small>
                      </td>
                      <td>
                        <strong>
                          {money(e.amount, e.currency)}{" "}
                          <small className="inline">{e.currency}</small>
                        </strong>
                        <small>
                          {e.subscription.payment_methods?.nickname ||
                            "No payment reference"}
                        </small>
                      </td>
                      <td>
                        {format(parseISO(e.date), "MMM d, yyyy")}
                        <small>In {dueIn(e.date, now)} days</small>
                      </td>
                      <td>
                        {e.subscription.profiles?.full_name || "Unassigned"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="A clear horizon"
              text="No projected subscription payments are due in the next 30 days."
            />
          )}
          <div className="panel-footnote">
            Projections are commitments, not recorded accounting expenses.
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Requires attention</h2>
              <p>A few things to keep on your radar</p>
            </div>
            <span className="count-chip">{attention.size}</span>
          </div>
          <div className="attention-list">
            {unanswered.slice(0, 3).map((r) => (
              <Link key={r.id} href={`/reviews/${r.id}`}>
                <span className="attention-icon">
                  <ClipboardCheck size={17} />
                </span>
                <div>
                  <strong>
                    {r.software_subscriptions?.name || "Software review"}
                  </strong>
                  <p>
                    {dueIn(r.deadline, now) < 0
                      ? "Decision overdue"
                      : "Usage confirmation needed"}
                  </p>
                </div>
                <ArrowRight size={16} />
              </Link>
            ))}
            {needs.slice(0, 3).map((s) => (
              <Link key={s.id} href={`/software/${s.id}`}>
                <span className="attention-icon amber">
                  <CalendarDays size={17} />
                </span>
                <div>
                  <strong>{s.name}</strong>
                  <p>Decision deadline {decisionDeadline(s)}</p>
                </div>
                <ArrowRight size={16} />
              </Link>
            ))}
            {expiring.slice(0, 2).map((s) => (
              <Link key={`expiry-${s.id}`} href={`/software/${s.id}`}>
                <span className="attention-icon amber">
                  <CircleAlert size={17} />
                </span>
                <div>
                  <strong>{s.name}</strong>
                  <p>License expiry {s.license_expiry_date}</p>
                </div>
                <ArrowRight size={16} />
              </Link>
            ))}
            {!unanswered.length && !needs.length && !expiring.length && (
              <Empty
                title="You're all caught up"
                text="Usage requests and upcoming deadlines will appear here."
              />
            )}
          </div>
        </section>
      </div>
      <section className="panel mt-6">
        <div className="panel-heading">
          <div>
            <h2>Recent activity</h2>
            <p>Changes that keep your records current</p>
          </div>
        </div>
        <div className="activity-list">
          {recent.length
            ? recent.map((a) => (
                <div key={a.id}>
                  <span className="activity-dot" />
                  <div>
                    <strong>
                      {a.after_data?.name ||
                        a.after_data?.full_name ||
                        a.entity.replaceAll("_", " ")}
                    </strong>
                    <span>
                      {a.action === "INSERT" ? "added" : "updated"} ·{" "}
                      {a.entity.replaceAll("_", " ")}
                    </span>
                  </div>
                  <time>
                    {new Intl.DateTimeFormat("en-CA", {
                      timeZone: "America/Edmonton",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(a.created_at))}
                  </time>
                </div>
              ))
            : software.slice(0, 4).map((s) => (
                <div key={s.id}>
                  <span className="activity-dot" />
                  <div>
                    <Link href={`/software/${s.id}`}>{s.name}</Link>
                    <span>Software added</span>
                  </div>
                  <Status value={s.status} />
                </div>
              ))}
          {!software.length && (
            <Empty
              title="Your workspace starts here"
              text="Add your first software record to begin building a reliable register."
              href="/software/new"
              action="Add software"
            />
          )}
        </div>
      </section>
    </>
  );
}
