import "server-only";
import { redirect } from "next/navigation";
import { createClient as authAdmin } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { sealRecoveryToken } from "@/lib/recovery-capability";
import { requireAccess } from "@/lib/auth";
import { publicConfig, appUrl } from "@/lib/env";
import { withFreshVerifiedPassword } from "@/lib/developer-auth";
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
export async function prepareAssistedRecovery(
  person: string,
  password: string,
  code: string,
) {
  const context = await requireRecoveryOperator();
  let output: { url: string; expiresAt: string; email: string } | undefined;
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
      const url = new URL("/auth/assisted-recovery", appUrl());
      // Fragments are never sent in HTTP requests, access logs or Referer headers.
      url.hash = new URLSearchParams({
        recovery: record.id,
        code,
      }).toString();
      output = {
        url: url.toString(),
        expiresAt: record.expires_at,
        email: record.email,
      };
    },
  );
  if (!output) throw new Error("Recovery link could not be prepared.");
  return output;
}
