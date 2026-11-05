-- Separate email enablement from scope without changing existing opt-outs or schedules.
alter table public.billing_reminder_preferences add column only_owned boolean not null default true;
grant update(only_owned) on public.billing_reminder_preferences to authenticated;

-- Evaluate actual recipient identity and existing software visibility rules.
-- The worker never changes auth.uid() or impersonates another session.
create function private.software_notification_access(software uuid,recipient uuid,owned_only boolean)
 returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.software_subscriptions s join public.profiles p on p.id=recipient join auth.users u on u.id=p.id
  where s.id=software and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)
   and u.email ~* '^[^@[:space:]]+@caedm\.ca$'
   and not exists(select 1 from public.employee_invitations i where i.email=lower(p.email) and i.status<>'accepted')
   and (p.role in ('super_admin','admin','finance') or exists(select 1 from public.team_members m where m.profile_id=p.id and m.team_id=s.team_id))
   and (not owned_only or (s.owner_id=p.id and private.owner_valid(s.team_id,p.id)))
 )
$$;
revoke all on function private.software_notification_access(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create or replace function private.due_billing_notices(as_of date)
 returns table(subscription_id uuid,recipient_id uuid,billing_date date,stage text,notice_days integer)
 language sql stable security definer set search_path='' as $$
 select s.id,p.id,r.renewal,
  case when r.renewal-as_of<=coalesce(pref.second_notice_days,7) then 'follow_up' else 'initial' end,
  case when r.renewal-as_of<=coalesce(pref.second_notice_days,7) then coalesce(pref.second_notice_days,7) else coalesce(pref.first_notice_days,14) end
 from public.software_subscriptions s
 join public.profiles p on p.status='active' and
  (p.id=s.owner_id or exists(select 1 from public.billing_reminder_preferences wider where wider.profile_id=p.id and wider.enabled and not wider.only_owned))
 left join public.billing_reminder_preferences pref on pref.profile_id=p.id
 cross join lateral(select private.next_renewal(s,as_of) as renewal) r
 where s.purchase_type='subscription' and s.status in ('active','trial','pending_cancellation') and not s.billing_paused
  and coalesce(pref.enabled,true)
  and private.software_notification_access(s.id,p.id,coalesce(pref.only_owned,true))
  and r.renewal>as_of and r.renewal-as_of<=coalesce(pref.first_notice_days,14)
$$;
revoke all on function private.due_billing_notices(date) from public,anon,authenticated,service_role;

-- Preferences affect delivery, not review creation, assignment or response rights.
-- Existing owner/Finance routing remains; opting for all software never grants new review access.
create or replace function public.claim_notifications() returns table(id uuid,claim_token uuid,kind text,email text,full_name text,review_id uuid,software_name text,renewal_date date,deadline date,amount numeric,currency text)
 language plpgsql security definer set search_path='' as $$
begin
 return query with candidates as (
  select n.id from public.notification_logs n join public.usage_reviews r on r.id=n.review_id
  join public.software_subscriptions s on s.id=r.subscription_id join public.profiles p on p.id=n.recipient_id
  left join public.billing_reminder_preferences pref on pref.profile_id=p.id
  where n.attempts<5 and (n.status in ('pending','failed') or (n.status='sending' and n.claimed_at<now()-interval '30 minutes'))
   and not s.billing_paused and coalesce(pref.enabled,true)
   and private.software_notification_access(s.id,p.id,coalesce(pref.only_owned,true))
   and ((n.kind in ('initial','follow_up') and r.response is null and r.owner_id=n.recipient_id and s.status in ('active','trial','pending_cancellation'))
     or (n.kind='escalation' and r.response is null and p.role in ('super_admin','admin','finance') and s.status in ('active','trial','pending_cancellation'))
     or (n.kind='response' and p.role in ('super_admin','admin','finance')))
  order by n.created_at limit 25 for update of n skip locked
 ), claimed as (
  update public.notification_logs n set status='sending',attempts=n.attempts+1,claimed_at=now(),claim_token=gen_random_uuid()
  from candidates c where n.id=c.id returning n.*
 ), attempts as (
  insert into public.notification_attempts(notification_id,attempt) select c.id,c.attempts from claimed c returning notification_id
 )
 select n.id,n.claim_token,n.kind,p.email,p.full_name,r.id,s.name,r.renewal_date,r.deadline,s.amount,s.currency
 from claimed n join attempts a on a.notification_id=n.id join public.profiles p on p.id=n.recipient_id
 join public.usage_reviews r on r.id=n.review_id join public.software_subscriptions s on s.id=r.subscription_id;
end $$;
revoke all on function public.claim_notifications() from public,anon,authenticated;
grant execute on function public.claim_notifications() to service_role;
