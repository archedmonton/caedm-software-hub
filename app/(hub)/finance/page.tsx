import Link from "next/link";
import { Download } from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { requireAccess } from "@/lib/auth";
import { subscriptions, expenses, allRows } from "@/lib/data";
import {
  cents,
  currencyTotals,
  money,
  projectedEvents,
  today,
  statuses,
  type Team,
} from "@/lib/domain";
import {
  reportFilters,
  filteredExpenses,
  matchesSoftware,
} from "@/lib/reports";
import { PageHeading, Empty, Totals } from "@/components/hub/common";
import { ExpenseForm } from "@/components/hub/expense-form";
export default async function Finance({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { db } = await requireAccess("finance");
  const q = await searchParams;
  const parsed = reportFilters.safeParse(q);
  const f = parsed.success
    ? parsed.data
    : { report: "register" as const, format: "csv" as const };
  const [software, recorded, teams, payments, settings] = await Promise.all([
    subscriptions(db),
    expenses(db),
    allRows<Team>(db, "teams"),
    allRows<{ id: string; nickname: string }>(db, "payment_methods"),
    db.from("application_settings").select("currencies").single(),
  ]);
  const actual = filteredExpenses(recorded, software, f).sort((a, b) =>
    b.transaction_date.localeCompare(a.transaction_date),
  );
  const filtered = software.filter((s) => matchesSoftware(s, f));
  const now = today();
  const events = filtered.flatMap((s) =>
    projectedEvents(s, now, format(addDays(parseISO(now), 30), "yyyy-MM-dd")),
  );
  const exportQuery = new URLSearchParams(
    Object.entries(f).filter(
      ([key, value]) => key !== "format" && Boolean(value),
    ) as [string, string][],
  );
  const byId = new Map(software.map((s) => [s.id, s]));
  const groups = [
    { label: "Department", get: (e: (typeof actual)[number]) => e.team_name },
    { label: "Vendor", get: (e: (typeof actual)[number]) => e.vendor_name },
    {
      label: "Payment reference",
      get: (e: (typeof actual)[number]) => e.payment_reference || "Unassigned",
    },
    {
      label: "Accounting period",
      get: (e: (typeof actual)[number]) => e.transaction_date.slice(0, 7),
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="FINANCIAL STEWARDSHIP"
        title="Finance centre"
        description="Confirmed spending, future commitments, and reports you can trust."
      />
      <ExpenseForm
        software={software.map((s) => ({ id: s.id, name: s.name }))}
        currencies={settings.data?.currencies || ["CAD", "USD"]}
      />
      <section className="panel mb-6">
        <div className="panel-heading">
          <div>
            <h2>Report filters</h2>
            <p>
              Register dates refer to purchase date; expense dates refer to
              transaction date.
            </p>
          </div>
        </div>
        <form className="report-filters" method="get">
          <label>
            Report
            <select name="report" defaultValue={f.report}>
              <option value="register">Software Register</option>
              <option value="expenses">Expense Report</option>
            </select>
          </label>
          <label>
            From date
            <input name="from" type="date" defaultValue={f.from || ""} />
          </label>
          <label>
            To date
            <input name="to" type="date" defaultValue={f.to || ""} />
          </label>
          <label>
            Department
            <select name="team" defaultValue={f.team || ""}>
              <option value="">All departments</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment reference
            <select name="payment" defaultValue={f.payment || ""}>
              <option value="">All references</option>
              {payments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname}
                </option>
              ))}
            </select>
          </label>
          <label>
            Software status
            <select name="status" defaultValue={f.status || ""}>
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-3">
            <button className="primary-button">Apply filters</button>
            <Link href="/finance" className="subtle-link">
              Reset
            </Link>
          </div>
        </form>
        {!parsed.success && (
          <p className="notice error mx-6 mb-6" role="alert">
            Invalid filters. Check your date range and selections.
          </p>
        )}
        <div className="export-bar">
          <span>
            <strong>
              {f.report === "expenses" ? "Expense Report" : "Software Register"}
            </strong>{" "}
            ·{" "}
            {f.report === "expenses"
              ? "Confirmed transactions only"
              : "All matching software purchases"}
          </span>
          <div className="flex gap-3">
            <a
              className="secondary-button"
              href={`/api/exports?${exportQuery}&format=csv`}
            >
              <Download size={15} />
              CSV
            </a>
            <a
              className="secondary-button"
              href={`/api/exports?${exportQuery}&format=xlsx`}
            >
              <Download size={15} />
              Excel
            </a>
          </div>
        </div>
      </section>
      <div className="detail-kpis mb-6">
        <section className="panel p-6">
          <span className="eyebrow">CONFIRMED EXPENSES · FILTERED</span>
          <div className="text-2xl mt-3">
            <Totals
              totals={currencyTotals(
                actual,
                (e) => cents(e.amount) + cents(e.tax),
                (e) => e.currency,
              )}
            />
          </div>
          <p className="field-hint">
            {actual.length} recorded transactions, including recorded tax
          </p>
        </section>
        <section className="panel p-6">
          <span className="eyebrow">EXPECTED · NEXT 30 DAYS</span>
          <div className="text-2xl mt-3">
            <Totals
              totals={currencyTotals(
                events,
                (e) => e.amount,
                (e) => e.currency,
              )}
            />
          </div>
          <p className="field-hint">
            Projected billing · Not accounting expenses
          </p>
        </section>
        <section className="panel p-6">
          <span className="eyebrow">PURCHASE MIX · REGISTER</span>
          <h2 className="text-2xl mt-3">
            {filtered.filter((s) => s.purchase_type === "subscription").length}{" "}
            / {filtered.filter((s) => s.purchase_type === "one_time").length}
          </h2>
          <p className="field-hint">
            Recurring subscriptions / one-time purchases
          </p>
        </section>
      </div>
      <div className="finance-groups">
        {groups.map(({ label, get }) => (
          <section key={label} className="panel">
            <div className="panel-heading">
              <h2>Expenses by {label.toLowerCase()}</h2>
            </div>
            <div className="group-list">
              {[...new Set(actual.map(get))].map((key) => (
                <div key={key}>
                  <span>{key}</span>
                  <Totals
                    totals={currencyTotals(
                      actual.filter((e) => get(e) === key),
                      (e) => cents(e.amount) + cents(e.tax),
                      (e) => e.currency,
                    )}
                  />
                </div>
              ))}
              {!actual.length && (
                <p className="text-muted-foreground text-sm">
                  No recorded expenses in this selection.
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
      <section className="panel mt-6">
        <div className="panel-heading">
          <div>
            <h2>Confirmed expense records</h2>
            <p>
              Historical vendor, department, cost centre, and payment references
              are retained.
            </p>
          </div>
        </div>
        {actual.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Transaction date</th>
                  <th>Software / vendor</th>
                  <th>Department</th>
                  <th>Amount</th>
                  <th>Tax</th>
                  <th>Payment reference</th>
                  <th>Invoice</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {actual.map((e) => (
                  <tr key={e.id}>
                    <td>{e.transaction_date}</td>
                    <td>
                      <Link
                        className="record-link"
                        href={`/software/${e.subscription_id}`}
                      >
                        {byId.get(e.subscription_id)?.name}
                      </Link>
                      <small>{e.vendor_name}</small>
                    </td>
                    <td>
                      {e.team_name}
                      <small>{e.cost_centre}</small>
                    </td>
                    <td>
                      {money(cents(e.amount), e.currency)} {e.currency}
                    </td>
                    <td>{money(cents(e.tax), e.currency)}</td>
                    <td>{e.payment_reference || "—"}</td>
                    <td>{e.invoice_reference || "—"}</td>
                    <td>
                      <Link
                        className="text-primary"
                        href={`/finance/${e.id}/edit`}
                      >
                        Correct
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No confirmed expenses yet"
            text="Record an invoice or completed transaction to start financial reporting."
          />
        )}
      </section>
    </>
  );
}
