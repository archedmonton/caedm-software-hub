import "server-only";
import { redirect } from "next/navigation";
import {
  createClient as isolatedClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { requireAccess } from "@/lib/auth";
import { publicConfig } from "@/lib/env";
import { limitAuth } from "@/lib/rate-limit";
export async function requireDeveloper() {
  const context = await requireAccess();
  if (!context.access.tools_allowed)
    redirect("/dashboard?notice=Developer+access+required");
  const check = await context.db.rpc("developer_directory");
  if (check.error)
    redirect("/dashboard?notice=Developer+authorization+unavailable");
  return { ...context, directory: check.data as DeveloperDirectory };
}
export type DeveloperPerson = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  developer_active: boolean;
  granted_at: string | null;
  granted_by: string | null;
  last_seen_at: string | null;
};
export type DeveloperDirectory = {
  primary_id: string | null;
  require_mfa: boolean;
  approved_successor: string | null;
  people: DeveloperPerson[];
  audit: {
    id: string;
    actor_id: string;
    subject_id: string;
    action: string;
    created_at: string;
  }[];
};
export async function withFreshDeveloperPassword(
  password: string,
  code: string,
  operation: (
    db: SupabaseClient,
    context: Awaited<ReturnType<typeof requireDeveloper>>,
  ) => Promise<void>,
) {
  const context = await requireDeveloper();
  await withFreshVerifiedPassword(
    context,
    password,
    code,
    async () => {
      const recheck = await context.db.rpc("developer_directory");
      if (recheck.error)
        throw new Error("Developer authorization is no longer valid.");
    },
    (verifier) => operation(verifier, context),
  );
}
export async function withFreshVerifiedPassword(
  context: {
    user: { id: string; email?: string };
    directory: { require_mfa: boolean };
  },
  password: string,
  code: string,
  recheck: () => Promise<void>,
  operation: (verifier: SupabaseClient) => Promise<void>,
) {
  await limitAuth(`developer-step-up:${context.user.id}`);
  if (!password || password.length > 128)
    throw new Error("Enter your current password.");
  const config = publicConfig();
  // No SSR cookie adapter: this isolated session cannot replace the actor's browser session.
  const verifier = isolatedClient(config.url, config.key, {
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
  try {
    const signed = await verifier.auth.signInWithPassword({
      email: context.user.email!,
      password,
    });
    if (signed.error || signed.data.user?.id !== context.user.id)
      throw new Error(
        "Password verification failed. Check your details and try again.",
      );
    const factors =
      signed.data.user.factors?.filter(
        (factor) => factor.status === "verified",
      ) || [];
    const requiresMfa = factors.length > 0 || context.directory.require_mfa;
    if (requiresMfa) {
      const factor = factors.find((factor) => factor.factor_type === "totp");
      if (!factor || !/^\d{6}$/.test(code))
        throw new Error(
          "A verified authenticator and current MFA code are required.",
        );
      const challenge = await verifier.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (challenge.error || !challenge.data)
        throw new Error("MFA verification could not be started.");
      const verified = await verifier.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.data.id,
        code,
      });
      if (verified.error) throw new Error("MFA verification failed.");
    }
    // Recheck the ORIGINAL session, including revocation and preview state, after step-up.
    await recheck();
    await operation(verifier);
  } finally {
    await verifier.auth.signOut({ scope: "local" });
  }
}
