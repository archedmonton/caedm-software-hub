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
  return { db, user, profile: profile as Profile };
}
export async function requireAccess(
  level: "active" | "finance" | "admin" = "active",
) {
  const context = await session();
  if (
    !context.user.email_confirmed_at ||
    context.profile.status !== "active" ||
    context.user.email?.toLowerCase() !== context.profile.email.toLowerCase() ||
    context.user.email.toLowerCase().split("@")[1] !== "caedm.ca"
  )
    redirect("/pending-approval");
  if (
    (level === "admin" && !adminRole(context.profile.role)) ||
    (level === "finance" && !financeRole(context.profile.role))
  )
    redirect("/dashboard?notice=Access+restricted");
  return context;
}
