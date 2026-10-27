import { z } from "zod";
import { workEmail } from "@/lib/domain";

export const invitationInput = z.object({
  full_name: z.string().trim().min(1, "Enter a full name.").max(150),
  email: workEmail,
  team_id: z.string().uuid("Select a department."),
  role: z.enum(["admin", "finance", "staff"]),
  can_manage: z.boolean(),
});
export const invitationToken = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Open a valid invitation link.");
export type InvitationSummary = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  role: string;
  expires_at: string;
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

export function invitationMessage(
  invite: InvitationSummary,
  origin: string,
  token: string,
) {
  invitationToken.parse(token);
  const base = new URL(origin);
  if (
    base.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(base.hostname)
  )
    throw new Error("Invitation links require HTTPS.");
  const url = `${base.origin}/accept-invitation#token=${token}`;
  const subject = "Invitation from CAEDM Software Hub";
  const text = `Hello ${invite.full_name},\n\nYou have been invited to CAEDM Software Hub, our workspace for managing software, subscriptions, and renewals.\n\nDepartment: ${invite.department}\nRole: ${invite.role}\n\nAccept your invitation and create your own password:\n${url}\n\nThis invitation expires in 72 hours. No temporary password is sent. If you were not expecting this invitation, contact your CAEDM administrator. Do not forward this email.\n\nCAEDM Software Hub\nCatholic Archdiocese of Edmonton`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f7fb;color:#17233a;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">Your invitation to CAEDM Software Hub. Accept and securely set your password.</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dce3ee;border-radius:12px"><tr><td style="background:#17233a;color:#ffffff;padding:28px 32px;border-radius:12px 12px 0 0;font-size:22px;font-weight:bold">CAEDM Software Hub</td></tr><tr><td style="padding:32px"><h1 style="font-size:26px;line-height:1.3;margin:0 0 24px">You are invited</h1><p style="line-height:1.6">Hello ${escapeHtml(invite.full_name)},</p><p style="line-height:1.6">Your administrator has invited you to our workspace for managing software, subscriptions, and renewals.</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;font-size:14px"><tr><td style="padding:6px 20px 6px 0;color:#64748b">Department</td><td>${escapeHtml(invite.department)}</td></tr><tr><td style="padding:6px 20px 6px 0;color:#64748b">Access role</td><td>${escapeHtml(invite.role)}</td></tr></table><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#315ad8;color:#ffffff;padding:14px 24px;border-radius:6px;font-weight:bold;text-decoration:none">Accept invitation</a></p><p style="font-size:14px;line-height:1.6;color:#64748b">Create your own password to finish setting up your account. This invitation expires in 72 hours. Please do not forward it.</p><p style="font-size:13px;line-height:1.6;color:#64748b">If the button does not work, copy this address into your browser:<br><a href="${escapeHtml(url)}" style="color:#315ad8;word-break:break-all">${escapeHtml(url)}</a></p><p style="font-size:13px;line-height:1.6;color:#64748b">Not expecting this invitation? Contact your CAEDM administrator.</p></td></tr><tr><td style="border-top:1px solid #e8edf4;padding:20px 32px;color:#64748b;font-size:12px;line-height:1.6">Catholic Archdiocese of Edmonton<br>CAEDM Software Hub</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
export function professionalSender(value: string | undefined) {
  const input = value?.trim();
  if (!input || /[\r\n]/.test(input))
    throw new Error("Configure an authorized EMAIL_FROM address.");
  const address = input.match(/<([^<>]+)>$/)?.[1]?.trim() || input;
  z.string().email().parse(address);
  return { name: "CAEDM Software Hub", address };
}
