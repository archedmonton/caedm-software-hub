import "server-only";
import { redirect } from "next/navigation";
import { createClient as authAdmin } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { sealRecoveryToken } from "@/lib/recovery-capability";
import { requireAccess } from "@/lib/auth";
import { publicConfig, appUrl } from "@/lib/env";
import { withFreshVerifiedPassword } from "@/lib/developer-auth";
import { emailProvider } from "@/lib/email";
import { brandedNotice } from "@/lib/email-template";
export type RecoveryDirectory = {
  require_mfa: boolean;
  people: {
    id: string;
    full_name: string;
    email: string;
    role: string;
    pending: boolean;
    expires_at: string | null;
  }[];
  history: {
    id: string;
    actor_id: string | null;
    subject_id: string;
    action: string;
    created_at: string;
    display_time?: string;
  }[];
};
export async function requireRecoveryOperator() {
  const context = await requireAccess();
  if (
    context.access.preview_role ||
    (!context.access.tools_allowed &&
      context.actualProfile.role !== "super_admin")
  )
    redirect("/dashboard?notice=Account+recovery+access+required");
  const result = await context.db.rpc("account_recovery_console");
  if (result.error || !result.data)
    throw new Error(
      "Account recovery is unavailable. Confirm the recovery migration is installed.",
    );
  const directory = result.data as RecoveryDirectory;
  // Serialize the display text once. Browser and server time-zone databases can
  // disagree, which must never cause hydration to discard a security form.
  directory.history = directory.history.map((row) => ({
    ...row,
    display_time:
      new Date(row.created_at).toLocaleString("en-CA", {
        timeZone: "America/Edmonton",
      }) + " (Edmonton)",
  }));
  return { ...context, directory };
}
export async function sendAssistedRecovery(
  person: string,
  password: string,
  code: string,
) {
  const context = await requireRecoveryOperator();
  let output: { expiresAt: string; email: string } | undefined;
  await withFreshVerifiedPassword(
    context,
    password,
    code,
    async () => {
      const result = await context.db.rpc("account_recovery_console");
      if (result.error)
        throw new Error("Account recovery authorization is no longer valid.");
    },
    async (verified) => {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) throw new Error("Account recovery is not configured.");
      const prepared = await verified.rpc("begin_account_recovery", { person });
      if (prepared.error)
        throw new Error(
          /Select an eligible|Wait one minute|Recovery limit/.test(
            prepared.error.message,
          )
            ? prepared.error.message
            : "Account recovery is not permitted.",
        );
      const record = prepared.data as {
        id: string;
        profile_id: string;
        email: string;
        expires_at: string;
      };
      // Narrow Auth-only administrator operation, explicitly authorized by the signed-in
      // operator's fresh-auth RPC. Never use this client for business queries.
      const admin = authAdmin(publicConfig().url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
        },
      });
      const link = await admin.auth.admin.generateLink({
        type: "recovery",
        email: record.email,
      });
      const hash = link.data?.properties?.hashed_token;
      if (
        link.error ||
        link.data.user?.id !== record.profile_id ||
        !hash ||
        !/^[a-f0-9]{32,128}$/.test(hash)
      )
        throw new Error(
          "Recovery link preparation failed. The account remains restricted until its password is reset. Retry after one minute or contact IT.",
        );
      const code = randomBytes(32).toString("hex");
      const bound = await verified.rpc("bind_account_recovery", {
        recovery: record.id,
        token_digest: createHash("md5").update(code).digest("hex"),
        sealed_token: sealRecoveryToken(hash),
      });
      if (bound.error)
        throw new Error(
          "Recovery link preparation expired. Retry after one minute.",
        );
      const url = new URL("/reset-password", appUrl());
      // Fragments are never sent in HTTP requests, access logs or Referer headers.
      url.hash = new URLSearchParams({
        recovery: record.id,
        code,
      }).toString();
      let accepted = false;
      let acceptingProvider: string | null = null;
      try {
        const provider = emailProvider({ timeoutMs: 8000 });
        const receipt = await provider.send({
          id: `assisted-recovery-${record.id}`,
          to: record.email,
          purpose: "authentication",
          ...brandedNotice({
            title: "Reset your Software Hub password",
            paragraphs: [
              `Hello ${context.directory.people.find((p) => p.id === person)?.full_name || "there"},`,
              "Your authorized Software Hub support administrator requested a password reset after verifying your identity.",
              "Choose your own private password using the button below, then sign in again. This link works once and expires in 15 minutes. Only the latest reset link can be used.",
              "If you did not request help, contact IT. Never share your password or forward this email.",
            ],
            action: { label: "Choose a new password", url: url.href },
          }),
        });
        acceptingProvider = receipt?.provider || provider.name;
        accepted = true;
      } catch {
        // No reset URL, token, recipient or provider response enters logs or audit.
      }
      const recorded = await verified.rpc("record_account_recovery_email", {
        recovery: record.id,
        accepted,
        email_provider: accepted ? acceptingProvider : null,
      });
      if (accepted && recorded.error)
        throw new Error(
          "Reset email was accepted, but its audit status could not be saved. Check email activity before sending again.",
        );
      if (!accepted)
        throw new Error(
          "Reset email could not be confirmed. The account remains restricted until the password is changed. Check email settings, then send a new reset email after one minute.",
        );
      output = { expiresAt: record.expires_at, email: record.email };
    },
  );
  if (!output) throw new Error("Reset email could not be prepared.");
  return output;
}
