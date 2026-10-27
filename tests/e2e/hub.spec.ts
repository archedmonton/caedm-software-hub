import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
test.describe.configure({ mode: "serial" });
const raw = execFileSync(
  process.execPath,
  ["node_modules/supabase/dist/supabase.js", "status", "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const config = JSON.parse(raw.slice(raw.indexOf("{")));
if (!["127.0.0.1", "localhost"].includes(new URL(config.API_URL).hostname))
  throw new Error("Tests require a local Supabase target.");
const suffix = Date.now();
const secret = `TestPassword9${randomBytes(8).toString("hex")}`;
const emails = {
  admin: `e2e-admin-${suffix}@caedm.ca`,
  finance: `e2e-finance-${suffix}@caedm.ca`,
  staff: `e2e-staff-${suffix}@caedm.ca`,
  pending: `e2e-pending-${suffix}@caedm.ca`,
};
const ids: Record<string, string> = {};
let admin: SupabaseClient;
let softwareId: string;
const team = "10000000-0000-4000-8000-000000000001";
const softwareName = `=Demo Integration Tool ${suffix}`;
async function login(page: Page, role: keyof typeof emails) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(emails[role]);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "pending" ? /pending-approval/ : /dashboard/,
  );
}
async function checked<T extends { data: unknown; error: unknown }>(
  result: T,
): Promise<T["data"]> {
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data;
}
test.beforeAll(async () => {
  admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  for (const role of ["admin", "finance", "staff"] as const) {
    const created = await checked(
      await admin.auth.admin.createUser({
        email: emails[role],
        password: secret,
        email_confirm: true,
        user_metadata: { full_name: `Test ${role}` },
      }),
    );
    ids[role] = created.user!.id;
    const { data: p } = await admin
      .from("profiles")
      .select("role,status")
      .eq("id", ids[role])
      .single();
    expect(p).toEqual({ role: "staff", status: "pending_approval" });
    await checked(
      await admin
        .from("profiles")
        .update({ role, status: "active" })
        .eq("id", ids[role])
        .select(),
    );
  }
  await checked(
    await admin
      .from("team_members")
      .upsert({ team_id: team, profile_id: ids.staff, can_manage: true })
      .select(),
  );
});
test("public routes are responsive and restricted endpoints reject anonymous access", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/software");
  await expect(page).toHaveURL(/login/);
  expect((await request.get("/api/exports")).status()).toBe(401);
  expect((await request.post("/api/jobs/reminders")).status()).toBe(401);
});
test("real signup email verification leads to pending approval and no business data", async ({
  page,
}) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Pending Demo Employee");
  await page.getByLabel("Work email").fill(emails.pending);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByLabel("Confirm password").fill(secret);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Check your work email");
  let html = "";
  await expect
    .poll(async () => {
      const list = await (
        await fetch(
          `${config.MAILPIT_URL || config.INBUCKET_URL}/api/v1/messages`,
        )
      ).json();
      const message = list.messages?.find((m: { To: { Address: string }[] }) =>
        m.To?.some((t) => t.Address === emails.pending),
      );
      if (message) {
        const detail = await (
          await fetch(
            `${config.MAILPIT_URL || config.INBUCKET_URL}/api/v1/message/${message.ID}`,
          )
        ).json();
        html = detail.HTML || detail.Text || "";
      }
      return Boolean(html);
    })
    .toBe(true);
  const match = html.match(/https?:[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+/);
  expect(match).toBeTruthy();
  const link = new URL(match![0].replaceAll("&amp;", "&"));
  const token = link.searchParams.get("token");
  expect(token).toBeTruthy();
  await page.goto(match![0].replaceAll("&amp;", "&"));
  await expect(page).toHaveURL(/pending-approval/);
  await expect(
    page.getByRole("heading", { name: "Your request is with IT" }),
  ).toBeVisible();
  await page.goto("/finance");
  await expect(page).toHaveURL(/pending-approval/);
  const client = createClient(
    config.API_URL,
    config.PUBLISHABLE_KEY || config.ANON_KEY,
    { auth: { persistSession: false } },
  );
  const signed = await checked(
    await client.auth.signInWithPassword({
      email: emails.pending,
      password: secret,
    }),
  );
  ids.pending = signed.user!.id;
  expect(
    (await client.from("software_subscriptions").select("id")).data,
  ).toEqual([]);
  const blocked = await client.auth.signUp({
    email: `intruder-${suffix}@example.com`,
    password: secret,
  });
  expect(blocked.error).toBeTruthy();
});
test("administrator approves a verified account and assigns a department", async ({
  page,
}) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Team Management" }).click();
  const account = page.locator("article").filter({ hasText: emails.pending });
  await account.getByLabel("Role").selectOption("staff");
  await account.getByLabel("Status").selectOption("active");
  page.once("dialog", (d) => d.accept());
  await account.getByRole("button", { name: "Update access" }).click();
  await expect(account.getByRole("status")).toContainText("Changes saved");
  const assign = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Assign department access" }),
  });
  await assign
    .getByRole("combobox", { name: "Employee", exact: true })
    .selectOption(ids.pending);
  await assign
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption(team);
  page.once("dialog", (d) => d.accept());
  await assign.getByRole("button", { name: "Assign membership" }).click();
  await expect(assign.getByRole("status")).toContainText("Changes saved");
});
test("software creation, dashboard, search and editing use actual records", async ({
  page,
}) => {
  await login(page, "admin");
  await page
    .getByRole("link", { name: "Add software", exact: true })
    .first()
    .click();
  await page.getByLabel("Software name", { exact: true }).fill(softwareName);
  await page
    .getByRole("combobox", { name: "Vendor", exact: true })
    .selectOption("20000000-0000-4000-8000-000000000001");
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption(team);
  await page
    .getByRole("combobox", { name: "Responsible employee", exact: true })
    .selectOption(ids.staff);
  await page.getByLabel("Billing amount", { exact: true }).fill("123.45");
  await page
    .getByRole("combobox", { name: "Payment reference", exact: true })
    .selectOption("30000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Save software" }).click();
  await expect(page).toHaveURL(/software\/[0-9a-f-]+$/);
  softwareId = page.url().split("/").pop()!;
  await expect(
    page.getByRole("heading", { name: softwareName, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit software" }).click();
  await page
    .getByLabel("Internal notes")
    .fill("Synthetic integration-test record");
  await page.getByRole("button", { name: "Save software" }).click();
  await expect(
    page.getByText("Synthetic integration-test record", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Software Inventory", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search software" })
    .fill(String(suffix));
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText(softwareName, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByText("Monthly recurring", { exact: true }),
  ).toBeVisible();
  await mkdir(".artifacts", { recursive: true });
  await page.screenshot({
    path: ".artifacts/dashboard-desktop.png",
    fullPage: true,
  });
});
test("local reminders create authenticated reviews and the owner can respond", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto(`/software/${softwareId}`);
  await page.getByRole("button", { name: "Request usage review" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Review requested");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Run reminders now" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Reminder run complete");
  await expect(page.getByText("initial · local").first()).toBeVisible();
  await login(page, "staff");
  await page.getByRole("link", { name: /Usage Reviews/ }).click();
  await expect(page).toHaveURL(/\/reviews$/);
  await page.getByRole("link", { name: softwareName, exact: true }).click();
  await page.getByLabel("Still Needed").check();
  await page
    .getByLabel("Comment (optional)")
    .fill("Used weekly by the demo team.");
  await page.getByRole("button", { name: "Submit usage confirmation" }).click();
  await expect(page.getByText("Used weekly by the demo team.")).toBeVisible();
});
test("finance records expenses and downloads safe, complete CSV and Excel reports", async ({
  page,
}) => {
  await login(page, "finance");
  await page.getByRole("link", { name: "Finance Centre", exact: true }).click();
  await page.getByText("+ Record a confirmed expense", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Software", exact: true })
    .selectOption(softwareId);
  await page.getByLabel("Amount excluding tax", { exact: true }).fill("123.45");
  await page.getByLabel("Tax recorded").fill("6.17");
  await page
    .getByLabel("Invoice reference", { exact: true })
    .fill(`DEMO-INVOICE-${suffix}`);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await expect(
    page.getByText(`DEMO-INVOICE-${suffix}`, { exact: true }),
  ).toBeVisible();
  const csvWait = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV", exact: true }).click();
  const csvFile = await csvWait;
  const csvText = await readFile((await csvFile.path())!, "utf8");
  expect(csvText).toContain(`'=Demo Integration Tool ${suffix}`);
  const xlsxWait = page.waitForEvent("download");
  await page.getByRole("link", { name: "Excel", exact: true }).click();
  const xlsx = await xlsxWait;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await xlsx.path())!);
  expect(book.worksheets[0].rowCount).toBeGreaterThan(8);
  expect(book.worksheets[0].getColumn("B").values).toContain(
    `'=Demo Integration Tool ${suffix}`,
  );
  await page
    .getByRole("combobox", { name: "Report", exact: true })
    .selectOption("expenses");
  await page.getByRole("button", { name: "Apply filters" }).click();
  const expenseWait = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV", exact: true }).click();
  const file = await expenseWait;
  const text = await readFile((await file.path())!, "utf8");
  expect(text).toContain(`DEMO-INVOICE-${suffix}`);
  expect(text).toContain('"129.62"');
  const row = page
    .locator("tbody tr")
    .filter({ hasText: `DEMO-INVOICE-${suffix}` });
  await row.getByRole("link", { name: "Correct" }).click();
  await page.getByLabel("Tax", { exact: true }).fill("6.00");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page).toHaveURL(/finance$/);
});
test("staff cannot export finance data or read other departments; mobile navigation works", async ({
  page,
}) => {
  await login(page, "staff");
  expect((await page.request.get("/api/exports")).status()).toBe(403);
  await page.goto("/finance");
  await expect(page).toHaveURL(/dashboard/);
  const client = createClient(
    config.API_URL,
    config.PUBLISHABLE_KEY || config.ANON_KEY,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({
    email: emails.staff,
    password: secret,
  });
  const { data } = await client
    .from("software_subscriptions")
    .select("team_id");
  expect(data?.every((row) => row.team_id === team)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("link", { name: "Upcoming Renewals", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Upcoming renewals" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/renewals-mobile.png",
    fullPage: true,
  });
});
test("cancellation/archive confirmations preserve expense history", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto(`/software/${softwareId}`);
  await page.getByRole("button", { name: "Mark cancelled" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Complete cancellation with the vendor separately",
  );
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator(".heading-actions .status")).toHaveText(
    "cancelled",
  );
  await page.getByRole("button", { name: "Archive record" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator(".heading-actions .status")).toHaveText("archived");
  await page.goto("/finance");
  await expect(
    page.getByText(`DEMO-INVOICE-${suffix}`, { exact: true }),
  ).toBeVisible();
});

test("password reset email works for a verified pending account without granting inventory access", async ({
  page,
}) => {
  const email = `e2e-reset-${suffix}@caedm.ca`;
  await checked(
    await admin.auth.admin.createUser({
      email,
      password: secret,
      email_confirm: true,
      user_metadata: { full_name: "Reset Test Employee" },
    }),
  );
  await page.goto("/forgot-password");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  let html = "";
  await expect
    .poll(async () => {
      const list = await (
        await fetch(
          `${config.MAILPIT_URL || config.INBUCKET_URL}/api/v1/messages`,
        )
      ).json();
      const message = list.messages?.find((m: { To: { Address: string }[] }) =>
        m.To?.some((t) => t.Address === email),
      );
      if (message) {
        const detail = await (
          await fetch(
            `${config.MAILPIT_URL || config.INBUCKET_URL}/api/v1/message/${message.ID}`,
          )
        ).json();
        html = detail.HTML || detail.Text || "";
      }
      return Boolean(html);
    })
    .toBe(true);
  const match = html.match(/https?:[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+/);
  expect(match).toBeTruthy();
  const link = new URL(match![0].replaceAll("&amp;", "&"));
  const token = link.searchParams.get("token");
  expect(token).toBeTruthy();
  await page.goto(
    `/auth/confirm?type=recovery&token_hash=${encodeURIComponent(token!)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();
  const replacement = secret + "Updated9";
  await page.getByLabel("New password", { exact: true }).fill(replacement);
  await page.getByLabel("Confirm password").fill(replacement);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("Password updated");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/pending-approval/);
  const client = createClient(
    config.API_URL,
    config.PUBLISHABLE_KEY || config.ANON_KEY,
    { auth: { persistSession: false } },
  );
  expect(
    (await client.auth.signInWithPassword({ email, password: replacement }))
      .error,
  ).toBeNull();
  await page.goto("/auth/callback?code=invalid");
  await expect(
    page.getByRole("alert").filter({ hasText: "invalid or expired" }),
  ).toBeVisible();
});

async function capturedInvitation(email: string, previousId?: string) {
  let captured:
    | {
        id: string;
        url: string;
        from: { Name: string; Address: string };
        html: string;
      }
    | undefined;
  await expect
    .poll(async () => {
      const list = await (
        await fetch(
          `${config.MAILPIT_URL || config.INBUCKET_URL}/api/v1/messages`,
        )
      ).json();
      const message = list.messages?.find(
        (m: { ID: string; Subject: string; To: { Address: string }[] }) =>
          m.ID !== previousId &&
          m.Subject === "Invitation from CAEDM Software Hub" &&
          m.To.some((t) => t.Address === email),
      );
      if (!message) return false;
      const detail = await (
        await fetch(
          `${config.MAILPIT_URL || config.INBUCKET_URL}/api/v1/message/${message.ID}`,
        )
      ).json();
      const html: string = detail.HTML || detail.Text || "";
      const match = html.match(
        /http:\/\/localhost:3100\/accept-invitation#token=[a-f0-9]{64}/,
      );
      if (!match) return false;
      captured = { id: message.ID, url: match[0], from: detail.From, html };
      return true;
    })
    .toBe(true);
  return captured!;
}
async function sendEmployeeInvitation(page: Page, email: string) {
  await login(page, "admin");
  await page.goto("/team");
  const section = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Invite an employee",
      exact: true,
    }),
  });
  await section
    .getByLabel("Employee name", { exact: true })
    .fill("Invited Pilot Employee");
  await section.getByLabel("Employee work email").fill(email);
  await section.getByLabel("Invitation department").selectOption(team);
  await section
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(section.getByRole("status")).toContainText("Invitation sent");
}
test("administrator invitation sends branded mail and requires password setup before department access", async ({
  page,
  browser,
  request,
}) => {
  const email = `e2e-invited-${suffix}@caedm.ca`;
  await sendEmployeeInvitation(page, email);
  const mail = await capturedInvitation(email);
  expect(mail.from.Name).toBe("CAEDM Software Hub");
  expect(mail.html).toContain("Accept invitation");
  const { data: before } = await admin
    .from("employee_invitations")
    .select("id,status,token_hash")
    .eq("email", email)
    .single();
  expect(before!.status).toBe("pending");
  expect(mail.url).not.toContain(before!.token_hash);
  expect((await request.get("/accept-invitation")).status()).toBe(200);
  expect(
    (
      await admin
        .from("employee_invitations")
        .select("status")
        .eq("email", email)
        .single()
    ).data!.status,
  ).toBe("pending");
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await recipient.goto(mail.url);
    await expect(
      recipient.getByRole("heading", { name: "Set up your account" }),
    ).toBeVisible();
    await expect(recipient).toHaveURL(/\/accept-invitation$/);
    const chosenPassword = secret + "Invitation9";
    await recipient
      .getByLabel("New password", { exact: true })
      .fill(chosenPassword);
    await recipient.getByLabel("Confirm password").fill(chosenPassword);
    await recipient
      .getByRole("button", { name: "Accept invitation and set password" })
      .click();
    await expect(recipient.getByRole("status")).toContainText(
      "Your account is ready",
    );
    await recipient
      .getByRole("link", { name: "Sign in to your workspace" })
      .click();
    await recipient.getByLabel("Work email").fill(email);
    await recipient
      .getByLabel("Password", { exact: true })
      .fill(chosenPassword);
    await recipient
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(recipient).toHaveURL(/dashboard/);
    expect(
      (
        await admin
          .from("employee_invitations")
          .select("status")
          .eq("email", email)
          .single()
      ).data!.status,
    ).toBe("accepted");
    const client = createClient(
      config.API_URL,
      config.PUBLISHABLE_KEY || config.ANON_KEY,
      { auth: { persistSession: false } },
    );
    const signed = await checked(
      await client.auth.signInWithPassword({ email, password: chosenPassword }),
    );
    const member = await checked(
      await client
        .from("team_members")
        .select("team_id,can_manage")
        .eq("profile_id", signed.user!.id),
    );
    expect(member).toEqual([{ team_id: team, can_manage: false }]);
    expect(
      (await client.from("employee_invitations").select("id")).data,
    ).toEqual([]);
    await recipient.goto("/team");
    await expect(recipient).toHaveURL(/dashboard/);
    await recipient.goto(mail.url);
    await recipient
      .getByLabel("New password", { exact: true })
      .fill(chosenPassword);
    await recipient.getByLabel("Confirm password").fill(chosenPassword);
    await recipient
      .getByRole("button", { name: "Accept invitation and set password" })
      .click();
    await expect(recipient.getByRole("main").getByRole("alert")).toContainText(
      "invalid",
    );
  } finally {
    await context.close();
  }
});
test("resending invalidates old invitation links and revocation blocks the latest link", async ({
  page,
  browser,
}) => {
  const email = `e2e-revoked-invite-${suffix}@caedm.ca`;
  await sendEmployeeInvitation(page, email);
  const first = await capturedInvitation(email);
  const invite = await checked(
    await admin
      .from("employee_invitations")
      .select("id")
      .eq("email", email)
      .single(),
  );
  if (!invite) throw new Error("The test invitation was not created.");
  await checked(
    await admin
      .from("employee_invitations")
      .update({ last_sent_at: new Date(Date.now() - 120000).toISOString() })
      .eq("id", invite.id)
      .select(),
  );
  const section = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Employee invitations",
      exact: true,
    }),
  });
  const row = section.locator("article").filter({ hasText: email });
  await row.getByRole("button", { name: "Resend invitation" }).click();
  await expect(row.getByRole("status")).toContainText(
    "A new invitation was sent",
  );
  const second = await capturedInvitation(email, first.id);
  expect(second.url).not.toBe(first.url);
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await recipient.goto(first.url);
    await recipient
      .getByLabel("New password", { exact: true })
      .fill(secret + "Invite9");
    await recipient.getByLabel("Confirm password").fill(secret + "Invite9");
    await recipient
      .getByRole("button", { name: "Accept invitation and set password" })
      .click();
    await expect(recipient.getByRole("main").getByRole("alert")).toContainText(
      "invalid",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Revoke invitation" }).click();
    await expect(row.getByText("Revoked", { exact: true })).toBeVisible();
    await recipient.goto(second.url);
    await recipient
      .getByLabel("New password", { exact: true })
      .fill(secret + "Invite9");
    await recipient.getByLabel("Confirm password").fill(secret + "Invite9");
    await recipient
      .getByRole("button", { name: "Accept invitation and set password" })
      .click();
    await expect(recipient.getByRole("main").getByRole("alert")).toContainText(
      "invalid",
    );
    expect(
      (
        await admin
          .from("employee_invitations")
          .select("status")
          .eq("id", invite.id)
          .single()
      ).data!.status,
    ).toBe("revoked");
  } finally {
    await context.close();
  }
});

test("CAEDM logo and searchable public help are accessible on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/login");
  const logo = page.getByRole("img", {
    name: "The Catholic Archdiocese of Edmonton",
  });
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const trigger = page.getByRole("button", { name: "Open help", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "How can we help?" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("searchbox", { name: "Search help" });
  await expect(search).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Administration", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator("details[open] summary")).toContainText(
    "How do I sign in?",
  );
  await search.fill("no-matching-help-topic-12345");
  await expect(
    dialog.getByRole("heading", { name: "No matching guidance" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Clear search and topics" }).click();
  await expect(search).toHaveValue("");
  await search.fill("forgotten password");
  await expect(dialog.locator("summary")).toContainText([
    "How do I reset a forgotten password?",
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    false,
  );
  await page.screenshot({
    path: ".artifacts/branding-help-login-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close help", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(search).toHaveValue("");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: ".artifacts/branding-login-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
});

test("workspace help follows the current page and shows guidance for each role", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/team");
  await expect(
    page.getByRole("img", { name: "The Catholic Archdiocese of Edmonton" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open help", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "How can we help?" });
  await expect(dialog.locator("details[open] summary")).toContainText(
    "How do I invite an employee",
  );
  await dialog
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await dialog.getByRole("searchbox", { name: "Search help" }).fill("resend");
  await expect(
    dialog.getByText("How do I resend or revoke an invitation?", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: ".artifacts/branding-help-admin-desktop.png",
    fullPage: false,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await login(page, "finance");
  await page.goto("/finance");
  await page.getByRole("button", { name: "Open help", exact: true }).click();
  await expect(dialog.locator("details[open] summary")).toContainText(
    "How do I record and correct an expense?",
  );
  await expect(
    dialog.getByRole("button", { name: "Finance", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Administration", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await login(page, "staff");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open help", exact: true }).click();
  await expect(dialog.locator("details[open] summary")).toContainText(
    "What do the dashboard numbers mean?",
  );
  await expect(
    dialog.getByRole("button", { name: "Finance", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Administration", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("searchbox", { name: "Search help" })
    .fill("manage permission");
  await expect(
    dialog.getByText("Why can I see a record but not change it?", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: ".artifacts/branding-help-staff-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(
    page.getByRole("img", { name: "The Catholic Archdiocese of Edmonton" }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: ".artifacts/branding-navigation-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
});
