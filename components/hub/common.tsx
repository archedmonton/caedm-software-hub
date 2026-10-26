import Link from "next/link";
import { ArrowUpRight, Layers3 } from "lucide-react";
import { money } from "@/lib/domain";
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Empty({
  title = "Nothing here yet",
  text = "New records will appear here as your team adds them.",
  href,
  action,
}: {
  title?: string;
  text?: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <Layers3 size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      {href && (
        <Link className="text-primary" href={href}>
          {action || "Get started"} <ArrowUpRight size={14} />
        </Link>
      )}
    </div>
  );
}
export function Totals({ totals }: { totals: Record<string, number> }) {
  const entries = Object.entries(totals);
  return (
    <span className="currency-totals">
      {entries.length ? (
        entries
          .sort(([a], [b]) =>
            a === "CAD" ? -1 : b === "CAD" ? 1 : a.localeCompare(b),
          )
          .map(([code, value]) => (
            <span key={code}>
              <strong>{money(value, code)}</strong>
              <small>{code}</small>
            </span>
          ))
      ) : (
        <span className="text-muted-foreground">No amounts</span>
      )}
    </span>
  );
}
