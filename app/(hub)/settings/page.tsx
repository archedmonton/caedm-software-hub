import { requireAccess } from "@/lib/auth";
import { allRows } from "@/lib/data";
import { financeRole, type Team } from "@/lib/domain";
import { PageHeading, Status } from "@/components/hub/common";
import { ActionButton, SimpleForm } from "@/components/hub/controls";
export default async function Settings() {
  const { db, profile } = await requireAccess();
  const { data: settings } = await db
    .from("application_settings")
    .select("*")
    .single();
  const teams = await allRows<Team>(db, "teams");
  const logs = financeRole(profile.role)
    ? await allRows<{
        id: string;
        kind: string;
        status: string;
        provider: string;
        created_at: string;
        subject: string | null;
        body: string | null;
        error: string | null;
      }>(db, "notification_logs")
    : [];
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE PREFERENCES"
        title="Settings"
        description="Your account, notification rules, and the references behind the numbers."
      />
      <section className="panel p-7">
        <h2>Your profile</h2>
        <dl className="detail-grid">
          <div>
            <dt>Name</dt>
            <dd>{profile.full_name}</dd>
          </div>
          <div>
            <dt>Verified email</dt>
            <dd>{profile.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>
              <Status value={profile.role} />
            </dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>
              <Status value={profile.status} />
            </dd>
          </div>
          <div>
            <dt>Organization timezone</dt>
            <dd>America/Edmonton</dd>
          </div>
        </dl>
      </section>
      {profile.role === "admin" && (
        <div className="admin-grid mt-6">
          <section className="panel p-7">
            <h2 className="mb-5">Organization & reminders</h2>
            <SimpleForm kind="settings">
              <label>
                Organization name
                <input
                  name="organization_name"
                  defaultValue={settings?.organization_name}
                  required
                  maxLength={150}
                />
              </label>
              <label>
                Reporting currencies (comma separated)
                <input
                  name="currencies"
                  defaultValue={settings?.currencies.join(",")}
                  placeholder="CAD,USD"
                  required
                />
              </label>
              <label>
                Initial review notice (days before decision deadline)
                <input
                  type="number"
                  name="initial_reminder_days"
                  defaultValue={settings?.initial_reminder_days || 30}
                  min={1}
                  max={365}
                  required
                />
              </label>
              <label>
                Follow-up notice (days before decision deadline)
                <input
                  type="number"
                  name="follow_up_days"
                  defaultValue={settings?.follow_up_days || 7}
                  min={1}
                  max={90}
                  required
                />
              </label>
            </SimpleForm>
          </section>
          <section className="panel p-7">
            <h2>Reminder delivery</h2>
            <p className="text-muted-foreground my-5 text-sm">
              Run the daily reminder workflow manually. Unique queue records
              prevent duplicate normal deliveries. Development delivery previews
              appear below.
            </p>
            <ActionButton action="reminders">Run reminders now</ActionButton>
            <p className="field-hint mt-5">
              Server credentials and email configuration are managed through
              environment variables. No credentials are displayed here.
            </p>
          </section>
        </div>
      )}
      {financeRole(profile.role) && (
        <>
          <div className="admin-grid mt-6">
            <section className="panel p-7">
              <h2 className="mb-5">Add a vendor</h2>
              <SimpleForm kind="vendor" reference label="Add vendor">
                <label>
                  Vendor name
                  <input name="name" required maxLength={150} />
                </label>
              </SimpleForm>
            </section>
            <section className="panel p-7">
              <h2 className="mb-5">Add a payment reference</h2>
              <SimpleForm
                kind="payment"
                reference
                label="Add payment reference"
              >
                <label>
                  Department
                  <select name="team_id" required>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nickname
                  <input name="nickname" required maxLength={100} />
                </label>
                <div className="form-grid">
                  <label>
                    Card brand
                    <input name="brand" maxLength={40} />
                  </label>
                  <label>
                    Last four digits
                    <input
                      name="last_four"
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      maxLength={4}
                      required
                    />
                  </label>
                </div>
                <label>
                  Payment notes
                  <textarea name="notes" maxLength={2000} rows={2} />
                </label>
                <p className="field-hint">
                  References only. Never enter full card numbers or security
                  codes.
                </p>
              </SimpleForm>
            </section>
          </div>
          <section className="panel mt-6">
            <div className="panel-heading">
              <div>
                <h2>Notification activity</h2>
                <p>Delivery state and local email previews</p>
              </div>
            </div>
            <div className="notification-list">
              {logs
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .slice(0, 50)
                .map((log) => (
                  <details key={log.id}>
                    <summary>
                      <span>
                        {log.kind.replaceAll("_", " ")} ·{" "}
                        {log.provider || "Queued"}
                      </span>
                      <Status value={log.status} />
                      <time>{log.created_at.slice(0, 10)}</time>
                    </summary>
                    <h3 className="my-3">{log.subject || "Pending message"}</h3>
                    <p className="whitespace-pre-wrap text-sm">
                      {log.body ||
                        log.error ||
                        "The message will be prepared by the next reminder run."}
                    </p>
                    {log.provider === "local" && (
                      <p className="field-hint">
                        Development preview. No external email was sent.
                      </p>
                    )}
                  </details>
                ))}
              {!logs.length && (
                <p className="p-6 text-muted-foreground text-sm">
                  No notification activity yet.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
