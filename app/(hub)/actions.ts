"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/auth";
import {
  expenseSchema,
  financeRole,
  reviewSchema,
  subscriptionSchema,
} from "@/lib/domain";
import { runReminders } from "@/lib/jobs";
export type Result = { error?: string; success?: string; id?: string };
function failure(error: unknown): Result {
  return {
    error:
      error instanceof z.ZodError
        ? error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" · ")
        : "The change could not be saved. Check permissions and field values, then try again.",
  };
}
function refresh() {
  revalidatePath("/", "layout");
}
export async function saveSoftware(
  id: string | null,
  input: unknown,
): Promise<Result> {
  const { db, profile } = await requireAccess();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error);
  if (id && !z.string().uuid().safeParse(id).success)
    return { error: "Invalid software reference." };
  const data = parsed.data;
  if (!financeRole(profile.role)) {
    const { data: member } = await db
      .from("team_members")
      .select("can_manage")
      .eq("team_id", data.team_id)
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (!member?.can_manage)
      return {
        error: "Your team membership does not permit software changes.",
      };
  }
  const { data: settings } = await db
    .from("application_settings")
    .select("currencies")
    .single();
  if (!settings?.currencies.includes(data.currency))
    return { error: "Select a configured currency." };
  const query = id
    ? db.from("software_subscriptions").update(data).eq("id", id)
    : db.from("software_subscriptions").insert(data);
  const { data: saved, error } = await query.select("id").single();
  if (error) return failure(error);
  refresh();
  return { success: "Software saved.", id: saved.id };
}
export async function changeStatus(
  id: string,
  status: "archived" | "cancelled",
): Promise<Result> {
  const { db } = await requireAccess();
  if (
    !z.string().uuid().safeParse(id).success ||
    !["archived", "cancelled"].includes(status)
  )
    return { error: "Invalid request." };
  const { error, data } = await db
    .from("software_subscriptions")
    .update({ status, auto_renew: false })
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) return failure(error);
  refresh();
  return { success: `Record ${status}. History has been retained.` };
}
export async function saveExpense(input: unknown): Promise<Result> {
  const { db } = await requireAccess("finance");
  const result = expenseSchema.safeParse(input);
  if (!result.success) return failure(result.error);
  const { data: settings } = await db
    .from("application_settings")
    .select("currencies")
    .single();
  if (!settings?.currencies.includes(result.data.currency))
    return { error: "Select a configured currency." };
  const { error } = await db.from("expense_records").insert(result.data);
  if (error) return failure(error);
  refresh();
  return { success: "Confirmed expense recorded." };
}
export async function respondReview(input: unknown): Promise<Result> {
  const { db } = await requireAccess();
  const result = reviewSchema.safeParse(input);
  if (!result.success) return failure(result.error);
  const { id, response, comment } = result.data;
  const { error } = await db.rpc("respond_to_review", {
    review_id: id,
    answer: response,
    response_comment: comment,
  });
  if (error) return failure(error);
  refresh();
  return { success: "Your response has been shared with Finance." };
}
export async function requestReview(id: string): Promise<Result> {
  const { db } = await requireAccess("admin");
  if (!z.string().uuid().safeParse(id).success)
    return { error: "Invalid reference." };
  const { error } = await db.rpc("request_usage_review", { subscription: id });
  if (error) return failure(error);
  refresh();
  return {
    success: "Review requested. Run reminders to deliver the queued message.",
  };
}
export async function adminChange(
  kind: string,
  input: Record<string, string>,
): Promise<Result> {
  const { db } = await requireAccess("admin");
  try {
    if (kind === "profile") {
      const values = z
        .object({
          id: z.string().uuid(),
          role: z.enum(["admin", "finance", "staff"]),
          status: z.enum([
            "pending_approval",
            "active",
            "rejected",
            "suspended",
            "deactivated",
          ]),
        })
        .parse(input);
      const { error } = await db
        .from("profiles")
        .update({ role: values.role, status: values.status })
        .eq("id", values.id)
        .select("id")
        .single();
      if (error) throw error;
    } else if (kind === "team") {
      const values = z
        .object({ name: z.string().trim().min(1).max(100) })
        .parse(input);
      const { error } = await db.from("teams").insert(values);
      if (error) throw error;
    } else if (kind === "member") {
      const values = z
        .object({ team_id: z.string().uuid(), profile_id: z.string().uuid() })
        .parse(input);
      const { error } = await db
        .from("team_members")
        .upsert({ ...values, can_manage: input.can_manage === "true" });
      if (error) throw error;
    } else if (kind === "remove_member") {
      const values = z
        .object({ team_id: z.string().uuid(), profile_id: z.string().uuid() })
        .parse(input);
      const { error } = await db.rpc("remove_membership", {
        department: values.team_id,
        employee: values.profile_id,
      });
      if (error) throw error;
    } else if (kind === "settings") {
      const values = z
        .object({
          organization_name: z.string().trim().min(1).max(150),
          initial_reminder_days: z.coerce.number().int().min(1).max(365),
          follow_up_days: z.coerce.number().int().min(1).max(90),
          currencies: z.string().regex(/^[A-Z]{3}(,[A-Z]{3}){0,19}$/),
        })
        .parse(input);
      const { error } = await db
        .from("application_settings")
        .update({
          ...values,
          currencies: [...new Set(values.currencies.split(","))],
        })
        .eq("id", true);
      if (error) throw error;
    } else return { error: "Unknown action." };
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { success: "Changes saved." };
}
export async function addReference(
  kind: string,
  input: Record<string, string>,
): Promise<Result> {
  const { db } = await requireAccess("finance");
  try {
    if (kind === "vendor") {
      const value = z
        .object({ name: z.string().trim().min(1).max(150) })
        .parse(input);
      const { error } = await db.from("vendors").insert(value);
      if (error) throw error;
    } else if (kind === "payment") {
      const value = z
        .object({
          team_id: z.string().uuid(),
          nickname: z.string().trim().min(1).max(100),
          brand: z.string().max(40),
          last_four: z.string().regex(/^\d{4}$/),
          notes: z.string().max(2000),
        })
        .parse(input);
      const { error } = await db.from("payment_methods").insert(value);
      if (error) throw error;
    } else return { error: "Unknown reference." };
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { success: "Reference added." };
}
export async function triggerReminders(): Promise<Result> {
  await requireAccess("admin");
  try {
    const result = await runReminders();
    refresh();
    return {
      success: `Reminder run complete: ${result.sent} delivered, ${result.failed} failed.`,
    };
  } catch {
    return {
      error:
        "Reminder delivery is unavailable. Check the server key, migrations, APP_URL and email configuration.",
    };
  }
}
export async function correctExpense(
  id: string,
  input: unknown,
): Promise<Result> {
  const { db } = await requireAccess("finance");
  const schema = expenseSchema.omit({ subscription_id: true });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure(parsed.error);
  if (!z.string().uuid().safeParse(id).success)
    return { error: "Invalid expense reference." };
  const { data: settings } = await db
    .from("application_settings")
    .select("currencies")
    .single();
  if (!settings?.currencies.includes(parsed.data.currency))
    return { error: "Select a configured currency." };
  const { error } = await db
    .from("expense_records")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .single();
  if (error) return failure(error);
  refresh();
  return { success: "Expense corrected. Audit history retained." };
}
