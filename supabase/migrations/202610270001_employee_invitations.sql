-- Additive administrator invitations. Existing accounts and permissions are preserved.
create table public.employee_invitations (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check(email=lower(email) and email ~ '^[^@[:space:]]+@caedm\.ca$'),
 full_name text not null check(length(btrim(full_name)) between 1 and 150),
 team_id uuid not null references public.teams on delete restrict,
 role public.app_role not null default 'staff',
 can_manage boolean not null default false,
 invited_by uuid not null references public.profiles on delete restrict,
 onboarding_user_id uuid not null unique default gen_random_uuid(),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending' check(status in ('pending','accepted','revoked')),
 delivery_status text not null default 'sending' check(delivery_status in ('sending','sent','failed')),
 delivery_error text,
 send_count integer not null default 1,
 last_sent_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '72 hours',
 accepted_at timestamptz,
 accepted_user_id uuid references public.profiles on delete restrict,
 accept_claim uuid,
 accept_until timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.employee_invitations enable row level security;
create policy invitations_admin_read on public.employee_invitations for select to authenticated using(private.is_admin());
revoke all on public.employee_invitations from public,anon,authenticated;
grant select(id,email,full_name,team_id,role,can_manage,invited_by,status,delivery_status,delivery_error,send_count,last_sent_at,expires_at,accepted_at,created_at,updated_at) on public.employee_invitations to authenticated;
grant all on public.employee_invitations to service_role;
create index invitations_expiry_idx on public.employee_invitations(expires_at) where status='pending';
create trigger touch_invitation before update on public.employee_invitations for each row execute function private.touch();

create function private.audit_invitation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(actor_id,entity,record_id,action,before_data,after_data)
 values(auth.uid(),'employee_invitations',new.id::text,tg_op,
 case when tg_op='UPDATE' then to_jsonb(old)-array['token_hash','accept_claim','accept_until','onboarding_user_id'] end,
 to_jsonb(new)-array['token_hash','accept_claim','accept_until','onboarding_user_id']);
 return new;
end $$;
create trigger audit_invitation after insert or update on public.employee_invitations for each row execute function private.audit_invitation();
revoke all on function private.audit_invitation() from public,anon,authenticated;

-- Auth Admin applies app metadata after inserting auth.users. Reserve the user ID server-side
-- before creation; ordinary signup cannot choose it. Activation still checks trusted app metadata.
create or replace function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare pending_invite public.employee_invitations;
begin
 if new.email !~* '^[^@[:space:]]+@caedm\.ca$' then raise exception 'Only @caedm.ca work emails may register'; end if;
 perform pg_advisory_xact_lock(hashtextextended('invite:'||lower(new.email),0));
 select * into pending_invite from public.employee_invitations where email=lower(new.email);
 if found and (pending_invite.status<>'accepted') then
  if pending_invite.status<>'pending' or pending_invite.expires_at<=now()
   or pending_invite.accept_until is null or pending_invite.accept_until<=now()
   or new.id is distinct from pending_invite.onboarding_user_id then
   raise exception 'Complete the administrator invitation instead of registering';
  end if;
 end if;
 insert into public.profiles(id,full_name,email) values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1)),150),lower(new.email));
 return new;
end $$;

create or replace function private.guard_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='active' and not exists(select 1 from auth.users where id=new.id and email_confirmed_at is not null and lower(email)=lower(new.email)) then raise exception 'Email must be verified before approval'; end if;
 if new.status='active' and exists(select 1 from public.employee_invitations i where i.email=lower(new.email) and i.status<>'accepted') then raise exception 'Invitation password setup must be completed before activation'; end if;
 if old.role='admin' and old.status='active' and (new.role<>'admin' or new.status<>'active') then
  perform pg_advisory_xact_lock(73301);
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id<>old.id and p.role='admin' and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)) then raise exception 'Keep at least one active administrator'; end if;
 end if;
 return new;
end $$;

create function public.prepare_employee_invitation(
 token_digest text, person_name text default null, work_email text default null,
 department uuid default null, granted_role public.app_role default 'staff', manage boolean default false,
 existing_invitation uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.employee_invitations; target_email text; bucket_key text; used integer; existing_user auth.users;
begin
 if not coalesce(private.is_admin(),false) then raise exception 'Administrator access required'; end if;
 if token_digest !~ '^[a-f0-9]{64}$' or token_digest is null then raise exception 'Invalid invitation token'; end if;
 if existing_invitation is not null then
  select * into i from public.employee_invitations where id=existing_invitation for update;
  if not found or i.status<>'pending' then raise exception 'Only pending or expired invitations can be resent'; end if;
  if i.accept_until>now() then raise exception 'Invitation setup is in progress. Try again shortly'; end if;
  if i.last_sent_at>now()-interval '60 seconds' then raise exception 'Wait one minute before resending'; end if;
  target_email=i.email;
 else
  target_email=lower(btrim(work_email));
  if target_email is null or target_email !~ '^[^@[:space:]]+@caedm\.ca$' then raise exception 'Use a valid @caedm.ca email'; end if;
  if person_name is null or length(btrim(person_name)) not between 1 and 150 then raise exception 'Enter a full name'; end if;
  if not exists(select 1 from public.teams where id=department) then raise exception 'Select an existing department'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('invite:'||target_email,0));
 if existing_invitation is null then
  select * into i from public.employee_invitations where email=target_email for update;
  if found and i.status<>'revoked' then raise exception 'An invitation already exists. Use Resend or manage the registered account'; end if;
 end if;
 select * into existing_user from auth.users where lower(email)=target_email;
 if found and (i.id is null or existing_user.id is distinct from i.onboarding_user_id or existing_user.raw_app_meta_data->>'caedm_invitation_id' is distinct from i.id::text
  or not exists(select 1 from public.profiles where id=existing_user.id and status='pending_approval')) then
  raise exception 'This person already has an account. Manage their existing access';
 end if;
 bucket_key='employee-invites:'||auth.uid()::text;
 insert into private.rate_limits(key,window_start,hits) values(bucket_key,now(),1)
 on conflict(key) do update set
 hits=case when private.rate_limits.window_start<now()-interval '1 hour' then 1 else private.rate_limits.hits+1 end,
 window_start=case when private.rate_limits.window_start<now()-interval '1 hour' then now() else private.rate_limits.window_start end
 returning hits into used;
 if used>20 then raise exception 'Invitation limit reached. Try again in an hour'; end if;
 if i.id is null then
  insert into public.employee_invitations(email,full_name,team_id,role,can_manage,invited_by,token_hash)
  values(target_email,btrim(person_name),department,granted_role,manage,auth.uid(),token_digest) returning * into i;
 else
  update public.employee_invitations set
   full_name=case when existing_invitation is null then btrim(person_name) else full_name end,
   team_id=case when existing_invitation is null then department else team_id end,
   role=case when existing_invitation is null then granted_role else role end,
   can_manage=case when existing_invitation is null then manage else can_manage end,
   invited_by=auth.uid(),token_hash=token_digest,status='pending',delivery_status='sending',delivery_error=null,
   send_count=send_count+1,last_sent_at=now(),expires_at=now()+interval '72 hours',accept_claim=null,accept_until=null
  where id=i.id returning * into i;
 end if;
 return jsonb_build_object('id',i.id,'email',i.email,'full_name',i.full_name,'role',i.role,
 'department',(select name from public.teams where id=i.team_id),'expires_at',i.expires_at);
end $$;

create function public.finish_invitation_delivery(invitation uuid,token_digest text,successful boolean)
 returns void language plpgsql security definer set search_path='' as $$
begin
 update public.employee_invitations set delivery_status=case when successful then 'sent' else 'failed' end,
 delivery_error=case when successful then null else 'Email delivery failed. Check SMTP settings and resend.' end
 where id=invitation and token_hash=token_digest and status='pending';
 if not found then raise exception 'Invitation was changed or revoked'; end if;
end $$;

create function public.revoke_employee_invitation(invitation uuid)
 returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(private.is_admin(),false) then raise exception 'Administrator access required'; end if;
 update public.employee_invitations set status='revoked',accept_claim=null,accept_until=null where id=invitation and status='pending';
 if not found then raise exception 'Only pending invitations can be revoked'; end if;
end $$;

create function public.claim_employee_invitation(token_digest text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.employee_invitations; existing_user auth.users; claim uuid;
begin
 select * into i from public.employee_invitations where token_hash=token_digest for update;
 if not found or i.status<>'pending' or i.expires_at<=now() then raise exception 'Invitation is invalid, expired, or already used'; end if;
 if i.accept_until>now() then raise exception 'Invitation setup is already in progress. Try again shortly'; end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=i.invited_by and p.role='admin' and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)) then raise exception 'Ask an administrator to resend this invitation'; end if;
 select * into existing_user from auth.users where lower(email)=i.email;
 if found and (existing_user.id is distinct from i.onboarding_user_id or existing_user.raw_app_meta_data->>'caedm_invitation_id' is distinct from i.id::text
  or not exists(select 1 from public.profiles where id=existing_user.id and status='pending_approval')) then
  raise exception 'This email already has an account. Sign in or contact your administrator';
 end if;
 claim=gen_random_uuid();
 update public.employee_invitations set accept_claim=claim,accept_until=now()+interval '5 minutes' where id=i.id;
 return jsonb_build_object('id',i.id,'email',i.email,'full_name',i.full_name,'claim',claim,'user_id',existing_user.id,'new_user_id',i.onboarding_user_id);
end $$;

create function public.release_employee_invitation(invitation uuid,claim uuid)
 returns void language plpgsql security definer set search_path='' as $$
begin
 update public.employee_invitations set accept_claim=null,accept_until=null where id=invitation and accept_claim=claim and status='pending';
end $$;

create function public.complete_employee_invitation(invitation uuid,claim uuid,employee uuid)
 returns void language plpgsql security definer set search_path='' as $$
declare i public.employee_invitations;
begin
 select * into i from public.employee_invitations where id=invitation for update;
 if not found or i.status<>'pending' or i.expires_at<=now() or claim is null or i.accept_claim is null or i.accept_claim is distinct from claim or i.accept_until is null or i.accept_until<=now() then raise exception 'Invitation is invalid, expired, or revoked'; end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=i.invited_by and p.role='admin' and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)) then raise exception 'Administrator approval is no longer valid'; end if;
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=employee and employee=i.onboarding_user_id and lower(u.email)=i.email and u.email_confirmed_at is not null and coalesce(u.encrypted_password,'')<>'' and u.raw_app_meta_data->>'caedm_invitation_id'=i.id::text and p.status='pending_approval') then raise exception 'Password setup is incomplete'; end if;
 update public.employee_invitations set status='accepted',accepted_at=now(),accepted_user_id=employee,accept_claim=null,accept_until=null where id=i.id;
 update public.profiles set full_name=i.full_name,role=i.role,status='active' where id=employee;
 insert into public.team_members(team_id,profile_id,can_manage) values(i.team_id,employee,i.can_manage)
 on conflict(team_id,profile_id) do update set can_manage=excluded.can_manage;
end $$;

revoke all on function public.prepare_employee_invitation(text,text,text,uuid,public.app_role,boolean,uuid),public.revoke_employee_invitation(uuid) from public,anon;
grant execute on function public.prepare_employee_invitation(text,text,text,uuid,public.app_role,boolean,uuid),public.revoke_employee_invitation(uuid) to authenticated;
revoke all on function public.finish_invitation_delivery(uuid,text,boolean),public.claim_employee_invitation(text),public.release_employee_invitation(uuid,uuid),public.complete_employee_invitation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_invitation_delivery(uuid,text,boolean),public.claim_employee_invitation(text),public.release_employee_invitation(uuid,uuid),public.complete_employee_invitation(uuid,uuid,uuid) to service_role;
