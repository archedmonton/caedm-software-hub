# About, release management and Developer Tools

This is a locally prepared feature. It has not been pushed or deployed. No production database, account, primary designation, email schedule or Vercel environment has been changed.

## Version baseline and release process

Before this change, package.json had no version, Git had no release tags, and there was no numbered changelog. The first formal baseline is **1.0.0**, marked **prepared**, with no invented publication date. Historical feature milestones are documented in README; they are not represented as fabricated releases.

package.json is the application version source. src/lib/releases.ts holds the corresponding typed notes. `npm run validate:releases` checks semantic versions, agreement, uniqueness, order, dates and required metadata. Both `check` and `build` run it. Before an approved release, update both sources, assign the genuine publication date and status, validate and review. Do not increment for every development commit. About reads the actual Vercel build SHA or explicitly identifies a development build. It is available to authenticated accounts, including accounts awaiting approval, without granting workspace access.

## Access and preview model

Developer designation is stored separately from organization roles in private.developer_access. A contact-email match never grants it. Every Developer action/page/RPC checks the real, verified, active identity and current assignment. Direct table access is denied; the public campaign table has Developer-only read RLS. Developer designation does not expand finance, administration or department permissions.

Role previews are tied to the trusted JWT session_id and real auth.uid(), expire after 30 minutes, and narrow the existing private.active_role predicate used by RLS. Supported subsets: Super Admin → Admin/Finance/Staff; Admin → Finance/Staff; Finance → Staff; Staff has no lower preview. This follows this application's existing predicates, where Admin includes Finance capabilities. Account role/UUID never changes. The server uses the effective role, including export authorization. Staff preview uses the actor's existing department memberships. No service business queries, impersonation, user-controlled role headers or localStorage authority are used.

The gold banner identifies real changes and offers Return to My View. Developer actions are disabled while previewing. Revocation or an unsupported actual-role change fails closed; `/preview-exit` provides an escape. Sign-out ends the preview. Start/end records and actual-user mutation audit context are retained. Expiration is represented by the saved expires_at boundary; expired records cannot authorize previews even before a user explicitly exits.

## Database changes

Apply reviewed migrations in order, only after explicit target selection and deployment approval:

1. `202611160001_developer_governance.sql`: private Developer assignments, primary governance, session previews, append-only audit and security-email queue; trusted context and guarded RPCs; additive audit_logs.context; replacement of effective-role predicate. No organization role, auth identity or historical finance record is rewritten.
2. `202611160002_developer_announcements.sql`: public campaign metadata with RLS; private deduplicated recipient queue, attempt history, suppression list and provider events; audience, draft, preview, test, confirmation, lease, snapshot, receipt, history/outbox and security-email delivery RPCs. Queue/unique indexes enforce concurrent delivery and idempotent submissions.

All private tables have RLS and revoked direct grants. Ordinary business RPCs use the actor's signed-in client. Only the protected email delivery worker uses a service credential. The signed provider receipt endpoint uses an anonymous, narrow, unguessable per-recipient capability RPC. That capability can update only its bound email receipt within 30 days, cannot read business data, and is never returned in browser history/outbox. Webhook signature validation, timestamp checks, provider-ID binding and event deduplication provide additional protection. Secrets and raw provider errors are not logged.

## Explicit first Developer bootstrap

An authorized database operator must first verify the existing protected account UUID, email verification, active status and completed onboarding in the intentionally selected project. Do not create or repin an identity. In SQL Editor as the database owner:

```sql
-- Read-only: confirm the existing protected identity and matching Auth account.
select d.profile_id, p.email, p.role, p.status, u.email_confirmed_at
from private.developer_protection d
join public.profiles p on p.id=d.profile_id
join auth.users u on u.id=p.id
where lower(p.email)=lower(u.email);

-- Only after the operator has confirmed the intended existing UUID:
-- select private.bootstrap_developer_access('<confirmed existing protected UUID>'::uuid);
```

Set server-side `DEVELOPER_EMAIL=ruban.peppin@caedm.ca` and `DEVELOPER_NAME=Ruban Peppin` for this installation. No account is automatically promoted by these settings. To require MFA application-wide for Developer grants, an authorized database operator sets private.developer_governance.require_mfa=true after verified TOTP enrollment. This single policy is read by the server and enforced again by PostgreSQL, including direct RPC calls. Enrolled verified MFA factors always require aal2, independently of that policy. Missing enrollment under a required policy blocks changes with a clear message. The application currently supports TOTP step-up; an unsupported factor cannot bypass the requirement.

## Grant, revoke and hand over

`/developer/access` lists separately authorized Developers, real organization roles, grant dates and grantor. Grant/revoke uses a separate password-authenticated client with no SSR cookie adapter, a durable per-actor throttle, identity comparison, configured/enrolled TOTP challenge, original-session recheck and a database JWT password-proof window of 90 seconds. Incorrect/stale credentials cannot change access. The current browser session remains unchanged. Own-access revocation and primary revocation are denied in PostgreSQL. Security notices are queued transactionally and delivered through security-alerts@caedm.ca; failure does not silently erase the audit.

Primary handover:

1. Grant an eligible successor Developer access; no organization-role change is necessary.
2. The successor signs in and opens Developer Tools. The database records their access verification.
3. The deployment operator updates DEVELOPER_EMAIL and DEVELOPER_NAME to the successor's verified identity and deploys the approved configuration. Only after verifying it matches the intended account, the database operator executes `select private.authorize_developer_handover('<verified successor UUID>'::uuid);` in the selected project. This is an explicit operator witness, valid for one day, not a public application permission.
4. The current primary selects the same successor and confirms with a fresh password and configured MFA. Server configuration, approved UUID, actual primary, active assignment and recent successor Tools access must agree. The former primary remains an authorized Developer unless separately revoked later.

Changing environment contact alone does not change database access. A mismatch is visible in Developer Tools. Existing protected Super Admin governance remains independent: handover does not transfer, demote or remove the pinned protected identity. Follow that separate protection process if it ever needs organizational review.

## Announcements and delivery

The composer offers Welcome Testers, What's New and Blank. What's New derives version/date/status/notes from current release metadata and explicitly identifies an unreleased version. Formatting supports escaped text, paragraphs, **bold** and bullet lists only. No arbitrary HTML or executable links are accepted. Preview and final sending share one renderer, with a clear test-only label for tests.

Audiences are built from actual registered profiles and actual invitations: signed up, invited, both or selected people. Valid outstanding invitees need not have registered. Disabled accounts, revoked/expired invitations, non-CAEDM and suppressed addresses are excluded. Emails are canonicalized and deduplicated. Names on unverified self-registered accounts use a professional fallback. Eligibility, author authorization and suppressions are rechecked before delivery. No recipient list is exposed in another recipient's email.

Save and preview the current draft; send a test to the authenticated Developer; review eligible, excluded, duplicate and unique counts; confirm in the Send Announcement dialog. The test must be provider-accepted for the current revision. Any content/audience edit invalidates the proof. The database recalculates the final count and rejects stale/empty audiences. Request UUIDs and recipient uniqueness prevent repeated campaign submission from creating duplicate deliveries.

Individual messages use notifications@caedm.ca with the sending Developer's verified email as Reply-To. The worker freezes the rendered message and logo before the first provider call so retries retain identical Resend idempotency content across configuration changes. Claims use five-minute leases and unique claim tokens. Automatic transport retries wait five minutes, stop after five attempts, and stop before Resend's 24-hour idempotency window expires; unknown older outcomes require operator reconciliation rather than risking a duplicate send. Accepted/delivered or provider-confirmed failures are not blindly resent. Suppressed addresses are not retried. A bounded ten-recipient batch avoids bulk sending in a single web request. SMTP fallback cannot guarantee exactly-once delivery after an ambiguous network failure; Resend is the intended production provider.

Email Outbox combines available queue metadata from announcements, usage reviews, billing, invitations, feature requests, account notices and Developer security notices. Existing actual-role/recipient visibility is retained for business queues, including Staff Developers. It does not grant access to financial content. History/details include attempts and safe failure reasons; retry controls never resend successful messages. Accepted is not delivered. Signed Resend events can confirm delivery to the recipient's mail server, which does not imply an inbox location or that the person read the message.

## Configuration and activation after approval

Keep RESEND_API_KEY, CRON_SECRET and RESEND_WEBHOOK_SECRET in server-only hosting secret storage. Use the canonical HTTPS APP_URL. Authorize notifications@caedm.ca and security-alerts@caedm.ca on the verified sending domain. The current key was identified as sending-only in prior read-only testing; a controlled real acceptance/delivery test remains necessary after deployment approval.

Schedule authenticated POST `/api/jobs/announcements` every five minutes using `Authorization: Bearer <CRON_SECRET>` and monitor failures/backlog. Existing reminder, feature-request and account-notice schedules remain separate. Send Test to Me invokes only a bounded test-recipient delivery through that same protected worker; without working worker configuration it stays queued and does not unlock bulk sending. Ensure hosting permits this authenticated same-origin worker call; deployment protection may require its configured server-side bypass or an accessible canonical production origin.

Configure a Resend webhook to HTTPS `/api/webhooks/resend`, set RESEND_WEBHOOK_SECRET, and subscribe to email.delivered, email.bounced, email.complained, email.suppressed and email.failed. Verification uses the raw bounded body and signed svix headers. Unsupported events are acknowledged without business queries. Database storage failures return 503 so Resend can retry. All test mail during development is captured by local Mailpit; no production recipients were contacted.

Before release, run check, unit tests, database tests, production build and the real local-Supabase browser suite. The installed Next.js 16.4.3 warning was addressed locally by pinning Next.js and its matching lint configuration to the officially patched 16.4.5 release. The production dependency audit reports no vulnerabilities; the wider dependency audit still reports seven moderate development-tool findings, which have not been silently upgraded as part of this feature. Review screenshots, templates, SQL and deployment configuration, then obtain explicit push/deployment approval. Do not seed production, run an unselected remote migration, create a PR or send a live bulk campaign as part of local review.

Primary references: [Supabase password authentication](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa), [Vercel build metadata](https://vercel.com/docs/environment-variables/system-environment-variables), [Resend signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [Resend delivery events](https://resend.com/docs/webhooks/emails/delivered), [Resend tags](https://resend.com/docs/dashboard/emails/tags).
