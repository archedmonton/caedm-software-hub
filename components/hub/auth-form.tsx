"use client";
import Link from "next/link";
import { useActionState } from "react";
import { ShieldCheck, ArrowRight, Church } from "lucide-react";
import { authenticate, type AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
const copy = {
  login: ["Welcome back", "Sign in to your CAEDM workspace.", "Sign in"],
  register: [
    "Create your account",
    "Your work email. One connected workspace.",
    "Create account",
  ],
  forgot: [
    "Reset your password",
    "We will send a secure link to your work email.",
    "Send reset link",
  ],
  update: [
    "Choose a new password",
    "Use at least 12 characters, upper and lowercase letters, and a number.",
    "Update password",
  ],
};
export function AuthForm({
  mode,
  ready = true,
  notice,
}: {
  mode: keyof typeof copy;
  ready?: boolean;
  notice?: string;
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    authenticate.bind(null, mode),
    {},
  );
  const [title, description, submit] = copy[mode];
  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <Link href="/login" className="brand">
          <Church size={30} />
          <span>
            CAEDM<span className="brand-caption">SOFTWARE HUB</span>
          </span>
        </Link>
        <div>
          <span className="eyebrow text-blue-300">
            GOOD STEWARDSHIP. CLEARER DECISIONS.
          </span>
          <h1>
            A thoughtful home
            <br />
            for every subscription.
          </h1>
          <p>
            Bring software, renewals, and spending into focus. Built for the
            people serving our archdiocese.
          </p>
        </div>
        <small>Catholic Archdiocese of Edmonton</small>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <span className="icon-tile">
            <ShieldCheck size={24} />
          </span>
          <h1>{title}</h1>
          <p className="text-muted-foreground mb-8">{description}</p>
          {notice && (
            <p className="notice error" role="alert">
              {notice}
            </p>
          )}
          {!ready ? (
            <div className="notice">
              Supabase is not configured.{" "}
              <Link href="/setup">View setup instructions</Link>.
            </div>
          ) : (
            <form action={action} className="space-y-5">
              {mode === "register" && (
                <label>
                  Full name
                  <input
                    name="full_name"
                    autoComplete="name"
                    maxLength={150}
                    required
                  />
                </label>
              )}
              {mode !== "update" && (
                <label>
                  Work email
                  <input
                    name="email"
                    type="email"
                    placeholder="you@caedm.ca"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                </label>
              )}
              {mode !== "forgot" && (
                <label>
                  {mode === "update" ? "New password" : "Password"}
                  <input
                    name="password"
                    type="password"
                    minLength={mode === "login" ? 1 : 12}
                    maxLength={128}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    required
                  />
                </label>
              )}
              {(mode === "register" || mode === "update") && (
                <>
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
                  {mode === "register" && (
                    <p className="text-xs text-muted-foreground">
                      At least 12 characters with uppercase, lowercase, and a
                      number. Email verification and administrator approval are
                      required.
                    </p>
                  )}
                </>
              )}
              {state.error && (
                <p className="notice error" role="alert">
                  {state.error}
                </p>
              )}
              {state.message && (
                <p className="notice" role="status">
                  {state.message}
                </p>
              )}
              <Button className="w-full" disabled={pending}>
                {pending ? "Please wait…" : submit}
                <ArrowRight size={16} />
              </Button>
            </form>
          )}
          <div className="auth-links">
            {mode === "login" ? (
              <>
                <Link href="/forgot-password">Forgot password?</Link>
                <span>
                  New here? <Link href="/register">Request access</Link>
                </span>
              </>
            ) : (
              <Link href="/login">Back to sign in</Link>
            )}
            {mode === "update" && (
              <Link href="/dashboard">Go to dashboard</Link>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-10">
            A private workspace for authorized @caedm.ca employees.
          </p>
        </div>
      </section>
    </main>
  );
}
