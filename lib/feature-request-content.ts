import { z } from "zod";
import { developer } from "@/lib/developer";
import { workEmail } from "@/lib/domain";

export const featureAreas = [
  "General",
  "Dashboard",
  "Software Inventory",
  "Upcoming Renewals",
  "Usage Reviews",
  "Finance Centre",
  "Team Management",
  "Settings",
] as const;
export const featurePriorities = ["Normal", "Low", "High"] as const;
const paragraph = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label}: enter at least ${min} characters.`)
    .max(max)
    .refine((v) => !v.includes("\0"), "Remove unsupported characters.");
export const featureRequestInput = z.object({
  request_key: z.string().uuid(),
  title: paragraph(8, 120, "Request title").refine(
    (v) => !/[\r\n]/.test(v),
    "Keep the title on one line.",
  ),
  area: z.enum(featureAreas),
  priority: z.enum(featurePriorities),
  department: paragraph(0, 120, "Department"),
  problem: paragraph(20, 3000, "Problem or need"),
  solution: paragraph(20, 4000, "Proposed improvement"),
  benefit: paragraph(10, 2000, "Expected benefit"),
  workaround: paragraph(0, 1000, "Current workaround"),
});
export type FeatureRequestInput = z.infer<typeof featureRequestInput>;
export type FeatureRequestReceipt = {
  id: string;
  title: string;
  delivery_status: "pending" | "sending" | "sent" | "failed";
  created_at: string;
};
export type FeatureRequestMessage = Omit<FeatureRequestInput, "request_key"> & {
  id: string;
  requester_name: string;
  requester_email: string;
  created_at: string;
};
export function eligibleFeatureRequester(
  profile: { email: string; status: string },
  user: { email?: string; email_confirmed_at?: string | null },
) {
  return (
    !!user.email_confirmed_at &&
    ["active", "pending_approval"].includes(profile.status) &&
    workEmail.safeParse(user.email).success &&
    user.email?.toLowerCase() === profile.email.toLowerCase()
  );
}
const html = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function featureRequestMessage(request: FeatureRequestMessage) {
  featureRequestInput.parse({ ...request, request_key: request.id });
  const replyTo = workEmail.parse(request.requester_email);
  const sections = [
    ["Requested by", `${request.requester_name} <${replyTo}>`],
    ["Department", request.department || "Not specified"],
    ["Area", request.area],
    ["Priority", request.priority],
    ["Problem or need", request.problem],
    ["Proposed improvement", request.solution],
    ["Expected benefit", request.benefit],
    ["Current workaround", request.workaround || "Not specified"],
  ];
  return {
    id: `feature-${request.id}`,
    to: developer.email,
    replyTo,
    subject: `Feature request: ${request.title}`,
    text: `CAEDM Software Hub | Feature request\n\n${request.title}\nReference: ${request.id}\nSubmitted: ${request.created_at}\n\n${sections.map(([label, value]) => `${label}\n${value}`).join("\n\n")}\n\nReply to this email to contact the requester.`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;background:#faf7f8;font-family:Arial,Helvetica,sans-serif;color:#26313b"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:auto;background:#ffffff;border:1px solid #e5dbe0"><tr><td style="padding:24px;background:#860038;color:#ffffff;border-top:5px solid #E5C047;font-size:20px;font-weight:bold">CAEDM Software Hub</td></tr><tr><td style="padding:28px"><p style="color:#005493;font-size:12px;text-transform:uppercase;letter-spacing:1px">New feature request</p><h1 style="font-size:24px;line-height:1.4">${html(request.title)}</h1><p style="font-size:12px;color:#626b78">Reference: ${html(request.id)}<br>Submitted: ${html(request.created_at)}</p>${sections.map(([label, value]) => `<h2 style="font-size:14px;color:#860038;margin-top:24px">${html(label)}</h2><p style="font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere">${html(value)}</p>`).join("")}<p style="margin-top:28px;border-top:1px solid #e5dbe0;padding-top:20px;font-size:12px;color:#626b78">Reply to this email to contact the verified requester.</p></td></tr></table></td></tr></table></body></html>`,
  };
}
