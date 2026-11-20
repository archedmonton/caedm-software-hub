import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const raw = execFileSync(
  process.execPath,
  ["node_modules/supabase/dist/supabase.js", "status", "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const config = JSON.parse(raw.slice(raw.indexOf("{")));
if (!["127.0.0.1", "localhost"].includes(new URL(config.API_URL).hostname))
  throw new Error("Recovery tests require local Supabase.");
const suffix = Date.now();
const secret = `RecoveryTest9${randomBytes(8).toString("hex")}`;
const nextSecret = `RecoveryChanged9${randomBytes(8).toString("hex")}`;
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const people: Record<string, { id: string; email: string }> = {};
test.beforeAll(async () => {
  for (const role of ["super_admin", "staff"]) {
    const email = `recovery-${role}-${suffix}@caedm.ca`;
    const created = await admin.auth.admin.createUser({
      email,
      password: secret,
      email_confirm: true,
      user_metadata: { full_name: `Recovery ${role}` },
    });
    if (created.error || !created.data.user)
      throw new Error("Local recovery fixture creation failed.");
    people[role] = { id: created.data.user.id, email };
    const updated = await admin
      .from("profiles")
      .update({ status: "active" })
      .eq("id", people[role].id);
    if (updated.error)
      throw new Error("Local recovery fixture activation failed.");
    if (role === "super_admin") {
      const promoted = await admin
        .from("profiles")
        .update({ role })
        .eq("id", people[role].id);
      if (promoted.error)
        throw new Error("Local recovery fixture promotion failed.");
    }
  }
});
test("Super Admin prepares a private link; employee changes password; old sessions and reuse are blocked", async ({
  page,
  browser,
}) => {
  const hydrationErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (/hydration/i.test(error.message)) hydrationErrors.push(error.message);
  });
  const oldClient = createClient(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  expect(
    (
      await oldClient.auth.signInWithPassword({
        email: people.staff.email,
        password: secret,
      })
    ).error,
  ).toBeNull();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(people.super_admin.email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/account-recovery");
  await expect(
    page.getByRole("heading", { name: "Account recovery", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Employee", { exact: true })
    .selectOption(people.staff.id);
  await page.getByLabel("Your current password").fill("incorrect-password");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Prepare recovery link" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "verification failed",
  );
  await page
    .getByLabel("Employee", { exact: true })
    .selectOption(people.staff.id);
  await page.getByLabel("Your current password").fill(secret);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Prepare recovery link" }).click();
  const input = page.getByRole("textbox", {
    name: "Private recovery link",
    exact: true,
  });
  await expect(input).toBeVisible();
  const link = await input.inputValue();
  expect(link).toContain("/auth/assisted-recovery#");
  await page.screenshot({
    path: ".artifacts/recovery-review/console-desktop.png",
    fullPage: true,
    mask: [input],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("heading", { name: "Account recovery", exact: true })
    .click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/recovery-review/console-mobile.png",
    fullPage: true,
  });
  expect(
    (await oldClient.rpc("get_access_context")).data.recovery_required,
  ).toBe(true);
  const recipient = await browser.newContext();
  const userPage = await recipient.newPage();
  await userPage.goto(link);
  await expect(
    userPage.getByRole("button", { name: "Change password", exact: true }),
  ).toBeEnabled();
  expect(new URL(userPage.url()).hash).toBe("");
  await userPage.getByLabel("New password", { exact: true }).fill(nextSecret);
  await userPage.getByLabel("Confirm new password").fill(nextSecret);
  await userPage.screenshot({
    path: ".artifacts/recovery-review/choose-password.png",
    fullPage: true,
    mask: [userPage.locator('input[type="password"]')],
  });
  await userPage
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    userPage.getByRole("heading", { name: "Password changed", exact: true }),
  ).toBeVisible();
  expect(
    (await oldClient.rpc("get_access_context")).data.recovery_required,
  ).toBe(true);
  await userPage
    .getByRole("link", { name: "Sign in with your new password" })
    .click();
  await userPage.getByLabel("Work email").fill(people.staff.email);
  await userPage.getByLabel("Password", { exact: true }).fill(nextSecret);
  await userPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(userPage).toHaveURL(/dashboard/);
  await expect(
    userPage.getByRole("link", { name: "Account Recovery", exact: true }),
  ).toHaveCount(0);
  await userPage.goto("/account-recovery");
  await expect(userPage).toHaveURL(/dashboard\?notice=/);
  await userPage.goto(link);
  await userPage.getByLabel("New password", { exact: true }).fill(secret);
  await userPage.getByLabel("Confirm new password").fill(secret);
  await userPage
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(userPage.locator(".notice[role=alert]")).toContainText(
    "invalid, expired or replaced",
  );
  await recipient.close();
  expect(hydrationErrors).toEqual([]);
});
