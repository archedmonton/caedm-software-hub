import Link from "next/link";
import {
  Bell,
  Building2,
  ChevronDown,
  MailCheck,
  UserRound,
  ArrowUpRight,
} from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { allRows } from "@/lib/data";
import { adminRole, financeRole, roleLabels } from "@/lib/domain";
import { PageHeading, Status } from "@/components/hub/common";
import { ActionButton, SimpleForm } from "@/components/hub/controls";
import { BillingPreferences } from "@/components/hub/billing-preferences";
import { FieldHelp } from "@/components/hub/field-help";
import {
  billingReminderDefaults,
  type BillingReminderPreferences,
} from "@/lib/billing-reminders";

type DeliveryLog = {
  id: string;
  kind: string;
  status: string;
  provider: string | null;
  created_at: string;
  subject: string | null;
  body: string | null;
  error: string | null;
};
export default async function Settings() {
  const { db, profile } = await requireAccess();
  const isAdmin = adminRole(profile.role);
  const isFinance = financeRole(profile.role);
  const [settingResult, preferenceResult, reviewLogs, billingLogs] =
    await Promise.all([
      isAdmin
        ? db.from("application_settings").select("*").single()
        : Promise.resolve({ data: null }),
      db
        .from("billing_reminder_preferences")
        .select("enabled,only_owned,first_notice_days,second_notice_days")
        .eq("profile_id", profile.id)
        .maybeSingle(),
      isFinance
        ? allRows<DeliveryLog>(db, "notification_logs")
        : Promise.resolve([]),
      isFinance
        ? allRows<Omit<DeliveryLog, "kind"> & { stage: string }>(
            db,
            "billing_notifications",
            "id,stage,status,provider,created_at,subject,body,error",
          )
        : Promise.resolve([]),
    ]);
  const settings = settingResult.data;
  const logs = [
    ...reviewLogs,
    ...billingLogs.map((l) => ({ ...l, kind: `billing_${l.stage}` })),
  ]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50);
  const failures = logs.filter((l) => l.status === "failed").length;
  return (
    <div className="settings-page readable-workspace">
      <PageHeading
        eyebrow="YOUR PREFERENCES"
        title="Settings"
        description={
          isAdmin
            ? "Manage your emails here. Shared workspace controls are kept separately below."
            : "Choose your software emails and check your account details."
        }
      />
      <div className="settings-layout">
        <div className="settings-main">
          <section
            id="notifications"
            className="panel settings-notifications"
            aria-labelledby="notifications-heading"
          >
            <div className="settings-section-heading">
              <span className="settings-section-icon">
                <Bell aria-hidden="true" />
              </span>
              <div>
                <span className="section-kicker">PERSONAL SETTINGS</span>
                <h2 id="notifications-heading">Notifications</h2>
                <p>
                  Choose the software emails you receive. These choices apply
                  only to you.
                </p>
              </div>
            </div>
            <BillingPreferences
              preferences={
                (preferenceResult.data as BillingReminderPreferences | null) ??
                billingReminderDefaults
              }
              available={!preferenceResult.error}
            />
          </section>

          {isFinance && (
            <section
              className="settings-administration"
              aria-labelledby="workspace-controls-heading"
            >
              <div className="settings-group-heading">
                <h2 id="workspace-controls-heading">
                  {isAdmin
                    ? "Workspace administration"
                    : "Delivery information"}
                </h2>
                <p>
                  {isAdmin
                    ? "Shared rules and delivery tools for administrators."
                    : "Read delivery history without changing anyone’s notification preferences."}
                </p>
              </div>
              {isAdmin && (
                <details
                  className="panel settings-disclosure"
                  id="workspace-settings"
                >
                  <summary>
                    <Building2 aria-hidden="true" />
                    <span>
                      <strong>Workspace settings</strong>
                      <span>
                        Organization, reporting currencies and Usage Review
                        timing
                      </span>
                    </span>
                    <ChevronDown
                      className="disclosure-chevron"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="settings-disclosure-body">
                    <p className="settings-explanation">
                      These shared rules apply to the organization. They do not
                      change personal billing notice timings.
                    </p>
                    <SimpleForm kind="settings" label="Save workspace settings">
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
                      <p className="field-hint">
                        Currencies stay separate. No exchange rates are applied.
                      </p>
                      <h3>When to request Usage Reviews</h3>
                      <div className="form-grid">
                        <div>
                          <div className="editor-field-label">
                            <label htmlFor="organization-initial-notice">
                              Initial review notice (days before decision
                              deadline)
                            </label>
                            <FieldHelp
                              id="organization-initial-help"
                              title="Initial review notice"
                              text="This organization rule creates Usage Reviews before the cancellation decision deadline. The deadline may be earlier than billing because of vendor notice periods. It is separate from each employee’s 14- and 7-day billing emails."
                            />
                          </div>
                          <input
                            id="organization-initial-notice"
                            type="number"
                            name="initial_reminder_days"
                            defaultValue={settings?.initial_reminder_days ?? 30}
                            min={1}
                            max={365}
                            required
                          />
                        </div>
                        <div>
                          <div className="editor-field-label">
                            <label htmlFor="organization-follow-up">
                              Follow-up notice (days before decision deadline)
                            </label>
                            <FieldHelp
                              id="organization-follow-up-help"
                              title="Review follow-up"
                              text="A follow-up is eligible only if the first review email was sent on an earlier day and the review is unanswered. Delivery respects each recipient’s Notifications settings. This is not a second billing reminder."
                            />
                          </div>
                          <input
                            id="organization-follow-up"
                            type="number"
                            name="follow_up_days"
                            defaultValue={settings?.follow_up_days ?? 7}
                            min={1}
                            max={90}
                            required
                          />
                        </div>
                      </div>
                    </SimpleForm>
                  </div>
                </details>
              )}
              <details
                className="panel settings-disclosure"
                id="email-delivery"
              >
                <summary>
                  <MailCheck aria-hidden="true" />
                  <span>
                    <strong>
                      {isAdmin
                        ? "Email delivery & activity"
                        : "Email delivery activity"}
                    </strong>
                    <span>
                      {isAdmin
                        ? "Automatic schedule, manual delivery and recent messages"
                        : "Recent billing and Usage Review email delivery"}
                    </span>
                  </span>
                  {failures > 0 && (
                    <span className="delivery-failure-count">
                      {failures} failed
                    </span>
                  )}
                  <ChevronDown
                    className="disclosure-chevron"
                    aria-hidden="true"
                  />
                </summary>
                <div className="settings-disclosure-body">
                  {isAdmin && (
                    <div className="delivery-run-tools">
                      <h3>Automatic delivery is scheduled daily</h3>
                      <p>
                        The daily run is at 15:00 UTC, using Edmonton dates. Run
                        now to process emails that are currently due. Personal
                        preferences still apply.
                      </p>
                      <ActionButton action="reminders">
                        Run reminders now
                      </ActionButton>
                    </div>
                  )}
                  <h3 className="delivery-activity-heading">
                    Notification activity
                  </h3>
                  <p className="settings-explanation">
                    The latest 50 messages. Open an entry for its delivery
                    details.
                  </p>
                  <div className="notification-list">
                    {logs.map((log) => (
                      <details key={log.id}>
                        <summary>
                          <span>
                            {log.kind.replaceAll("_", " ")} ·{" "}
                            {log.provider || "Queued"}
                          </span>
                          <Status value={log.status} />
                          <time dateTime={log.created_at}>
                            {new Intl.DateTimeFormat("en-CA", {
                              timeZone: "America/Edmonton",
                              month: "short",
                              day: "numeric",
                            }).format(new Date(log.created_at))}
                          </time>
                        </summary>
                        <h4>{log.subject || "Pending message"}</h4>
                        <p className="delivery-message-body">
                          {log.body ||
                            log.error ||
                            "This email will be checked during the next delivery run."}
                        </p>
                        {log.provider === "local" && (
                          <p className="field-hint">
                            Development preview. No external email was sent.
                          </p>
                        )}
                      </details>
                    ))}
                    {!logs.length && (
                      <p className="settings-explanation">
                        No messages have been queued yet.
                      </p>
                    )}
                  </div>
                </div>
              </details>
            </section>
          )}
        </div>
        <aside className="settings-account" aria-labelledby="account-heading">
          <section className="panel settings-account-card">
            <div className="settings-account-title">
              <UserRound size={22} aria-hidden="true" />
              <h2 id="account-heading">Your account</h2>
            </div>
            <strong className="settings-account-name">
              {profile.full_name}
            </strong>
            <p className="settings-account-email">{profile.email}</p>
            <dl>
              <div>
                <dt>Role</dt>
                <dd>{roleLabels[profile.role]}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>
                  <Status value={profile.status} />
                </dd>
              </div>
              <div>
                <dt>Dates & times</dt>
                <dd>America/Edmonton</dd>
              </div>
            </dl>
            <p>
              Need a role or department change? Contact your workspace
              administrator.
            </p>
            {isAdmin && (
              <Link className="dashboard-text-link" href="/team">
                Manage people & departments{" "}
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            )}
          </section>
          {isFinance && (
            <div className="settings-reference-note">
              <h3>Vendors & payment references</h3>
              <p>
                Add these while adding or editing software, right where you need
                them.
              </p>
              <Link className="dashboard-text-link" href="/software">
                Open Software Inventory{" "}
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
