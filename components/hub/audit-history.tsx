import { createClient } from "@/lib/supabase/server";
export async function AuditHistory({ recordId }: { recordId: string }) {
  const db = await createClient();
  const { data } = await db
    .from("audit_logs")
    .select("id,action,created_at,before_data,after_data")
    .eq("record_id", recordId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!data?.length) return null;
  return (
    <section className="panel mt-6">
      <div className="panel-heading">
        <div>
          <h2>Audit history</h2>
          <p>Latest 50 changes · America/Edmonton</p>
        </div>
      </div>
      <div className="notification-list">
        {data.map((entry) => {
          const before = (entry.before_data || {}) as Record<string, unknown>;
          const after = (entry.after_data || {}) as Record<string, unknown>;
          const changed = Object.keys(after).filter(
            (key) =>
              !["updated_at", "created_at", "id"].includes(key) &&
              JSON.stringify(before[key]) !== JSON.stringify(after[key]),
          );
          const time = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Edmonton",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(entry.created_at));
          return (
            <details key={entry.id}>
              <summary>
                <strong>
                  {entry.action === "INSERT"
                    ? "Record created"
                    : "Record updated"}
                </strong>
                <time>{time}</time>
              </summary>
              <dl className="audit-fields">
                {changed.map((key) => (
                  <div key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>
                      {entry.before_data && (
                        <>
                          <del>{String(before[key] ?? "Empty")}</del>
                          <span aria-label="changed to"> → </span>
                        </>
                      )}
                      {String(after[key] ?? "Empty")}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          );
        })}
      </div>
    </section>
  );
}
