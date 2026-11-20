"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/hub/brand";
import { HelpCenter } from "@/components/hub/help-center";
import {
  completeRecovery,
  type AssistedState,
} from "@/app/auth/assisted-recovery/actions";
export function AssistedRecoveryForm() {
  const [capability, setCapability] = useState<{
    recovery: string;
    token: string;
  } | null>(null);
  const [emailToken, setEmailToken] = useState("");
  const [state, action, pending] = useActionState<AssistedState, FormData>(
    completeRecovery,
    {},
  );
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const recovery = fragment.get("recovery") || "";
      const token = fragment.get("code") || "";
      const emailHash = fragment.get("token_hash") || "";
      if (/^(?:pkce_)?[a-f0-9]{32,128}$/i.test(emailHash)) {
        setEmailToken(emailHash);
        window.history.replaceState(null, "", window.location.pathname);
      }
      if (
        /^[a-f0-9-]{36}$/.test(recovery) &&
        /^[a-f0-9]{32,128}$/.test(token)
      ) {
        setCapability({ recovery, token });
        window.history.replaceState(null, "", window.location.pathname);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return (
    <main className="developer-page assisted-recovery-page">
      <div className="flex justify-end mb-4">
        <HelpCenter />
      </div>
      <Brand />
      <section className="card mt-8">
        <h1>Choose your new password</h1>
        <p>
          Choose a private password using the latest reset email, then sign in
          again. Opening this page does not use your link; it is verified when
          you submit your new password.
        </p>
        {state.success ? (
          <div role="status">
            <h2>Password changed</h2>
            <p>
              Your password has been updated. Sign in with your new password to
              continue.
            </p>
            <Link className="button" href="/login">
              Sign in with your new password
            </Link>
          </div>
        ) : (
          <form action={action} className="space-y-5">
            <input
              type="hidden"
              name="recovery"
              value={capability?.recovery || ""}
            />
            <input type="hidden" name="code" value={capability?.token || ""} />
            <input type="hidden" name="email_token" value={emailToken} />
            <p>
              Use at least 12 characters, upper and lowercase letters, and a
              number.
            </p>
            <label>
              New password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <label>
              Confirm new password
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            {state.error && (
              <p className="notice error" role="alert">
                {state.error}
              </p>
            )}
            {!capability && !emailToken && (
              <p role="status">
                Open the complete link in your latest reset email. If you
                refreshed this page, reopen that email. You can also request a
                new link using Forgot password.
              </p>
            )}
            <button
              className="button"
              disabled={(!capability && !emailToken) || pending}
            >
              {pending ? "Changing password…" : "Change password"}
            </button>
          </form>
        )}
        {!state.success && (
          <Link href="/forgot-password">Request a new reset email</Link>
        )}
      </section>
    </main>
  );
}
