# CAEDM Software Hub

Use Next.js App Router and Supabase. Never print or commit .env.local or service credentials. Keep approval, verification, roles and team authorization enforced in PostgreSQL RLS as well as server actions. All business queries use the signed-in user's client; reserve the service key for server-side authentication throttling, scheduled jobs, and administrator-controlled invitation onboarding. Do not use synthetic records as an authorization bypass. Preserve historical financial records. Keep currencies separate and projected payments separate from recorded expenses. Run npm run check, npm test, npm run test:db, npm run build and npm run test:e2e for relevant changes. Never apply migrations to a remote project or seed it without an explicitly selected target. See README.md for setup and deployment.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
