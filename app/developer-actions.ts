"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  requireDeveloper,
  withFreshDeveloperPassword,
} from "@/lib/developer-auth";
import { session } from "@/lib/auth";
import { developer } from "@/lib/developer";
export async function startPreview(form: FormData) {
  const { db } = await requireDeveloper();
  const role = z.enum(["admin", "finance", "staff"]).parse(form.get("role"));
  const { error } = await db.rpc("start_role_preview", { selected_role: role });
  if (error)
    return { error: "This preview is not permitted for your actual role." };
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
export async function endPreview() {
  const { db } = await session();
  const { error } = await db.rpc("end_role_preview");
  if (error)
    throw new Error("Preview could not be ended. Sign out and sign in again.");
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
export async function changeDeveloper(
  _previous: { error?: string; success?: string },
  form: FormData,
) {
  try {
    const person = z.string().uuid().parse(form.get("person"));
    const enabled = form.get("enabled") === "true";
    await withFreshDeveloperPassword(
      String(form.get("password") || ""),
      String(form.get("mfa_code") || ""),
      async (db) => {
        const result = await db.rpc("change_developer_access", {
          person,
          enabled,
        });
        if (result.error)
          throw new Error(
            "This access change is not permitted. Check eligibility, primary protection and current authorization.",
          );
      },
    );
    revalidatePath("/developer");
    return {
      success:
        "Developer access updated. A security notice is queued; delivery status is available in Email Outbox.",
    };
  } catch (error) {
    return {
      error:
        error instanceof z.ZodError
          ? "Select an eligible person."
          : error instanceof Error &&
              /verification|authenticator|code|required|permitted|Too many|valid|password/i.test(
                error.message,
              )
            ? error.message
            : "Developer access could not be changed.",
    };
  }
}
export async function confirmHandover(
  _previous: { error?: string; success?: string },
  form: FormData,
) {
  try {
    const successor = z.string().uuid().parse(form.get("person"));
    await withFreshDeveloperPassword(
      String(form.get("password") || ""),
      String(form.get("mfa_code") || ""),
      async (db, context) => {
        const candidate = context.directory.people.find(
          (p) =>
            p.id === successor &&
            p.developer_active &&
            p.email === developer.email,
        );
        if (!candidate || context.directory.approved_successor !== successor)
          throw new Error(
            "Approved configuration and successor verification are required.",
          );
        const result = await db.rpc("confirm_developer_handover", {
          successor,
        });
        if (result.error)
          throw new Error(
            "Primary handover is not permitted. Check operator approval and successor access verification.",
          );
      },
    );
    revalidatePath("/", "layout");
    return {
      success:
        "Primary handover recorded. Existing Developer access and organization roles were preserved.",
    };
  } catch {
    return {
      error:
        "Handover could not be confirmed. Recheck password/MFA, configuration, operator approval and successor eligibility.",
    };
  }
}
