"use client";
import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  startPreview,
  changeDeveloper,
  confirmHandover,
} from "@/app/developer-actions";
import {
  previewAnnouncement,
  testAnnouncement,
  queueAnnouncement,
  type ComposerState,
} from "@/app/announcement-actions";
import {
  announcementTemplates,
  type AnnouncementTemplate,
} from "@/lib/announcement-content";
import type { DeveloperDirectory } from "@/lib/developer-auth";
import type {
  AnnouncementHistory,
  EmailActivity,
} from "@/lib/announcement-types";
import { roleLabels, type Profile } from "@/lib/domain";
import { Status } from "@/components/hub/common";

function ConfirmDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      className="developer-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="developer-confirm-title"
    >
      <h2 id="developer-confirm-title">{title}</h2>
      {children}
      <button
        type="button"
        className="button button-secondary"
        onClick={onClose}
      >
        Cancel
      </button>
    </dialog>
  );
}
function Result({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="success">
          {success}
        </p>
      )}
    </>
  );
}
function Credentials() {
  return (
    <div className="developer-credentials">
      <label>
        Confirm your current password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <label>
        Authenticator code, if configured
        <input
          name="mfa_code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="6-digit code"
        />
      </label>
      <p>
        Your password is checked in an isolated authentication session. Your
        current browser session and organization role remain unchanged.
      </p>
    </div>
  );
}
export function RolePreview({ actualRole }: { actualRole: Profile["role"] }) {
  const roles: Profile["role"][] =
    actualRole === "super_admin"
      ? ["admin", "finance", "staff"]
      : actualRole === "admin"
        ? ["finance", "staff"]
        : actualRole === "finance"
          ? ["staff"]
          : [];
  const [state, action, pending] = useActionState<{ error?: string }, FormData>(
    async (_previous, form) => (await startPreview(form)) || {},
    {},
  );
  return (
    <section className="card">
      <span className="eyebrow">PERMISSION PREVIEW</span>
      <h2>View the workspace with fewer permissions</h2>
      <p>
        Your actual role is <strong>{roleLabels[actualRole]}</strong>. A preview
        narrows access for this signed-in session for up to 30 minutes.
      </p>
      <div className="developer-warning">
        <strong>Changes are real</strong>
        <p>
          This is a permission preview of your own account. You do not
          impersonate another employee. Any permitted changes affect real
          records and are audited under your account.
        </p>
      </div>
      {roles.length ? (
        <form action={action}>
          <label>
            Preview role
            <select name="role" aria-label="Preview role">
              {roles.map((role) => (
                <option value={role} key={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
          </label>
          <p>
            Staff preview uses only your existing department memberships.
            Developer actions are unavailable until you return to your view.
          </p>
          <Result {...state} />
          <button className="button" disabled={pending}>
            Start restricted preview
          </button>
        </form>
      ) : (
        <p>
          Your role has no supported lower-permission preview. Developer
          designation does not increase it.
        </p>
      )}
    </section>
  );
}
export function DeveloperAccess({
  directory,
  actorId,
}: {
  directory: DeveloperDirectory;
  actorId: string;
}) {
  const [person, setPerson] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState<
    { error?: string; success?: string },
    FormData
  >(changeDeveloper, {});
  const candidate = directory.people.find((p) => p.id === person);
  return (
    <section className="card">
      <span className="eyebrow">SEPARATE FROM ORGANIZATION ROLES</span>
      <h2>Developer access</h2>
      <p>
        Only verified, active CAEDM employees are eligible. Granting Developer
        access gives access to these tools; it does not grant Super Admin,
        Finance or new departments.
      </p>
      <div className="developer-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Organization role</th>
              <th>Developer access</th>
              <th>Granted</th>
              <th>Granted by</th>
            </tr>
          </thead>
          <tbody>
            {directory.people
              .filter((p) => p.developer_active)
              .map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.full_name}
                    <small>{p.email}</small>
                    <small>Verified · Active account</small>
                  </td>
                  <td>{roleLabels[p.role as Profile["role"]]}</td>
                  <td>
                    {p.id === directory.primary_id
                      ? "Primary developer · protected"
                      : "Authorized Developer"}
                  </td>
                  <td>{p.granted_at?.slice(0, 10) || "—"}</td>
                  <td>
                    {directory.people.find((a) => a.id === p.granted_by)
                      ?.email || "Authorized operator"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <Result {...state} />
      <label>
        Choose an eligible employee
        <select value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Select a person</option>
          {directory.people
            .filter((p) => p.id !== actorId && p.id !== directory.primary_id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} · {p.email} ·{" "}
                {p.developer_active ? "Developer" : "No Developer access"}
              </option>
            ))}
        </select>
      </label>
      <p>
        You cannot remove your own Developer access or revoke the primary
        developer. Use the governed handover process to change the primary
        contact.
      </p>
      <button
        className="button"
        disabled={!candidate || pending}
        onClick={() => setConfirm(true)}
      >
        {candidate?.developer_active ? "Review revocation" : "Review grant"}
      </button>
      {confirm && candidate && (
        <ConfirmDialog
          title={
            candidate.developer_active
              ? "Revoke Developer access?"
              : "Grant Developer access?"
          }
          onClose={() => setConfirm(false)}
        >
          <p>
            {candidate.full_name} · {candidate.email}
          </p>
          <p>
            {candidate.developer_active
              ? "This person will lose Developer Tools access. Their organization role remains unchanged."
              : "This person will gain Developer Tools access independently of their organization role."}
          </p>
          <form
            action={async (form) => {
              await action(form);
              setConfirm(false);
            }}
          >
            <input type="hidden" name="person" value={candidate.id} />
            <input
              type="hidden"
              name="enabled"
              value={String(!candidate.developer_active)}
            />
            <Credentials />
            <button className="button" disabled={pending}>
              Confirm {candidate.developer_active ? "revocation" : "grant"}
            </button>
          </form>
        </ConfirmDialog>
      )}
    </section>
  );
}
export function Handover({
  directory,
  actorId,
  configuredEmail,
}: {
  directory: DeveloperDirectory;
  actorId: string;
  configuredEmail: string;
}) {
  const [person, setPerson] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState<
    { error?: string; success?: string },
    FormData
  >(confirmHandover, {});
  const successor = directory.people.find((p) => p.id === person);
  const ready =
    actorId === directory.primary_id &&
    successor?.developer_active &&
    successor.email === configuredEmail &&
    directory.approved_successor === person &&
    !!successor.last_seen_at;
  return (
    <section className="card">
      <span className="eyebrow">GOVERNED SUCCESSION</span>
      <h2>Primary developer handover</h2>
      <p>
        Changing a contact address alone never grants access or transfers
        governance. The outgoing developer keeps their existing Developer access
        unless it is separately revoked later.
      </p>
      <ol className="handover-steps">
        <li>
          <strong>Grant the successor Developer access.</strong>
          <p>
            Choose a verified, active CAEDM employee in Developer Access.
            Confirm with your password and configured MFA.
          </p>
        </li>
        <li>
          <strong>Have the successor sign in and open Developer Tools.</strong>
          <p>
            The system records their access verification. They should confirm
            they can use the required tools.
          </p>
        </li>
        <li>
          <strong>
            Ask the deployment operator to update the primary configuration.
          </strong>
          <p>
            Set Vercel’s DEVELOPER_EMAIL to the successor’s verified address,
            align the approved display name and deploy the approved
            configuration. The database operator must explicitly authorize that
            same successor UUID using the documented handover procedure.
          </p>
        </li>
        <li>
          <strong>The current primary confirms the handover.</strong>
          <p>
            Re-enter the current primary’s password and configured MFA. The
            saved designation changes only after configuration, eligibility and
            operator approval agree.
          </p>
        </li>
      </ol>
      <dl className="about-details">
        <dt>Configured primary contact</dt>
        <dd>{configuredEmail || "Missing"}</dd>
        <dt>Recorded primary</dt>
        <dd>
          {directory.people.find((p) => p.id === directory.primary_id)?.email ||
            "Not established"}
        </dd>
      </dl>
      <label>
        Successor
        <select value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Select an authorized Developer</option>
          {directory.people
            .filter((p) => p.developer_active && p.id !== directory.primary_id)
            .map((p) => (
              <option value={p.id} key={p.id}>
                {p.full_name} · {p.email}
              </option>
            ))}
        </select>
      </label>
      {successor && (
        <p>
          Opened Developer Tools: {successor.last_seen_at || "Not yet recorded"}{" "}
          · Operator approval:{" "}
          {directory.approved_successor === person ? "Recorded" : "Required"}
        </p>
      )}
      <Result {...state} />
      <button
        className="button"
        disabled={!ready || pending}
        onClick={() => setConfirm(true)}
      >
        Review primary handover
      </button>
      {!ready && (
        <p>
          Only the recorded primary can confirm after all four steps are ready.
          Organization roles and protected Super Admin identity are managed
          separately.
        </p>
      )}
      {confirm && successor && (
        <ConfirmDialog
          title="Confirm primary developer handover?"
          onClose={() => setConfirm(false)}
        >
          <p>
            Transfer the primary developer designation to {successor.email}.
            Existing roles, records and Developer access are preserved.
          </p>
          <form
            action={async (form) => {
              await action(form);
              setConfirm(false);
            }}
          >
            <input type="hidden" name="person" value={person} />
            <Credentials />
            <button className="button" disabled={pending}>
              Confirm handover
            </button>
          </form>
        </ConfirmDialog>
      )}
    </section>
  );
}
export function AnnouncementComposer({
  people,
  history,
  actorId,
  initialId,
  authors,
}: {
  people: { email: string; full_name: string }[];
  history: AnnouncementHistory[];
  actorId: string;
  initialId: string;
  authors: Record<string, string>;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState<AnnouncementTemplate>("welcome");
  const [title, setTitle] = useState(announcementTemplates.welcome.title);
  const [subject, setSubject] = useState(announcementTemplates.welcome.subject);
  const [body, setBody] = useState(announcementTemplates.welcome.body);
  const [audience, setAudience] = useState("signed_up");
  const [selected, setSelected] = useState<string[]>([]);
  const [id, setId] = useState(initialId);
  const [state, action, saving] = useActionState<ComposerState, FormData>(
    previewAnnouncement,
    {},
  );
  const [dirty, setDirty] = useState(true);
  const [tested, setTested] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<{ error?: string; success?: string }>(
    {},
  );
  const [busy, transition] = useTransition();
  const [narrow, setNarrow] = useState(false);
  const [queued, setQueued] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const changed = () => {
    setDirty(true);
    setTested(false);
    setNotice({});
  };
  const preview = !dirty ? state.preview : undefined;
  const applyFormat = (kind: "bold" | "list") => {
    const input = textarea.current;
    if (!input) return;
    const start = input.selectionStart,
      end = input.selectionEnd;
    const selectedText =
      body.slice(start, end) ||
      (kind === "bold" ? "important text" : "List item");
    setBody(
      body.slice(0, start) +
        (kind === "bold"
          ? `**${selectedText}**`
          : selectedText
              .split("\n")
              .map((line) => `- ${line}`)
              .join("\n")) +
        body.slice(end),
    );
    changed();
    input.focus();
  };
  return (
    <>
      <section className="card announcement-composer">
        <span className="eyebrow">INDIVIDUAL CAEDM COMMUNICATIONS</span>
        <h2>Compose an announcement</h2>
        <p>
          Compose → Preview → Send Test to Me → Review recipients → Confirm
          send. Editing content or recipients requires a new preview and test.
        </p>
        <form
          action={async (form) => {
            setNotice({});
            setTested(false);
            setDirty(false);
            await action(form);
          }}
        >
          <input type="hidden" name="id" value={id} />
          <div className="developer-form-grid">
            <label>
              Starting template
              <select
                name="template"
                value={template}
                onChange={(e) => {
                  const next = e.target.value as AnnouncementTemplate;
                  setTemplate(next);
                  setTitle(announcementTemplates[next].title);
                  setSubject(announcementTemplates[next].subject);
                  setBody(announcementTemplates[next].body);
                  changed();
                }}
              >
                <option value="welcome">Welcome Testers</option>
                <option value="whats_new">What’s New · current release</option>
                <option value="blank">Blank Announcement</option>
              </select>
            </label>
            <label>
              Audience
              <select
                name="audience"
                aria-label="Audience"
                value={audience}
                onChange={(e) => {
                  setAudience(e.target.value);
                  changed();
                }}
              >
                <option value="signed_up">Everyone Signed Up</option>
                <option value="invited">Everyone Invited</option>
                <option value="everyone">All Signed Up and Invited</option>
                <option value="selected">Selected People</option>
              </select>
            </label>
            <label>
              Announcement title
              <input
                name="title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  changed();
                }}
                required
                maxLength={200}
              />
            </label>
            <label>
              Email subject
              <input
                name="subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  changed();
                }}
                required
                maxLength={180}
              />
            </label>
          </div>
          {audience === "selected" && (
            <fieldset className="recipient-picker">
              <legend>Choose actual eligible people</legend>
              {people.length ? (
                people.map((p) => (
                  <label key={p.email}>
                    <input
                      type="checkbox"
                      name="selected"
                      value={p.email}
                      checked={selected.includes(p.email)}
                      onChange={(e) => {
                        setSelected((current) =>
                          e.target.checked
                            ? [...current, p.email]
                            : current.filter((email) => email !== p.email),
                        );
                        changed();
                      }}
                    />
                    <span>
                      {p.full_name || "Invited employee"}
                      <small>{p.email}</small>
                    </span>
                  </label>
                ))
              ) : (
                <p>No eligible people are available.</p>
              )}
            </fieldset>
          )}
          <label>Message</label>
          <div className="announcement-toolbar">
            <button
              type="button"
              onClick={() => applyFormat("bold")}
              aria-label="Format selected text as bold"
            >
              <strong>Bold</strong>
            </button>
            <button type="button" onClick={() => applyFormat("list")}>
              Bullet list
            </button>
            <span>
              Plain text, **bold** and lists. HTML is displayed as text.
            </span>
          </div>
          <textarea
            ref={textarea}
            aria-label="Message"
            name="body"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              changed();
            }}
            required
            minLength={10}
            maxLength={20000}
            rows={12}
          />
          <p>
            From: CAEDM Software Hub &lt;notifications@caedm.ca&gt;. Replies go
            to your verified work email. Every person receives a separate
            message.
          </p>
          <Result error={state.error} />
          <button className="button" disabled={saving || queued || !id}>
            {saving ? "Saving preview…" : "Save & preview"}
          </button>
        </form>
      </section>
      {preview && (
        <section className="card">
          <div className="developer-section-heading">
            <div>
              <span className="eyebrow">CURRENT SAVED DRAFT</span>
              <h2>Email preview</h2>
            </div>
            <button
              className="button button-secondary"
              onClick={() => setNarrow((value) => !value)}
            >
              {narrow ? "Desktop preview" : "Narrow-screen preview"}
            </button>
          </div>
          <p>
            Reply-To: {preview.sender.email} · Preview is personalized for you
            and labeled TEST. The final announcement uses this same renderer
            without the TEST label.
          </p>
          <div className={`announcement-preview ${narrow ? "narrow" : ""}`}>
            <iframe
              title="Announcement email preview"
              sandbox=""
              srcDoc={preview.html}
            />
          </div>
          <div className="audience-counts">
            <span>
              <strong>{preview.audience.eligible}</strong>Eligible records
            </span>
            <span>
              <strong>{preview.audience.excluded}</strong>Excluded records
            </span>
            <span>
              <strong>{preview.audience.duplicates_removed}</strong>Duplicates
              removed
            </span>
            <span>
              <strong>{preview.audience.count}</strong>Unique recipients
            </span>
          </div>
          <p>
            Audience: {preview.audience.audience.replaceAll("_", " ")}. Disabled
            accounts, revoked or expired invitations, non-CAEDM and suppressed
            addresses are excluded. The audience is checked again before
            queueing.
          </p>
          <div className="developer-actions">
            <button
              className="button button-secondary"
              disabled={busy || saving || queued}
              onClick={() =>
                transition(async () => {
                  const result = await testAnnouncement(id);
                  setNotice(result);
                  setTested(!!result.success);
                })
              }
            >
              {busy ? "Checking delivery…" : "Send Test to Me"}
            </button>
            <button
              className="button"
              disabled={!tested || busy || queued || preview.audience.count < 1}
              onClick={() => setConfirm(true)}
            >
              Review & send to {preview.audience.count} people
            </button>
          </div>
          {preview.audience.count === 0 && (
            <p role="status">
              No eligible recipients. Choose another audience before sending.
            </p>
          )}
          <Result {...notice} />
          {confirm && (
            <ConfirmDialog
              title="Send Announcement?"
              onClose={() => setConfirm(false)}
            >
              <p>
                You are about to send this announcement to{" "}
                <strong>{preview.audience.count} CAEDM recipients</strong>.
              </p>
              <p>
                Each person will receive an individually addressed email from
                notifications@caedm.ca. Please confirm that the content and
                recipient selection are correct.
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  transition(async () => {
                    const result = await queueAnnouncement(
                      id,
                      preview.audience.count,
                      true,
                    );
                    setNotice(result);
                    setConfirm(false);
                    if (result.success) {
                      setQueued(true);
                      router.refresh();
                    }
                  })
                }
              >
                Send to {preview.audience.count} People
              </button>
            </ConfirmDialog>
          )}
        </section>
      )}
      <section className="card">
        <div className="developer-section-heading">
          <h2>Announcement history</h2>
          <button
            className="button button-secondary"
            onClick={() => router.refresh()}
          >
            Refresh results
          </button>
        </div>
        <p>
          Queue records are durable. Provider acceptance and confirmed delivery
          are reported separately. Only failed, still-eligible messages can be
          retried.
        </p>
        <div className="developer-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Announcement</th>
                <th>Template / audience</th>
                <th>Created by / date</th>
                <th>Queued</th>
                <th>Accepted</th>
                <th>Delivered</th>
                <th>Failed / skipped</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/developer/announcements/${row.id}`}>
                      {row.subject}
                    </Link>
                    <small>
                      {row.state} · {row.total} recipients
                      {row.queued_at
                        ? ` · queued ${row.queued_at.slice(0, 10)}`
                        : ""}
                    </small>
                  </td>
                  <td>
                    {row.template} / {row.audience.replaceAll("_", " ")}
                  </td>
                  <td>
                    {row.created_by === actorId
                      ? "You"
                      : authors[row.created_by] || "Former Developer"}
                    <small>{row.created_at.slice(0, 10)}</small>
                  </td>
                  <td>{row.queued + row.sending}</td>
                  <td>{row.accepted}</td>
                  <td>{row.delivered}</td>
                  <td>
                    {row.failed} / {row.skipped}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!history.length && <p>No announcements have been prepared yet.</p>}
        <button
          className="button button-secondary"
          onClick={() => {
            setId(crypto.randomUUID());
            setQueued(false);
            changed();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          Start another announcement
        </button>
      </section>
    </>
  );
}
export function EmailOutbox({ rows }: { rows: EmailActivity[] }) {
  const router = useRouter();
  const [tab, setTab] = useState("all"),
    [status, setStatus] = useState("all"),
    [query, setQuery] = useState(""),
    [date, setDate] = useState("");
  const filtered = rows.filter(
    (row) =>
      (tab === "all" ||
        (tab === "announcements"
          ? row.type === "announcement"
          : row.type !== "announcement")) &&
      (status === "all" || row.status === status) &&
      (!date || row.created_at.slice(0, 10) === date) &&
      `${row.email} ${row.subject} ${row.type}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="card">
      <div className="developer-section-heading">
        <div>
          <h2>Email Outbox</h2>
          <p>
            The latest 200 records visible to your actual role. Developer
            designation does not expose restricted Finance activity.
          </p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => router.refresh()}
        >
          Refresh activity
        </button>
      </div>
      <div className="developer-tabs" aria-label="Email activity filters">
        {[
          ["all", "All Email"],
          ["notifications", "Notifications"],
          ["announcements", "Announcements"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="developer-form-grid">
        <label>
          Search recipient, subject or type
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {[
              "all",
              "draft",
              "pending",
              "queued",
              "sending",
              "accepted",
              "delivered",
              "failed",
              "skipped",
              "superseded",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Created date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      <p>
        Accepted means the provider accepted the email. Confirmed delivery is
        available for announcements when signed Resend webhooks are configured.
        Other existing “sent” records are shown as accepted.
      </p>
      <div className="developer-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Message</th>
              <th>Recipient</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Created</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={`${row.type}-${row.id}`}>
                <td>
                  {row.announcement_id ? (
                    <Link
                      href={`/developer/announcements/${row.announcement_id}`}
                    >
                      {row.subject}
                    </Link>
                  ) : (
                    row.subject
                  )}
                  <small>
                    {row.type.replaceAll("_", " ")}
                    {row.is_test ? " · TEST" : ""}
                  </small>
                </td>
                <td>{row.email}</td>
                <td>
                  <Status value={row.status} />
                </td>
                <td>{row.attempts}</td>
                <td>{row.created_at.slice(0, 16).replace("T", " ")}</td>
                <td>{row.safe_error || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p>No email activity matches these filters.</p>}
    </section>
  );
}
