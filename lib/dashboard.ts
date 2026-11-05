import {
  decisionDeadline,
  dueIn,
  type Review,
  type Subscription,
} from "@/lib/domain";

export type DashboardIssue = {
  kind: "review" | "decision" | "license" | "expired";
  label: string;
  date: string | null;
  overdue: boolean;
  href: string;
  action: string;
  mine: boolean;
};
export type DashboardAttention = {
  id: string;
  name: string;
  department: string;
  issues: DashboardIssue[];
};

// Presentation only: inputs must already come from the signed-in, RLS-scoped client.
export function dashboardAttention(
  software: Subscription[],
  reviews: Review[],
  viewer: string,
  reference: string,
) {
  const items = new Map<string, DashboardAttention>();
  const visible = new Map(
    software
      .filter((s) => !["archived", "cancelled"].includes(s.status))
      .map((s) => [s.id, s]),
  );
  const add = (s: Subscription, issue: DashboardIssue) => {
    const item = items.get(s.id) ?? {
      id: s.id,
      name: s.name,
      department: s.teams?.name || "No department",
      issues: [],
    };
    item.issues.push(issue);
    items.set(s.id, item);
  };
  for (const r of reviews) {
    const s = visible.get(r.subscription_id);
    if (!s || r.response) continue;
    add(s, {
      kind: "review",
      label:
        r.owner_id === viewer
          ? "Your usage review"
          : "Usage review awaiting its owner",
      date: r.deadline,
      overdue: dueIn(r.deadline, reference) < 0,
      href: `/reviews/${r.id}`,
      action: r.owner_id === viewer ? "Answer review" : "View review",
      mine: r.owner_id === viewer,
    });
  }
  for (const s of visible.values()) {
    const href = `/software/${s.id}`;
    const deadline = decisionDeadline(s);
    if (
      s.purchase_type === "subscription" &&
      !s.billing_paused &&
      ["active", "trial", "pending_cancellation"].includes(s.status) &&
      deadline &&
      dueIn(deadline, reference) <= 30
    )
      add(s, {
        kind: "decision",
        label: "Cancellation decision deadline",
        date: deadline,
        overdue: dueIn(deadline, reference) < 0,
        href,
        action: "View software",
        mine: false,
      });
    if (s.license_expiry_date && dueIn(s.license_expiry_date, reference) <= 30)
      add(s, {
        kind: "license",
        label: "License expiry",
        date: s.license_expiry_date,
        overdue: dueIn(s.license_expiry_date, reference) < 0,
        href,
        action: "View software",
        mine: false,
      });
    if (s.status === "expired")
      add(s, {
        kind: "expired",
        label: "Software is marked expired",
        date: null,
        overdue: true,
        href,
        action: "View software",
        mine: false,
      });
  }
  const compare = (a: DashboardIssue, b: DashboardIssue) =>
    Number(b.overdue) - Number(a.overdue) ||
    (a.date ?? reference).localeCompare(b.date ?? reference) ||
    Number(b.mine) - Number(a.mine) ||
    Number(b.kind === "review") - Number(a.kind === "review");
  for (const item of items.values()) item.issues.sort(compare);
  return [...items.values()].sort(
    (a, b) =>
      compare(a.issues[0], b.issues[0]) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
