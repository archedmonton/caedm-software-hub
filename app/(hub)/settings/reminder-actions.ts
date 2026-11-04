"use server";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth";
import { billingReminderSchema } from "@/lib/billing-reminders";
export async function saveBillingReminderPreferences(
  input: unknown,
): Promise<{ error?: string; success?: string }> {
  const { db, profile } = await requireAccess();
  const parsed = billingReminderSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await db
    .from("billing_reminder_preferences")
    .upsert(
      { profile_id: profile.id, ...parsed.data },
      { onConflict: "profile_id" },
    );
  if (error)
    return {
      error:
        "Your billing preferences could not be saved. Check your connection or ask an administrator to verify setup.",
    };
  revalidatePath("/settings");
  return {
    success:
      "Your billing reminder preferences are saved. Usage review requests are unchanged.",
  };
}
