"use client";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { equivalents, money, type Subscription } from "@/lib/domain";
import { Empty } from "@/components/hub/common";
export function SpendingCharts({ software }: { software: Subscription[] }) {
  const codes = [...new Set(software.map((s) => s.currency))].sort();
  const [currency, setCurrency] = useState(
    codes.includes("CAD") ? "CAD" : codes[0] || "CAD",
  );
  const departments: Record<string, number> = {};
  const categories: Record<string, number> = {};
  software
    .filter((s) => s.currency === currency)
    .forEach((s) => {
      const e = equivalents(s);
      const team = s.teams?.name || "Unassigned";
      departments[team] = (departments[team] || 0) + e.monthly;
      categories[s.category] = (categories[s.category] || 0) + e.annual;
    });
  const data = Object.entries(departments)
    .map(([name, cost]) => ({ name, cost: cost / 100 }))
    .filter((v) => v.cost > 0);
  const categoryData = Object.entries(categories)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = categoryData.reduce((a, [, v]) => a + v, 0);
  return (
    <div className="dashboard-charts">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Spending by department</h2>
            <p>Monthly recurring equivalent</p>
          </div>
          <select
            aria-label="Chart currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {(codes.length ? codes : ["CAD"]).map((code) => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </div>
        {data.length ? (
          <>
            <div
              className="chart"
              role="img"
              aria-label={`Monthly department spending in ${currency}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  margin={{ top: 15, right: 20, left: 0, bottom: 15 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e8edf3"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value) =>
                      money(Math.round(Number(value) * 100), currency)
                    }
                  />
                  <Bar
                    dataKey="cost"
                    fill="var(--caedm-blue)"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={44}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <details className="chart-data">
              <summary>View spending data</summary>
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Monthly {currency}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d) => (
                    <tr key={d.name}>
                      <td>{d.name}</td>
                      <td>{money(Math.round(d.cost * 100), currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <Empty
            title="Spending comes into focus here"
            text="Add active subscriptions to see department totals."
          />
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Where it goes</h2>
            <p>Annual recurring cost by category · {currency}</p>
          </div>
        </div>
        <div className="category-list">
          {categoryData.length ? (
            categoryData.map(([name, value], i) => (
              <div key={name}>
                <div className="flex justify-between gap-3">
                  <span>
                    <i className={`category-dot color-${i % 4}`} />
                    {name}
                  </span>
                  <strong>{money(value, currency)}</strong>
                </div>
                <div className="category-track">
                  <i
                    className={`color-${i % 4}`}
                    style={{ width: `${(value / total) * 100}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <Empty title="No recurring costs yet" />
          )}
        </div>
        <p className="panel-footnote">
          Currencies are reported separately. No exchange rates applied.
        </p>
      </section>
    </div>
  );
}
