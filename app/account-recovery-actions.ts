"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prepareAssistedRecovery } from "@/lib/account-recovery";
export type RecoveryState = {
  error?: string;
  link?: { url: string; email: string; expiresAt: string };
};
export async function issueRecovery(
  _state: RecoveryState,
  form: FormData,
): Promise<RecoveryState> {
  if (form.get("identity_confirmed") !== "yes")
    return {
      error:
        "Verify the employee's identity using your organization's approved process first.",
    };
  const person = z.string().uuid().safeParse(form.get("person"));
  if (!person.success) return { error: "Choose an employee." };
  try {
    const link = await prepareAssistedRecovery(
      person.data,
      String(form.get("password") || ""),
      String(form.get("mfa") || ""),
    );
    revalidatePath("/account-recovery");
    return { link };
  } catch (error) {
    return {
      error:
        error instanceof Error &&
        /verification|MFA|authenticator|Account recovery|Recovery link|Select an eligible|Wait one minute|Recovery limit|Too many/.test(
          error.message,
        )
          ? error.message
          : "Account recovery could not be prepared. Contact IT.",
    };
  }
}
