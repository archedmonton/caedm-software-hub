import { z } from "zod";
import { workEmail } from "@/lib/domain";
import { developer } from "@/lib/developer";
import { emailBrand } from "@/lib/email-brand";

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
  const role =
    (
      { admin: "Administrator", finance: "Finance", staff: "Staff" } as Record<
        string,
        string
      >
    )[invite.role] || "Team member";
  const expiresAt = new Date(invite.expires_at);
  if (!Number.isFinite(expiresAt.getTime()))
    throw new Error("Invalid invitation expiry.");
  const expires = `${new Intl.DateTimeFormat("en-CA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Edmonton",
  }).format(expiresAt)} (Edmonton time)`;
  const text = `CAEDM SOFTWARE HUB\nCatholic Archdiocese of Edmonton\n\nYou are invited to Software Hub\n\nHello ${invite.full_name},\n\nYour CAEDM administrator has invited you to join Software Hub, our shared workspace for software, subscriptions and renewals.\n\nYOUR ACCESS\nDepartment: ${invite.department}\nAccess role: ${role}\nWork email: ${invite.email}\n\nAccept your invitation:\n${url}\n\nCreate your own password to finish setting up your account, then sign in to your workspace. No temporary password is sent.\n\nINVITATION EXPIRES\n${expires}\nThis link is personal to you. Please do not forward this email.\n\nIf the link has expired, ask your CAEDM administrator to resend your invitation.\n\nNeed a hand? Contact ${developer.name}: ${developer.email}\nIf you were not expecting this invitation, contact your CAEDM administrator before continuing.\n\nCAEDM Software Hub\nCatholic Archdiocese of Edmonton\nGood stewardship. Clearer decisions.`;
  const html = `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${subject}</title>
  <style>
    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    a.email-button, a.email-button:link, a.email-button:visited, a.email-button:hover, a.email-button:focus, a.email-button:active, a.email-button span { color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; text-decoration:none !important; }
    a.email-button:hover { background:#68002c !important; border-color:#68002c !important; }
    @media (hover:hover) {
      a.email-link:hover { color:#860038 !important; }
    }
    a.email-button:focus { outline:3px solid #005493; outline-offset:3px; }
    @media only screen and (max-width:620px) {
      .email-outer { padding:20px 12px !important; }
      .email-padding { padding-left:22px !important; padding-right:22px !important; }
      .email-heading { font-size:26px !important; line-height:34px !important; }
      .email-access, .email-access tbody, .email-access tr, .email-access td { display:block !important; width:100% !important; box-sizing:border-box !important; }
      .email-access colgroup { display:none !important; }
      .email-access-title { padding:16px 16px 4px !important; }
      .email-label { padding:12px 16px 0 !important; }
      .email-value { padding:3px 16px 12px !important; }
      .email-label + .email-value { border-bottom:1px solid #eadfe4; }
      .email-access tr:last-child .email-value { border-bottom:0; }
      .email-action { width:100% !important; }
      .email-button { display:block !important; padding:10px 16px !important; text-align:center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f8f5f6;color:#26313b;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">You are invited to CAEDM Software Hub. Set your password and join your department's workspace.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f5f6">
    <tr><td class="email-outer" align="center" style="padding:32px 16px">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;table-layout:fixed;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #e8dfe3;border-top:4px solid #E5C047;border-radius:10px;overflow:hidden">
        <tr><td class="email-padding" style="padding:28px 32px 24px;background:#ffffff">
          <img src="cid:${emailBrand.logoCid}" alt="${emailBrand.logoAlt}" width="217" height="101" style="display:block;width:217px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none">
          <p style="margin:12px 0 0;color:#860038;font-size:11px;font-weight:bold;line-height:16px;letter-spacing:2px">SOFTWARE HUB</p>
        </td></tr>
        <tr><td class="email-padding" bgcolor="#860038" style="padding:28px 32px;background:#860038;color:#ffffff">
          <p style="margin:0 0 10px;color:#E5C047;font-size:11px;line-height:16px;font-weight:bold;letter-spacing:2px">YOUR CAEDM WORKSPACE</p>
          <h1 class="email-heading" style="margin:0;color:#ffffff;font-size:30px;line-height:38px;font-weight:bold">You are invited to<br>Software Hub</h1>
          <p style="margin:12px 0 0;color:#ffffff;font-size:14px;line-height:22px">Software, subscriptions and renewals. Together in one place.</p>
        </td></tr>
        <tr><td class="email-padding" style="padding:28px 32px 32px">
          <p style="margin:0 0 16px;font-size:16px;line-height:25px">Hello ${escapeHtml(invite.full_name)},</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:25px">Your CAEDM administrator has invited you to join Software Hub, our shared workspace for managing software, subscriptions and renewals.</p>
          <table class="email-access" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;background:#faf7f8;border:1px solid #eadfe4;border-radius:6px">
            <colgroup><col width="32%" style="width:32%"><col width="68%" style="width:68%"></colgroup>
            <tr><td class="email-access-title" colspan="2" style="padding:16px 20px 10px;font-size:11px;font-weight:bold;line-height:16px;letter-spacing:1.5px;color:#860038">YOUR ACCESS</td></tr>
            <tr><td class="email-label" width="32%" valign="top" style="width:32%;padding:8px 12px 8px 20px;font-size:13px;line-height:21px;color:#626b78">Department</td><td class="email-value" valign="top" style="padding:8px 20px 8px 0;font-size:14px;line-height:21px;font-weight:bold;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(invite.department)}</td></tr>
            <tr><td class="email-label" valign="top" style="padding:8px 12px 8px 20px;font-size:13px;line-height:21px;color:#626b78">Access role</td><td class="email-value" valign="top" style="padding:8px 20px 8px 0;font-size:14px;line-height:21px">${escapeHtml(role)}</td></tr>
            <tr><td class="email-label" valign="top" style="padding:8px 12px 18px 20px;font-size:13px;line-height:21px;color:#626b78">Work email</td><td class="email-value" valign="top" style="padding:8px 20px 18px 0;font-size:14px;line-height:21px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(invite.email)}</td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:20px 0 12px">
          <!--[if mso]><v:roundrect href="${escapeHtml(url)}" style="height:44px;v-text-anchor:middle;width:208px" arcsize="12%" stroke="f" fillcolor="#860038"><w:anchorlock/><center style="color:#ffffff !important;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold"><span style="color:#ffffff !important">Accept invitation</span></center></v:roundrect><![endif]-->
          <!--[if !mso]><!--><table class="email-action" role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#860038" align="center" style="background:#860038;border-radius:6px">
            <a class="email-button" href="${escapeHtml(url)}" style="display:inline-block;padding:10px 22px;border:1px solid #860038;border-radius:6px;color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;background:#860038;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;font-weight:bold;text-decoration:none !important;text-align:center"><span style="color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;text-decoration:none !important">Accept invitation</span></a>
          </td></tr></table><!--<![endif]-->
          </td></tr></table>
          <p style="margin:0 0 24px;font-size:14px;line-height:23px;color:#626b78">Create your own password to finish setting up your account, then sign in to your workspace. No temporary password is sent.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid #E5C047;background:#fffcf2"><tr><td style="padding:14px 16px">
            <p style="margin:0 0 5px;color:#860038;font-size:11px;line-height:16px;letter-spacing:1px;font-weight:bold">INVITATION EXPIRES</p>
            <p style="margin:0 0 5px;color:#26313b;font-size:14px;line-height:22px;font-weight:bold">${escapeHtml(expires)}</p>
            <p style="margin:0;font-size:13px;line-height:21px;color:#626b78">This link is personal to you. Please do not forward this email.</p>
          </td></tr></table>
          <p style="margin:24px 0 8px;font-size:12px;line-height:20px;color:#626b78">If the button does not work, copy this entire link into your browser:</p>
          <p style="margin:0;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere"><a class="email-link" href="${escapeHtml(url)}" style="color:#005493;text-decoration:underline;word-break:break-all">${escapeHtml(url)}</a></p>
          <p style="margin:14px 0 0;font-size:12px;line-height:20px;color:#626b78">If the link has expired, ask your CAEDM administrator to resend your invitation.</p>
        </td></tr>
        <tr><td class="email-padding" style="padding:22px 32px;background:#faf7f8;border-top:1px solid #e8dfe3">
          <p style="margin:0 0 8px;font-size:14px;line-height:22px;font-weight:bold;color:#860038">Need a hand?</p>
          <p style="margin:0;font-size:13px;line-height:22px;color:#626b78">Contact ${escapeHtml(developer.name)} at<br><a class="email-link" href="mailto:${developer.email}" style="color:#005493;text-decoration:underline">${developer.email}</a></p>
          <p style="margin:14px 0 0;font-size:12px;line-height:20px;color:#626b78">If you were not expecting this invitation, contact your CAEDM administrator before continuing.</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <p style="margin:20px 12px 0;font-size:12px;line-height:20px;color:#626b78;text-align:center"><strong style="color:#860038">CAEDM Software Hub</strong><br>Catholic Archdiocese of Edmonton<br>Good stewardship. Clearer decisions.</p>
    </td></tr>
  </table>
</body></html>`;
  return {
    subject,
    text,
    html,
    replyTo: developer.email,
    inlineBrandLogo: true as const,
  };
}
export function professionalSender(value: string | undefined) {
  const input = value?.trim();
  if (!input || /[\r\n]/.test(input))
    throw new Error("Configure an authorized EMAIL_FROM address.");
  const address = input.match(/<([^<>]+)>$/)?.[1]?.trim() || input;
  z.string().email().parse(address);
  return { name: "CAEDM Software Hub", address };
}
