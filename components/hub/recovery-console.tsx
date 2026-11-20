"use client";
import { useActionState } from "react";
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
  return (
    <>
      <section className="card">
        <h2>Send a password reset email</h2>
        <p>
          Verify the employee’s identity before continuing. The Hub emails a
          one-time reset link directly to their verified work address. It
          expires in 15 minutes. The employee chooses their own password and
          signs in again.
        </p>
        <p>
          Sending a reset starts recovery and restricts workspace access until
          the password is changed. Sending a replacement invalidates the
          previous assisted link. Roles, email verification and approval remain
          unchanged.
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
            I have verified this employee’s identity and authorize a reset email
            to their verified work address.
          </label>
          {state.error && (
            <p className="error notice" role="alert">
              {state.error}
            </p>
          )}
          <button className="button" disabled={pending}>
            {pending ? "Sending reset email…" : "Send reset link"}
          </button>
        </form>
        {state.sent && (
          <div className="notice mt-6" role="status">
            <strong>Reset email accepted for {state.sent.email}</strong>
            <p>
              The email service accepted the reset email. Ask the employee to
              check their inbox and junk folder and use the newest message. The
              link expires 15 minutes after it was created. Provider acceptance
              does not confirm inbox delivery.
            </p>
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
