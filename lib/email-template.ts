import { emailBrand } from "@/lib/email-brand";
import { developer } from "@/lib/developer";

export const escapeEmailHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function brandedNotice(input: {
  title: string;
  paragraphs: string[];
  details?: [string, string][];
  action?: { label: string; url: string };
  code?: string;
}) {
  const e = escapeEmailHtml;
  const details = input.details || [];
  const text = `CAEDM SOFTWARE HUB\nCatholic Archdiocese of Edmonton\n\n${input.title}\n\n${input.paragraphs.join("\n\n")}\n\n${details.map(([k, v]) => `${k}: ${v}`).join("\n")}${input.code ? `\nVerification code: ${input.code}` : ""}${input.action ? `\n\n${input.action.label}:\n${input.action.url}` : ""}\n\nNeed a hand? Contact ${developer.email}.\nCAEDM Software Hub`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>a.email-button,a.email-button:link,a.email-button:visited,a.email-button:hover,a.email-button:active,a.email-button span{color:#ffffff!important;-webkit-text-fill-color:#ffffff!important;text-decoration:none!important}a.email-button:hover{background:#68002c!important}</style></head><body style="margin:0;background:#f8f5f6;font-family:Arial,Helvetica,sans-serif;color:#26313b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:auto;background:white;border:1px solid #e8dfe3;border-top:5px solid #E5C047"><tr><td style="padding:24px 28px;border-bottom:1px solid #e8dfe3"><img src="cid:${emailBrand.logoCid}" alt="${emailBrand.logoAlt}" width="224" style="display:block;max-width:100%;height:auto"><p style="font-size:12px;letter-spacing:2px;color:#860038">SOFTWARE HUB</p></td></tr><tr><td style="padding:28px"><h1 style="font-size:26px;line-height:1.3;color:#860038;margin:0 0 20px">${e(input.title)}</h1>${input.paragraphs.map((p) => `<p style="font-size:16px;line-height:1.6;margin:0 0 18px">${e(p)}</p>`).join("")}${details.length ? `<table role="presentation" width="100%" style="background:#faf7f8">${details.map(([k, v]) => `<tr><td style="padding:10px;font-size:14px">${e(k)}</td><td style="padding:10px;font-size:14px;font-weight:bold;overflow-wrap:anywhere">${e(v)}</td></tr>`).join("")}</table>` : ""}${input.code ? `<p style="font-size:28px;letter-spacing:5px;font-weight:bold;color:#860038">${e(input.code)}</p>` : ""}${input.action ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td bgcolor="#860038" style="border-radius:5px"><a class="email-button" href="${e(input.action.url)}" style="display:inline-block;background:#860038;border:1px solid #860038;border-radius:5px;padding:10px 20px;font-size:16px;line-height:22px;font-weight:bold;color:#ffffff!important;text-decoration:none"><span style="color:#ffffff!important">${e(input.action.label)}</span></a></td></tr></table><p style="font-size:12px;line-height:1.6;overflow-wrap:anywhere">If the button does not open, copy this link into your browser:<br><a href="${e(input.action.url)}" style="color:#005493">${e(input.action.url)}</a></p>` : ""}</td></tr><tr><td style="padding:20px 28px;background:#faf7f8;border-top:1px solid #e8dfe3;font-size:13px;line-height:1.6">Need a hand? <a href="mailto:${developer.email}" style="color:#005493">${developer.email}</a><br>CAEDM Software Hub · Catholic Archdiocese of Edmonton</td></tr></table></td></tr></table></body></html>`;
  return {
    subject: `${input.title} | CAEDM Software Hub`,
    text,
    html,
    inlineBrandLogo: true as const,
    replyTo: developer.email,
  };
}
