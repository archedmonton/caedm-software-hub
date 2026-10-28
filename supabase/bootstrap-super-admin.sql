-- Run as the database administrator only against an explicitly selected project.
-- Requires migrations 202610280003 and 202610280004 and the existing, verified,
-- active ruban.peppin@caedm.ca account with any invitation fully completed.
-- No Auth user or synthetic profile is created; the protected UUID is pinned once.
select private.bootstrap_developer_super_admin();
