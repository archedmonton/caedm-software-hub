import { releases } from "@/src/lib/releases";
import { brandedNotice, escapeEmailHtml } from "@/lib/email-template";
import type { Message } from "@/lib/email";
export type AnnouncementTemplate = "welcome" | "whats_new" | "blank";
export const announcementTemplates = {
  welcome: {
    title: "Welcome to CAEDM Software Hub",
    subject: "Welcome to CAEDM Software Hub",
    body: "Welcome to our shared software workspace.\n\nSoftware Hub helps us track software, subscriptions, responsible employees, upcoming renewals and recorded expenses. Your assigned role and departments determine what you can access.\n\n- Review your department’s software and your responsibilities.\n- Check upcoming renewals and respond to usage reviews assigned to you.\n- Choose your software email preferences in Settings.\n\nDuring testing, you may see further improvements. Use Help for guidance, contact the developer for support, or use Request a Feature to share a suggestion.",
  },
  whats_new: {
    title: "What’s New in CAEDM Software Hub",
    subject: `What’s New in CAEDM Software Hub · v${releases[0].version}`,
    body: `Version ${releases[0].version} · ${releases[0].releaseDate || "Prepared release — publication date not assigned"}\n\n${releases[0].title}\n\n${releases[0].summary}\n\n${[...releases[0].features, ...releases[0].improvements, ...releases[0].fixes].map((item) => `- ${item}`).join("\n")}\n\n${releases[0].status === "prepared" ? "This release is awaiting approval and is not yet live. Check About for the published release status." : "Read the full release history in About."}`,
  },
  blank: {
    title: "Application announcement",
    subject: "CAEDM Software Hub update",
    body: "",
  },
} satisfies Record<
  AnnouncementTemplate,
  { title: string; subject: string; body: string }
>;

// Deliberately small formatting grammar: text, **bold**, paragraphs and '- ' lists.
// All source text is escaped first; HTML, scripts and arbitrary links are never accepted.
export function announcementBodyHtml(body: string) {
  const inline = (text: string) =>
    escapeEmailHtml(text).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  return body
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.trim().split("\n");
      return lines.every((line) => line.startsWith("- "))
        ? `<ul style="padding-left:24px;font-size:16px;line-height:1.6">${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join("")}</ul>`
        : `<p style="font-size:16px;line-height:1.6;margin:0 0 18px">${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}
export type AnnouncementDelivery = {
  id: string;
  email: string;
  full_name: string;
  title: string;
  subject: string;
  body: string;
  template: AnnouncementTemplate;
  reply_to: string;
  is_test: boolean;
  delivery_ref?: string;
};
export function announcementMessage(
  input: AnnouncementDelivery,
  origin: string,
): Message {
  const first = input.full_name.trim().split(/\s+/)[0] || "there";
  const greeting = `Hi ${first},`;
  const test = input.is_test
    ? "TEST EMAIL — only you receive this preview."
    : "";
  const marker = "ANNOUNCEMENT_BODY_PLACEHOLDER";
  const notice = brandedNotice({
    title: input.title,
    paragraphs: [greeting, ...(test ? [test] : []), marker],
    action: {
      label:
        input.template === "whats_new"
          ? "Read release history"
          : "Open Software Hub",
      url: `${new URL(origin).origin}${input.template === "whats_new" ? "/about" : "/login"}`,
    },
  });
  return {
    ...notice,
    id: `announcement-${input.id}`,
    to: input.email,
    purpose: "notifications",
    deliveryRef: input.delivery_ref,
    subject: `${input.is_test ? "[TEST] " : ""}${input.subject}`,
    replyTo: input.reply_to,
    text: notice.text.replace(marker, input.body),
    html: notice.html.replace(
      `<p style="font-size:16px;line-height:1.6;margin:0 0 18px">${marker}</p>`,
      announcementBodyHtml(input.body),
    ),
  };
}
export function developerSecurityMessage(
  input: {
    id: string;
    kind: string;
    email: string;
    full_name: string;
    actor_name: string;
  },
  origin: string,
): Message {
  return {
    id: `developer-access-${input.id}`,
    to: input.email,
    purpose: "security",
    ...brandedNotice({
      title:
        input.kind === "developer_granted"
          ? "Developer access granted"
          : input.kind === "developer_revoked"
            ? "Developer access revoked"
            : "Primary developer handover recorded",
      paragraphs: [
        `Hi ${input.full_name.trim().split(/\s+/)[0] || "there"},`,
        `${input.actor_name || "An authorized developer"} recorded a change to Developer access in CAEDM Software Hub. Your organization role and department memberships were not changed by this action.`,
        "If this change was unexpected, contact IT or the configured primary developer.",
      ],
      details: [["Recorded change", input.kind.replaceAll("_", " ")]],
      action: {
        label: "Open Software Hub",
        url: `${new URL(origin).origin}/login`,
      },
    }),
  };
}
