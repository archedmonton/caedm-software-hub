-- Add reusable category metadata without rewriting existing software or expense history.
create table public.software_categories (
 id uuid primary key default gen_random_uuid(),
 name text not null check(name=btrim(name) and length(name) between 1 and 80),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index software_categories_name_unique on public.software_categories(lower(name));
alter table public.software_categories enable row level security;
revoke all on public.software_categories from public,anon,authenticated,service_role;
grant select,insert on public.software_categories to authenticated;
create policy categories_read on public.software_categories for select to authenticated using(private.active_role() is not null);
create policy categories_insert on public.software_categories for insert to authenticated with check(private.is_finance());
create trigger audit after insert on public.software_categories for each row execute function private.audit();
create trigger rate_limit before insert on public.software_categories for each row execute function private.limit_write();
insert into public.software_categories(name)
 select distinct on(lower(btrim(category))) btrim(category) from public.software_subscriptions
 where length(btrim(category)) between 1 and 80 order by lower(btrim(category)),btrim(category);
insert into public.software_categories(name) values('Productivity') on conflict(lower(name)) do nothing;

-- The caller uses its signed-in client. Only administrators may discover candidates
-- or grant a department membership; approval, verification and protected roles remain enforced.
create function public.software_employee_candidates()
 returns table(id uuid,full_name text,email text) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Administrator access required'; end if;
 return query select p.id,p.full_name,p.email from public.profiles p join auth.users u on u.id=p.id
 where p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)
 and u.email ~* '^[^@[:space:]]+@caedm\.ca$' and private.can_manage_account(p.id)
 and not exists(select 1 from public.employee_invitations i where i.email=lower(p.email) and i.status<>'accepted')
 order by p.full_name,p.id;
end $$;
revoke all on function public.software_employee_candidates() from public,anon,authenticated,service_role;
grant execute on function public.software_employee_candidates() to authenticated;

create function public.assign_software_employee(department uuid,employee uuid)
 returns table(id uuid,full_name text,email text,can_manage boolean) language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(73303);
 if not private.is_admin() or not coalesce(private.can_manage_account(employee),false) then raise exception 'Administrator access to this employee is required'; end if;
 if not exists(select 1 from public.teams where public.teams.id=department) then raise exception 'Select an existing department'; end if;
 perform 1 from public.profiles p join auth.users u on u.id=p.id
 where p.id=employee and p.status='active' and u.email_confirmed_at is not null
 and lower(u.email)=lower(p.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$'
 and not exists(select 1 from public.employee_invitations i where i.email=lower(p.email) and i.status<>'accepted') for update of p;
 if not found then raise exception 'Select a verified, active employee with completed password setup'; end if;
 -- Ownership only needs View access. Do not downgrade an existing Manage membership.
 insert into public.team_members(team_id,profile_id,can_manage) values(department,employee,false)
 on conflict(team_id,profile_id) do nothing;
 return query select p.id,p.full_name,p.email,m.can_manage from public.profiles p
 join public.team_members m on m.profile_id=p.id where p.id=employee and m.team_id=department;
end $$;
revoke all on function public.assign_software_employee(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assign_software_employee(uuid,uuid) to authenticated;

-- Ownership must remain valid even for direct SQL/API writes and stale browser choices.
create or replace function private.owner_valid(t uuid,p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p is null or exists(select 1 from public.team_members m join public.profiles pr on pr.id=m.profile_id join auth.users u on u.id=pr.id
 where m.team_id=t and m.profile_id=p and pr.status='active' and u.email_confirmed_at is not null
 and lower(u.email)=lower(pr.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$'
 and not exists(select 1 from public.employee_invitations i where i.email=lower(pr.email) and i.status<>'accepted'))
$$;
