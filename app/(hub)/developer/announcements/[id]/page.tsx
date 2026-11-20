import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireDeveloper } from "@/lib/developer-auth";
import { retryAnnouncement } from "@/app/announcement-actions";
import { PageHeading, Status } from "@/components/hub/common";
type Recipient = {
  id: string;
  email: string;
  full_name: string;
  is_test: boolean;
  status: string;
  attempts: number;
  safe_error: string | null;
};
type Attempt = {
  recipient_id: string;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  outcome: string | null;
};
export default async function AnnouncementDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, directory } = await requireDeveloper();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const result = await db.rpc("developer_announcement_detail", {
    announcement: id,
  });
  if (result.error || !result.data?.announcement) notFound();
  const {
    announcement: a,
    recipients,
    attempts,
  } = result.data as {
    announcement: {
      title: string;
      subject: string;
      template: string;
      audience: string;
      created_by: string;
      created_at: string;
      queued_at: string | null;
      body: string;
    };
    recipients: Recipient[];
    attempts: Attempt[];
  };
  return (
    <div className="developer-page">
      <Link href="/developer?tab=announcements">← Back to announcements</Link>
      <PageHeading
        eyebrow="ANNOUNCEMENT DELIVERY"
        title={a.title}
        description={a.subject}
      />
      <section className="card">
        <dl className="about-details">
          <dt>Created by</dt>
          <dd>
            {directory.people.find((p) => p.id === a.created_by)?.email ||
              "Former developer"}
          </dd>
          <dt>Template / audience</dt>
          <dd>
            {a.template} / {a.audience.replaceAll("_", " ")}
          </dd>
          <dt>Created</dt>
          <dd>{a.created_at}</dd>
          <dt>Queued</dt>
          <dd>{a.queued_at || "Draft"}</dd>
        </dl>
        <p>
          Accepted means the email provider accepted the message. Delivered is
          shown only after a signed Resend delivery event; it does not confirm
          that someone read the email.
        </p>
        <div className="developer-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Latest result</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td>{r.email}</td>
                  <td>{r.is_test ? "Test" : "Announcement"}</td>
                  <td>
                    <Status value={r.status} />
                  </td>
                  <td>{r.attempts}</td>
                  <td>{r.safe_error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={retryAnnouncement}>
          <input type="hidden" name="id" value={id} />
          <button
            className="button"
            disabled={
              !recipients.some(
                (r) => !r.is_test && r.status === "failed" && r.attempts < 5,
              )
            }
          >
            Retry eligible failed recipients
          </button>
        </form>
        <p>
          Accepted and delivered messages are never resent. Suppressed or
          ineligible recipients are skipped at delivery.
        </p>
        <details>
          <summary>Delivery attempts ({attempts.length})</summary>
          <ul>
            {attempts.map((t) => (
              <li key={`${t.recipient_id}-${t.attempt}`}>
                {recipients.find((r) => r.id === t.recipient_id)?.email}:
                attempt {t.attempt} · {t.outcome || "sending"} · {t.started_at}
              </li>
            ))}
          </ul>
        </details>
      </section>
      <section className="card">
        <h2>Saved message</h2>
        <p className="announcement-plain-body">{a.body}</p>
      </section>
    </div>
  );
}
