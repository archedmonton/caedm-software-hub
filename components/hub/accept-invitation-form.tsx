"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Church, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acceptInvitation,
  type InvitationState,
} from "@/app/invitations/actions";

export function AcceptInvitationForm() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const capture = () => {
      const supplied = new URLSearchParams(window.location.hash.slice(1)).get(
        "token",
      );
      if (supplied && /^[a-f0-9]{64}$/.test(supplied)) {
        setToken(supplied);
        window.history.replaceState(null, "", window.location.pathname);
      }
    };
    const timer = window.setTimeout(capture, 0);
    window.addEventListener("hashchange", capture);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", capture);
    };
  }, []);
  return <InvitationPanel key={token || "missing"} token={token} />;
}
function InvitationPanel({ token }: { token: string | null }) {
  const [state, action, pending] = useActionState<InvitationState, FormData>(
    acceptInvitation,
    {},
  );
  return (
    <main className="standalone">
      <section className="panel w-full max-w-lg p-8">
        <Link
          className="mb-8 flex items-center gap-3 text-[23px] leading-none font-semibold tracking-wide text-foreground"
          href="/login"
        >
          <Church size={28} className="text-primary shrink-0" />
          <span>
            CAEDM
            <span className="mt-2 block text-[8px] font-medium tracking-[2.5px] text-muted-foreground">
              SOFTWARE HUB
            </span>
          </span>
        </Link>
        <ShieldCheck className="text-primary mb-5" size={32} />
        <span className="eyebrow">YOUR INVITATION</span>
        <h1>Set up your account</h1>
        <p className="text-muted-foreground my-5">
          Create your own password to accept your invitation. Your administrator
          has already selected your role and department.
        </p>
        {state.success ? (
          <>
            <p className="notice mb-5" role="status">
              {state.success}
            </p>
            <Button asChild>
              <Link href="/login">Sign in to your workspace</Link>
            </Button>
          </>
        ) : token ? (
          <form action={action} className="space-y-5">
            <input type="hidden" name="token" value={token} />
            <label>
              New password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <label>
              Confirm password
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <p className="field-hint">
              Use at least 12 characters with uppercase and lowercase letters
              and a number.
            </p>
            {state.error && (
              <p className="notice error" role="alert">
                {state.error}
              </p>
            )}
            <Button disabled={pending}>
              {pending
                ? "Setting up your account..."
                : "Accept invitation and set password"}
            </Button>
          </form>
        ) : (
          <p className="notice" role="status">
            Open the complete link from your latest invitation email. If it has
            expired or was revoked, ask your administrator for a new invitation.
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-8">
          A private workspace for authorized @caedm.ca employees.
        </p>
      </section>
    </main>
  );
}
