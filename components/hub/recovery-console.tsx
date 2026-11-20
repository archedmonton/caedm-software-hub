"use client";
import { useActionState, useState } from "react";
import {
  issueRecovery,
  type RecoveryState,
} from "@/app/account-recovery-actions";
import type { RecoveryDirectory } from "@/lib/account-recovery";
export function RecoveryConsole({
  directory,
}: {
  directory: RecoveryDirectory;
}) {
  const [state, action, pending] = useActionState<RecoveryState, FormData>(
    (_previous, form) => issueRecovery({}, form),
    {},
  );
  const [copied, setCopied] = useState(false);
  return (
    <>
      <section className="card">
        <h2>Prepare a one-time recovery link</h2>
        <p>
          Verify the employee’s identity before continuing. Share the link
          privately through an approved channel. It expires in 15 minutes and
          works once. The employee chooses their own password, then signs in
          again.
        </p>
        <p>
          Preparing a link immediately restricts workspace access until the
          password is changed. Replacing it invalidates the previous assisted
          link. Roles, email verification and approval remain unchanged.
        </p>
        <form action={action} className="space-y-5">
          <label>
            Employee
            <select
              aria-label="Employee"
              name="person"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Select an employee
              </option>
              {directory.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} · {p.email}
                  {p.pending ? " · Recovery pending" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Your current password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <label>
            Authenticator code
            {directory.require_mfa ? " (required)" : " (if enrolled)"}
            <input
              name="mfa"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required={directory.require_mfa}
            />
          </label>
          <label className="check-label">
            <input
              name="identity_confirmed"
              type="checkbox"
              value="yes"
              required
            />
            I have verified this employee’s identity and will share the link
            privately.
          </label>
          {state.error && (
            <p className="error notice" role="alert">
              {state.error}
            </p>
          )}
          <button className="button" disabled={pending}>
            {pending ? "Preparing secure link…" : "Prepare recovery link"}
          </button>
        </form>
        {state.link && (
          <div className="notice mt-6" role="status">
            <strong>Recovery link for {state.link.email}</strong>
            <p>
              Expires{" "}
              {new Date(state.link.expiresAt).toLocaleTimeString("en-CA", {
                timeZone: "America/Edmonton",
              })}{" "}
              (Edmonton). Displayed for this operation only. Do not put it in a
              support ticket or a shared channel.
            </p>
            <label>
              Private recovery link
              <input
                aria-label="Private recovery link"
                readOnly
                value={state.link.url}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            <button
              type="button"
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(state.link!.url);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy private link"}
            </button>
          </div>
        )}
        <p className="mt-6">
          Super Admins, Developers, protected accounts and accounts with MFA
          require IT-assisted recovery. You cannot recover your own account
          here. Use “Forgot password” or contact IT.
        </p>
      </section>
      <section className="card mt-6">
        <h2>Recovery history</h2>
        <p>
          Security audit records contain actions and identities, never recovery
          links or passwords.
        </p>
        <div className="developer-table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>When</th>
                <th>Employee</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {directory.history.map((r) => (
                <tr key={r.id}>
                  <td>
                    <time dateTime={r.created_at}>
                      {r.display_time || r.created_at}
                    </time>
                  </td>
                  <td>
                    {directory.people.find((p) => p.id === r.subject_id)
                      ?.email || "Protected or unavailable account"}
                  </td>
                  <td>
                    {r.action
                      .replaceAll("account_recovery_", "")
                      .replaceAll("_", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
