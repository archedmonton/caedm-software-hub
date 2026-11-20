"use server";
import { z } from "zod";
import { password } from "@/lib/domain";
import { limitAuth } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createClient as adminClient } from "@supabase/supabase-js";
import { publicConfig } from "@/lib/env";
import { openRecoveryToken } from "@/lib/recovery-capability";
export type AssistedState = { error?: string; success?: boolean };
export async function completeRecovery(
  _state: AssistedState,
  form: FormData,
): Promise<AssistedState> {
  const emailToken = z
    .string()
    .regex(/^(?:pkce_)?[a-f0-9]{32,128}$/i)
    .safeParse(form.get("email_token"));
  if (emailToken.success) {
    const chosen = password.safeParse(form.get("password"));
    if (!chosen.success)
      return {
        error:
          "Use at least 12 characters with uppercase, lowercase letters and a number.",
      };
    if (chosen.data !== form.get("confirmation"))
      return { error: "Passwords do not match." };
    try {
      // Hash the capability before throttling; no bearer token enters durable rate-limit keys.
      const { createHash } = await import("node:crypto");
      await limitAuth(
        `email-recovery:${createHash("sha256").update(emailToken.data).digest("hex")}`,
      );
      const db = await createClient();
      const verified = await db.auth.verifyOtp({
        type: "recovery",
        token_hash: emailToken.data,
      });
      if (verified.error || !verified.data.user?.email_confirmed_at)
        return {
          error:
            "This reset link is invalid, expired or already used. Request a new reset email.",
        };
      try {
        const updated = await db.auth.updateUser({ password: chosen.data });
        if (updated.error)
          return {
            error:
              "Password could not be changed. Request a new reset email and try a different password.",
          };
        return { success: true };
      } finally {
        await db.auth.signOut({ scope: "local" });
      }
    } catch {
      return {
        error:
          "Password reset could not be completed. Request a new reset email or contact IT.",
      };
    }
  }
  const input = z
    .object({
      recovery: z.string().uuid(),
      code: z.string().regex(/^[a-f0-9]{64}$/),
      password,
      confirmation: z.string(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success)
    return {
      error:
        "Open a valid recovery link and use a password with at least 12 characters, upper and lowercase letters, and a number.",
    };
  if (input.data.password !== input.data.confirmation)
    return { error: "Passwords do not match." };
  try {
    await limitAuth(`assisted-recovery:${input.data.recovery}`);
    const db = await createClient();
    // The capability is checked before creating any authenticated session.
    const allowed = await db.rpc("validate_account_recovery", {
      recovery: input.data.recovery,
      token_hash: input.data.code,
    });
    if (allowed.error || !allowed.data)
      return {
        error:
          "This recovery link is invalid, expired or replaced. Ask your administrator for a new link.",
      };
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) return { error: "Recovery is unavailable. Contact IT." };
    // Narrow authentication-recovery RPC. The capability is checked again in SQL;
    // neither this ciphertext nor the underlying Auth token is returned to the browser.
    const admin = adminClient(publicConfig().url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
    });
    const claim = await admin.rpc("claim_account_recovery", {
      recovery: input.data.recovery,
      token_hash: input.data.code,
    });
    if (claim.error || !claim.data)
      return {
        error:
          "This recovery link is invalid, expired or replaced. Ask your administrator for a new link.",
      };
    const token = openRecoveryToken(claim.data.sealed_token);
    const verified = await db.auth.verifyOtp({
      type: "recovery",
      token_hash: token,
    });
    if (verified.error || verified.data.user?.id !== allowed.data) {
      if (!verified.error) await db.auth.signOut({ scope: "local" });
      return {
        error:
          "This recovery link is expired or already used. Ask your administrator for a new link.",
      };
    }
    const updated = await db.auth.updateUser({ password: input.data.password });
    // DB password-change trigger completes recovery; prior/recovery sessions remain
    // denied by RLS. Always require a new password sign-in, including after an error.
    await db.auth.signOut({ scope: "local" });
    if (updated.error)
      return {
        error:
          "Password could not be changed. Use a different password and request a new recovery link.",
      };
    return { success: true };
  } catch {
    return {
      error: "Recovery could not be completed. Try again or contact IT.",
    };
  }
}
