import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/data";
import type { Profile } from "@/lib/domain";
import { appUrl, publicConfig } from "@/lib/env";
import { emailProvider } from "@/lib/email";
import {
  invitationMessage,
  type InvitationSummary,
} from "@/lib/invitation-content";

export function invitationAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new Error(
      "Invitation delivery is not configured. Contact your administrator.",
    );
  return createClient(publicConfig().url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
}
export function newInvitationSecret() {
  const token = randomBytes(32).toString("hex");
  return { token, digest: invitationDigest(token) };
}
export function invitationDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function deliverInvitation(
  db: SupabaseClient,
  input: Record<string, unknown>,
) {
  const provider = emailProvider();
  const origin = appUrl();
  const admin = invitationAdmin();
  const { token, digest } = newInvitationSecret();
  const { data, error } = await db.rpc("prepare_employee_invitation", {
    ...input,
    token_digest: digest,
  });
  if (error) {
    const allowed =
      /already|Wait one minute|Invitation limit|Select an existing|setup is in progress/i;
    throw new Error(
      allowed.test(error.message)
        ? error.message
        : "The invitation could not be prepared. Check the details and permissions.",
    );
  }
  const invite = data as InvitationSummary;
  let successful = false;
  try {
    await provider.send({
      id: randomBytes(16).toString("hex"),
      to: invite.email,
      ...invitationMessage(invite, origin, token),
    });
    successful = true;
  } catch {
    // Never expose SMTP responses, credentials, or invitation tokens.
  }
  const { error: finishError } = await admin.rpc("finish_invitation_delivery", {
    invitation: invite.id,
    token_digest: digest,
    successful,
  });
  if (!successful)
    throw new Error(
      "Email delivery failed. Check SMTP settings, then use Resend invitation.",
    );
  if (finishError)
    throw new Error(
      "The email was sent, but its status could not be saved. Refresh the invitation list before retrying.",
    );
}

export type TeamInvitation = {
  id: string;
  full_name: string;
  email: string;
  team_id: string;
  role: Profile["role"];
  status: string;
  delivery_status: string;
  delivery_error: string | null;
  expires_at: string;
  created_at: string;
  expired: boolean;
};
export async function employeeInvitations(db: SupabaseClient) {
  const rows = await allRows<TeamInvitation>(
    db,
    "employee_invitations",
    "id,full_name,email,team_id,role,status,delivery_status,delivery_error,expires_at,created_at",
  );
  const now = Date.now();
  return rows.map((i) => ({
    ...i,
    expired: i.status === "pending" && new Date(i.expires_at).getTime() <= now,
  }));
}
