import Link from "next/link";
import {
  Plus,
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  CircleAlert,
  CheckCircle2,
  ClipboardCheck,
  Layers3,
} from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { requireAccess } from "@/lib/auth";
import { allRows, reviews, subscriptions } from "@/lib/data";
import {
  currencyTotals,
  dueIn,
  equivalents,
  financeRole,
  projectedEvents,
  today,
} from "@/lib/domain";
import { dashboardAttention } from "@/lib/dashboard";
import { PageHeading, Empty, Totals } from "@/components/hub/common";
import { SpendingCharts } from "@/components/hub/charts";
import { Button } from "@/components/ui/button";

export default async function Dashboard() {
  const { db, profile } = await requireAccess();
  const [software, reviewRows, activity, managed] = await Promise.all([
    subscriptions(db),
    reviews(db),
    allRows<{
      id: string;
      entity: string;
      action: string;
      created_at: string;
      after_data: Record<string, string> | null;
    }>(db, "audit_logs"),
    profile.role === "staff"
      ? db
          .from("team_members")
          .select("team_id")
          .eq("profile_id", profile.id)
          .eq("can_manage", true)
          .limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  const canAdd = financeRole(profile.role) || Boolean(managed.data?.length);
  const now = today();
  const end = format(addDays(parseISO(now), 30), "yyyy-MM-dd");
  const active = software.filter(
    (s) =>
      s.purchase_type === "subscription" &&
      ["active", "trial"].includes(s.status),
  );
  const events = software
    .flatMap((s) => projectedEvents(s, now, end))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.subscription.name.localeCompare(b.subscription.name),
    );
  const attention = dashboardAttention(software, reviewRows, profile.id, now);
  const ownReviews = reviewRows.filter(
    (r) =>
      !r.response &&
      r.owner_id === profile.id &&
      software.some(
        (s) =>
          s.id === r.subscription_id &&
          !["archived", "cancelled"].includes(s.status),
      ),
  );
  const overdue = attention.filter((item) =>
    item.issues.some((i) => i.overdue),
  ).length;
  const recent = activity
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  return (
    <div className="dashboard-page readable-workspace">
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title={`Good to see you, ${profile.full_name.split(" ")[0]}.`}
        description="Start with what needs a decision. Then see what is coming up."
      >
        {canAdd && (
          <Button asChild>
            <Link href="/software/new">
              <Plus aria-hidden="true" />
              Add software
            </Link>
          </Button>
        )}
      </PageHeading>
      <div className="dashboard-context">
        <span>
          {profile.role === "staff"
            ? "Your departments"
            : "Organization overview"}
        </span>
        <time dateTime={now}>
          {format(parseISO(now), "EEEE, MMMM d, yyyy")}
        </time>
      </div>
      <div className="dashboard-priority-grid">
        <section
          className="panel dashboard-priority"
          aria-labelledby="attention-heading"
        >
          <div className="priority-header">
            <div>
              <span className="section-kicker">START HERE</span>
              <h2 id="attention-heading">Needs your attention</h2>
              <p>Overdue items first. Each software appears once.</p>
            </div>
            <div className="priority-total">
              <strong>{attention.length}</strong>
              <span>
                {attention.length === 1
                  ? "record to check"
                  : "records to check"}
              </span>
            </div>
          </div>
          {attention.length ? (
            <>
              <div className="priority-summary">
                <span
                  className={
                    overdue ? "urgency-label overdue" : "urgency-label"
                  }
                >
                  {overdue
                    ? `${overdue} overdue or expired`
                    : "No overdue items"}
                </span>
                <span>
                  {ownReviews.length}{" "}
                  {ownReviews.length === 1
                    ? "review assigned to you"
                    : "reviews assigned to you"}
                </span>
              </div>
              <ol className="priority-list">
                {attention.slice(0, 4).map((item) => {
                  const issue = item.issues[0];
                  const action = item.issues.find((i) => i.mine) ?? issue;
                  const days = issue.date ? dueIn(issue.date, now) : null;
                  return (
                    <li key={item.id}>
                      <Link
                        href={action.href}
                        aria-label={`${action.action}: ${item.name}`}
                      >
                        <span
                          className={`priority-symbol ${issue.overdue ? "is-overdue" : ""}`}
                        >
                          {issue.kind === "review" ? (
                            <ClipboardCheck aria-hidden="true" />
                          ) : (
                            <CircleAlert aria-hidden="true" />
                          )}
                        </span>
                        <div className="priority-item-copy">
                          <div className="priority-item-top">
                            <strong>{item.name}</strong>
                            <span
                              className={`urgency-label ${issue.overdue ? "overdue" : ""}`}
                            >
                              {issue.kind === "expired"
                                ? "Expired"
                                : issue.overdue
                                  ? "Overdue"
                                  : days === 0
                                    ? "Due today"
                                    : days !== null
                                      ? `In ${days} days`
                                      : "Check record"}
                            </span>
                          </div>
                          <p>
                            {issue.label}
                            {issue.date && (
                              <>
                                {" "}
                                ·{" "}
                                <time dateTime={issue.date}>
                                  {format(parseISO(issue.date), "MMM d, yyyy")}
                                </time>
                              </>
                            )}
                          </p>
                          <span className="priority-item-detail">
                            {item.department}
                            {item.issues.length > 1 &&
                              ` · Also: ${item.issues
                                .slice(1)
                                .map((i) => i.label.toLowerCase())
                                .join(", ")}`}
                          </span>
                          <span className="priority-item-action">
                            {action.action}
                            <ArrowRight size={17} aria-hidden="true" />
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <div className="priority-clear">
              <CheckCircle2 size={40} aria-hidden="true" />
              <h3>You are up to date</h3>
              <p>
                No outstanding reviews, approaching decision deadlines or
                expiring licenses in the next 30 days.
              </p>
              <Link className="dashboard-text-link" href="/software">
                Browse software <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </div>
          )}
          <div className="priority-footer">
            <Link href="/reviews">
              Open Usage Reviews <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
            <Link href="/renewals">
              View renewal deadlines{" "}
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
            {attention.length > 4 && (
              <span>
                Showing the first 4 of {attention.length} software records.
              </span>
            )}
          </div>
        </section>
        <section
          className="panel dashboard-payments"
          aria-labelledby="payments-heading"
        >
          <div className="payments-header">
            <span className="section-kicker">
              <CalendarDays size={18} aria-hidden="true" />
              LOOKING AHEAD
            </span>
            <h2 id="payments-heading">Payments in the next 30 days</h2>
            <div className="payments-total">
              <Totals
                totals={currencyTotals(
                  events,
                  (e) => e.amount,
                  (e) => e.currency,
                )}
              />
            </div>
            <p>
              {events.length} projected{" "}
              {events.length === 1 ? "payment" : "payments"} · currencies kept
              separate
            </p>
          </div>
          <div className="next-payment-list">
            {events.slice(0, 3).map((e) => (
              <Link
                key={`${e.subscription.id}-${e.date}`}
                href={`/software/${e.subscription.id}`}
              >
                <span className="payment-date">
                  <strong>{format(parseISO(e.date), "dd")}</strong>
                  <span>{format(parseISO(e.date), "MMM")}</span>
                </span>
                <div>
                  <strong>{e.subscription.name}</strong>
                  <span>
                    {e.subscription.profiles?.full_name || "Owner unassigned"}
                  </span>
                </div>
                <span className="payment-amount">
                  <Totals totals={{ [e.currency]: e.amount }} />
                </span>
              </Link>
            ))}
            {!events.length && <p>No projected payments in this period.</p>}
          </div>
          <div className="payments-footer">
            <Link className="dashboard-text-link" href="/renewals">
              See all upcoming payments{" "}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <p>
              Expected charges, not recorded expenses. Check vendor notice
              periods before cancelling.
            </p>
          </div>
        </section>
      </div>
      <section
        className="dashboard-overview"
        aria-labelledby="overview-heading"
      >
        <div className="dashboard-section-heading">
          <div>
            <h2 id="overview-heading">Your software overview</h2>
            <p>Recurring commitments across the software you can access.</p>
          </div>
          <Link className="dashboard-text-link" href="/software">
            Software inventory <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <div className="dashboard-metrics">
          <div>
            <span>
              <Layers3 size={18} aria-hidden="true" />
              Active subscriptions
            </span>
            <strong className="metric-number">{active.length}</strong>
            <p>Active and trial subscriptions</p>
          </div>
          <div>
            <span>Monthly recurring</span>
            <Totals
              totals={currencyTotals(
                active,
                (s) => equivalents(s).monthly,
                (s) => s.currency,
              )}
            />
            <p>Monthly equivalent, not an invoice</p>
          </div>
          <div>
            <span>Annual recurring</span>
            <Totals
              totals={currencyTotals(
                active,
                (s) => equivalents(s).annual,
                (s) => s.currency,
              )}
            />
            <p>Annual equivalent, not recorded expenses</p>
          </div>
        </div>
      </section>
      <SpendingCharts software={software} />
      <details className="panel dashboard-history">
        <summary>
          <span>Recent activity</span>
          <span>Latest changes to your records</span>
        </summary>
        <div className="dashboard-history-list">
          {recent.map((a) => (
            <div key={a.id}>
              <div>
                <strong>
                  {a.after_data?.name ||
                    a.after_data?.full_name ||
                    a.entity.replaceAll("_", " ")}
                </strong>
                <p>
                  {a.action === "INSERT"
                    ? "Added"
                    : a.action === "DELETE"
                      ? "Removed"
                      : "Updated"}{" "}
                  · {a.entity.replaceAll("_", " ")}
                </p>
              </div>
              <time dateTime={a.created_at}>
                {new Intl.DateTimeFormat("en-CA", {
                  timeZone: "America/Edmonton",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(a.created_at))}
              </time>
            </div>
          ))}
          {!recent.length && (
            <Empty
              title="No recent activity"
              text="Changes to the records you can access will appear here."
            />
          )}
        </div>
      </details>
    </div>
  );
}
