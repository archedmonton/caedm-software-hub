# CAEDM Software Hub

The explicitly requested administrator-assisted authentication recovery may use the service credential only for Auth admin generateLink after the signed-in operator's fresh-auth PostgreSQL authorization returns the exact eligible target, and for the capability-bound encrypted-token recovery redemption RPC. Never use that client for business queries, credential display, role changes or bypassing verification/MFA. Keep capability expiry and recovery/session restrictions enforced in PostgreSQL as well as server actions.

Whenever a new application release is prepared, update the version in package.json and add a corresponding entry to src/lib/releases.ts. Ensure the release validation tests pass before deployment.

Do not invent historical semantic versions or release dates. Prepared releases have an explicit unreleased status. Keep package-lock.json version metadata aligned. Developer authorization is independent of organization roles; preserve the UUID-pinned Super Admin protection. Role previews must downscope both server operations and RLS without changing auth.uid(), session identity or real roles. New Developer Tools work requires explicit approval before any push, deployment, hosted migration, real access change or bulk announcement.

Use Next.js App Router and Supabase. Never print or commit .env.local or service credentials. Keep approval, verification, roles and team authorization enforced in PostgreSQL RLS as well as server actions. All business queries use the signed-in user's client; reserve the service key for server-side authentication throttling, scheduled jobs, and administrator-controlled invitation onboarding. Do not use synthetic records as an authorization bypass. Preserve historical financial records. Keep currencies separate and projected payments separate from recorded expenses. Run npm run check, npm test, npm run test:db, npm run build and npm run test:e2e for relevant changes. Never apply migrations to a remote project or seed it without an explicitly selected target. See README.md for setup and deployment.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
