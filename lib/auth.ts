import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { configured } from "@/lib/env";
import { adminRole, financeRole, type Profile } from "@/lib/domain";
export async function session() {
  if (!configured()) redirect("/setup");
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error) redirect("/setup?reason=database");
  const { data: access, error: accessError } =
    await db.rpc("get_access_context");
  if (accessError || !access) redirect("/setup?reason=developer-migration");
  if (access.recovery_required) redirect("/auth/recovery-required");
  const actualProfile = profile as Profile;
  return {
    db,
    user,
    actualProfile,
    access: access as AccessContext,
    profile: {
      ...actualProfile,
      role: access.effective_role || actualProfile.role,
    } as Profile,
  };
}
export type AccessContext = {
  actual_role: Profile["role"] | null;
  effective_role: Profile["role"] | null;
  developer: boolean;
  tools_allowed: boolean;
  preview_role: Profile["role"] | null;
  preview_id: string | null;
  preview_expires_at: string | null;
  recovery_required?: boolean;
};
export async function requireAccess(
  level: "active" | "finance" | "admin" = "active",
) {
  const context = await session();
  if (context.access.recovery_required) redirect("/auth/recovery-required");
  if (
    !context.user.email_confirmed_at ||
    context.profile.status !== "active" ||
    context.user.email?.toLowerCase() !== context.profile.email.toLowerCase() ||
    context.user.email.toLowerCase().split("@")[1] !== "caedm.ca"
  )
    redirect("/pending-approval");
  if (!context.access.effective_role) redirect("/preview-exit");
  if (
    (level === "admin" && !adminRole(context.profile.role)) ||
    (level === "finance" && !financeRole(context.profile.role))
  )
    redirect("/dashboard?notice=Access+restricted");
  return context;
}
