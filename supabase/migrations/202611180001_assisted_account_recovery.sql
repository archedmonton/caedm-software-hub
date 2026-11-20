-- Administrator-assisted recovery uses Supabase's one-use recovery tokens, never shared passwords.
-- Apply only after the reviewed Developer governance migration to the explicitly selected target.
create table private.account_recoveries (
 profile_id uuid primary key references public.profiles(id) on delete restrict,
 id uuid not null unique default gen_random_uuid(), issuer_id uuid not null references public.profiles(id),
 started_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
 token_digest text, sealed_token text, claim_until timestamptz, completed_at timestamptz
);
alter table private.account_recoveries enable row level security;
revoke all on private.account_recoveries from public,anon,authenticated,service_role;
alter table private.account_email_notifications drop constraint account_email_notifications_kind_check;
alter table private.account_email_notifications add constraint account_email_notifications_kind_check check(kind in ('approval','access_changed','role_changed','recovery_started','recovery_completed'));

create function private.recovery_session_allowed(person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.account_recoveries r where r.profile_id=person and
  (r.completed_at is null or not exists(select 1 from auth.sessions s where s.user_id=person and s.id::text=private.request_session() and s.created_at>r.completed_at)))
$$;
alter function private.actual_role() rename to role_before_recovery;
-- Feature submission is otherwise intentionally available to pending accounts;
-- a recovered account's old session must not retain this exception.
alter function private.can_request_features() rename to feature_requester_before_recovery;
create function private.can_request_features() returns boolean language sql stable security definer set search_path='' as $$
 select private.feature_requester_before_recovery() and private.recovery_session_allowed(auth.uid())
$$;
revoke all on function private.feature_requester_before_recovery(),private.can_request_features() from public,anon,authenticated,service_role;
grant execute on function private.can_request_features() to authenticated;
-- Policies retain function OIDs across renames; bind this policy to the guarded wrapper.
alter policy requests_read on public.feature_requests using((private.can_request_features() and requester_id=auth.uid()) or private.is_admin());
create function private.actual_role() returns public.app_role language sql stable security definer set search_path='' as $$
 select private.role_before_recovery() where private.recovery_session_allowed(auth.uid())
$$;
alter function private.developer_eligible(uuid) rename to eligible_before_recovery;
create function private.developer_eligible(person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.eligible_before_recovery(person) and not exists(select 1 from private.account_recoveries where profile_id=person and completed_at is null)
$$;
create or replace function private.is_developer() returns boolean language sql stable security definer set search_path='' as $$
 select private.actual_role() is not null and private.has_developer_access(auth.uid()) and (private.current_preview()).id is null
$$;
create or replace function public.get_access_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('actual_role',private.actual_role(),'effective_role',private.active_role(),'developer',private.has_developer_access(auth.uid()),'tools_allowed',private.is_developer(),'preview_role',(private.current_preview()).preview_role,'preview_id',(private.current_preview()).id,'preview_expires_at',(private.current_preview()).expires_at,'recovery_required',not private.recovery_session_allowed(auth.uid()))
$$;
create function private.recovery_operator(person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.developer_eligible(person) and exists(select 1 from public.profiles p where p.id=person and
  (p.role='super_admin' or exists(select 1 from private.developer_access d where d.profile_id=person and d.active)))
$$;
create function private.require_recovery_operator(fresh boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare claims jsonb; password_at numeric;
begin
 if not private.recovery_operator(auth.uid()) or not private.recovery_session_allowed(auth.uid()) or (private.current_preview()).id is not null then raise exception 'Developer or Super Admin access required outside role preview'; end if;
 if not fresh then return; end if;
 claims=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 select max((value->>'timestamp')::numeric) into password_at from jsonb_array_elements(coalesce(claims->'amr','[]'::jsonb)) where value->>'method'='password';
 if password_at is null or password_at<extract(epoch from now())-90 or password_at>extract(epoch from now())+5 then raise exception 'Fresh password verification required'; end if;
 if (coalesce((select require_mfa from private.developer_governance where singleton),false) or exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status::text='verified')) and coalesce(claims->>'aal','')<>'aal2' then raise exception 'MFA step-up required'; end if;
end $$;
create function private.recovery_target(person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select person<>auth.uid() and private.eligible_before_recovery(person)
 and not exists(select 1 from public.profiles where id=person and role='super_admin')
 and not exists(select 1 from private.developer_protection where profile_id=person)
 and not exists(select 1 from private.developer_access where profile_id=person and active)
 and not exists(select 1 from auth.mfa_factors where user_id=person and status::text='verified')
$$;
create function public.account_recovery_console() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_recovery_operator();
 return jsonb_build_object('require_mfa',coalesce((select require_mfa from private.developer_governance where singleton),false),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,'role',p.role,'pending',r.profile_id is not null and r.completed_at is null,'expires_at',r.expires_at) order by p.full_name,p.id),'[]') from public.profiles p left join private.account_recoveries r on r.profile_id=p.id where private.recovery_target(p.id)),
 'history',(select coalesce(jsonb_agg(x),'[]') from (select a.id,a.actor_id,a.subject_id,a.action,a.created_at from private.developer_audit a where a.action in ('account_recovery_started','account_recovery_prepared','account_recovery_completed') order by a.created_at desc limit 30) x));
end $$;
create function public.begin_account_recovery(person uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.account_recoveries;
begin
 perform pg_advisory_xact_lock(73303);
 perform private.require_recovery_operator(true);
 if not coalesce(private.recovery_target(person),false) then raise exception 'Select an eligible verified employee; protected or MFA accounts require IT recovery'; end if;
 if exists(select 1 from private.account_recoveries where profile_id=person and started_at>clock_timestamp()-interval '1 minute') then raise exception 'Wait one minute before replacing a recovery link'; end if;
 if exists(select 1 from private.account_recoveries where profile_id=person and claim_until>clock_timestamp()) then raise exception 'Wait one minute; recovery setup is in progress'; end if;
 if (select count(*) from private.developer_audit where actor_id=auth.uid() and action='account_recovery_started' and created_at>now()-interval '1 hour')>=5 then raise exception 'Recovery limit reached; contact IT'; end if;
 insert into private.account_recoveries(profile_id,issuer_id) values(person,auth.uid()) on conflict(profile_id) do update set id=gen_random_uuid(),issuer_id=auth.uid(),started_at=clock_timestamp(),expires_at=clock_timestamp()+interval '15 minutes',token_digest=null,sealed_token=null,claim_until=null,completed_at=null returning * into r;
 insert into private.developer_audit(actor_id,subject_id,action) values(auth.uid(),person,'account_recovery_started');
 insert into private.account_email_notifications(recipient_id,actor_id,kind,before_role,after_role,before_status,after_status)
 select p.id,auth.uid(),'recovery_started',p.role::text,p.role::text,p.status::text,p.status::text from public.profiles p where p.id=person;
 return jsonb_build_object('id',r.id,'profile_id',person,'email',(select email from public.profiles where id=person),'expires_at',r.expires_at);
end $$;
create function public.bind_account_recovery(recovery uuid,token_digest text,sealed_token text) returns void language plpgsql security definer set search_path='' as $$
declare person uuid;
begin
 perform private.require_recovery_operator(true);
 if token_digest is null or token_digest!~'^[a-f0-9]{32}$' then raise exception 'Invalid token fingerprint'; end if;
 if sealed_token is null or length(sealed_token) not between 40 and 2048 or sealed_token!~'^v1\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$' then raise exception 'Invalid sealed token'; end if;
 update private.account_recoveries r set token_digest=bind_account_recovery.token_digest,sealed_token=bind_account_recovery.sealed_token where r.id=recovery and issuer_id=auth.uid() and r.completed_at is null and r.token_digest is null and r.expires_at>clock_timestamp() and private.recovery_target(r.profile_id) returning profile_id into person;
 if person is null then raise exception 'Recovery preparation expired or superseded'; end if;
 insert into private.developer_audit(actor_id,subject_id,action) values(auth.uid(),person,'account_recovery_prepared');
end $$;
-- A high-entropy bearer capability is validated before Auth's OTP API. No identity is disclosed for bad tokens.
create function public.validate_account_recovery(recovery uuid,token_hash text) returns uuid language sql stable security definer set search_path='' as $$
 select r.profile_id from private.account_recoveries r where r.id=recovery and token_hash~'^[a-f0-9]{32,128}$' and r.token_digest=md5(token_hash) and r.completed_at is null and r.expires_at>clock_timestamp()
 and private.recovery_operator(r.issuer_id) and private.eligible_before_recovery(r.profile_id)
 and not exists(select 1 from public.profiles where id=r.profile_id and role='super_admin')
 and not exists(select 1 from private.developer_access where profile_id=r.profile_id and active)
 and not exists(select 1 from private.developer_protection where profile_id=r.profile_id)
 and not exists(select 1 from auth.mfa_factors where user_id=r.profile_id and status::text='verified')
$$;
create function public.claim_account_recovery(recovery uuid,token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.account_recoveries;
begin
 perform pg_advisory_xact_lock(73303);
 update private.account_recoveries q set claim_until=clock_timestamp()+interval '30 seconds'
 where q.id=recovery and q.sealed_token is not null and (q.claim_until is null or q.claim_until<clock_timestamp()) and q.profile_id=public.validate_account_recovery(recovery,token_hash) returning * into r;
 if r.id is null then return null; end if;
 return jsonb_build_object('profile_id',r.profile_id,'sealed_token',r.sealed_token);
end $$;
create function private.complete_assisted_recovery() returns trigger language plpgsql security definer set search_path='' as $$
declare person uuid;
begin
 if coalesce(new.encrypted_password,'')='' or new.encrypted_password is not distinct from old.encrypted_password then return new; end if;
 update private.account_recoveries set completed_at=clock_timestamp(),token_digest=null,sealed_token=null,claim_until=null where profile_id=new.id and completed_at is null returning profile_id into person;
 if person is not null then
  insert into private.developer_audit(subject_id,action) values(person,'account_recovery_completed');
  insert into private.account_email_notifications(recipient_id,kind,before_role,after_role,before_status,after_status)
  select p.id,'recovery_completed',p.role::text,p.role::text,p.status::text,p.status::text from public.profiles p where p.id=person;
 end if;
 return new;
end $$;
create trigger complete_assisted_recovery after update of encrypted_password on auth.users for each row execute function private.complete_assisted_recovery();
revoke all on function private.recovery_session_allowed(uuid),private.role_before_recovery(),private.actual_role(),private.eligible_before_recovery(uuid),private.developer_eligible(uuid),private.recovery_operator(uuid),private.require_recovery_operator(boolean),private.recovery_target(uuid),private.complete_assisted_recovery() from public,anon,authenticated,service_role;
revoke all on function public.account_recovery_console(),public.begin_account_recovery(uuid),public.bind_account_recovery(uuid,text,text),public.validate_account_recovery(uuid,text),public.claim_account_recovery(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.account_recovery_console(),public.begin_account_recovery(uuid),public.bind_account_recovery(uuid,text,text) to authenticated;
grant execute on function public.validate_account_recovery(uuid,text) to anon,authenticated;
grant execute on function public.claim_account_recovery(uuid,text) to service_role;
