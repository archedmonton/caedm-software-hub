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
  const [state, action, pending] = useActionState<AssistedState, FormData>(
    completeRecovery,
    {},
  );
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const recovery = fragment.get("recovery") || "";
      const token = fragment.get("code") || "";
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
          Your administrator prepared this one-time recovery link after
          verifying your identity. Choose a private password, then sign in
          again.
        </p>
        {state.success ? (
          <div role="status">
            <h2>Password changed</h2>
            <p>
              Your previous workspace sessions can no longer access the
              application.
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
            {!capability && (
              <p role="status">
                Open the complete private link from your administrator. If you
                refreshed this page, open the link again.
              </p>
            )}
            <button className="button" disabled={!capability || pending}>
              {pending ? "Changing password…" : "Change password"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
