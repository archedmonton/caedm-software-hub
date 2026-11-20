import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireDeveloper } from "@/lib/developer-auth";
import { developer } from "@/lib/developer";
import { PageHeading } from "@/components/hub/common";
import {
  DeveloperAccess,
  RolePreview,
  Handover,
  AnnouncementComposer,
  EmailOutbox,
} from "@/components/hub/developer-tools";
import type { Audience, DeveloperActivity } from "@/lib/announcement-types";
const tabs = [
  ["overview", "Overview"],
  ["preview", "View as Role"],
  ["announcements", "Announcements"],
  ["outbox", "Email Outbox"],
  ["access", "Developer Access"],
  ["handover", "Primary Handover"],
] as const;
export default async function DeveloperPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const context = await requireDeveloper();
  const { db, directory, actualProfile } = context;
  await db.rpc("visit_developer_tools");
  const requested = (await searchParams).tab || "overview";
  const tab = tabs.some(([key]) => key === requested) ? requested : "overview";
  const primary = directory.people.find((p) => p.id === directory.primary_id);
  const mismatch = !primary || primary.email !== developer.email;
  const [activityResult, audienceResult] = await Promise.all([
    db.rpc("developer_email_activity"),
    db.rpc("developer_announcement_audience", { kind: "everyone" }),
  ]);
  const activity: DeveloperActivity = activityResult.data || {
    announcements: [],
    outbox: [],
  };
  const audience: Audience = audienceResult.data || {
    audience: "everyone",
    eligible: 0,
    excluded: 0,
    duplicates_removed: 0,
    count: 0,
    people: [],
  };
  return (
    <div className="developer-page readable-workspace">
      <PageHeading
        eyebrow="GOVERNED APPLICATION TOOLS"
        title="Developer Tools"
        description="Manage application communications and Developer access. Your organization role remains separate."
      />
      <nav className="developer-tabs" aria-label="Developer tools">
        {tabs.map(([key, label]) => (
          <Link
            href={`/developer?tab=${key}`}
            key={key}
            aria-current={key === tab ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {mismatch && (
        <div className="developer-warning" role="status">
          <strong>Primary contact needs attention</strong>
          <p>
            The configured developer contact and recorded primary developer do
            not match. Existing assignments remain unchanged. Follow the
            handover steps to reconcile them.
          </p>
        </div>
      )}
      {(activityResult.error || audienceResult.error) && (
        <p className="error" role="alert">
          Email activity could not be loaded. Confirm the reviewed announcement
          migration is installed.
        </p>
      )}
      {tab === "overview" && (
        <>
          <div className="developer-overview">
            <section className="card">
              <span className="eyebrow">YOUR ACCESS</span>
              <h2>{actualProfile.full_name}</h2>
              <p>
                Developer designation ·{" "}
                {actualProfile.role.replaceAll("_", " ")} organization role
              </p>
              <p>
                Developer tools do not grant Finance, administrator or
                department access.
              </p>
              <Link href="/developer?tab=preview" className="button">
                Choose a restricted role preview
              </Link>
            </section>
            <section className="card">
              <span className="eyebrow">PRIMARY DEVELOPER</span>
              <h2>{primary?.full_name || "Operator setup required"}</h2>
              <p>
                {primary?.email ||
                  "An authorized database operator must bootstrap the existing protected developer UUID."}
              </p>
              <p>Contact: {developer.email || "Not configured"}</p>
              <Link href="/developer?tab=handover">
                Review primary handover
              </Link>
            </section>
          </div>
          <section className="card">
            <h2>Before you make a change</h2>
            <ul className="developer-guidance">
              <li>
                Role previews affect real records. Every change is attributed to
                your actual account.
              </li>
              <li>
                Announcements require a current preview, a test accepted by the
                provider and confirmation of the deduplicated recipient count.
              </li>
              <li>
                Developer access changes require your current password and
                configured MFA. They never change organization roles.
              </li>
            </ul>
          </section>
          <Audit directory={directory} />
          <section className="card">
            <h2>Help an employee sign in</h2>
            <p>
              Prepare an audited one-time password recovery link when email is
              unavailable. Fresh verification and identity confirmation are
              required.
            </p>
            <Link className="button" href="/account-recovery">
              Open Account Recovery
            </Link>
          </section>
        </>
      )}
      {tab === "preview" && <RolePreview actualRole={actualProfile.role} />}
      {tab === "announcements" && (
        <AnnouncementComposer
          initialId={randomUUID()}
          authors={Object.fromEntries(
            directory.people.map((person) => [
              person.id,
              person.full_name || person.email,
            ]),
          )}
          people={audience.people}
          history={activity.announcements}
          actorId={context.user.id}
        />
      )}
      {tab === "outbox" && <EmailOutbox rows={activity.outbox} />}
      {tab === "access" && (
        <>
          <DeveloperAccess directory={directory} actorId={context.user.id} />
          <Audit directory={directory} />
        </>
      )}
      {tab === "handover" && (
        <Handover
          directory={directory}
          actorId={context.user.id}
          configuredEmail={developer.email}
        />
      )}
    </div>
  );
}
function Audit({
  directory,
}: {
  directory: Awaited<ReturnType<typeof requireDeveloper>>["directory"];
}) {
  const person = (id: string | null) =>
    directory.people.find((p) => p.id === id)?.full_name ||
    (id ? "Former or unavailable account" : "Authorized database operator");
  return (
    <section className="card">
      <h2>Developer audit trail</h2>
      <p>
        Append-only records distinguish actual actors, access changes,
        announcements and role-preview sessions.
      </p>
      <div className="developer-table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Person affected</th>
            </tr>
          </thead>
          <tbody>
            {directory.audit.map((row) => (
              <tr key={row.id}>
                <td>
                  {new Date(row.created_at).toLocaleString("en-CA", {
                    timeZone: "America/Edmonton",
                  })}
                </td>
                <td>{row.action.replaceAll("_", " ")}</td>
                <td>{person(row.actor_id)}</td>
                <td>{row.subject_id ? person(row.subject_id) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
