import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  super_admin: `e2e-super-admin-${suffix}@caedm.ca`,
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
  for (const role of ["admin", "finance", "staff", "super_admin"] as const) {
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
    if (role === "super_admin")
      await checked(
        await admin
          .from("profiles")
          .update({ status: "active" })
          .eq("id", ids[role]),
      );
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
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
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
  const review = await checked(
    await admin
      .from("usage_reviews")
      .select("id")
      .eq("subscription_id", softwareId)
      .single(),
  );
  if (!review) throw new Error("The test review was not created.");
  // Reused local databases can have older batches ahead of this run's notification.
  await expect
    .poll(
      async () => {
        await page.getByRole("button", { name: "Run reminders now" }).click();
        await page
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "Reminder run complete",
        );
        const logs = await checked(
          await admin
            .from("notification_logs")
            .select("status,provider")
            .eq("review_id", review.id)
            .eq("kind", "initial"),
        );
        return logs?.some(
          (log) => log.status === "sent" && log.provider === "local",
        );
      },
      { timeout: 60000, intervals: [100, 300] },
    )
    .toBe(true);
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
  expect(mail.html).toContain('src="cid:caedm-logo@software-hub.caedm.ca"');
  expect(mail.html).toContain("#860038");
  expect(mail.html).toContain("#E5C047");
  expect(mail.html).toContain("Edmonton time");
  const rawInvitation = await (
    await fetch(
      `${config.MAILPIT_URL || config.INBUCKET_URL}/api/v1/message/${mail.id}/raw`,
    )
  ).text();
  expect(
    rawInvitation.includes("Content-ID: <caedm-logo@software-hub.caedm.ca>"),
  ).toBe(true);
  expect(rawInvitation.includes("Content-Type: image/png")).toBe(true);
  expect(rawInvitation.includes("Content-Disposition: inline;")).toBe(true);
  expect(rawInvitation.includes("Reply-To: ruban.peppin@caedm.ca")).toBe(true);
  // Preview with an inert placeholder link rather than persist a working token.
  const logo = await readFile("lib/assets/caedm-logo.png");
  const previewHtml = mail.html
    .replaceAll(
      mail.url,
      "https://caedm-software-hub.vercel.app/accept-invitation#token=" +
        "0".repeat(64),
    )
    .replaceAll(email, "employee@caedm.ca")
    .replace(
      "cid:caedm-logo@software-hub.caedm.ca",
      `data:image/png;base64,${logo.toString("base64")}`,
    );
  await writeFile(".artifacts/invitation-email-preview.html", previewHtml);
  const previewContext = await browser.newContext();
  try {
    const preview = await previewContext.newPage();
    await preview.setViewportSize({ width: 760, height: 1000 });
    await preview.setContent(previewHtml);
    await expect(
      preview.getByRole("img", {
        name: "The Catholic Archdiocese of Edmonton",
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        preview
          .locator("img")
          .evaluate((el) => (el as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await preview.screenshot({
      path: ".artifacts/invitation-email-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await preview.setViewportSize({ width: 390, height: 844 });
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview.screenshot({
      path: ".artifacts/invitation-email-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    await preview.locator("img").evaluate((el) => el.remove());
    await expect(
      preview.getByRole("heading", { name: "You are invited to Software Hub" }),
    ).toBeVisible();
    await expect(
      preview.getByRole("link", { name: "Accept invitation", exact: true }),
    ).toBeVisible();
  } finally {
    await previewContext.close();
  }
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
  await expect(
    dialog.getByRole("link", { name: "ruban.peppin@caedm.ca", exact: true }),
  ).toHaveAttribute("href", "mailto:ruban.peppin@caedm.ca");
  await expect(
    dialog.getByRole("link", { name: "Request a Feature", exact: true }),
  ).toHaveAttribute("href", "/request-feature");
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

async function fillFeatureRequest(page: Page, title: string) {
  await page.getByLabel("Request title", { exact: true }).fill(title);
  await page
    .getByLabel("Area of the application")
    .selectOption("Upcoming Renewals");
  await page
    .getByLabel("Department (optional)", { exact: true })
    .fill("Mission Services");
  await page
    .getByLabel("Problem or need", { exact: true })
    .fill(
      "Our department needs an easier way to coordinate renewal decisions with the responsible owners.",
    );
  await page
    .getByLabel("Proposed improvement", { exact: true })
    .fill(
      "Add a shared department renewal planning view with decision dates and owner reminders.",
    );
  await page
    .getByLabel("Expected benefit", { exact: true })
    .fill(
      "This would reduce manual follow-up and help our team decide before cancellation deadlines.",
    );
}
async function featureEmail(title: string, replyTo: string) {
  let message:
    { ID: string; Subject: string; To: { Address: string }[] } | undefined;
  const mailbox = config.MAILPIT_URL || config.INBUCKET_URL;
  await expect
    .poll(async () => {
      const list = await (await fetch(`${mailbox}/api/v1/messages`)).json();
      message = list.messages?.find(
        (m: { Subject: string }) => m.Subject === `Feature request: ${title}`,
      );
      return !!message;
    })
    .toBe(true);
  expect(message!.To).toEqual([
    expect.objectContaining({ Address: "ruban.peppin@caedm.ca" }),
  ]);
  const raw = await (
    await fetch(`${mailbox}/api/v1/message/${message!.ID}/raw`)
  ).text();
  expect(raw).toContain(`Reply-To: ${replyTo}`);
  const detail = await (
    await fetch(`${mailbox}/api/v1/message/${message!.ID}`)
  ).json();
  expect(detail.HTML).toContain("Mission Services");
  expect(detail.HTML).toContain("Proposed improvement");
}
async function runFeatureEmailJob(page: Page) {
  const response = await page.request.post("/api/jobs/feature-requests", {
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET || "local-development-job-secret-at-least-32-characters"}`,
    },
  });
  expect(response.status()).toBe(200);
}
test("an active employee requests a feature through Help and Ruban receives a structured local email", async ({
  page,
}) => {
  expect(
    (await page.request.get("/request-feature", { maxRedirects: 0 })).status(),
  ).toBe(307);
  expect((await page.request.post("/api/jobs/feature-requests")).status()).toBe(
    401,
  );
  await login(page, "staff");
  await page.getByRole("button", { name: "Open help", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Request a Feature", exact: true })
    .click();
  await expect(page).toHaveURL(/request-feature/);
  await expect(
    page.getByText(`Submitting as Test staff`, { exact: true }),
  ).toBeVisible();
  const title = `Renewal planning for the department ${suffix}`;
  await fillFeatureRequest(page, title);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".artifacts/feature-request-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/feature-request-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Submit feature request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Thank you for your idea" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "saved and queued for email delivery to Ruban Peppin",
  );
  const saved = await checked(
    await admin
      .from("feature_requests")
      .select("id,requester_id,requester_email,delivery_status")
      .eq("title", title)
      .single(),
  );
  if (!saved) throw new Error("The submitted feature request was not saved.");
  expect(saved).toMatchObject({
    requester_id: ids.staff,
    requester_email: emails.staff,
    delivery_status: "pending",
  });
  await runFeatureEmailJob(page);
  await featureEmail(title, emails.staff);
  await page.reload();
  await expect(page.getByText("Email sent", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Your recent requests" })
      .getByText(title, { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Request title", { exact: true })).toHaveValue(
    "",
  );
  // Simulate a retained failed delivery in this isolated local test record.
  await checked(
    await admin
      .from("feature_requests")
      .update({
        delivery_status: "failed",
        email_sent_at: null,
        delivery_error: "Email delivery failed; retry later.",
        last_attempt_at: new Date(Date.now() - 120000).toISOString(),
      })
      .eq("id", saved.id),
  );
  await page.reload();
  const row = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await row
    .getByRole("button", { name: "Retry email delivery", exact: true })
    .click();
  await expect(row.getByRole("status")).toContainText(
    "queued for email delivery",
  );
  await runFeatureEmailJob(page);
  await page.reload();
  await expect(page.getByText("Email sent", { exact: true })).toBeVisible();
  expect(
    (
      await admin
        .from("feature_requests")
        .select("delivery_attempts")
        .eq("id", saved.id)
        .single()
    ).data!.delivery_attempts,
  ).toBe(2);
});
test("a verified employee awaiting approval can request a feature without gaining workspace access", async ({
  page,
}) => {
  const email = `e2e-feature-pending-${suffix}@caedm.ca`;
  const result = await checked(
    await admin.auth.admin.createUser({
      email,
      password: secret,
      email_confirm: true,
      user_metadata: { full_name: "Pending Feature Requester" },
    }),
  );
  const requesterId = result.user!.id;
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/pending-approval/);
  await page.getByRole("button", { name: "Open help", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Request a Feature", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Request a Feature", exact: true }),
  ).toBeVisible();
  const title = `Pending employee workflow suggestion ${suffix}`;
  await fillFeatureRequest(page, title);
  await page
    .getByRole("button", { name: "Submit feature request", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "saved and queued for email delivery to Ruban Peppin",
  );
  await runFeatureEmailJob(page);
  await featureEmail(title, email);
  expect(
    (
      await admin
        .from("profiles")
        .select("status")
        .eq("id", requesterId)
        .single()
    ).data!.status,
  ).toBe("pending_approval");
  const client = createClient(
    config.API_URL,
    config.PUBLISHABLE_KEY || config.ANON_KEY,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({ email, password: secret });
  expect(
    (await client.from("software_subscriptions").select("id")).data,
  ).toEqual([]);
  expect(
    (
      await client
        .from("feature_requests")
        .select("id")
        .eq("requester_id", ids.staff)
    ).data,
  ).toEqual([]);
  expect(
    (
      await client
        .from("feature_requests")
        .select("id")
        .eq("requester_id", requesterId)
    ).data,
  ).toHaveLength(1);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/pending-approval/);
});

test("ordinary Admin cannot grant Super Admin or change protected accounts", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/team");
  const elevated = page
    .locator("article")
    .filter({ hasText: emails.super_admin });
  await expect(
    elevated.getByRole("combobox", { name: "Role", exact: true }),
  ).toHaveCount(0);
  await expect(
    elevated.getByText("Only a Super Admin can change this account's access.", {
      exact: true,
    }),
  ).toBeVisible();
  const own = page.locator("article").filter({ hasText: emails.admin });
  await expect(
    own
      .getByRole("combobox", { name: "Role", exact: true })
      .locator('option[value="super_admin"]'),
  ).toHaveCount(0);
  const client = createClient(
    config.API_URL,
    config.PUBLISHABLE_KEY || config.ANON_KEY,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({
    email: emails.admin,
    password: secret,
  });
  expect(
    (
      await client
        .from("profiles")
        .update({ role: "super_admin" })
        .eq("id", ids.admin)
        .select("id")
    ).error,
  ).toBeTruthy();
  expect(
    (
      await client
        .from("profiles")
        .update({ role: "staff", status: "suspended" })
        .eq("id", ids.super_admin)
        .select("id")
    ).data,
  ).toEqual([]);
  const protection = await client.rpc("get_developer_protection");
  expect(protection.error).toBeNull();
  if (protection.data) {
    expect(
      (
        await client
          .from("profiles")
          .update({ role: "staff", status: "deactivated" })
          .eq("id", protection.data)
          .select("id")
      ).data,
    ).toEqual([]);
    await expect(
      page.getByText("Protected developer Super Admin", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await client.rpc("remove_membership", {
          department: team,
          employee: protection.data,
        })
      ).error,
    ).toBeTruthy();
  }
});

test("Super Admin can grant and revoke elevated access through Team Management", async ({
  page,
}) => {
  const email = `e2e-role-recipient-${suffix}@caedm.ca`;
  const created = await checked(
    await admin.auth.admin.createUser({
      email,
      password: secret,
      email_confirm: true,
      user_metadata: { full_name: "Role Grant Recipient", role: "super_admin" },
    }),
  );
  const employeeId = created.user!.id;
  await checked(
    await admin
      .from("profiles")
      .update({ status: "active" })
      .eq("id", employeeId),
  );
  await login(page, "super_admin");
  await expect(
    page.getByRole("link", { name: "Team Management", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Finance Centre", exact: true }),
  ).toBeVisible();
  await page.goto("/team");
  const employee = page.locator("article").filter({ hasText: email });
  await employee
    .getByRole("combobox", { name: "Role", exact: true })
    .selectOption("super_admin");
  page.once("dialog", (dialog) => dialog.accept());
  await employee
    .getByRole("button", { name: "Update access", exact: true })
    .click();
  await expect(employee.getByRole("status")).toContainText("Changes saved");
  expect(
    (await admin.from("profiles").select("role").eq("id", employeeId).single())
      .data!.role,
  ).toBe("super_admin");
  await page.screenshot({
    path: ".artifacts/super-admin-team-desktop.png",
    fullPage: true,
  });
  await employee
    .getByRole("combobox", { name: "Role", exact: true })
    .selectOption("finance");
  page.once("dialog", (dialog) => dialog.accept());
  await employee
    .getByRole("button", { name: "Update access", exact: true })
    .click();
  await expect(
    employee.getByRole("combobox", { name: "Role", exact: true }),
  ).toHaveValue("finance");
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("profiles")
            .select("role")
            .eq("id", employeeId)
            .single()
        ).data?.role,
    )
    .toBe("finance");
  await page.getByRole("button", { name: "Open help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "How can we help?" });
  await help
    .getByRole("searchbox", { name: "Search help" })
    .fill("grant revoke super admin");
  await expect(
    help.getByText("How do I grant or revoke Super Admin access?", {
      exact: true,
    }),
  ).toBeVisible();
});

test("Help explains all four roles with an accessible comparison on desktop and mobile", async ({
  page,
}) => {
  await login(page, "staff");
  await page.getByRole("button", { name: "Open help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "How can we help?" });
  await help
    .getByRole("button", { name: "Roles & access", exact: true })
    .click();
  await help
    .getByRole("searchbox", { name: "Search help" })
    .fill("difference between");
  await expect(
    help.getByText(
      "What is the difference between Super Admin, Admin, Finance and Staff?",
      { exact: true },
    ),
  ).toBeVisible();
  const comparison = help.getByRole("region", {
    name: "Role permissions comparison",
  });
  await expect(comparison.getByRole("columnheader")).toHaveText([
    "Capability",
    "Super Admin",
    "Admin",
    "Finance",
    "Staff",
  ]);
  await expect(
    comparison.getByRole("rowheader", {
      name: "Record/correct expenses and export reports",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    help.getByText("How do I grant or revoke Super Admin access?", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".artifacts/roles-help-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await comparison.evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  expect(
    await comparison
      .getByRole("rowheader")
      .evaluateAll((cells) =>
        cells.every((cell) => cell.scrollWidth <= cell.clientWidth),
      ),
  ).toBe(true);
  await comparison.focus();
  await page.screenshot({
    path: ".artifacts/roles-help-mobile.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(help).not.toBeVisible();
});
