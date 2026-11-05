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
| `SUPABASE_SERVICE_ROLE_KEY`            | Server only: authentication throttling, invitation onboarding and scheduled email workers    |
| `CRON_SECRET`                          | Server only: random secret of at least 32 characters for scheduled POST requests            |
| `EMAIL_PROVIDER`                       | `local` in development, `smtp` for production delivery                                      |
| `EMAIL_FROM`                           | Verified sender identity configured with your SMTP provider                                 |
| `SMTP_HOST`, `SMTP_PORT`               | SMTP host and port; defaults to 587 with required STARTTLS; 465 uses implicit TLS           |
| `SMTP_USER`, `SMTP_PASSWORD`           | Server only SMTP credentials, when required                                                 |
| `DATABASE_URL`                         | Optional direct PostgreSQL connection for external tooling; not used by application queries |

Never prefix server secrets with `NEXT_PUBLIC_`. Never commit environment files or paste live credentials into logs. Ordinary business queries always use the signed-in user's Supabase client and RLS. The service credential is isolated to authentication throttling, administrator-controlled invitation onboarding and scheduled email delivery. Missing Supabase setup produces a setup screen; production authentication fails closed if durable throttling is not configured. Local authentication uses a bounded in-memory limiter without the service key; Supabase Auth has its own rate limits in addition.

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

## Administrator invitations

On Team Management, create a department, then use **Invite an employee** to select the employee's name, exact @caedm.ca email, role, department and software permissions. Invitations are intended for new accounts; manage an existing account through Registered accounts instead.

The employee receives **Invitation from CAEDM Software Hub** from the mailbox in EMAIL_FROM, with the display name **CAEDM Software Hub**. SMTP_USER remains the provider's login username; it does not control the visible sender name. Both HTML and plain-text versions are sent through the application's SMTP configuration. Supabase Auth SMTP remains responsible for ordinary registration and password reset messages.

Invitation emails use the supplied CAEDM logo on white, burgundy headings and action buttons, gold accents and blue support links. The logo is attached inline with a Content-ID rather than fetched from an external image URL. `next.config.ts` includes lib/assets/caedm-logo.png in server file traces so the email worker can load it on Vercel. The message includes department, a readable role name, invited work email, exact expiry in Edmonton time, password setup instructions and a fallback link. Support links and Reply-To use the developer contact in lib/developer.ts. The authorized SMTP sender mailbox is preserved.

The invitation email uses stacked access details and a full-width action on small screens, explicit hover colours, and a VML button fallback for classic Outlook. The invitation and password setup forms use consistent field spacing, responsive layouts and visible keyboard focus. The local browser suite checks the delivered MIME image, sender and Reply-To, hover contrast without layout movement, and narrow-screen wrapping, then renders desktop and mobile previews under `.artifacts/invitation-email-*`, `.artifacts/invitation-form-*` and `.artifacts/invitation-setup-*`. Preview HTML replaces the working test invitation link with an inert placeholder. No database migration or additional environment variable is needed for these visual changes. Verify appearance in the team's email clients after release; browser previews do not emulate every Outlook or mobile mail renderer.

Invitation links expire after 72 hours. Opening a link does not consume it: the employee must submit a valid password to complete setup. Role, status and department membership are assigned together only after password setup. The employee then signs in normally. Invitations can be resent after one minute (invalidating the previous link) or revoked. A failed email remains visible and can be resent after correcting SMTP settings. Each administrator can prepare at most 20 invitations per hour.

Only invitation token hashes are stored. Each invitation reserves a server-generated Auth user ID so signup metadata cannot bypass onboarding. Acceptance uses a short exclusive claim; interrupted setup can resume for the same invitation without adopting unrelated existing accounts. Resending, revocation, expiry and loss of the inviting administrator's verified active status prevent activation. Ordinary signup and direct profile activation cannot bypass a pending invitation. Audit entries exclude token hashes and claim secrets.

For production, set EMAIL_PROVIDER=smtp, an authorized EMAIL_FROM mailbox, SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD, the server-only SUPABASE_SERVICE_ROLE_KEY and APP_URL=https://your-stable-domain in Vercel. This feature extends the server key's scope only to administrator-authorized onboarding and service-only invitation RPCs. Never prefix it with NEXT_PUBLIC_. Apply the additive invitation migration before deploying the new application version. Existing accounts and financial records are preserved.

After adding smtp_port to an existing local stack, restart it with npx supabase stop then npx supabase start to expose the port while retaining local data. Local invitation emails go to the local Mailpit SMTP receiver on 127.0.0.1:54325 and can be read at http://127.0.0.1:54324. The local provider refuses invitation delivery against a hosted Supabase URL and is forbidden in production. Invitation tokens stay in the URL fragment and are removed from browser history when captured; they are not sent in GET requests or persisted to client storage.

Have the mail administrator verify SPF authorization, DKIM signing and DMARC alignment for the EMAIL_FROM domain. Keep the real sender address authorized by the provider, disable tracking/link rewriting for these transactional emails, and test delivery to the organization's mailboxes. Professional branding cannot guarantee inbox placement.

### SMTP policy troubleshooting

Use port 587 with STARTTLS, or port 465 with implicit TLS, and retain certificate verification. A successful TLS connection followed by `535 5.7.3 Authentication unsuccessful` means the server rejected authentication. This response alone does not distinguish an account/credential problem from connector or authentication policy. Changing the visible sender name does not resolve authentication failures.

For on-premises Exchange, have the mail administrator inspect the connector that receives this application's connection. These read-only commands run in the Exchange Management Shell:

```powershell
Get-ReceiveConnector -Server <ExchangeServerName> |
  Where-Object { $_.Bindings -match ':587$' } |
  Format-List Identity,Enabled,Bindings,AuthMechanism,PermissionGroups,Fqdn,RemoteIPRanges,ProtocolLoggingLevel
```

Check the account's enabled/locked/expired state, permitted login identity, applicable authentication policies, connector permissions and authentication methods. Correlate the failed authentication time with the Front End SMTP receive protocol logs and Windows authentication events. If logging is disabled, the mail administrator can temporarily enable verbose logging on the specific connector under the organization's change process. Do not enable anonymous/open relay or weaken TLS to work around the failure.

Vercel and hosted Supabase each need access to the approved SMTP endpoint from their own networks. A hostname reachable only through internal DNS or private addresses is insufficient without approved private connectivity. Public DNS resolving successfully also does not prove TCP reachability or firewall authorization. Verify the public endpoint, certificate, port and access restrictions from the deployment environment, then verify that the authenticated account can send as the EMAIL_FROM mailbox.

See Microsoft's [authenticated SMTP configuration](https://learn.microsoft.com/en-us/exchange/clients/pop3-and-imap4/configure-authenticated-smtp) and [protocol logging](https://learn.microsoft.com/en-us/exchange/mail-flow/connectors/protocol-logging) guidance. Configure application SMTP in Vercel separately from Supabase Auth SMTP.

## CAEDM branding and in-app help

The shared Brand component uses the supplied full-color logo at lib/assets/caedm-logo.png without cropping or recoloring it. A white surface preserves its appearance on the burgundy sidebar and sign-in panel. The palette is defined by the --caedm-* variables in app/globals.css: burgundy #860038, gold #E5C047, blue #005493, red #BF311A and white #ffffff. Primary actions use burgundy; gold highlights navigation; blue supports guidance and reporting; red identifies errors.

The Help icon appears on sign-in, registration, password recovery, invitation, approval and setup screens, and in the workspace header. It opens a searchable guide with topic filters, expandable step-by-step answers and guidance for the current page. Public help explains account access and missing emails. Authenticated Staff, Finance, Admin and Super Admin receive guidance for their available workflows. Help is informational; authorization remains enforced by existing server actions and database policies.

The native modal supports keyboard focus containment, Escape, a close button and focus restoration, with a scrollable answer area on smaller screens. Help text lives in lib/help-content.ts; update it whenever a workflow changes. Every Help screen includes Developer Information for **Ruban Peppin**, a mail link to **ruban.peppin@caedm.ca**, and **Request a Feature**. The contact is shared in lib/developer.ts. Help itself is an informational guide; the separate feature form stores submitted suggestions.

## Roles and protected developer access

Help's **Roles & access** topic contains the complete four-role comparison, departmental View/Manage guidance, software ownership rules, approval requirements and privileged account instructions. The comparison is available on public and authenticated Help screens; operational Super Admin grant/revoke instructions are shown only to Super Admins. The comparison table supports keyboard focus and horizontal scrolling on smaller screens.

| Capability | Super Admin | Admin | Finance | Staff |
| --- | --- | --- | --- | --- |
| Software, subscription costs and renewals | All departments | All departments | All departments | Assigned departments |
| Create/edit/pause/cancel/archive software | All departments | All departments | All departments | Assigned departments with Manage permission |
| Record/correct expenses, audit access and CSV/Excel exports | Yes | Yes | Yes | No |
| Maintain vendors, categories and limited payment references | Yes | Yes | Yes | No |
| Invite/approve employees and assign ordinary roles | Yes | Yes | No | No |
| Departments, memberships, settings and manual reminders | Yes | Ordinary accounts | No | No |
| Grant/revoke Super Admin or manage those accounts | Yes, except protected developer | No | No | No |
| Answer usage reviews | Assigned owner only | Assigned owner only | Assigned owner only | Assigned owner only |

Super Admin includes existing Admin and Finance capabilities. Ordinary Admins cannot promote themselves, grant Super Admin, downgrade or restrict a Super Admin, or edit its memberships. Only Super Admins manage other elevated accounts. Membership and role checks are enforced by PostgreSQL RLS, profile/membership triggers, guarded RPCs and server actions, in addition to UI controls. Signup metadata cannot assign roles or activation, and invitation roles remain Admin/Finance/Staff; invitees must finish password setup before an active account can be elevated separately. Role changes remain in audit history.

The protected developer is the existing **ruban.peppin@caedm.ca** identity. Its UUID is pinned in a private, client-inaccessible table, rather than granting authority based on a user-editable email or metadata. Other application administrators, including delegated Super Admins, cannot change its access or memberships. Its role must remain Super Admin and its status active; identity changes and deletion are blocked. The developer can manage its own department memberships, subject to ownership-transfer rules. Additional Super Admins do not inherit permanent developer protection. Last-active-Super-Admin and administrator guards prevent accidental lockout. Financial history and exact review ownership are preserved for all roles. These application protections do not replace control of Supabase/Vercel infrastructure by authorized operators.

Before deploying this role feature, review and apply **202610280003_super_admin_role.sql** and **202610280004_super_admin_permissions.sql** in order to the explicitly selected project. The enum migration must commit before the permissions migration uses it. The permissions migration elevates and pins the developer only if that existing account is already verified, active and has completed any invitation; it never creates a user or approves a pending registration. For a fresh installation, first verify and approve the designated account through the normal operator bootstrap, then run **supabase/bootstrap-super-admin.sql** as the database administrator. That helper is revoked from anonymous, authenticated and service roles and cannot be invoked by an application action. No new environment secret is required. Deploy the application after the migrations and verify both protected developer and ordinary Admin access before rollout.

To grant Super Admin after deployment, sign in as a verified active Super Admin, open **Team Management → Registered accounts**, choose an existing verified active employee, select **Super Admin**, and confirm **Update access**. To revoke another non-protected person's elevation, select Admin/Finance/Staff; assign departments if changing them to Staff. Use suspended/deactivated to restrict a non-protected account when needed.

## Developer contact and feature requests

Open **Help → Request a Feature**, or `/request-feature`. Verified CAEDM employees with active accounts **or accounts awaiting approval** can submit. Unverified, rejected, suspended and deactivated accounts cannot. PostgreSQL checks the Auth email, profile identity and status as well as the server action. Pending employees retain their existing workspace restrictions.

The form collects a title, application area, priority, optional department, problem, proposed improvement, expected benefit and optional workaround. The verified account supplies the sender's identity automatically. Requests are saved before email delivery, receive a reference, and appear in the requester's ten most recent submissions. The message goes only to **ruban.peppin@caedm.ca**, with **CAEDM Software Hub** as the sender display name and the requester's verified address as Reply-To. Both branded HTML and plain text are provided. Do not submit credentials or confidential financial details.

Submission, history and retry queueing use the signed-in user's client. Requests are private to their eligible owner and verified active administrators under RLS; Finance does not gain access to other employees' suggestions. Audit entries contain delivery metadata rather than request text, contact details or delivery secrets. Ordinary clients cannot claim deliveries or mark an email as sent.

The protected scheduled job at **POST `/api/jobs/feature-requests`** sends up to three queued messages per run. Configure a scheduler supporting POST to invoke it **every five minutes**, with `Authorization: Bearer <CRON_SECRET>` supplied from secret storage. It uses the existing server-only `SUPABASE_SERVICE_ROLE_KEY` and application SMTP configuration; Supabase Auth SMTP is separate. Without this scheduler, requests remain saved and queued. Monitor job failures and pending/failed request statuses; sustained queues need more frequent runs or an appropriate worker batch/duration adjustment.

The database allows five new requests per employee per hour. A per-form key prevents duplicate submissions. Exclusive five-minute delivery leases prevent concurrent sends; failed deliveries become eligible for an automatic retry after five minutes, with a maximum of five attempts. Employees can also queue a retry after a one-minute cooldown. Requests remain saved if SMTP fails. As with other SMTP workers, a process failure after SMTP acceptance but before recording success can result in a duplicate; the stable Message-ID helps downstream deduplication.

Before deploying this feature, review and apply **202610280001_feature_requests.sql** and **202610280002_feature_request_queue.sql**, in order, to the explicitly selected hosted project. Then deploy the application, verify Production `EMAIL_PROVIDER=smtp`, the existing SMTP variables, service credential and `CRON_SECRET`, and enable the protected scheduler. No additional secret variables are required. Verify a real feature email in the intended mailbox after deployment. Local `dev:local` captures these emails in Mailpit at http://127.0.0.1:54324 and does not send to external recipients.

If `/request-feature` shows "Feature requests are temporarily unavailable", the request-history query failed; this message is separate from SMTP delivery. Inspect the safe database error code in server logs. `PGRST205` indicates the table is absent from the API schema cache: confirm the selected hosted project has both feature-request migrations and the expected table/columns before refreshing the API schema cache. Pushing application code to GitHub/Vercel does not apply Supabase migrations. Do not apply unreviewed later role migrations just to repair the already-released feature table. If the CLI cannot connect to the project pooler, an authorized operator can use the selected project's SQL Editor or restore the approved database network connection and rerun the versioned migration process. A missing scheduler leaves submitted requests queued; it does not hide the form.

## Inline references on Add and Edit software

Vendor, Category, Department, Responsible employee and Payment reference dropdowns offer an **Add…** action when the signed-in person has permission. It opens a native modal without submitting or clearing the software draft. A newly saved reference is selected automatically. Cancel or Escape returns focus to the dropdown; field-level **i** buttons provide keyboard and touch guidance for billing anchors, forecasts, cancellation notice, ownership, licenses and limited payment references. The modals follow the [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

Finance, Admin and Super Admin can add vendors, shared categories and department-specific payment references. Admin and Super Admin can also create departments and add eligible employees who are not yet members of a department with **View** access. Existing members are selected directly from Responsible employee; their Manage permission is retained. Candidate discovery and assignment are guarded in PostgreSQL as well as server actions; unverified, pending, unfinished invitation and protected-account changes are excluded. An administrator can instead invite a new Staff employee using the existing SMTP/password onboarding flow. An invitee is not selected as an owner until onboarding is complete. No synthetic profile or service-key business query is used.

Shared references and department memberships save immediately; cancelling a software draft does not delete them. Changing department clears any owner or payment reference that is not valid for the new department. The payment modal fixes its department to the current selection and stores only nickname, optional brand, optional last four digits and notes. Duplicate payment nicknames require choosing the existing reference or a new nickname; no existing card details are silently overwritten. Vendor and payment-reference creation live in the software editor; Settings links to Software Inventory without repeating those forms.

Before deploying this feature, apply **202611020001_software_editor_references.sql** after the prior migrations to the explicitly selected hosted project. It adds the RLS-protected category catalog, backfills distinct existing category names without rewriting software or expenses, and adds guarded employee candidate/assignment functions. Existing category spellings remain selectable. The migration also checks verification and completed onboarding when validating software ownership. Apply the migration before deploying the new editor; do not seed production. No new environment variables are needed. A Git push does not apply hosted migrations. Do not rerun this migration on deployments where it has already succeeded.

To publish code to Git before its database prerequisite is ready, include `[skip vercel]` in the commit message. The repository's `vercel.json` uses Vercel's [Ignored Build Step](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand) to skip that commit's deployment. After applying and verifying the migration, push a release commit without that marker (an empty release commit is sufficient). Redeploying the marked commit retains the skip rule. Ordinary commits continue to deploy automatically.

### Duplicate feedback and dropdown order

Each authorized Add option sits immediately below its dropdown placeholder, before saved entries. Category has an explicit Select a category placeholder while retaining the existing Productivity default. Employee and payment Add options remain disabled until a department is selected. Duplicate vendor/category/department names and department-scoped payment nicknames are errors, not successful reuse; comparisons ignore case and surrounding spaces. The modal preserves the draft and entered values, focuses and marks the problem field, and announces a persistent written error with a single brief shake. The shake respects reduced-motion settings, following [W3C error identification guidance](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA21) and [MDN motion guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion).

Existing employee memberships cannot be added a second time. Existing employees are identified by verified work email/UUID, not by full name; different people may share a name. Invitation duplicates direct administrators to select or assign the existing employee, manage pending/inactive accounts, or resend the existing invitation. Rejected submissions do not send another email or change existing permissions.

Before releasing duplicate protection, apply **202611040001_reference_duplicates.sql** to the selected project after the editor migration. PostgreSQL triggers serialize normalized-name creation and renames, and the guarded assignment RPC rejects duplicate membership. Existing names, IDs, permissions and financial history are preserved, including legacy case variants; no merging or deletion occurs. This follow-up migration is separate from the already-released editor migration and must not be applied remotely without selecting the target. CLI migration history must also be reconciled for migrations previously applied through SQL Editor.

## Workflows

- **Dashboard:** Needs your attention leads the page, with overdue/expired records first and one row per software retaining all reasons. Assigned reviewers get an Answer review link; other authorized viewers get View review. Upcoming 30-day payments sit beside it. Recurring totals, spending analysis and expandable recent activity follow. Staff see permitted departments only; Add software is shown only to Finance/administrators or Staff with Manage membership.
- **Inventory:** add, edit, search, filter, sort, paginate, transfer ownership, pause billing, track seat utilization and license expiry, cancel internally, or archive. Historical records are retained. Finance/Admin create shared vendors, categories and limited payment references directly from the software editor. Staff need a `can_manage` membership for software mutations; a view-only membership permits reading.
- **Renewals:** 7/30/60/90-day projections use the original billing anchor, including month ends and leap years. Explicit next billing dates are authoritative. Disabled auto-renew and pending cancellation project only the recorded next charge. Paused, cancelled, expired, archived, and one-time records have no recurring projections. Custom intervals are expressed in whole months (1–120). Notice periods use calendar days.
- **Usage reviews:** authenticated owners choose Still Needed, Not Needed, or Unsure with an optional comment. Responses are write-once and timestamped; Finance receives a queued notification subject to personal notification settings. Admins may request reviews manually. Owner reassignment transfers outstanding reviews. No external vendor cancellation is performed.
- **Finance:** recorded expenses and projected payments are separate. Record confirmed transactions including explicit tax, correct a recorded expense with audit history, group by department/vendor/payment reference/accounting period, and export filtered Software Register or Expense Report CSV/Excel. Expense references are snapshotted at recording time so later organizational changes do not rewrite history. Date filters use purchase dates for the register and transaction dates for expenses. Financial totals are separated by currency; no foreign exchange conversion is implied.
- **Administration:** approve/reject/suspend/deactivate users, assign roles and memberships, create departments, manage reminder intervals and currencies. Profile and role mutations require Admin in both the server and RLS.

Recurring equivalents use integer cents in JavaScript, rounded to cents for display; stored amounts are exact decimals. They represent run-rate estimates, not invoices. Projected amounts do not invent tax. Trial amounts reflect the billing amount entered by the team. Inactive records remain in historical register reports.

All export text is sanitized against spreadsheet formula interpretation; Excel numeric fields remain numeric. Exports are protected server-side and use complete paged database reads rather than relying on Supabase's default 1,000-row response cap. No full card numbers, CVV, bank credentials, or vendor passwords are collected. Invoice references are plain text; website links accept HTTP(S) only and are not fetched by the server.

## Dashboard and Settings design

The redesign targets clear reading and task discovery for employees aged 40–60. It follows [WAI guidance for older users](https://www.w3.org/WAI/older-users/developing/), the [44px enhanced target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) and [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/). The two pages use 16px base text, stronger supporting-text contrast, larger headings, visible action labels, and comfortable keyboard/touch controls. Charts render final values without animation and retain a tabular alternative. Local browser coverage includes a 320 CSS-pixel viewport and a 200%-equivalent layout viewport; this is not a claim of complete WCAG conformance.

Settings opens with personal Notifications and a compact Your account panel. Workspace settings and Email delivery & activity start collapsed for administrators. Finance has read-only delivery history; Staff see personal controls only. Native disclosures support keyboard operation, and personal settings remain independent of organization Usage Review rules. Payment references are created in the existing software-editor modal. This redesign adds no database migration or new authorization grants.

## Reminder jobs and email

The daily worker creates reviews ahead of the decision deadline. The initial lead time defaults to 30 days before the cancellation decision deadline (earlier than renewal when notice is required). Follow-up defaults to seven days before the deadline, only if the initial message was delivered on an earlier day. Unanswered overdue reviews are escalated once per Finance/Admin recipient. A subscription's review frequency (default 12 months since its last response) is independent of its billing cycle; an unresolved review prevents a fresh review every billing period.

Local development needs no external email credentials. As an approved Admin, open **Settings → Email delivery & activity → Run reminders now**. The local provider records subject/body previews in notification activity and captures branded billing emails in this project's Mailpit inbox. Production refuses the local provider: configure SMTP and test a delivery before scheduling.

The repository configures a daily Vercel Cron **GET** to `/api/jobs/reminders` at **15:00 UTC** (08:00 MST / 09:00 MDT). The endpoint accepts authenticated GET and POST with the same timing-safe `Authorization: Bearer <CRON_SECRET>` check. Set a server-only `CRON_SECRET` of at least 32 characters in the Production environment; Vercel supplies it to production cron invocations. Existing authenticated POST schedulers remain supported. Prefer one scheduler and remove redundant schedules when switching; do not put secrets in URLs. [Vercel cron quickstart](https://vercel.com/docs/cron-jobs/quickstart) documents production-only invocation. No live scheduler is created by a local test or Git commit until deployment.

Every verified active workspace user has personal **Settings → Notifications** controls. **Software email notifications** is the master switch for billing notices, Usage Review requests/follow-ups and Finance response/escalation emails. **Only software I own** is independent: checked includes current valid ownership; unchecked includes all software the recipient is already authorized to view (assigned departments for Staff, organization-wide for Finance/Admin/Super Admin). Wider billing scope can include unassigned software. These preferences never grant access or broaden review response rights. Review requests still route only to their assigned reviewer; Finance updates still require the Finance hierarchy. Finance recipients must opt into wider scope to receive updates about other owners' software.

Defaults are **on, owner-only, 14 and 7 calendar days before expected billing**. Existing opt-outs and custom timings are preserved. Employees can choose ordered billing offsets (first 2–365, second 1–364), save choices or restore and save defaults. Turning the switch off preserves scope/timings and suppresses all software reminder email kinds at claim time. In-app reviews, responsibility to respond, organization review deadlines/frequency, invitations, verification and password-reset emails remain unchanged. Preferences are writable only by that signed-in verified active employee under RLS and server actions; administrators cannot change another employee's choices. Changes apply on Save notification settings. Invalid unsaved timing edits are discarded when switching off so they cannot block an opt-out. The switch follows the [W3C switch pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/) with a stable accessible label, checked state and keyboard support.

Billing notices use Edmonton business dates, each software's expected renewal calculation and original currency. Only active/trial/pending-cancellation subscriptions qualify. Paused billing, one-time purchases, inactive/unverified recipients, unfinished onboarding and cancelled/expired/archived software are excluded. Notices are not sent on or after billing. Missed runs catch up only the latest due stage, avoiding a pair of emails on the same day. Each cycle has at most one ordinary delivery per recipient and stage, even if offsets change. Access, ownership, scope and enablement are checked again when claiming queued emails; already in-flight messages may arrive after a preference change. Queues and delivery history remain intact. Emails distinguish forecasts from invoices and link to the software record and Notifications settings.

Usage-review batches retain their existing limit of 25 messages per run. Billing delivery claims five messages at a time with exclusive leases and processes up to 20 batches while leaving time within the serverless job budget. Remaining work stays queued. Finance and administrators can inspect both types in Notification activity. Failed billing attempts wait at least five minutes before eligibility for the next scheduler/manual run, with at most five attempts. A daily schedule retries on its next daily run; it does not promise a five-minute delivery. Monitor queue capacity and run additional authenticated batches when necessary.

Apply pending **202611040001_reference_duplicates.sql**, **202611040002_billing_reminders.sql**, then **202611040003_notification_scope.sql** in order to the explicitly selected hosted project before deploying this feature. Migration 002 adds personal preferences and billing delivery infrastructure; 003 adds owner scope and filters billing/review delivery against each recipient's real access and preferences. It does not impersonate sessions, rewrite financial records, enable existing opt-outs, alter organization review settings or require new SMTP credentials. Verify the hosted schema before release; Vercel does not apply these database migrations automatically. SQL Editor migrations need their CLI history reconciled before later CLI deployments. Never seed production.

Finance Centre is labelled **Beta** in desktop/mobile navigation, the section heading and expense correction screens. The label does not change permissions or historical record handling. Usage Reviews includes keyboard/touch information buttons for filters, amount, decision deadline, response, Finance attention, review owner, captured renewal date and comments. Help explains these fields and distinguishes billing notices from required usage reviews.

Unique review/recipient/message constraints and transaction locks prevent normal duplicate messages. Workers claim rows with `FOR UPDATE SKIP LOCKED`, maintain a 30-minute lease, and use a claim token when saving delivery state. Each attempt is retained. Failed messages retry up to five attempts. Investigate exhausted failures before any operator intervention. SMTP cannot guarantee exactly-once delivery if a process dies after the mail server accepts a message but before the database records success; deterministic Message-ID helps downstream deduplication. Configure SMTP timeouts and monitor notification failures. Do not run jobs more frequently merely to compensate for an uninvestigated provider failure.

## Verification

Last verified locally on November 5, 2026: TypeScript and ESLint passed; 91 unit tests, 95 database tests, and all 30 real local-Supabase browser workflows passed; the production build passed. All fourteen existing migrations are applied locally; the Dashboard/Settings redesign adds none. Coverage includes priority ordering and grouping, expired records, correct review links, view-only access, expandable settings, 320px reflow, keyboard/touch controls, complete mobile scrolling and a 200%-equivalent layout. The suite also covers notifications, actual Mailpit delivery, invitations, role protection, software editing, Finance, exports, Help and feature requests. Test setup deactivates only prior local E2E administrators after creating the current run's administrators, preserving history and preventing accumulated test recipients from exceeding real write limits. Production protections are unchanged. Desktop/mobile design and email previews were visually reviewed. External SMTP and hosted deployment require separate verification.

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
- [ ] Schedule protected POST `/api/jobs/feature-requests` every five minutes and verify a real feature request email, Reply-To and delivery status with active and pending accounts.
- [ ] Run checks, migration/RLS tests, production build, and local browser suite.
- [ ] Apply any pending software-editor migrations, including **202611040001_reference_duplicates.sql**, before releasing their UI; smoke test inline creation, duplicate feedback, cancelled modals, owner onboarding, department changes and keyboard/touch guidance with each role. Do not rerun migrations already applied.
- [ ] Apply **202611040002_billing_reminders.sql** and **202611040003_notification_scope.sql** before releasing Notifications; verify the production daily cron, server-only CRON_SECRET, owner-specific 14/7 emails, preference changes/opt-out, delivery activity and pending queue capacity. Remove redundant external schedules when switching to Vercel Cron.
- [ ] Smoke test real deployment with pending, Staff, Finance, Admin and Super Admin accounts including direct API/export denials, elevation/revocation and protected developer restrictions.
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
