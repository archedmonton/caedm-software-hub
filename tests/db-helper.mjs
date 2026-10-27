import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export async function database() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create schema auth;create table auth.users(id uuid primary key,email text not null,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',encrypted_password text default '');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;grant usage on schema public to authenticated,anon,service_role,supabase_auth_admin;`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  return db;
}
export const ids = {
  admin: "90000000-0000-4000-8000-000000000001",
  finance: "90000000-0000-4000-8000-000000000002",
  staff: "90000000-0000-4000-8000-000000000003",
  other: "90000000-0000-4000-8000-000000000004",
  pending: "90000000-0000-4000-8000-000000000005",
  unverified: "90000000-0000-4000-8000-000000000006",
};
export async function fixtures(db) {
  for (const [role, id] of Object.entries(ids))
    await db.query(
      `insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,$4)`,
      [
        id,
        `${role}@caedm.ca`,
        role === "unverified" ? null : new Date().toISOString(),
        JSON.stringify({
          full_name: `Test ${role}`,
          role: "admin",
          status: "active",
        }),
      ],
    );
  await db.exec(
    `update public.profiles set role='admin',status='active' where id='${ids.admin}';update public.profiles set role='finance',status='active' where id='${ids.finance}';update public.profiles set status='active' where id in ('${ids.staff}','${ids.other}');`,
  );
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  await db.exec(
    `insert into public.team_members(team_id,profile_id,can_manage) values('10000000-0000-4000-8000-000000000001','${ids.staff}',true),('10000000-0000-4000-8000-000000000002','${ids.other}',true);update public.software_subscriptions set owner_id='${ids.staff}' where team_id='10000000-0000-4000-8000-000000000001';`,
  );
}
export async function asUser(db, id, fn) {
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','',false);`,
    );
  }
}
