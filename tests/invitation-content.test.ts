import { describe, test, expect } from "vitest";
import {
  invitationInput,
  invitationMessage,
  invitationToken,
  professionalSender,
} from "@/lib/invitation-content";
import { emailBrand } from "@/lib/email-brand";
const invite = {
  id: "test",
  email: "employee@caedm.ca",
  full_name: 'Alex <script>alert("x")</script>',
  department: "Mission & Services",
  role: "staff",
  expires_at: "2026-11-01T00:00:00Z",
};
const token = "a".repeat(64);
describe("invitation email and inputs", () => {
  test("uses a professional identity without changing the authorized mailbox", () => {
    expect(
      professionalSender(
        "Notifications - CAEDM Software Hub <notifications@caedm.ca>",
      ),
    ).toEqual({
      name: "CAEDM Software Hub",
      address: "notifications@caedm.ca",
    });
    expect(() =>
      professionalSender("notifications@caedm.ca\r\nBcc: other@example.com"),
    ).toThrow();
    expect(() => professionalSender("Notifications")).toThrow();
  });
  test("provides matching HTML and text with escaped user content and no tracking", () => {
    const mail = invitationMessage(
      invite,
      "https://caedm-software-hub.vercel.app",
      token,
    );
    expect(mail.subject).toBe("Invitation from CAEDM Software Hub");
    expect(mail.html).toContain("Alex &lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("Mission &amp; Services");
    expect(mail.text).toContain(
      "October 31, 2026 at 6:00 p.m. (Edmonton time)",
    );
    expect(mail.html).toContain(
      "October 31, 2026 at 6:00 p.m. (Edmonton time)",
    );
    expect(mail.html).not.toMatch(/<script|<iframe/);
    expect(mail.html).toContain(`src="cid:${emailBrand.logoCid}"`);
    expect(mail.html.match(/<img\b/g)).toHaveLength(1);
    expect(mail.html).not.toMatch(/src=["'](?:https?:|data:)/);
    expect(mail.inlineBrandLogo).toBe(true);
    expect(mail.replyTo).toBe("ruban.peppin@caedm.ca");
    expect(mail.html).toContain("#860038");
    expect(mail.html).toContain("#E5C047");
    expect(mail.html).toContain("#005493");
    expect(mail.text).toContain("/accept-invitation#token=" + token);
    expect(mail.html).toContain("/accept-invitation#token=" + token);
    expect(mail.text).not.toContain("?token=");
  });
  test.each([
    ["staff", "Staff"],
    ["finance", "Finance"],
    ["admin", "Administrator"],
  ])("uses a clear %s role label in HTML and plain text", (role, label) => {
    const mail = invitationMessage(
      { ...invite, role },
      "https://caedm-software-hub.vercel.app",
      token,
    );
    expect(mail.text).toContain(`Access role: ${label}`);
    expect(mail.html).toContain(`>${label}</td>`);
  });
  test("shows the actual expiry across Edmonton's daylight-saving boundary", () => {
    const mail = invitationMessage(
      { ...invite, expires_at: "2026-11-02T00:00:00Z" },
      "https://caedm-software-hub.vercel.app",
      token,
    );
    expect(mail.text).toContain(
      "November 1, 2026 at 5:00 p.m. (Edmonton time)",
    );
    expect(mail.html).toContain(
      "November 1, 2026 at 5:00 p.m. (Edmonton time)",
    );
    expect(() =>
      invitationMessage(
        { ...invite, expires_at: "invalid" },
        "https://caedm-software-hub.vercel.app",
        token,
      ),
    ).toThrow("expiry");
  });
  test("rejects malformed secrets and insecure remote origins", () => {
    expect(() => invitationToken.parse("short")).toThrow();
    expect(() =>
      invitationMessage(invite, "http://external.example", token),
    ).toThrow();
    expect(() =>
      invitationMessage(invite, "http://localhost:3100", token),
    ).not.toThrow();
  });
  test("accepts only exact CAEDM email addresses and defined roles", () => {
    const input = {
      full_name: "Alex",
      email: "alex@caedm.ca",
      team_id: "10000000-0000-4000-8000-000000000001",
      role: "staff",
      can_manage: false,
    };
    expect(invitationInput.safeParse(input).success).toBe(true);
    for (const email of [
      "alex@example.com",
      "alex@caedm.ca.evil.test",
      "alex@sub.caedm.ca",
    ])
      expect(invitationInput.safeParse({ ...input, email }).success).toBe(
        false,
      );
    expect(invitationInput.safeParse({ ...input, role: "root" }).success).toBe(
      false,
    );
  });
});
