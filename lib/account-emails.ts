import "server-only";
import { createClient } from "@supabase/supabase-js";
import { appUrl, publicConfig } from "@/lib/env";
import { emailProvider } from "@/lib/email";
import { brandedNotice } from "@/lib/email-template";
export type AccountNotice = {
  id: string;
  claim_token: string;
  kind:
    | "approval"
    | "access_changed"
    | "role_changed"
    | "recovery_started"
    | "recovery_completed";
  email: string;
  full_name: string;
  before_role: string;
  after_role: string;
  before_status: string;
  after_status: string;
  created_at: string;
};
const labels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Administrator",
  finance: "Finance",
  staff: "Staff",
  pending_approval: "Awaiting approval",
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
  rejected: "Not approved",
};
const label = (value: string) => labels[value] || value;
export function accountEmailMessage(n: AccountNotice, origin: string) {
  if (n.kind === "recovery_started" || n.kind === "recovery_completed")
    return {
      id: `account-${n.id}`,
      to: n.email,
      purpose: "security" as const,
      ...brandedNotice({
        title:
          n.kind === "recovery_started"
            ? "Account recovery was started"
            : "Your account password was reset",
        paragraphs: [
          `Hello ${n.full_name},`,
          n.kind === "recovery_started"
            ? "An authorized Developer or Super Admin started assisted recovery for your account. Workspace access is restricted until you choose a new password. The recovery link will be shared privately after identity verification."
            : "Your password was changed after assisted account recovery. Sign in again using your new password. Previous workspace sessions are restricted.",
          "If you did not request this change, contact IT immediately. No password or recovery link is included in this notice.",
        ],
        details: [["Recorded at", n.created_at]],
        action: {
          label: "Open Software Hub",
          url: `${new URL(origin).origin}/login`,
        },
      }),
    };
  const roleChanged = n.kind === "role_changed";
  return {
    id: `account-${n.id}`,
    to: n.email,
    purpose:
      roleChanged || ["suspended", "deactivated"].includes(n.after_status)
        ? ("security" as const)
        : ("approvals" as const),
    ...brandedNotice({
      title: roleChanged
        ? "Your Software Hub role was changed"
        : n.kind === "approval"
          ? "Your Software Hub account is approved"
          : "Your Software Hub access was updated",
      paragraphs: [
        `Hello ${n.full_name},`,
        roleChanged
          ? "An administrator changed your application role. This notice records the change; it does not grant any additional access beyond the permissions saved in Software Hub."
          : "An administrator updated your account access. Your assigned department and current role determine the information you can access.",
        "The details below describe the recorded change. Later changes may affect your current access.",
        "If this change was unexpected, contact IT or the developer for assistance.",
      ],
      details: [
        ["Previous role", label(n.before_role)],
        ["Role after this change", label(n.after_role)],
        ["Status after this change", label(n.after_status)],
        ["Recorded at", n.created_at],
      ],
      action: {
        label: "Open Software Hub",
        url: `${new URL(origin).origin}/login`,
      },
    }),
  };
}
// Service credentials are used only by protected scheduled delivery jobs.
export async function runAccountEmails() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Account email job credential is missing.");
  const db = createClient(publicConfig().url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
  const provider = emailProvider();
  const origin = appUrl();
  const { data, error } = await db.rpc("claim_account_emails");
  if (error || !Array.isArray(data))
    throw new Error("Could not read account email queue.");
  const result = { sent: 0, failed: 0 };
  for (const notice of data as AccountNotice[]) {
    let successful = false;
    let deliveredBy = provider.name;
    try {
      const receipt = await provider.send(accountEmailMessage(notice, origin));
      deliveredBy = receipt?.provider || provider.name;
      successful = true;
    } catch {
      /* Safe diagnostics are emitted by the email transport. */
    }
    const { data: saved, error: finishError } = await db.rpc(
      "finish_account_email",
      {
        notification: notice.id,
        token: notice.claim_token,
        successful,
        email_provider: deliveredBy,
      },
    );
    if (finishError || !saved)
      throw new Error("Account email delivery state could not be saved.");
    result[successful ? "sent" : "failed"]++;
  }
  return result;
}
