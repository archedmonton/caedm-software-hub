import { z } from "zod";
import { workEmail } from "@/lib/domain";
import { brandedNotice } from "@/lib/email-template";
import type { Message } from "@/lib/email";

const events = [
  "signup",
  "recovery",
  "magiclink",
  "email",
  "invite",
  "email_change",
  "reauthentication",
  "password_changed_notification",
  "email_changed_notification",
  "phone_changed_notification",
  "identity_linked_notification",
  "identity_unlinked_notification",
  "mfa_factor_enrolled_notification",
  "mfa_factor_unenrolled_notification",
] as const;
const payloadSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: workEmail,
    new_email: workEmail.optional().or(z.literal("")),
    user_metadata: z
      .object({ full_name: z.string().max(150).optional() })
      .passthrough()
      .optional(),
  }),
  email_data: z.object({
    email_action_type: z.enum(events),
    token: z.string().max(128).optional(),
    token_hash: z.string().max(128).optional(),
    token_new: z.string().max(128).optional(),
    token_hash_new: z.string().max(128).optional(),
    old_email: workEmail.optional().or(z.literal("")),
  }),
});
const hashSchema = z.string().regex(/^[a-f0-9]{32,128}$/i);
const securityTitles: Record<string, string> = {
  password_changed_notification: "Your password was changed",
  email_changed_notification: "Your account email was changed",
  phone_changed_notification: "Your account phone was changed",
  identity_linked_notification: "A sign-in identity was linked",
  identity_unlinked_notification: "A sign-in identity was unlinked",
  mfa_factor_enrolled_notification: "An authentication factor was added",
  mfa_factor_unenrolled_notification: "An authentication factor was removed",
};
export function authEmailMessages(
  payload: unknown,
  eventId: string,
  origin: string,
  supabaseUrl: string,
): Message[] {
  const { user, email_data: data } = payloadSchema.parse(payload);
  const app = new URL(origin);
  const api = new URL(supabaseUrl);
  for (const url of [app, api]) {
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    )
      throw new Error("A secure email origin is required.");
  }
  const action = data.email_action_type;
  const greeting = `Hello ${user.user_metadata?.full_name || "there"},`;
  const message = (
    to: string,
    purpose: Message["purpose"],
    notice: Parameters<typeof brandedNotice>[0],
  ): Message => ({
    id: `auth-${eventId}-${to}`,
    to,
    purpose,
    ...brandedNotice(notice),
  });
  if (securityTitles[action]) {
    const recipients = [
      ...new Set([
        user.email,
        ...(action === "email_changed_notification" && data.old_email
          ? [data.old_email]
          : []),
      ]),
    ];
    return recipients.map((to) =>
      message(to, "security", {
        title: securityTitles[action],
        paragraphs: [
          greeting,
          "A security-related change was recorded for your CAEDM Software Hub account. If you made this change, no further action is needed. If you did not, contact IT immediately and secure your account.",
        ],
        action: { label: "Open Software Hub", url: `${app.origin}/login` },
      }),
    );
  }
  if (action === "reauthentication") {
    const code = z
      .string()
      .regex(/^\d{6,10}$/)
      .parse(data.token);
    return [
      message(user.email, "authentication", {
        title: "Verify your identity",
        paragraphs: [
          greeting,
          "Use this one-time code to confirm your identity. Do not share it with anyone. If you did not request this code, ignore this email.",
        ],
        code,
      }),
    ];
  }
  const link = (hash: string | undefined, type: string) => {
    if (["signup", "recovery", "email"].includes(type)) {
      // Keep the existing cross-browser verifyOtp flow for registration and reset.
      const url = new URL("/auth/confirm", app.origin);
      url.searchParams.set("token_hash", hashSchema.parse(hash));
      url.searchParams.set("type", type);
      return url.href;
    }
    // Use Supabase's verification endpoint to preserve its token, expiry and PKCE checks.
    const url = new URL("/auth/v1/verify", api.origin);
    url.searchParams.set("token", hashSchema.parse(hash));
    url.searchParams.set("type", type);
    const redirect = new URL("/auth/callback", app.origin);
    if (type === "recovery" || type === "invite")
      redirect.searchParams.set("next", "/auth/update-password");
    url.searchParams.set("redirect_to", redirect.href);
    return url.href;
  };
  if (action === "email_change") {
    const nextEmail = workEmail.parse(user.new_email);
    const recipients: [string, string | undefined][] = [
      [nextEmail, data.token_hash],
    ];
    // Supabase's historical field names are reversed: _new belongs to CURRENT email.
    if (data.token_hash_new)
      recipients.unshift([user.email, data.token_hash_new]);
    return recipients.map(([to, hash]) =>
      message(to, "authentication", {
        title: "Confirm your email change",
        paragraphs: [
          greeting,
          `A request was made to change your account email to ${nextEmail}. Confirm only if you requested this change.`,
          "This confirmation does not change your application role or approval status.",
        ],
        action: {
          label: "Confirm email change",
          url: link(hash, "email_change"),
        },
      }),
    );
  }
  const title =
    action === "recovery"
      ? "Reset your password"
      : action === "invite"
        ? "You are invited to Software Hub"
        : action === "magiclink"
          ? "Your secure sign-in link"
          : "Verify your email address";
  const body =
    action === "recovery"
      ? "A password reset was requested for your account. Use the secure link to choose a new password. If you did not request this, ignore this email."
      : action === "invite"
        ? "You have been invited to Software Hub. Complete password setup using the secure link. Workspace access remains subject to your administrator's approval."
        : action === "magiclink"
          ? "Use this secure link to sign in. If you did not request it, ignore this email."
          : "Confirm your work email address to continue. An administrator must approve your account before you can enter the workspace.";
  return [
    message(
      user.email,
      action === "invite" ? "invitations" : "authentication",
      {
        title,
        paragraphs: [
          greeting,
          body,
        "This link is personal and expires automatically. Do not forward this email.",
        ],
        action: {
          label:
            action === "recovery"
              ? "Choose a new password"
              : action === "invite"
                ? "Accept invitation"
                : action === "magiclink"
                  ? "Sign in"
                  : "Verify email address",
          url: link(data.token_hash, action),
        },
      },
    ),
  ];
}
