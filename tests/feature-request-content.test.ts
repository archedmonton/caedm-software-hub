import { test, expect } from "vitest";
import {
  featureRequestInput,
  featureRequestMessage,
  eligibleFeatureRequester,
} from "@/lib/feature-request-content";
const input = {
  request_key: "a0000000-0000-4000-8000-000000000001",
  title: "Improve renewal planning exports",
  area: "Upcoming Renewals",
  priority: "Normal",
  department: "Mission & Services",
  problem: "Our department needs an easier way to plan decisions.",
  solution: "Add an export showing the owner and decision deadline.",
  benefit: "This would reduce follow-up work.",
  workaround: "We keep a separate document.",
};
test("requires bounded structured fields and rejects header injection", () => {
  expect(featureRequestInput.safeParse(input).success).toBe(true);
  for (const patch of [
    { title: "Idea\r\nBcc: attacker@example.com" },
    { area: "Other app" },
    { problem: "short" },
    { solution: "x".repeat(4001) },
    { priority: "urgent" },
  ])
    expect(featureRequestInput.safeParse({ ...input, ...patch }).success).toBe(
      false,
    );
});
test("sends to the fixed developer, sets verified reply-to and escapes HTML", () => {
  const message = featureRequestMessage({
    ...featureRequestInput.parse(input),
    id: input.request_key,
    requester_name: '<script>alert("x")</script>',
    requester_email: "employee@caedm.ca",
    created_at: "2026-10-28T18:00:00Z",
  });
  expect(message.to).toBe("ruban.peppin@caedm.ca");
  expect(message.replyTo).toBe("employee@caedm.ca");
  expect(message.html).not.toContain("<script>");
  expect(message.html).toContain("&lt;script&gt;");
  expect(message.html).toContain("Mission &amp; Services");
  expect(message.text).toContain(input.problem);
  expect(message.id).toBe("feature-" + input.request_key);
});
test("does not accept an arbitrary reply-to mailbox", () => {
  expect(() =>
    featureRequestMessage({
      ...featureRequestInput.parse(input),
      id: input.request_key,
      requester_name: "Employee",
      requester_email: "external@example.com",
      created_at: "2026-10-28T18:00:00Z",
    }),
  ).toThrow();
});
test("allows verified pending and active identities, not unverified, restricted or mismatched identities", () => {
  const user = {
    email: "employee@caedm.ca",
    email_confirmed_at: "2026-10-28T18:00:00Z",
  };
  for (const status of ["pending_approval", "active"])
    expect(eligibleFeatureRequester({ email: user.email, status }, user)).toBe(
      true,
    );
  for (const status of ["suspended", "deactivated", "rejected"])
    expect(eligibleFeatureRequester({ email: user.email, status }, user)).toBe(
      false,
    );
  expect(
    eligibleFeatureRequester(
      { email: user.email, status: "pending_approval" },
      { ...user, email_confirmed_at: null },
    ),
  ).toBe(false);
  expect(
    eligibleFeatureRequester(
      { email: "someoneelse@caedm.ca", status: "active" },
      user,
    ),
  ).toBe(false);
});
