import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";

async function openReference(page: Page, field: string, title: string) {
  const dropdown = page.getByRole("combobox", { name: field, exact: true });
  await dropdown.focus();
  await dropdown.selectOption("__create__");
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
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
  await page.getByRole("link", { name: /Finance Centre/ }).click();
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
  const originalViewport = page.viewportSize();
  await section.screenshot({
    path: ".artifacts/invitation-form-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const submit = section.getByRole("button", {
    name: "Send invitation",
    exact: true,
  });
  expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await section.screenshot({
    path: ".artifacts/invitation-form-mobile.png",
    animations: "disabled",
  });
  if (originalViewport) await page.setViewportSize(originalViewport);
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
    const emailButton = preview.getByRole("link", {
      name: "Accept invitation",
      exact: true,
    });
    const restingEmailButton = await emailButton.boundingBox();
    expect(restingEmailButton!.height).toBe(44);
    // Reproduce a mail viewer applying generic blue link hover styling.
    await preview.addStyleTag({
      content: "a:hover { color:blue !important; }",
    });
    await emailButton.hover();
    await expect(emailButton).toHaveCSS("background-color", "rgb(104, 0, 44)");
    await expect(emailButton).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(emailButton.locator("span")).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    );
    expect(await emailButton.boundingBox()).toEqual(restingEmailButton);
    await emailButton.screenshot({
      path: ".artifacts/invitation-email-button-hover.png",
      animations: "disabled",
    });
    await emailButton.focus();
    await expect(emailButton.locator("span")).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    );
    await emailButton.blur();
    await preview.mouse.move(0, 0);
    await preview.setViewportSize({ width: 390, height: 844 });
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const mobileButton = await emailButton.boundingBox();
    const mobileAction = await preview.locator(".email-action").boundingBox();
    expect(mobileButton!.height).toBe(44);
    expect(Math.abs(mobileButton!.width - mobileAction!.width)).toBeLessThan(2);
    const departmentLabel = await preview
      .locator(".email-label")
      .first()
      .boundingBox();
    const departmentValue = await preview
      .locator(".email-value")
      .first()
      .boundingBox();
    const accessCard = await preview.locator(".email-access").boundingBox();
    expect(departmentValue!.width).toBeGreaterThanOrEqual(
      accessCard!.width - 3,
    );
    expect(departmentValue!.y).toBeGreaterThanOrEqual(
      departmentLabel!.y + departmentLabel!.height,
    );
    await preview.screenshot({
      path: ".artifacts/invitation-email-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    await preview.setViewportSize({ width: 320, height: 740 });
    await preview
      .locator(".email-value")
      .first()
      .evaluate((el) => {
        el.textContent =
          "Mission Advancement, Communications and Community Engagement";
      });
    await preview
      .locator(".email-value")
      .last()
      .evaluate((el) => {
        el.textContent = "a.very.long.employee.address.for.preview@caedm.ca";
      });
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
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
    const setupCard = recipient.locator(".invitation-accept-card");
    await setupCard.screenshot({
      path: ".artifacts/invitation-setup-desktop.png",
      animations: "disabled",
    });
    await recipient.setViewportSize({ width: 390, height: 844 });
    expect(
      await recipient.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await setupCard.screenshot({
      path: ".artifacts/invitation-setup-mobile.png",
      animations: "disabled",
    });
    await recipient.setViewportSize({ width: 1280, height: 720 });
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
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  const restingBounds = await signIn.boundingBox();
  await signIn.hover();
  await expect(signIn).toHaveCSS("background-color", "rgb(104, 0, 44)");
  await expect(signIn).toHaveCSS("color", "rgb(255, 255, 255)");
  expect(await signIn.boundingBox()).toEqual(restingBounds);
  await signIn.focus();
  await expect(signIn).toBeFocused();
  await expect(signIn).not.toHaveCSS("box-shadow", "none");
  await page.mouse.move(0, 0);
  await signIn.blur();
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
    page.getByRole("link", { name: /Finance Centre/ }),
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

test("reference dropdowns prioritize Add and duplicates show accessible, motion-aware errors without losing the draft", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/software/new");
  await page
    .getByLabel("Software name", { exact: true })
    .fill("Duplicate feedback draft");
  for (const field of [
    "Vendor",
    "Category",
    "Department",
    "Responsible employee",
    "Payment reference",
  ]) {
    const options = page
      .getByRole("combobox", { name: field, exact: true })
      .locator("option");
    await expect(options.nth(0)).toHaveAttribute("value", "");
    await expect(options.nth(1)).toHaveAttribute("value", "__create__");
    if (["Responsible employee", "Payment reference"].includes(field))
      await expect(options.nth(1)).toBeDisabled();
  }
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption(team);
  await page
    .getByRole("combobox", { name: "Responsible employee", exact: true })
    .selectOption(ids.staff);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() =>
    document.addEventListener("animationstart", (event) => {
      if (
        (event as AnimationEvent).animationName === "submission-error-shake"
      ) {
        const root = document.documentElement;
        root.dataset.errorShakes = String(
          Number(root.dataset.errorShakes || 0) + 1,
        );
      }
    }),
  );
  const vendor = await admin
    .from("vendors")
    .select("name")
    .eq("id", "20000000-0000-4000-8000-000000000001")
    .single();
  const department = await admin
    .from("teams")
    .select("name")
    .eq("id", team)
    .single();
  for (const [field, title, label, name] of [
    ["Vendor", "Add vendor", "Vendor name", vendor.data!.name],
    ["Category", "Add category", "Category name", "Productivity"],
    ["Department", "Add department", "Department name", department.data!.name],
  ]) {
    const dialog = await openReference(page, field, title);
    const input = dialog.getByLabel(label, { exact: true });
    await input.fill(`  ${name.toUpperCase()}  `);
    await dialog
      .getByRole("button", { name: `Save ${field.toLowerCase()}`, exact: true })
      .click();
    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText("already in the list");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    expect(await input.getAttribute("aria-describedby")).toBe(
      await alert.getAttribute("id"),
    );
    expect(
      await alert.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("submission-error-shake");
    if (field === "Category") {
      const shakes = Number(
        await page.locator("html").getAttribute("data-error-shakes"),
      );
      await dialog
        .getByRole("button", { name: "Save category", exact: true })
        .click();
      await expect
        .poll(async () =>
          Number(await page.locator("html").getAttribute("data-error-shakes")),
        )
        .toBeGreaterThan(shakes);
      await dialog.screenshot({
        path: ".artifacts/software-duplicate-error-desktop.png",
        animations: "disabled",
        caret: "initial",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await dialog.screenshot({
        path: ".artifacts/software-duplicate-error-mobile.png",
        animations: "disabled",
        caret: "initial",
      });
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await alert.evaluate((el) => getComputedStyle(el).animationName),
      ).toBe("none");
      await expect(alert).toBeVisible();
      await input.fill("Revised unsaved category");
      await expect(alert).toHaveCount(0);
      await expect(input).toHaveAttribute("aria-invalid", "false");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  const dialog = await openReference(
    page,
    "Responsible employee",
    "Add responsible employee",
  );
  await expect(
    dialog
      .getByRole("combobox", { name: "Active employee", exact: true })
      .locator(`option[value="${ids.staff}"]`),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Invite new employee", exact: true })
    .click();
  await dialog
    .getByLabel("Employee name", { exact: true })
    .fill("Existing employee");
  const email = dialog.getByLabel("Employee work email");
  await email.fill(emails.staff.toUpperCase());
  await dialog
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "employee email is already in the list",
  );
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveValue(emails.staff.toUpperCase());
  await dialog
    .getByRole("button", { name: "Back to software", exact: true })
    .click();
  await expect(page.getByLabel("Software name", { exact: true })).toHaveValue(
    "Duplicate feedback draft",
  );
  await expect(
    page.getByRole("combobox", { name: "Responsible employee", exact: true }),
  ).toHaveValue(ids.staff);
  expect(
    (
      await admin
        .from("employee_invitations")
        .select("id")
        .eq("email", emails.staff)
    ).data,
  ).toEqual([]);
  const help = page.getByRole("button", {
    name: "About Category",
    exact: true,
  });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tooltip")).toContainText(
    "changing case or surrounding spaces",
  );
});

test("concurrent signed-in reference inserts allow only one normalized name", async () => {
  const client = createClient(
    config.API_URL,
    config.PUBLISHABLE_KEY || config.ANON_KEY,
    { auth: { persistSession: false } },
  );
  await checked(
    await client.auth.signInWithPassword({
      email: emails.admin,
      password: secret,
    }),
  );
  try {
    const name = `Concurrent %_ reference ${suffix}`;
    const results = await Promise.all([
      client.from("vendors").insert({ name }),
      client.from("vendors").insert({ name: `  ${name.toUpperCase()}  ` }),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.code).toBe("23505");
  } finally {
    await client.auth.signOut();
  }
});

test("Add Software creates and selects references without losing the draft or bypassing employee onboarding", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/software/new");
  const draftName = `Inline editor software ${suffix}`;
  await page.getByLabel("Software name", { exact: true }).fill(draftName);
  await page.getByLabel("Cost centre", { exact: true }).fill("EDITOR-DRAFT");
  await page
    .getByRole("combobox", { name: "Vendor", exact: true })
    .selectOption("20000000-0000-4000-8000-000000000001");
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption(team);
  await page
    .getByRole("combobox", { name: "Responsible employee", exact: true })
    .selectOption(ids.staff);
  await page
    .getByRole("combobox", { name: "Payment reference", exact: true })
    .selectOption("30000000-0000-4000-8000-000000000001");
  let dialog = await openReference(page, "Vendor", "Add vendor");
  await expect(dialog.getByLabel("Vendor name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Vendor", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "Vendor", exact: true }),
  ).toHaveValue("20000000-0000-4000-8000-000000000001");
  await expect(page.getByLabel("Software name", { exact: true })).toHaveValue(
    draftName,
  );
  const vendorName = `Inline vendor ${suffix}`;
  dialog = await openReference(page, "Vendor", "Add vendor");
  await dialog.getByLabel("Vendor name").fill(vendorName);
  await dialog
    .getByRole("button", { name: "Save vendor", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .getByRole("combobox", { name: "Vendor", exact: true })
      .locator("option:checked"),
  ).toHaveText(vendorName);
  const categoryName = `Editor %_ Category ${suffix}`;
  dialog = await openReference(page, "Category", "Add category");
  await dialog.getByLabel("Category name").fill(categoryName);
  await dialog
    .getByRole("button", { name: "Save category", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  dialog = await openReference(page, "Category", "Add category");
  await dialog.getByLabel("Category name").fill(categoryName.toLowerCase());
  await dialog
    .getByRole("button", { name: "Save category", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("already in the list");
  await expect(dialog.getByLabel("Category name")).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue(categoryName);
  dialog = await openReference(page, "Department", "Add department");
  await dialog
    .getByLabel("Department name")
    .fill(`Editor department ${suffix}`);
  await dialog
    .getByRole("button", { name: "Save department", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const departmentId = await page
    .getByRole("combobox", { name: "Department", exact: true })
    .inputValue();
  expect(departmentId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(
    page.getByRole("combobox", { name: "Responsible employee", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Payment reference", exact: true }),
  ).toHaveValue("");
  dialog = await openReference(
    page,
    "Responsible employee",
    "Add responsible employee",
  );
  await dialog
    .getByRole("combobox", { name: "Active employee", exact: true })
    .selectOption(ids.staff);
  await dialog
    .getByRole("button", { name: "Add employee and select", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Responsible employee", exact: true }),
  ).toHaveValue(ids.staff);
  expect(
    (
      await admin
        .from("team_members")
        .select("can_manage")
        .eq("team_id", departmentId)
        .eq("profile_id", ids.staff)
        .single()
    ).data,
  ).toEqual({ can_manage: false });
  dialog = await openReference(
    page,
    "Payment reference",
    "Add payment reference",
  );
  await dialog.getByLabel("Reference nickname").fill(`Editor card ${suffix}`);
  await dialog.getByLabel("Card brand (optional)").fill("Visa");
  await dialog
    .getByLabel("Last four digits (optional)", { exact: true })
    .fill("12");
  await dialog
    .getByRole("button", { name: "Save payment reference", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Last four digits (optional)", { exact: true })
    .fill("2468");
  await dialog.screenshot({
    path: ".artifacts/software-payment-modal-desktop.png",
    animations: "disabled",
    caret: "initial",
  });
  await dialog
    .getByRole("button", { name: "Save payment reference", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .getByRole("combobox", { name: "Payment reference", exact: true })
      .locator("option:checked"),
  ).toContainText("2468");
  await expect(page.getByLabel("Cost centre", { exact: true })).toHaveValue(
    "EDITOR-DRAFT",
  );
  await page.getByLabel("Billing amount", { exact: true }).fill("89.45");
  await page.screenshot({
    path: ".artifacts/software-editor-desktop.png",
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  await page.locator(".form-section").first().screenshot({
    path: ".artifacts/software-basic-information-desktop.png",
    animations: "disabled",
    caret: "initial",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/software-editor-mobile.png",
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  await page.locator(".form-section").first().screenshot({
    path: ".artifacts/software-basic-information-mobile.png",
    animations: "disabled",
    caret: "initial",
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .getByRole("button", { name: "Save software", exact: true })
    .click();
  await expect(page).toHaveURL(/software\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: draftName, exact: true }),
  ).toBeVisible();
  const stored = await admin
    .from("software_subscriptions")
    .select("category,cost_centre,owner_id,team_id,amount")
    .eq("id", page.url().split("/").pop()!)
    .single();
  expect(stored.data).toMatchObject({
    category: categoryName,
    cost_centre: "EDITOR-DRAFT",
    owner_id: ids.staff,
    team_id: departmentId,
    amount: 89.45,
  });
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Add a vendor", exact: true }),
  ).toHaveCount(0);
});

test("Finance can add categories and non-card payment references but cannot add departments or employees", async ({
  page,
}) => {
  await login(page, "finance");
  await page.goto("/software/new");
  await page
    .getByLabel("Software name", { exact: true })
    .fill("Finance unsaved draft");
  await expect(
    page
      .getByRole("combobox", { name: "Department", exact: true })
      .locator('option[value="__create__"]'),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("combobox", { name: "Responsible employee", exact: true })
      .locator('option[value="__create__"]'),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption(team);
  let dialog = await openReference(page, "Category", "Add category");
  await dialog.getByLabel("Category name").fill(`Finance category ${suffix}`);
  await dialog
    .getByRole("button", { name: "Save category", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  dialog = await openReference(
    page,
    "Payment reference",
    "Add payment reference",
  );
  await dialog
    .getByLabel("Reference nickname")
    .fill(`Invoice reference ${suffix}`);
  await dialog
    .getByRole("button", { name: "Save payment reference", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .getByRole("combobox", { name: "Payment reference", exact: true })
      .locator("option:checked"),
  ).toHaveText(`Invoice reference ${suffix}`);
  await expect(page.getByLabel("Software name", { exact: true })).toHaveValue(
    "Finance unsaved draft",
  );
});

test("Staff retain software editing access without reference creation or employee administration", async ({
  page,
}) => {
  await login(page, "staff");
  await page.goto("/software/new");
  for (const name of [
    "Vendor",
    "Category",
    "Department",
    "Responsible employee",
    "Payment reference",
  ])
    await expect(
      page
        .getByRole("combobox", { name, exact: true })
        .locator('option[value="__create__"]'),
    ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save software", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Software name", { exact: true }).fill("Staff draft");
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption(team);
  await page
    .getByRole("combobox", { name: "Responsible employee", exact: true })
    .selectOption(ids.staff);
  await page
    .getByRole("button", { name: "About Responsible employee", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tooltip")).toContainText(
    "Ownership does not grant edit access",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).not.toBeVisible();
});

test("inline employee invitation uses the existing password setup flow and never selects an unapproved owner", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/software/new");
  await page
    .getByLabel("Software name", { exact: true })
    .fill("Draft before onboarding");
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption(team);
  const dialog = await openReference(
    page,
    "Responsible employee",
    "Add responsible employee",
  );
  await dialog
    .getByRole("button", { name: "Invite new employee", exact: true })
    .click();
  const email = `e2e-inline-invite-${suffix}@caedm.ca`;
  await dialog
    .getByLabel("Employee name", { exact: true })
    .fill("Inline invited employee");
  await dialog.getByLabel("Employee work email").fill(email);
  await expect(
    dialog.getByRole("combobox", {
      name: "Invitation department",
      exact: true,
    }),
  ).toHaveValue(team);
  await dialog
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Invitation sent");
  await capturedInvitation(email);
  const invite = await admin
    .from("employee_invitations")
    .select("role,team_id,status")
    .eq("email", email)
    .single();
  expect(invite.data).toEqual({
    role: "staff",
    team_id: team,
    status: "pending",
  });
  await dialog
    .getByLabel("Employee name", { exact: true })
    .fill("Inline invited employee");
  await dialog.getByLabel("Employee work email").fill(email);
  await dialog
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "already has an invitation in the list",
  );
  await expect(dialog.getByLabel("Employee work email")).toHaveValue(email);
  expect(
    (await admin.from("employee_invitations").select("id").eq("email", email))
      .data,
  ).toHaveLength(1);
  await dialog
    .getByRole("button", { name: "Back to software", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Software name", { exact: true })).toHaveValue(
    "Draft before onboarding",
  );
  await expect(
    page.getByRole("combobox", { name: "Responsible employee", exact: true }),
  ).toHaveValue("");
  await expect(
    page
      .getByRole("combobox", { name: "Responsible employee", exact: true })
      .getByRole("option", { name: "Inline invited employee", exact: true }),
  ).toHaveCount(0);
});

test("field information and reference dialogs support keyboard focus, Escape and mobile touch without losing draft values", async ({
  page,
  browser,
}) => {
  await login(page, "admin");
  await page.goto("/software/new");
  const help = page.getByRole("button", {
    name: "About Billing anchor date",
    exact: true,
  });
  await help.hover();
  await page.getByRole("tooltip").hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).not.toBeVisible();
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tooltip")).toContainText("month-end");
  await page.screenshot({
    path: ".artifacts/software-field-help-desktop.png",
    animations: "disabled",
    caret: "initial",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).not.toBeVisible();
  await expect(help).toBeFocused();
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption(team);
  const dialog = await openReference(
    page,
    "Payment reference",
    "Add payment reference",
  );
  const cardHelp = dialog.getByRole("button", {
    name: "About Last four digits",
    exact: true,
  });
  await page.mouse.move(0, 0);
  await cardHelp.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("tooltip")).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save payment reference", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close reference dialog", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({
    path: ".artifacts/software-payment-modal-mobile.png",
    animations: "disabled",
    caret: "initial",
  });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Payment reference", exact: true }),
  ).toBeFocused();
  const touch = await browser.newContext({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const mobile = await touch.newPage();
    await login(mobile, "admin");
    await mobile.goto("/software/new");
    await mobile
      .getByRole("button", { name: "About Billing amount", exact: true })
      .tap();
    const tooltip = mobile.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    const bounds = await tooltip.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await mobile.screenshot({
      path: ".artifacts/software-field-help-mobile.png",
      animations: "disabled",
      caret: "initial",
    });
    await mobile.getByLabel("Software name", { exact: true }).tap();
    await expect(tooltip).not.toBeVisible();
  } finally {
    await touch.close();
  }
});

test("software owners save personal billing timings, validation and opt-out without changing another employee", async ({
  page,
}) => {
  await login(page, "staff");
  await page.goto("/settings");
  const section = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Your billing reminders",
      exact: true,
    }),
  });
  const first = section.getByLabel(
    "First billing notice (days before billing)",
    { exact: true },
  );
  const second = section.getByLabel(
    "Second billing notice (days before billing)",
    { exact: true },
  );
  await expect(first).toHaveValue("14");
  await expect(second).toHaveValue("7");
  await first.fill("21");
  await second.fill("3");
  await section
    .getByRole("button", { name: "Save billing preferences", exact: true })
    .click();
  await expect(section.getByRole("status")).toContainText(
    "preferences are saved",
  );
  await page.reload();
  await expect(first).toHaveValue("21");
  await expect(second).toHaveValue("3");
  await first.fill("3");
  await second.fill("7");
  await section
    .getByRole("button", { name: "Save billing preferences", exact: true })
    .click();
  await expect(section.getByRole("alert")).toContainText(
    "first notice must be earlier",
  );
  await page.reload();
  await expect(first).toHaveValue("21");
  await section.getByRole("checkbox").uncheck();
  await section
    .getByRole("button", { name: "Save billing preferences", exact: true })
    .click();
  await expect(section.getByRole("status")).toBeVisible();
  await page.reload();
  await expect(section.getByRole("checkbox")).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await section.screenshot({
    path: ".artifacts/billing-preferences-mobile.png",
    animations: "disabled",
    caret: "initial",
  });
  await section
    .getByRole("button", { name: "Restore defaults", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Save billing preferences", exact: true })
    .click();
  await expect(section.getByRole("status")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, "admin");
  await page.goto("/settings");
  await expect(first).toHaveValue("14");
  await expect(second).toHaveValue("7");
  expect((await page.request.get("/api/jobs/reminders")).status()).toBe(401);
});

async function billingFixture(days: number) {
  const businessDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const next = new Date(businessDay + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + days);
  const date = next.toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("software_subscriptions")
    .insert({
      name: `Billing ${days} day ${suffix}`,
      vendor_id: "20000000-0000-4000-8000-000000000001",
      team_id: team,
      owner_id: ids.staff,
      category: "Productivity",
      purchase_date: businessDay,
      purchase_type: "subscription",
      amount: 123.45,
      currency: "CAD",
      billing_cycle: "monthly",
      billing_start_date: businessDay,
      next_billing_date: date,
      cancellation_notice_days: 30,
      last_reviewed_at: businessDay,
    })
    .select("id,name,next_billing_date")
    .single();
  if (error || !data)
    throw new Error("Local billing fixture could not be created");
  return data as { id: string; name: string; next_billing_date: string };
}
test("14-day and 7-day billing reminders deliver branded email exactly once through the real local worker", async ({
  page,
  browser,
}) => {
  const initial = await billingFixture(14),
    final = await billingFixture(7);
  await login(page, "admin");
  await page.goto("/settings");
  const run = async () => {
    await page
      .getByRole("button", { name: "Run reminders now", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Reminder run complete" }),
    ).toBeVisible({ timeout: 60000 });
  };
  const messages = async () => {
    const list = await (
      await fetch(
        `${config.MAILPIT_URL || config.INBUCKET_URL}/api/v1/messages?limit=1000`,
      )
    ).json();
    return (
      list.messages as {
        ID: string;
        Subject: string;
        To: { Address: string }[];
      }[]
    ).filter(
      (m) =>
        m.To.some((t) => t.Address === emails.staff) &&
        [initial.name, final.name].some((name) => m.Subject.endsWith(name)),
    );
  };
  await run();
  await expect
    .poll(async () => (await messages()).length, { timeout: 60000 })
    .toBe(2);
  const delivered = await messages();
  for (const [software, days] of [
    [initial, 14],
    [final, 7],
  ] as const) {
    const message = delivered.find((m) => m.Subject.endsWith(software.name))!;
    expect(message.Subject).toContain(`in ${days} days`);
    const detail = await (
      await fetch(
        `${config.MAILPIT_URL || config.INBUCKET_URL}/api/v1/message/${message.ID}`,
      )
    ).json();
    expect(detail.From.Name).toBe("CAEDM Software Hub");
    expect(detail.HTML).toContain("cid:caedm-logo@software-hub.caedm.ca");
    expect(detail.Text).toContain(software.next_billing_date);
    expect(detail.Text).toContain("CAD");
    expect(detail.Text).toContain(`/software/${software.id}`);
    if (days === 14) {
      const preview = await browser.newPage();
      const logo = await readFile("lib/assets/caedm-logo.png");
      await preview.setContent(
        detail.HTML.replaceAll(
          "cid:caedm-logo@software-hub.caedm.ca",
          `data:image/png;base64,${logo.toString("base64")}`,
        ),
      );
      await preview.screenshot({
        path: ".artifacts/billing-reminder-email-desktop.png",
        fullPage: true,
        animations: "disabled",
        caret: "initial",
      });
      await preview.setViewportSize({ width: 390, height: 844 });
      await preview.screenshot({
        path: ".artifacts/billing-reminder-email-mobile.png",
        fullPage: true,
        animations: "disabled",
        caret: "initial",
      });
      await preview.close();
    }
  }
  await run();
  expect(await messages()).toHaveLength(2);
});

test("Finance Centre Beta labels and Usage Review field help remain accessible on desktop and mobile", async ({
  page,
  browser,
}) => {
  await login(page, "finance");
  await page.goto("/finance");
  await expect(
    page
      .getByRole("link", { name: /Finance Centre/ })
      .getByText("Beta", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1 }).getByText("Beta", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".artifacts/finance-beta-desktop.png",
    fullPage: false,
    animations: "disabled",
    caret: "initial",
  });
  const software = await billingFixture(20);
  await checked(
    await admin.from("usage_reviews").insert({
      subscription_id: software.id,
      owner_id: ids.staff,
      renewal_date: software.next_billing_date,
      deadline: software.next_billing_date,
    }),
  );
  await login(page, "staff");
  await page.goto("/reviews");
  const help = page.getByRole("button", {
    name: "About Decision deadline",
    exact: true,
  });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tooltip")).toContainText(
    "cancellation notice period",
  );
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  await page.getByRole("link", { name: software.name, exact: true }).click();
  const responseHelp = page.getByRole("button", {
    name: "About Usage response",
    exact: true,
  });
  await responseHelp.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tooltip")).toContainText(
    "does not cancel anything automatically",
  );
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: ".artifacts/usage-review-help-desktop.png",
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  const mobile = await browser.newContext({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const tab = await mobile.newPage();
    await login(tab, "staff");
    await tab.goto("/reviews");
    await tab
      .getByRole("button", { name: "About Usage reviews", exact: true })
      .tap();
    await expect(tab.getByRole("tooltip")).toBeVisible();
    await tab.screenshot({
      path: ".artifacts/usage-review-help-mobile.png",
      fullPage: false,
      animations: "disabled",
      caret: "initial",
    });
  } finally {
    await mobile.close();
  }
});
