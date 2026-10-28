-- Additive role hierarchy. No new Auth user is created and no financial data changes.
create table private.developer_protection (
 singleton boolean primary key default true check(singleton),
 profile_id uuid not null unique references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now()
);
revoke all on private.developer_protection from public,anon,authenticated,service_role;

create or replace function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.active_role() in ('super_admin','admin'),false)
$$;
create or replace function private.is_finance() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.active_role() in ('super_admin','admin','finance'),false)
$$;
create function private.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.active_role()='super_admin',false)
$$;
create function private.can_manage_account(employee uuid) returns boolean language sql security definer set search_path='' as $$
 select private.is_admin() and exists(select 1 from public.profiles p where p.id=employee and
 case when exists(select 1 from private.developer_protection d where d.profile_id=p.id)
  then auth.uid()=p.id and private.is_super_admin()
  when p.role='super_admin' then private.is_super_admin()
  else true end)
$$;
revoke all on function private.is_super_admin(),private.can_manage_account(uuid) from public,anon;
grant execute on function private.is_super_admin(),private.can_manage_account(uuid) to authenticated;

create function public.get_developer_protection() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Administrator access required'; end if;
 return (select profile_id from private.developer_protection where singleton);
end $$;
revoke all on function public.get_developer_protection() from public,anon;
grant execute on function public.get_developer_protection() to authenticated;

create or replace function private.guard_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(73303);
 if new.id is distinct from old.id or new.email is distinct from old.email then raise exception 'Account identity cannot be changed through access management'; end if;
 if exists(select 1 from private.developer_protection where profile_id=old.id) then
  if new.role<>'super_admin' or new.status<>'active' then raise exception 'The developer Super Admin account is protected'; end if;
  if auth.uid() is not null and auth.uid()<>old.id then raise exception 'The developer Super Admin account is protected'; end if;
 end if;
 if auth.uid() is not null and (old.role='super_admin' or new.role='super_admin') and not private.is_super_admin() then raise exception 'Only a Super Admin can grant or manage Super Admin access'; end if;
 if new.role='super_admin' and old.role<>'super_admin' and (old.status<>'active' or new.status<>'active') then raise exception 'Approve the verified account before granting Super Admin access'; end if;
 if new.status='active' and not exists(select 1 from auth.users where id=new.id and email_confirmed_at is not null and lower(email)=lower(new.email) and email ~* '^[^@[:space:]]+@caedm\.ca$') then raise exception 'Email must be verified before approval'; end if;
 if new.status='active' and exists(select 1 from public.employee_invitations i where i.email=lower(new.email) and i.status<>'accepted') then raise exception 'Invitation password setup must be completed before activation'; end if;
 if old.role='super_admin' and old.status='active' and (new.role<>'super_admin' or new.status<>'active') then
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id<>old.id and p.role='super_admin' and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$') then raise exception 'Keep at least one active Super Admin'; end if;
 end if;
 if old.role in ('super_admin','admin') and old.status='active' and (new.role not in ('super_admin','admin') or new.status<>'active') then
  perform pg_advisory_xact_lock(73301);
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id<>old.id and p.role in ('super_admin','admin') and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$') then raise exception 'Keep at least one active administrator'; end if;
 end if;
 return new;
end $$;

create function private.protect_developer_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.developer_protection where profile_id=old.id) then raise exception 'The developer Super Admin account is protected'; end if;
 return old;
end $$;
revoke all on function private.protect_developer_delete() from public,anon,authenticated;
create trigger protect_developer_delete before delete on public.profiles for each row execute function private.protect_developer_delete();

drop policy profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for update to authenticated
 using(private.can_manage_account(id)) with check(private.can_manage_account(id));
drop policy members_insert on public.team_members;
drop policy members_update on public.team_members;
create policy members_insert on public.team_members for insert to authenticated with check(private.can_manage_account(profile_id));
create policy members_update on public.team_members for update to authenticated using(private.can_manage_account(profile_id)) with check(private.can_manage_account(profile_id));

create function private.guard_member_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(73303);
 if auth.uid() is not null then
  if tg_op in ('UPDATE','DELETE') and not private.can_manage_account(old.profile_id) then raise exception 'This account has protected department access'; end if;
  if tg_op in ('INSERT','UPDATE') and not private.can_manage_account(new.profile_id) then raise exception 'This account has protected department access'; end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.guard_member_access() from public,anon,authenticated;
create trigger guard_member_access before insert or update or delete on public.team_members for each row execute function private.guard_member_access();

create or replace function public.remove_membership(department uuid,employee uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(73303);
 if not private.can_manage_account(employee) then raise exception 'This account has protected department access'; end if;
 if exists(select 1 from public.software_subscriptions where team_id=department and owner_id=employee and status not in ('archived','cancelled','expired')) then raise exception 'Transfer active software ownership before removing department access'; end if;
 insert into public.audit_logs(actor_id,entity,record_id,action,before_data) select auth.uid(),'team_members',employee::text,'DELETE',to_jsonb(m) from public.team_members m where team_id=department and profile_id=employee;
 delete from public.team_members where team_id=department and profile_id=employee;
end $$;

-- Invitations never grant the highest privilege. Promote a verified account after setup.
alter table public.employee_invitations add constraint invitation_role_no_super_admin check(role<>'super_admin');

-- This operator-only bootstrap is never called by an application action or signup.
-- The protected UUID is pinned once; a future account with the same email cannot claim it.
create function private.bootstrap_developer_super_admin() returns uuid language plpgsql security definer set search_path='' as $$
declare developer_id uuid; protected_id uuid;
begin
 perform pg_advisory_xact_lock(73303);
 select p.id into developer_id from public.profiles p join auth.users u on u.id=p.id
 where lower(p.email)='ruban.peppin@caedm.ca' and lower(u.email)=lower(p.email)
 and u.email_confirmed_at is not null and p.status='active'
 and not exists(select 1 from public.employee_invitations i where i.email=lower(p.email) and i.status<>'accepted') for update of p;
 if developer_id is null then raise exception 'The existing developer account must be verified, active and have completed any invitation'; end if;
 select profile_id into protected_id from private.developer_protection where singleton;
 if protected_id is not null and protected_id<>developer_id then raise exception 'Developer identity is already pinned'; end if;
 update public.profiles set role='super_admin' where id=developer_id;
 insert into private.developer_protection(singleton,profile_id) values(true,developer_id) on conflict(singleton) do nothing;
 return developer_id;
end $$;
revoke all on function private.bootstrap_developer_super_admin() from public,anon,authenticated,service_role;
do $$ begin
 if exists(select 1 from public.profiles p join auth.users u on u.id=p.id where lower(p.email)='ruban.peppin@caedm.ca' and lower(u.email)=lower(p.email) and p.status='active' and u.email_confirmed_at is not null and not exists(select 1 from public.employee_invitations i where i.email=lower(p.email) and i.status<>'accepted')) then
  perform private.bootstrap_developer_super_admin();
 end if;
end $$;

-- Preserve workflow checks while including Super Admins in existing administrator/Finance paths.

create or replace function public.respond_to_review(review_id uuid, answer text, response_comment text default '') returns void language plpgsql security definer set search_path='' as $$
declare r public.usage_reviews;
begin
 if private.active_role() is null then raise exception 'Access denied'; end if;
 select * into r from public.usage_reviews where id=review_id for update;
 if r.id is null or r.owner_id is distinct from auth.uid() or not private.can_view_subscription(r.subscription_id) then raise exception 'Access denied'; end if;
 if r.response is not null then raise exception 'This review has already been completed'; end if;
 if answer not in ('still_needed','not_needed','unsure') or answer is null or length(response_comment)>3000 then raise exception 'Invalid response'; end if;
 update public.usage_reviews set response=answer,comment=response_comment,responded_at=now() where id=review_id;
 update public.software_subscriptions set last_reviewed_at=(now() at time zone 'America/Edmonton')::date where id=r.subscription_id;
 insert into public.notification_logs(review_id,recipient_id,kind) select r.id,p.id,'response' from public.profiles p join auth.users u on u.id=p.id where p.status='active' and p.role in ('super_admin','admin','finance') and u.email_confirmed_at is not null on conflict do nothing;
end $$;

create or replace function public.prepare_reminders(as_of date default (now() at time zone 'America/Edmonton')::date) returns integer language plpgsql security definer set search_path='' as $$
declare cfg public.application_settings; subscription_row public.software_subscriptions; renewal date; decision date; added integer=0;
begin
 if not pg_try_advisory_xact_lock(73302) then return 0; end if;
 select * into cfg from public.application_settings where id;
 for subscription_row in select * from public.software_subscriptions where purchase_type='subscription' and status in ('active','trial','pending_cancellation') loop
  renewal=private.next_renewal(subscription_row,as_of); decision=renewal-subscription_row.cancellation_notice_days;
  if renewal is not null and subscription_row.owner_id is not null and as_of>=decision-cfg.initial_reminder_days
   and (subscription_row.last_reviewed_at is null or as_of>=(subscription_row.last_reviewed_at+make_interval(months=>subscription_row.review_frequency_months))::date)
   and not exists(select 1 from public.usage_reviews where subscription_id=subscription_row.id and response is null)
  then
   insert into public.usage_reviews(subscription_id,owner_id,renewal_date,deadline) values(subscription_row.id,subscription_row.owner_id,renewal,decision) on conflict do nothing;
   added=added+1;
  end if;
 end loop;
 insert into public.notification_logs(review_id,recipient_id,kind)
 select r.id,r.owner_id,'initial' from public.usage_reviews r join public.software_subscriptions s on s.id=r.subscription_id where r.response is null and r.owner_id is not null and s.status in ('active','trial','pending_cancellation') on conflict do nothing;
 insert into public.notification_logs(review_id,recipient_id,kind)
 select r.id,r.owner_id,'follow_up' from public.usage_reviews r join public.software_subscriptions s on s.id=r.subscription_id where r.response is null and r.owner_id is not null and s.status in ('active','trial','pending_cancellation') and as_of>=r.deadline-cfg.follow_up_days and as_of<=r.deadline
 and exists(select 1 from public.notification_logs n where n.review_id=r.id and n.recipient_id=r.owner_id and n.kind='initial' and n.status='sent' and (n.delivered_at at time zone 'America/Edmonton')::date<as_of) on conflict do nothing;
 insert into public.notification_logs(review_id,recipient_id,kind)
 select r.id,p.id,'escalation' from public.usage_reviews r join public.software_subscriptions s on s.id=r.subscription_id cross join public.profiles p join auth.users u on u.id=p.id where r.response is null and r.deadline<as_of and s.status in ('active','trial','pending_cancellation') and p.role in ('super_admin','admin','finance') and not coalesce((to_jsonb(s)->>'billing_paused')::boolean,false) and p.status='active' and u.email_confirmed_at is not null on conflict do nothing;
 update public.usage_reviews r set escalated_at=now() where r.response is null and r.deadline<as_of and r.escalated_at is null and exists(select 1 from public.notification_logs n where n.review_id=r.id and n.kind='escalation');
 -- Bound retained authentication counters; expired keys are no longer useful.
 delete from private.rate_limits where window_start<now()-interval '1 day';
 return added;
end $$;

create or replace function public.claim_notifications() returns table(id uuid,claim_token uuid,kind text,email text,full_name text,review_id uuid,software_name text,renewal_date date,deadline date,amount numeric,currency text) language plpgsql security definer set search_path='' as $$ begin
 return query with candidates as (
  select n.id from public.notification_logs n join public.usage_reviews r on r.id=n.review_id join public.software_subscriptions s on s.id=r.subscription_id join public.profiles p on p.id=n.recipient_id join auth.users u on u.id=p.id
  where n.attempts<5 and (n.status in ('pending','failed') or(n.status='sending' and n.claimed_at<now()-interval '30 minutes'))
   and not coalesce((to_jsonb(s)->>'billing_paused')::boolean,false) and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)
   and ((n.kind in ('initial','follow_up') and r.response is null and r.owner_id=n.recipient_id and s.status in ('active','trial','pending_cancellation')) or (n.kind='escalation' and r.response is null and p.role in ('super_admin','admin','finance') and s.status in ('active','trial','pending_cancellation')) or(n.kind='response' and p.role in ('super_admin','admin','finance')))
  order by n.created_at limit 25 for update of n skip locked
 ), claimed as (
  update public.notification_logs n set status='sending',attempts=n.attempts+1,claimed_at=now(),claim_token=gen_random_uuid() from candidates c where n.id=c.id returning n.*
 ), attempts as (insert into public.notification_attempts(notification_id,attempt) select c.id,c.attempts from claimed c returning notification_id)
 select n.id,n.claim_token,n.kind,p.email,p.full_name,r.id,s.name,r.renewal_date,r.deadline,s.amount,s.currency from claimed n join attempts a on a.notification_id=n.id join public.profiles p on p.id=n.recipient_id join public.usage_reviews r on r.id=n.review_id join public.software_subscriptions s on s.id=r.subscription_id;
end $$;

create or replace function public.claim_employee_invitation(token_digest text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.employee_invitations; existing_user auth.users; claim uuid;
begin
 select * into i from public.employee_invitations where token_hash=token_digest for update;
 if not found or i.status<>'pending' or i.expires_at<=now() then raise exception 'Invitation is invalid, expired, or already used'; end if;
 if i.accept_until>now() then raise exception 'Invitation setup is already in progress. Try again shortly'; end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=i.invited_by and p.role in ('super_admin','admin') and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)) then raise exception 'Ask an administrator to resend this invitation'; end if;
 select * into existing_user from auth.users where lower(email)=i.email;
 if found and (existing_user.id is distinct from i.onboarding_user_id or existing_user.raw_app_meta_data->>'caedm_invitation_id' is distinct from i.id::text
  or not exists(select 1 from public.profiles where id=existing_user.id and status='pending_approval')) then
  raise exception 'This email already has an account. Sign in or contact your administrator';
 end if;
 claim=gen_random_uuid();
 update public.employee_invitations set accept_claim=claim,accept_until=now()+interval '5 minutes' where id=i.id;
 return jsonb_build_object('id',i.id,'email',i.email,'full_name',i.full_name,'claim',claim,'user_id',existing_user.id,'new_user_id',i.onboarding_user_id);
end $$;

create or replace function public.complete_employee_invitation(invitation uuid,claim uuid,employee uuid)
 returns void language plpgsql security definer set search_path='' as $$
declare i public.employee_invitations;
begin
 select * into i from public.employee_invitations where id=invitation for update;
 if not found or i.status<>'pending' or i.expires_at<=now() or claim is null or i.accept_claim is null or i.accept_claim is distinct from claim or i.accept_until is null or i.accept_until<=now() then raise exception 'Invitation is invalid, expired, or revoked'; end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=i.invited_by and p.role in ('super_admin','admin') and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)) then raise exception 'Administrator approval is no longer valid'; end if;
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=employee and employee=i.onboarding_user_id and lower(u.email)=i.email and u.email_confirmed_at is not null and coalesce(u.encrypted_password,'')<>'' and u.raw_app_meta_data->>'caedm_invitation_id'=i.id::text and p.status='pending_approval') then raise exception 'Password setup is incomplete'; end if;
 update public.employee_invitations set status='accepted',accepted_at=now(),accepted_user_id=employee,accept_claim=null,accept_until=null where id=i.id;
 update public.profiles set full_name=i.full_name,role=i.role,status='active' where id=employee;
 insert into public.team_members(team_id,profile_id,can_manage) values(i.team_id,employee,i.can_manage)
 on conflict(team_id,profile_id) do update set can_manage=excluded.can_manage;
end $$;
