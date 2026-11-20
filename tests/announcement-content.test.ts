import { test, expect } from "vitest";
import {
  announcementBodyHtml,
  announcementMessage,
  announcementTemplates,
  developerSecurityMessage,
} from "@/lib/announcement-content";
import { releases } from "@/src/lib/releases";
const input = {
  id: "test",
  email: "employee@caedm.ca",
  full_name: "Jane Employee",
  title: "An update",
  subject: "Software Hub update",
  body: "An **important** update.\n\n- First point\n- Second point",
  template: "blank" as const,
  reply_to: "developer@caedm.ca",
  is_test: false,
};
test("announcements personalize individual messages and use verified actor Reply-To", () => {
  const message = announcementMessage(input, "https://hub.caedm.ca");
  expect(message.to).toBe(input.email);
  expect(message.text).toContain("Hi Jane,");
  expect(message.replyTo).toBe(input.reply_to);
  expect(message.purpose).toBe("notifications");
  expect(message.html).toContain("<strong>important</strong>");
  expect(message.html).toContain("<li>First point</li>");
});
test("unsafe HTML, images, links and scripts remain escaped text", () => {
  const html = announcementBodyHtml(
    '<script>alert(1)</script> **safe** <img onerror="x"> [link](javascript:x)',
  );
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("href=");
  expect(html).toContain("&lt;script&gt;");
});
test("test/final share the renderer, tests are clearly labeled and missing names have a fallback", () => {
  const final = announcementMessage(
    { ...input, full_name: "" },
    "https://hub.caedm.ca",
  );
  const preview = announcementMessage(
    { ...input, full_name: "", is_test: true },
    "https://hub.caedm.ca",
  );
  expect(final.text).toContain("Hi there,");
  expect(preview.subject).toBe(`[TEST] ${final.subject}`);
  expect(preview.html).toContain("TEST EMAIL");
  expect(preview.html).toContain(announcementBodyHtml(input.body));
  expect(final.html).toContain(announcementBodyHtml(input.body));
});
test("What's New derives its version and notes from current release metadata", () => {
  expect(announcementTemplates.whats_new.body).toContain(releases[0].version);
  expect(announcementTemplates.whats_new.body).toContain(
    releases[0].features[0],
  );
  expect(announcementTemplates.whats_new.body).toContain(
    releases[0].status === "prepared"
      ? "not yet live"
      : "Read the full release history in About.",
  );
  expect(announcementTemplates.blank.body).toBe("");
});
test.each(["developer_granted", "developer_revoked", "primary_handover"])(
  "security notice %s uses the security sender and preserves role distinctions",
  (kind) => {
    const message = developerSecurityMessage(
      {
        id: "sample",
        kind,
        email: input.email,
        full_name: "Jane",
        actor_name: "Ruban",
      },
      "https://hub.caedm.ca",
    );
    expect(message.purpose).toBe("security");
    expect(message.text).toContain(
      "organization role and department memberships were not changed",
    );
    expect(message.text).toContain("Ruban");
  },
);
