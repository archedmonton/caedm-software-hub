"use server";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth";
import { adminRole, financeRole } from "@/lib/domain";
import {
  referenceKinds,
  referenceSchemas,
  employeeMembershipSchema,
  type ReferenceKind,
  type ReferenceResult,
  type EditorEmployee,
} from "@/lib/software-reference";

export async function createSoftwareReference(
  kind: ReferenceKind,
  input: unknown,
): Promise<ReferenceResult> {
  const { db, profile } = await requireAccess();
  if (!referenceKinds.includes(kind))
    return { error: "Choose a supported reference type." };
  if (
    kind === "department"
      ? !adminRole(profile.role)
      : !financeRole(profile.role)
  )
    return {
      error:
        kind === "department"
          ? "Only administrators can create departments."
          : "Finance or administrator access is required to create this reference.",
    };
  const parsed = referenceSchemas[kind].safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (kind === "payment") {
    const values = referenceSchemas.payment.parse(input);
    const saved = await db
      .from("payment_methods")
      .insert(values)
      .select("id,team_id,nickname,last_four")
      .single();
    if (saved.error?.code === "23505") {
      return {
        error:
          "This department already has a payment reference with that nickname. Select it from the list or use a different nickname.",
      };
    }
    if (saved.error)
      return {
        error:
          "The payment reference could not be saved. Check the department, permissions and last four digits.",
      };
    revalidatePath("/settings");
    return { payment: saved.data };
  }
  const values = referenceSchemas[kind].parse(input) as { name: string };
  const table =
    kind === "vendor"
      ? "vendors"
      : kind === "category"
        ? "software_categories"
        : "teams";
  const saved = await db.from(table).insert(values).select("id,name").single();
  if (saved.error?.code === "23505") {
    // Escape SQL LIKE wildcards so a literal name cannot match an unrelated reference.
    const pattern = values.name.replace(/[\\%_]/g, "\\$&");
    const existing = await db
      .from(table)
      .select("id,name")
      .ilike("name", pattern)
      .limit(1)
      .maybeSingle();
    if (existing.data) return { reference: existing.data, reused: true };
  }
  if (saved.error)
    return {
      error: `The ${kind} could not be saved. Check the name, permissions and database setup.`,
    };
  revalidatePath("/team");
  return { reference: saved.data };
}

export async function assignSoftwareEmployee(input: unknown): Promise<{
  error?: string;
  employee?: EditorEmployee;
  can_manage?: boolean;
}> {
  const { db, profile } = await requireAccess();
  if (!adminRole(profile.role))
    return {
      error: "Only administrators can assign employee department access.",
    };
  const parsed = employeeMembershipSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { data, error } = await db
    .rpc("assign_software_employee", {
      department: parsed.data.team_id,
      employee: parsed.data.profile_id,
    })
    .single();
  if (error || !data)
    return {
      error:
        "The employee could not be assigned. Select an eligible active employee and check protected-account permissions.",
    };
  const row = data as EditorEmployee & { can_manage: boolean };
  revalidatePath("/team");
  return {
    employee: { id: row.id, full_name: row.full_name, email: row.email },
    can_manage: row.can_manage,
  };
}
