import { adminRole, type Profile } from "@/lib/domain";

// UI/server checks mirror PostgreSQL policies; the database remains authoritative.
export function canManageAccount(
  actor: Profile,
  target: Pick<Profile, "id" | "role">,
  protectedDeveloperId: string | null,
) {
  if (actor.status !== "active" || !adminRole(actor.role)) return false;
  if (target.id === protectedDeveloperId)
    return actor.id === target.id && actor.role === "super_admin";
  return target.role !== "super_admin" || actor.role === "super_admin";
}
