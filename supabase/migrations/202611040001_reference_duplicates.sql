-- Reject new case/space variants without merging or renaming historical records.
-- A per-name transaction lock also covers concurrent inserts and renames.
create function private.guard_reference_duplicate() returns trigger
 language plpgsql security definer set search_path='' as $$
declare label_column text; name_key text; scope_key text; duplicate_found boolean;
begin
 if auth.uid() is not null and
   ((tg_table_name='teams' and not private.is_admin()) or (tg_table_name<>'teams' and not private.is_finance()))
 then return new; end if; -- Existing RLS rejects unauthorized writes without disclosing names.
 label_column=case when tg_table_name='payment_methods' then 'nickname' else 'name' end;
 name_key=lower(btrim(to_jsonb(new)->>label_column));
 scope_key=case when tg_table_name='payment_methods' then to_jsonb(new)->>'team_id' else '' end;
 if tg_op='UPDATE' then
  if name_key=lower(btrim(to_jsonb(old)->>label_column))
   and (tg_table_name<>'payment_methods' or to_jsonb(old)->>'team_id'=scope_key)
  then return new; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('software-reference:'||tg_table_name||':'||scope_key||':'||name_key,0));
 execute format('select exists(select 1 from public.%I where lower(btrim(%I))=$1 and id<>$2%s)',
  tg_table_name,label_column,case when tg_table_name='payment_methods' then ' and team_id::text=$3' else '' end)
 into duplicate_found using name_key,new.id,scope_key;
 if duplicate_found then
  raise exception using errcode='23505',message='This name is already in the list. Select the existing entry or use a different name.';
 end if;
 return new;
end $$;
revoke all on function private.guard_reference_duplicate() from public,anon,authenticated,service_role;
create trigger guard_reference_duplicate before insert or update of name on public.vendors for each row execute function private.guard_reference_duplicate();
create trigger guard_reference_duplicate before insert or update of name on public.teams for each row execute function private.guard_reference_duplicate();
create trigger guard_reference_duplicate before insert or update of name on public.software_categories for each row execute function private.guard_reference_duplicate();
create trigger guard_reference_duplicate before insert or update of nickname,team_id on public.payment_methods for each row execute function private.guard_reference_duplicate();

-- Existing members belong in the owner dropdown, not a second assignment.
create or replace function public.assign_software_employee(department uuid,employee uuid)
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
 if exists(select 1 from public.team_members where team_id=department and profile_id=employee) then
  raise exception using errcode='23505',message='This employee is already in the list for this department. Select them from Responsible employee instead.';
 end if;
 insert into public.team_members(team_id,profile_id,can_manage) values(department,employee,false);
 return query select p.id,p.full_name,p.email,m.can_manage from public.profiles p
 join public.team_members m on m.profile_id=p.id where p.id=employee and m.team_id=department;
end $$;
revoke all on function public.assign_software_employee(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assign_software_employee(uuid,uuid) to authenticated;
