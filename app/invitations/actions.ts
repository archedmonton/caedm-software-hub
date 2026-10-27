"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth";
import { password } from "@/lib/domain";
import { invitationInput, invitationToken } from "@/lib/invitation-content";
import {
  deliverInvitation,
  invitationAdmin,
  invitationDigest,
} from "@/lib/invitations";
import { limitAuth } from "@/lib/rate-limit";

export type InvitationState = { error?: string; success?: string };
export async function inviteEmployee(
  _state: InvitationState,
  form: FormData,
): Promise<InvitationState> {
  const { db } = await requireAccess("admin");
  const input = invitationInput.safeParse({
    ...Object.fromEntries(form),
    can_manage: form.get("can_manage") === "true",
  });
  if (!input.success) return { error: input.error.issues[0].message };
  try {
    await deliverInvitation(db, {
      person_name: input.data.full_name,
      work_email: input.data.email,
      department: input.data.team_id,
      granted_role: input.data.role,
      manage: input.data.can_manage,
    });
    revalidatePath("/team");
    return {
      success:
        "Invitation sent. The employee will create their own password before gaining access.",
    };
  } catch (error) {
    revalidatePath("/team");
    return {
      error:
        error instanceof Error
          ? error.message
          : "Invitation delivery is unavailable.",
    };
  }
}
export async function manageInvitation(
  id: string,
  action: "resend" | "revoke",
): Promise<InvitationState> {
  const { db } = await requireAccess("admin");
  if (
    !z.string().uuid().safeParse(id).success ||
    !["resend", "revoke"].includes(action)
  )
    return { error: "Invalid invitation request." };
  try {
    if (action === "resend")
      await deliverInvitation(db, { existing_invitation: id });
    else {
      const { error } = await db.rpc("revoke_employee_invitation", {
        invitation: id,
      });
      if (error)
        throw new Error(
          "The invitation could not be revoked. Refresh and check its status.",
        );
    }
    revalidatePath("/team");
    return {
      success:
        action === "resend"
          ? "A new invitation was sent. Previous links are invalid."
          : "Invitation revoked. Its link can no longer activate an account.",
    };
  } catch (error) {
    revalidatePath("/team");
    return {
      error:
        error instanceof Error
          ? error.message
          : "The invitation could not be updated.",
    };
  }
}
export async function acceptInvitation(
  _state: InvitationState,
  form: FormData,
): Promise<InvitationState> {
  const input = z
    .object({
      token: invitationToken,
      password,
      confirmation: z.string(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { error: input.error.issues[0].message };
  if (input.data.password !== input.data.confirmation)
    return { error: "Passwords do not match." };
  let invitation:
    | {
        id: string;
        claim: string;
        email: string;
        full_name: string;
        user_id: string | null;
        new_user_id: string;
      }
    | undefined;
  let admin: ReturnType<typeof invitationAdmin> | undefined;
  try {
    // Hashes, passwords, and tokens never enter logs or client-visible error messages.
    await limitAuth("invitation:" + invitationDigest(input.data.token));
    admin = invitationAdmin();
    const { data, error } = await admin.rpc("claim_employee_invitation", {
      token_digest: invitationDigest(input.data.token),
    });
    if (error)
      return {
        error:
          "This invitation is invalid, expired, revoked, or already being completed. Ask your administrator for a new invitation if needed.",
      };
    invitation = data;
    if (!invitation) throw new Error("Missing invitation.");
    const attributes = {
      password: input.data.password,
      email_confirm: true,
      user_metadata: { full_name: invitation.full_name },
      app_metadata: { caedm_invitation_id: invitation.id },
    };
    const result = invitation.user_id
      ? await admin.auth.admin.updateUserById(invitation.user_id, attributes)
      : await admin.auth.admin.createUser({
          id: invitation.new_user_id,
          email: invitation.email,
          ...attributes,
        });
    if (result.error || !result.data.user)
      throw new Error("Password setup failed.");
    const { error: completionError } = await admin.rpc(
      "complete_employee_invitation",
      {
        invitation: invitation.id,
        claim: invitation.claim,
        employee: result.data.user.id,
      },
    );
    if (completionError) throw new Error("Invitation completion failed.");
    revalidatePath("/team");
    return {
      success:
        "Your account is ready. Sign in with your work email and the password you just created.",
    };
  } catch {
    return {
      error:
        "Account setup could not be completed. Try again, or ask your administrator to resend the invitation.",
    };
  } finally {
    if (admin && invitation) {
      try {
        await admin.rpc("release_employee_invitation", {
          invitation: invitation.id,
          claim: invitation.claim,
        });
      } catch {
        /* Safe to retry after the claim lease expires. */
      }
    }
  }
}
