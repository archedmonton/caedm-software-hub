import { requireAccess } from "@/lib/auth";
import { allRows } from "@/lib/data";
import { adminRole, financeRole, roleLabels, type Team } from "@/lib/domain";
import { PageHeading, Status } from "@/components/hub/common";
import { ActionButton, SimpleForm } from "@/components/hub/controls";
import { BillingPreferences } from "@/components/hub/billing-preferences";
import Link from "next/link";
import {
  billingReminderDefaults,
  type BillingReminderPreferences,
} from "@/lib/billing-reminders";
export default async function Settings() {
  const { db, profile } = await requireAccess();
  const { data: settings } = await db
    .from("application_settings")
    .select("*")
    .single();
  const teams = await allRows<Team>(db, "teams");
  const preferenceResult = await db
    .from("billing_reminder_preferences")
    .select("enabled,first_notice_days,second_notice_days")
    .eq("profile_id", profile.id)
    .maybeSingle();
  const reviewLogs = financeRole(profile.role)
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
  const billingLogs = financeRole(profile.role)
    ? await allRows<{
        id: string;
        stage: string;
        status: string;
        provider: string | null;
        created_at: string;
        subject: string | null;
        body: string | null;
        error: string | null;
      }>(
        db,
        "billing_notifications",
        "id,stage,status,provider,created_at,subject,body,error",
      )
    : [];
  const logs = [
    ...reviewLogs,
    ...billingLogs.map((log) => ({ ...log, kind: `billing_${log.stage}` })),
  ];
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
              <span className="status">{roleLabels[profile.role]}</span>
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
      {adminRole(profile.role) && (
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
              The production scheduler runs daily at 15:00 UTC, using Edmonton
              business dates. It delivers personal billing notices (14 and 7
              days by default) and due usage-review messages. Run it manually to
              process currently due messages; this does not force future notices
              or send ordinary duplicates.
            </p>
            <ActionButton action="reminders">Run reminders now</ActionButton>
            <p className="mt-5 text-sm">
              <Link className="back-link" href="#billing-reminder-preferences">
                Customize my billing reminder emails ↓
              </Link>
            </p>
            <p className="field-hint mt-5">
              Server credentials and email configuration are managed through
              environment variables. No credentials are displayed here.
            </p>
          </section>
        </div>
      )}
      <section
        id="billing-reminder-preferences"
        className="panel p-7 mt-6 max-w-4xl"
      >
        <h2 className="mb-3">Your billing reminders</h2>
        <p className="text-muted-foreground mb-5 text-sm">
          Choose when the Hub emails you before the billing date for software
          you own. Your settings do not change another employee’s preferences.
        </p>
        <BillingPreferences
          preferences={
            (preferenceResult.data as BillingReminderPreferences | null) ??
            billingReminderDefaults
          }
          available={!preferenceResult.error}
        />
      </section>
      {financeRole(profile.role) && (
        <>
          <div className="mt-6">
            <section className="panel p-7 max-w-3xl">
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
