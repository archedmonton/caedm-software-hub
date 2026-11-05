import { z } from "zod";
import { cents, money } from "@/lib/domain";
import { emailBrand } from "@/lib/email-brand";

export const billingReminderDefaults = {
  enabled: true,
  only_owned: true,
  first_notice_days: 14,
  second_notice_days: 7,
};
export const billingReminderSchema = z
  .object({
    enabled: z.boolean(),
    only_owned: z.boolean().default(true),
    first_notice_days: z.coerce.number().int().min(2).max(365),
    second_notice_days: z.coerce.number().int().min(1).max(364),
  })
  .refine((v) => v.first_notice_days > v.second_notice_days, {
    message:
      "The first notice must be earlier than the second notice (a larger number of days).",
    path: ["second_notice_days"],
  });
export type BillingReminderPreferences = z.infer<typeof billingReminderSchema>;
export type BillingNotification = {
  id: string;
  claim_token: string;
  email: string;
  full_name: string;
  subscription_id: string;
  software_name: string;
  billing_date: string;
  notice_days: number;
  days_until_billing: number;
  amount: string;
  currency: string;
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function billingReminderMessage(n: BillingNotification, origin: string) {
  const base = new URL(origin);
  if (
    base.protocol !== "https:" &&
    !(
      base.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(base.hostname)
    )
  )
    throw new Error("A secure application URL is required.");
  const url = new URL(
    `/software/${z.string().uuid().parse(n.subscription_id)}`,
    base.origin,
  ).href;
  const preferences = new URL("/settings#notifications", base.origin).href;
  const amount = `${money(cents(n.amount), n.currency)} ${n.currency}`;
  const when = `${n.days_until_billing} ${n.days_until_billing === 1 ? "day" : "days"}`;
  const subject = `Upcoming software billing in ${when}: ${n.software_name}`;
  const text = `Hello ${n.full_name},\n\nThis is a reminder that ${n.software_name} has an expected billing date in ${when}.\n\nExpected billing date: ${n.billing_date}\nBilling amount: ${amount}\nScheduled notice: ${n.notice_days} days before billing\n\nReview the software details: ${url}\n\nThis is a forecast, not an invoice or a recorded payment. Updating the Hub does not cancel or change your vendor contract. Check any cancellation notice period in the software record.\n\nManage your software email notifications: ${preferences}\n\nCAEDM Software Hub\nThe Catholic Archdiocese of Edmonton`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Upcoming software billing</title><style>a.billing-button:hover,a.billing-button:focus{color:#ffffff!important;background:#68002c!important}@media(max-width:600px){.billing-padding{padding:24px 20px!important}}</style></head>
<body style="margin:0;padding:20px 0;background:#faf7f8;color:#26313b;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e8dfe3;border-top:5px solid #E5C047">
<tr><td class="billing-padding" style="padding:28px 32px;border-bottom:1px solid #e8dfe3"><img src="cid:${emailBrand.logoCid}" width="240" alt="${emailBrand.logoAlt}" style="display:block;width:240px;max-width:100%;height:auto"><p style="margin:14px 0 0;color:#860038;font-size:11px;letter-spacing:2px;font-weight:bold">SOFTWARE HUB · BILLING REMINDER</p></td></tr>
<tr><td class="billing-padding" style="padding:28px 32px"><h1 style="margin:0 0 20px;font-size:26px;line-height:34px;color:#860038">Upcoming software billing</h1><p style="font-size:15px;line-height:24px">Hello ${escapeHtml(n.full_name)},</p><p style="font-size:15px;line-height:24px"><strong>${escapeHtml(n.software_name)}</strong> has an expected billing date in <strong>${when}</strong>.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf7f8;border-left:3px solid #E5C047"><tr><td style="padding:16px;font-size:14px;line-height:24px"><strong>Expected billing date</strong><br>${escapeHtml(n.billing_date)}<br><strong>Billing amount</strong><br>${escapeHtml(amount)}<br><span style="color:#626b78">Scheduled ${n.notice_days}-day notice</span></td></tr></table>
<p style="margin:24px 0"><a class="billing-button" href="${escapeHtml(url)}" style="display:inline-block;background:#860038;color:#ffffff!important;text-decoration:none;font-size:14px;line-height:20px;font-weight:bold;padding:12px 20px;border-radius:5px;mso-padding-alt:12px 20px"><span style="color:#ffffff">Review software details</span></a></p>
<p style="font-size:13px;line-height:21px;color:#626b78">This is a forecast, not an invoice or a recorded payment. Updating the Hub does not cancel or change your vendor contract. Check the cancellation notice period in the software record.</p>
<p style="font-size:12px;line-height:20px;word-break:break-all">Button unavailable? <a href="${escapeHtml(url)}" style="color:#005493">${escapeHtml(url)}</a></p></td></tr>
<tr><td class="billing-padding" style="padding:20px 32px;background:#faf7f8;border-top:1px solid #e8dfe3"><p style="font-size:12px;line-height:20px;margin:0"><a href="${escapeHtml(preferences)}" style="color:#005493">Manage your software email notifications</a><br>CAEDM Software Hub · The Catholic Archdiocese of Edmonton</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html, inlineBrandLogo: true };
}
