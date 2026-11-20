-- Developer designation is independent of app_role. No Auth identity or organization role is changed.
create table private.developer_access (
 profile_id uuid primary key references public.profiles(id) on delete restrict,
 active boolean not null default true,
 granted_at timestamptz not null default now(),
 granted_by uuid,
 revoked_at timestamptz,
 last_seen_at timestamptz
);
create table private.developer_governance (
 singleton boolean primary key default true check(singleton),
 primary_id uuid not null references private.developer_access(profile_id) on delete restrict,
 require_mfa boolean not null default false,
 approved_successor uuid references private.developer_access(profile_id),
 successor_approved_at timestamptz,
 updated_at timestamptz not null default now()
);
create table private.role_previews (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id),
 session_id text not null,
 actual_role public.app_role not null,
 preview_role public.app_role not null,
 started_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 minutes',
 ended_at timestamptz,
 end_reason text
);
create unique index one_open_preview on private.role_previews(profile_id,session_id) where ended_at is null;
create table private.developer_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid, subject_id uuid,
 action text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table private.developer_security_emails (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id),
 actor_id uuid, kind text not null check(kind in ('developer_granted','developer_revoked','primary_handover')),
 created_at timestamptz not null default now(), status text not null default 'queued' check(status in ('queued','sending','accepted','failed','skipped')),
 attempts integer not null default 0 check(attempts between 0 and 5),claimed_at timestamptz,claim_token uuid,accepted_at timestamptz
);
do $$ declare t text; begin
 foreach t in array array['developer_access','developer_governance','role_previews','developer_audit','developer_security_emails'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function private.actual_role() returns public.app_role language sql stable security definer set search_path='' as $$
 select p.role from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$'
$$;
create function private.request_session() returns text language sql stable set search_path='' as $$
 select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id'
$$;
create function private.developer_eligible(person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=person and p.status='active' and u.email_confirmed_at is not null and lower(p.email)=lower(u.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$'
 and not exists(select 1 from public.employee_invitations i where i.email=lower(p.email) and i.status<>'accepted'))
$$;
create function private.has_developer_access(person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.developer_eligible(person) and exists(select 1 from private.developer_access d where d.profile_id=person and d.active)
$$;
create function private.preview_allowed(actual public.app_role,preview public.app_role) returns boolean language sql immutable set search_path='' as $$
 select coalesce((actual='super_admin' and preview in ('admin','finance','staff')) or (actual='admin' and preview in ('finance','staff')) or (actual='finance' and preview='staff'),false)
$$;
create function private.current_preview() returns private.role_previews language sql stable security definer set search_path='' as $$
 select r from private.role_previews r where r.profile_id=auth.uid() and r.session_id=private.request_session() and r.ended_at is null and r.expires_at>now()
$$;
create or replace function private.active_role() returns public.app_role language plpgsql stable security definer set search_path='' as $$
declare actual public.app_role; preview private.role_previews;
begin
 actual=private.actual_role();
 if actual is null then return null; end if;
 preview=private.current_preview();
 if preview.id is null then return actual; end if;
 if not private.has_developer_access(auth.uid()) or not private.preview_allowed(actual,preview.preview_role) then return null; end if;
 return preview.preview_role;
end $$;
create function private.is_developer() returns boolean language sql stable security definer set search_path='' as $$
 select private.has_developer_access(auth.uid()) and (private.current_preview()).id is null
$$;
create function private.require_developer() returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_developer() then raise exception 'Developer authorization required outside role preview'; end if; end $$;
revoke all on function private.actual_role(),private.request_session(),private.developer_eligible(uuid),private.has_developer_access(uuid),private.preview_allowed(public.app_role,public.app_role),private.current_preview(),private.is_developer(),private.require_developer() from public,anon,authenticated,service_role;

create function public.get_access_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('actual_role',private.actual_role(),'effective_role',private.active_role(),'developer',private.has_developer_access(auth.uid()),'tools_allowed',private.is_developer(),'preview_role',(private.current_preview()).preview_role,'preview_id',(private.current_preview()).id,'preview_expires_at',(private.current_preview()).expires_at)
$$;
revoke all on function public.get_access_context() from public,anon;
grant execute on function public.get_access_context() to authenticated;

create function public.start_role_preview(selected_role public.app_role) returns uuid language plpgsql security definer set search_path='' as $$
declare actual public.app_role; preview_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('developer:'||auth.uid()::text,0));
 perform private.require_developer();
 actual=private.actual_role();
 if private.request_session() is null or not private.preview_allowed(actual,selected_role) then raise exception 'This role preview is not permitted'; end if;
 update private.role_previews set ended_at=least(now(),expires_at),end_reason='replaced_or_expired' where profile_id=auth.uid() and session_id=private.request_session() and ended_at is null;
 insert into private.role_previews(profile_id,session_id,actual_role,preview_role) values(auth.uid(),private.request_session(),actual,selected_role) returning id into preview_id;
 insert into private.developer_audit(actor_id,action,detail) values(auth.uid(),'preview_started',jsonb_build_object('preview_id',preview_id,'actual_role',actual,'preview_role',selected_role));
 return preview_id;
end $$;
create function public.end_role_preview() returns void language plpgsql security definer set search_path='' as $$
declare r private.role_previews;
begin
 update private.role_previews set ended_at=least(now(),expires_at),end_reason='returned_or_signed_out' where profile_id=auth.uid() and session_id=private.request_session() and ended_at is null returning * into r;
 if r.id is not null then insert into private.developer_audit(actor_id,action,detail) values(auth.uid(),'preview_ended',jsonb_build_object('preview_id',r.id,'actual_role',r.actual_role,'preview_role',r.preview_role)); end if;
end $$;
revoke all on function public.start_role_preview(public.app_role),public.end_role_preview() from public,anon;
grant execute on function public.start_role_preview(public.app_role),public.end_role_preview() to authenticated;

alter table public.audit_logs add column context jsonb not null default '{}';
create function private.add_preview_audit_context() returns trigger language plpgsql security definer set search_path='' as $$
declare p private.role_previews;
begin
 p=private.current_preview();
 if p.id is not null then new.context=jsonb_build_object('preview_id',p.id,'actual_role',private.actual_role(),'preview_role',p.preview_role,'real_actor_id',auth.uid()); end if;
 return new;
end $$;
revoke all on function private.add_preview_audit_context() from public,anon,authenticated,service_role;
create trigger add_preview_context before insert on public.audit_logs for each row execute function private.add_preview_audit_context();

-- Operator-only initial designation: requires the already pinned protected identity.
create function private.bootstrap_developer_access(person uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.developer_protection where profile_id=person) or not private.developer_eligible(person) then raise exception 'Select the existing verified protected developer'; end if;
 if exists(select 1 from private.developer_governance where primary_id<>person) then raise exception 'Primary developer is already established'; end if;
 insert into private.developer_access(profile_id) values(person) on conflict(profile_id) do nothing;
 insert into private.developer_governance(singleton,primary_id) values(true,person) on conflict(singleton) do nothing;
 insert into private.developer_audit(actor_id,subject_id,action) values(null,person,'operator_bootstrap');
end $$;
revoke all on function private.bootstrap_developer_access(uuid) from public,anon,authenticated,service_role;
-- No email-based automatic grant; an authorized operator explicitly bootstraps the pinned UUID.

create function private.require_fresh_developer_password() returns void language plpgsql security definer set search_path='' as $$
declare claims jsonb; password_at numeric;
begin
 perform private.require_developer();
 claims=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 select max((value->>'timestamp')::numeric) into password_at from jsonb_array_elements(coalesce(claims->'amr','[]'::jsonb)) where value->>'method'='password';
 if password_at is null or password_at<extract(epoch from now())-90 or password_at>extract(epoch from now())+5 then raise exception 'Fresh password verification required'; end if;
 if ((select require_mfa from private.developer_governance where singleton) or exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status::text='verified')) and coalesce(claims->>'aal','')<>'aal2' then raise exception 'MFA step-up required'; end if;
end $$;
revoke all on function private.require_fresh_developer_password() from public,anon,authenticated,service_role;

create function public.developer_directory() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_developer();
 return jsonb_build_object('primary_id',(select primary_id from private.developer_governance where singleton),'require_mfa',coalesce((select require_mfa from private.developer_governance where singleton),false),'approved_successor',(select approved_successor from private.developer_governance where singleton),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,'role',p.role,'developer_active',coalesce(d.active,false),'granted_at',d.granted_at,'granted_by',d.granted_by,'last_seen_at',d.last_seen_at) order by p.full_name,p.id),'[]') from public.profiles p left join private.developer_access d on d.profile_id=p.id where private.developer_eligible(p.id)),
 'audit',(select coalesce(jsonb_agg(q),'[]') from (select id,actor_id,subject_id,action,detail,created_at from private.developer_audit order by created_at desc limit 50) q));
end $$;
create function public.visit_developer_tools() returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_developer(); update private.developer_access set last_seen_at=now() where profile_id=auth.uid(); end $$;
create function public.change_developer_access(person uuid,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare primary_person uuid;
begin
 perform pg_advisory_xact_lock(73310);
 perform private.require_fresh_developer_password();
 select primary_id into primary_person from private.developer_governance where singleton for update;
 if primary_person is null or person is null or enabled is null or person=auth.uid() or person=primary_person or not private.developer_eligible(person) then raise exception 'This developer access change is not permitted'; end if;
 if coalesce((select active from private.developer_access where profile_id=person),false)=enabled then raise exception 'Developer access already has this state'; end if;
 insert into private.developer_access(profile_id,active,granted_by,revoked_at) values(person,enabled,auth.uid(),case when enabled then null else now() end)
 on conflict(profile_id) do update set active=excluded.active,granted_at=case when enabled then now() else private.developer_access.granted_at end,granted_by=case when enabled then auth.uid() else private.developer_access.granted_by end,revoked_at=case when enabled then null else now() end;
 insert into private.developer_audit(actor_id,subject_id,action) values(auth.uid(),person,case when enabled then 'developer_granted' else 'developer_revoked' end);
 insert into private.developer_security_emails(recipient_id,actor_id,kind) values(person,auth.uid(),case when enabled then 'developer_granted' else 'developer_revoked' end);
end $$;
revoke all on function public.developer_directory(),public.visit_developer_tools(),public.change_developer_access(uuid,boolean) from public,anon;
grant execute on function public.developer_directory(),public.visit_developer_tools(),public.change_developer_access(uuid,boolean) to authenticated;

create function private.authorize_developer_handover(successor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_developer_access(successor) or exists(select 1 from private.developer_governance where primary_id=successor) then raise exception 'Select an eligible secondary developer'; end if;
 update private.developer_governance set approved_successor=successor,successor_approved_at=now(),updated_at=now() where singleton;
 if not found then raise exception 'Bootstrap the primary developer first'; end if;
 insert into private.developer_audit(actor_id,subject_id,action) values(null,successor,'operator_handover_authorized');
end $$;
revoke all on function private.authorize_developer_handover(uuid) from public,anon,authenticated,service_role;
create function public.confirm_developer_handover(successor uuid) returns void language plpgsql security definer set search_path='' as $$
declare g private.developer_governance;
begin
 perform pg_advisory_xact_lock(73310); perform private.require_fresh_developer_password();
 select * into g from private.developer_governance where singleton for update;
 if g.primary_id is distinct from auth.uid() or g.approved_successor is distinct from successor or g.successor_approved_at<now()-interval '1 day' or not private.has_developer_access(successor) then raise exception 'Approved primary handover required'; end if;
 if not exists(select 1 from private.developer_access where profile_id=successor and last_seen_at>g.successor_approved_at-interval '1 day') then raise exception 'Successor must verify access to Developer Tools first'; end if;
 update private.developer_governance set primary_id=successor,approved_successor=null,successor_approved_at=null,updated_at=now() where singleton;
 insert into private.developer_audit(actor_id,subject_id,action,detail) values(auth.uid(),successor,'primary_handover_completed',jsonb_build_object('former_primary',g.primary_id));
 insert into private.developer_security_emails(recipient_id,actor_id,kind) values(successor,auth.uid(),'primary_handover'),(g.primary_id,auth.uid(),'primary_handover');
end $$;
revoke all on function public.confirm_developer_handover(uuid) from public,anon;
grant execute on function public.confirm_developer_handover(uuid) to authenticated;
