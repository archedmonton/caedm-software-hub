# CAEDM Software Hub

Internal software stewardship for the Catholic Archdiocese of Edmonton. Built with Next.js App Router, strict TypeScript, React, Tailwind, shadcn/ui, Supabase PostgreSQL/Auth/SSR, Zod, React Hook Form, TanStack Table, Recharts, date-fns, ExcelJS, Nodemailer, Vitest, and Playwright.

## Run locally

Requires Node.js 22.12+ (tested with Node 24), npm, and Docker Desktop running Linux containers.

**Before `npm ci`, stop every development server for this repository with Ctrl+C.** On Windows, a running Next.js process can lock its native compiler file. If installation fails with `EPERM unlink ...next-swc...node`, the dependency folder may be incomplete: stop the server, rerun `npm ci --include=dev`, and wait for installation to finish before starting the app.

```powershell
npm ci
npx supabase start
npm run dev:local
```

Open **http://localhost:3100**. Local Studio is at http://127.0.0.1:54323 and the email inbox is at http://127.0.0.1:54324. `dev:local` reads only this project's local Supabase CLI configuration into the child server's environment. It refuses non-local targets and leaves `.env.local` unchanged. First startup downloads Docker images. `supabase start` applies migrations and fictional seed records on a fresh database.

Register a designated `@caedm.ca` administrator through the app. Open its confirmation email in the local inbox. The account remains pending. To bootstrap it, replace the designated email in `supabase/bootstrap-admin.sql`, then execute that SQL as the database administrator in **local Studio**. The SQL refuses missing or unverified accounts. It never promotes the first registrant automatically. After signing in, assign departments and approved owners to the fictional records.

For a local database created before changing Auth configuration, restart this project with `npx supabase stop` then `npx supabase start` so the Auth container loads the updated redirect settings.

For an existing Supabase project, copy `.env.example` to `.env.local`, supply that project's keys, apply the migrations to your intentionally selected target, configure Auth as below, bootstrap an explicitly designated verified administrator, and run `npm run dev` on port 3000. The implementation does not apply changes to your hosted project automatically.

```powershell
# Rebuild ONLY this project's local database and reapply synthetic seed records.
npx supabase db reset --local
# Stop the project's local containers when finished.
npx supabase stop
```

Reset removes this local project's accounts and records. Never use it against a database containing information you need to retain.

## Startup troubleshooting

- `npm run dev:local` uses this project's local Docker Supabase database and opens port **3100**. It does not use the hosted Supabase keys in `.env.local`.
- `npm run dev` uses `.env.local` and opens port **3000**. A hosted Supabase project must have all application migrations, the Auth Hook, email confirmation, and a designated approved administrator configured first. Setting only the URL and publishable key does not initialize the database.
- `Could not find the Next.js package`, a missing Supabase CLI module, or `'next' is not recognized` means dependencies are missing or incomplete. Stop the project's Node servers, run `npm ci --include=dev`, and retry.
- A Supabase `PGRST205` error for `profiles` or `software_subscriptions` means the selected database has not received the application tables. Use the local mode above, or apply the migrations to the intentionally selected hosted project before using that mode.
- A Next.js server returning HTTP 500 after a failed reinstall should be stopped and started again after dependencies are restored. Do not leave an old process running against a dependency folder being replaced.
- `EADDRINUSE` means another server already owns the selected port. Stop that repository's existing development server rather than starting a second copy.
- `npm start` is the production server: it requires `npm run build` first and the documented production configuration.

## Environment

| Variable                               | Purpose                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase API URL                                                                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public publishable key, or legacy anon key                                                  |
| `APP_URL`                              | Canonical application origin; HTTPS required in production                                  |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server only: durable authentication throttling and reminder worker                          |
| `CRON_SECRET`                          | Server only: random secret of at least 32 characters for scheduled POST requests            |
| `EMAIL_PROVIDER`                       | `local` in development, `smtp` for production delivery                                      |
| `EMAIL_FROM`                           | Verified sender identity configured with your SMTP provider                                 |
| `SMTP_HOST`, `SMTP_PORT`               | SMTP host and port; defaults to 587 with required STARTTLS; 465 uses implicit TLS           |
| `SMTP_USER`, `SMTP_PASSWORD`           | Server only SMTP credentials, when required                                                 |
| `DATABASE_URL`                         | Optional direct PostgreSQL connection for external tooling; not used by application queries |

Never prefix server secrets with `NEXT_PUBLIC_`. Never commit environment files or paste live credentials into logs. Ordinary business queries always use the signed-in user's Supabase client and RLS. The service credential is isolated to authentication throttling and reminder delivery. Missing Supabase setup produces a setup screen; production authentication fails closed if durable throttling is not configured. Local authentication uses a bounded in-memory limiter without the service key; Supabase Auth has its own rate limits in addition.

## Supabase configuration

Apply every SQL file in `supabase/migrations` in version order using the Supabase CLI (`supabase db push` after explicitly linking the correct project), or your migration process. Keep migrations version controlled. Do not seed production. Set the application's database timezone expectations to America/Edmonton; business dates are SQL `date`, timestamps are `timestamptz`, and all money is PostgreSQL `numeric(12,2)`.

In **Authentication → URL Configuration**:

1. Set Site URL to the canonical `APP_URL`.
2. Allow the exact `/auth/callback`, `/auth/callback?next=/auth/update-password`, and `/auth/confirm` redirect URLs on that origin. The local configuration includes both localhost:3100 (`dev:local`) and localhost:3000 (`dev`) callback URLs.
3. Require email confirmation and password strength: at least 12 characters including uppercase, lowercase, and digits. Disable anonymous sign-in and unused OAuth providers.
4. Configure Auth's email SMTP separately if needed. App notification SMTP does not configure Supabase's own verification/reset delivery.

In **Authentication → Hooks**, create a **Before User Created** hook, select **Postgres function**, and choose `public.before_user_created`. The migration grants execution only to `supabase_auth_admin` and revokes public/anonymous execution. `supabase/config.toml` enables this hook automatically for the local stack. The database user-insert trigger also rejects other domains as defence in depth.

For email verification that works across browsers, use this confirmation link in the Supabase confirmation email template:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup"
  >Verify work email</a
>
```

Use `type=recovery` for the password-reset template. Default Supabase PKCE emails are also supported via `/auth/callback` when opened in the initiating browser. The callback accepts only the dashboard or password-update destination. Expired links fail closed. Registering never activates or elevates an account, and verification never bypasses administrator approval.

After a designated administrator verifies their email, execute the reviewed `supabase/bootstrap-admin.sql` with that exact email as the database administrator. Normal account approval cannot approve an unverified identity. The last active administrator cannot be deactivated or demoted. Deactivated or suspended users immediately lose database access even with an existing session.

## Workflows

- **Dashboard:** real records drive counts, normalized monthly/annual amounts, projected billing, decision deadlines, expiring licenses, department/category charts, and activity. Staff see permitted departments only.
- **Inventory:** add, edit, search, filter, sort, paginate, transfer ownership, pause billing, track seat utilization and license expiry, cancel internally, or archive. Historical records are retained. Finance/Admin create shared vendors and limited card references in Settings. Staff need a `can_manage` membership for software mutations; a view-only membership permits reading.
- **Renewals:** 7/30/60/90-day projections use the original billing anchor, including month ends and leap years. Explicit next billing dates are authoritative. Disabled auto-renew and pending cancellation project only the recorded next charge. Paused, cancelled, expired, archived, and one-time records have no recurring projections. Custom intervals are expressed in whole months (1–120). Notice periods use calendar days.
- **Usage reviews:** authenticated owners choose Still Needed, Not Needed, or Unsure with an optional comment. Responses are write-once and timestamped; Finance receives a queued notification. Admins may request reviews manually. Owner reassignment transfers outstanding reviews. No external vendor cancellation is performed.
- **Finance:** recorded expenses and projected payments are separate. Record confirmed transactions including explicit tax, correct a recorded expense with audit history, group by department/vendor/payment reference/accounting period, and export filtered Software Register or Expense Report CSV/Excel. Expense references are snapshotted at recording time so later organizational changes do not rewrite history. Date filters use purchase dates for the register and transaction dates for expenses. Financial totals are separated by currency; no foreign exchange conversion is implied.
- **Administration:** approve/reject/suspend/deactivate users, assign roles and memberships, create departments, manage reminder intervals and currencies. Profile and role mutations require Admin in both the server and RLS.

Recurring equivalents use integer cents in JavaScript, rounded to cents for display; stored amounts are exact decimals. They represent run-rate estimates, not invoices. Projected amounts do not invent tax. Trial amounts reflect the billing amount entered by the team. Inactive records remain in historical register reports.

All export text is sanitized against spreadsheet formula interpretation; Excel numeric fields remain numeric. Exports are protected server-side and use complete paged database reads rather than relying on Supabase's default 1,000-row response cap. No full card numbers, CVV, bank credentials, or vendor passwords are collected. Invoice references are plain text; website links accept HTTP(S) only and are not fetched by the server.

## Reminder jobs and email

The daily worker creates reviews ahead of the decision deadline. The initial lead time defaults to 30 days before the cancellation decision deadline (earlier than renewal when notice is required). Follow-up defaults to seven days before the deadline, only if the initial message was delivered on an earlier day. Unanswered overdue reviews are escalated once per Finance/Admin recipient. A subscription's review frequency (default 12 months since its last response) is independent of its billing cycle; an unresolved review prevents a fresh review every billing period.

Local development needs no external email credentials. Use **Settings → Run reminders now** as an approved Admin. The local provider records message subject/body and simulated delivery in notification activity, visibly labelled as a development preview. Production refuses the local provider: configure SMTP and test a delivery before scheduling.

Schedule a daily authenticated **POST** to `/api/jobs/reminders`, for example at 08:00 America/Edmonton using your host scheduler. Supply `Authorization: Bearer <CRON_SECRET>` from the scheduler's secret storage. Use a scheduler that supports POST and timezone/DST; do not put secrets in URL query strings. A successful run processes up to 25 messages. Larger installations should invoke additional batches, monitoring the queue until pending work is drained.

Unique review/recipient/message constraints and transaction locks prevent normal duplicate messages. Workers claim rows with `FOR UPDATE SKIP LOCKED`, maintain a 30-minute lease, and use a claim token when saving delivery state. Each attempt is retained. Failed messages retry up to five attempts. Investigate exhausted failures before any operator intervention. SMTP cannot guarantee exactly-once delivery if a process dies after the mail server accepts a message but before the database records success; deterministic Message-ID helps downstream deduplication. Configure SMTP timeouts and monitor notification failures. Do not run jobs more frequently merely to compensate for an uninvestigated provider failure.

## Verification

Last verified locally on October 26, 2026: TypeScript and ESLint passed; 36 unit tests, 20 database tests, and all 9 real local-Supabase browser workflows passed; the production build passed; npm audit reported zero vulnerabilities. All five migrations were applied to the isolated local stack. Desktop and mobile screenshots were inspected. Hosted deployment and external SMTP delivery remain deployment-specific verification steps.

```powershell
npm run check
npm test
npm run test:db
npm run build
npx playwright install chromium
npm run test:e2e
```

If `npm run dev:local` is already running on port 3100, explicitly reuse that local server for browser verification:

```powershell
$env:PLAYWRIGHT_REUSE_SERVER = '1'
npm run test:e2e
Remove-Item Env:PLAYWRIGHT_REUSE_SERVER
```

Use this option only with this project's confirmed local Supabase server. By default, browser tests start their own server and refuse an occupied port.

Unit tests cover domain validation, roles, billing anchors, month ends/leap years/custom intervals, one-time and inactive handling, currency separation, deadlines, formula injection, and historical reports. Database tests run actual versioned SQL against an in-memory PostgreSQL-compatible PGlite instance with a minimal emulation of Supabase's Auth schema/roles. They exercise direct SQL permissions, RLS isolation, account approval, exact review ownership, audit retention, and reminder claims. This suite is fast and does not access a hosted database.

Playwright uses the **real local Supabase Docker stack**, Auth verification email delivery in Mailpit, approved synthetic accounts, and a separate Next.js development build on port 3100. It verifies registration/verification/pending approval, administrator approval, software creation/editing/search, local notification delivery, owner responses, expense recording/correction, CSV/Excel downloads, staff export denial/team isolation, cancellation/archive retention, and mobile navigation. It refuses non-loopback Supabase targets. It adds synthetic test accounts and records to the local database only. Reset that local database when you want to discard them. Screenshots and failure traces are ignored under `.artifacts`, `test-results`, and `playwright-report`.

No development account or client-side demo mode bypasses production authorization. External hosted email delivery and hosting must be verified with deployment-specific credentials. Build success does not prove those integrations.

## Deployment checklist

- [ ] Select the intended Supabase production project and apply reviewed migrations; do not load fictional seed data.
- [ ] Enable exact-domain Before User Created hook and email confirmation; enforce password rules and Auth rate limits.
- [ ] Configure canonical HTTPS origin, exact redirect allowlist, and confirmation/recovery templates.
- [ ] Configure production Auth email delivery and verify signup/reset emails.
- [ ] Bootstrap an explicitly designated verified administrator; assign Finance and department access.
- [ ] Set server secrets in hosting secret storage, including durable throttling credential and a random job secret.
- [ ] Configure application SMTP; verify a real reminder and Finance response/escalation notification.
- [ ] Run checks, migration/RLS tests, production build, and local browser suite.
- [ ] Smoke test real deployment with pending, Staff, Finance, and Admin accounts including direct API/export denials.
- [ ] Configure daily timezone-aware authenticated POST schedule and monitoring for failures/backlog.
- [ ] Configure database backups, retention/access review, credential rotation, and incident ownership.
- [ ] Review CSP if using a custom Supabase domain; current connections allow Supabase-hosted domains and local development endpoints. Confirm proxy/host origin configuration and HTTPS at the deployment edge.

## Primary documentation used

- [Next.js authentication and server-action authorization](https://nextjs.org/docs/app/guides/authentication)
- [Next.js Proxy and its limits](https://nextjs.org/docs/app/getting-started/proxy)
- [Supabase SSR clients and session refresh](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
- [TanStack Table v8](https://tanstack.com/table/v8/docs/framework/react/react-table)
- [Nodemailer SMTP transport](https://nodemailer.com/smtp)
- [ExcelJS](https://github.com/exceljs/exceljs)
- [React Hook Form](https://react-hook-form.com/docs/useform)
- [Zod validation](https://zod.dev/api)
- [Recharts responsive containers](https://recharts.github.io/en-US/api/ResponsiveContainer/)
- [date-fns month arithmetic](https://date-fns.org/docs/addMonths)
