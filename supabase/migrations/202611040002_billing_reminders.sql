-- Personal billing notices are independent of mandatory usage-review workflows.
create table public.billing_reminder_preferences (
 profile_id uuid primary key references public.profiles(id) on delete restrict,
 enabled boolean not null default true,
 first_notice_days integer not null default 14 check(first_notice_days between 2 and 365),
 second_notice_days integer not null default 7 check(second_notice_days between 1 and 364),
 updated_at timestamptz not null default now(),
 check(first_notice_days>second_notice_days)
);
alter table public.billing_reminder_preferences enable row level security;
revoke all on public.billing_reminder_preferences from public,anon,authenticated,service_role;
grant select,insert on public.billing_reminder_preferences to authenticated;
grant update(profile_id,enabled,first_notice_days,second_notice_days) on public.billing_reminder_preferences to authenticated;
create policy billing_preferences_read on public.billing_reminder_preferences for select to authenticated using(profile_id=auth.uid() and private.active_role() is not null);
create policy billing_preferences_insert on public.billing_reminder_preferences for insert to authenticated with check(profile_id=auth.uid() and private.active_role() is not null);
create policy billing_preferences_update on public.billing_reminder_preferences for update to authenticated using(profile_id=auth.uid() and private.active_role() is not null) with check(profile_id=auth.uid() and private.active_role() is not null);
create trigger touch before update on public.billing_reminder_preferences for each row execute function private.touch();
create trigger audit after insert or update on public.billing_reminder_preferences for each row execute function private.audit();
create trigger rate_limit before insert or update on public.billing_reminder_preferences for each row execute function private.limit_write();

create table public.billing_notifications (
 id uuid primary key default gen_random_uuid(),
 subscription_id uuid not null references public.software_subscriptions(id) on delete restrict,
 recipient_id uuid not null references public.profiles(id) on delete restrict,
 billing_date date not null,
 stage text not null check(stage in ('initial','follow_up')),
 notice_days integer not null check(notice_days between 1 and 365),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 claim_token uuid, claimed_at timestamptz, delivered_at timestamptz,
 provider text,subject text,body text,error text,
 created_at timestamptz not null default now(),
 unique(subscription_id,recipient_id,billing_date,stage)
);
alter table public.billing_notifications enable row level security;
revoke all on public.billing_notifications from public,anon,authenticated,service_role;
grant select on public.billing_notifications to authenticated;
create policy billing_notifications_read on public.billing_notifications for select to authenticated
 using(private.is_finance() or (recipient_id=auth.uid() and private.active_role() is not null and private.can_view_subscription(subscription_id)));
create index billing_notifications_queue on public.billing_notifications(status,created_at) where status<>'sent';
create table private.billing_notification_attempts (
 notification_id uuid not null references public.billing_notifications(id),
 attempt integer not null,
 started_at timestamptz not null default now(),finished_at timestamptz,status text,error text,
 primary key(notification_id,attempt)
);
alter table private.billing_notification_attempts enable row level security;
revoke all on private.billing_notification_attempts from public,anon,authenticated,service_role;

-- One eligibility source is used at preparation and again at claim time.
-- Catch-up sends only the latest due stage, not both notices in one run.
create function private.due_billing_notices(as_of date)
 returns table(subscription_id uuid,recipient_id uuid,billing_date date,stage text,notice_days integer)
 language sql stable security definer set search_path='' as $$
 select s.id,s.owner_id,r.renewal,
  case when r.renewal-as_of<=coalesce(p.second_notice_days,7) then 'follow_up' else 'initial' end,
  case when r.renewal-as_of<=coalesce(p.second_notice_days,7) then coalesce(p.second_notice_days,7) else coalesce(p.first_notice_days,14) end
 from public.software_subscriptions s
 left join public.billing_reminder_preferences p on p.profile_id=s.owner_id
 cross join lateral(select private.next_renewal(s,as_of) as renewal) r
 where s.purchase_type='subscription' and s.status in ('active','trial','pending_cancellation') and not s.billing_paused
 and s.owner_id is not null and private.owner_valid(s.team_id,s.owner_id)
 and coalesce(p.enabled,true) and r.renewal>as_of and r.renewal-as_of<=coalesce(p.first_notice_days,14)
$$;
revoke all on function private.due_billing_notices(date) from public,anon,authenticated,service_role;

create function public.prepare_billing_notifications(as_of date default (now() at time zone 'America/Edmonton')::date)
 returns integer language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 if not pg_try_advisory_xact_lock(73304) then return 0; end if;
 insert into public.billing_notifications(subscription_id,recipient_id,billing_date,stage,notice_days)
 select * from private.due_billing_notices(as_of) on conflict do nothing;
 get diagnostics added=row_count;
 return added;
end $$;

create function public.claim_billing_notifications()
 returns table(id uuid,claim_token uuid,email text,full_name text,subscription_id uuid,software_name text,billing_date date,notice_days integer,days_until_billing integer,amount numeric,currency text)
 language plpgsql security definer set search_path='' as $$
begin
 return query with due as (
  select * from private.due_billing_notices((now() at time zone 'America/Edmonton')::date)
 ), candidates as (
  select n.id,d.notice_days from public.billing_notifications n join due d
   on d.subscription_id=n.subscription_id and d.recipient_id=n.recipient_id and d.billing_date=n.billing_date and d.stage=n.stage
  where n.attempts<5 and (n.status='pending' or (n.status='failed' and n.claimed_at<now()-interval '5 minutes') or (n.status='sending' and n.claimed_at<now()-interval '30 minutes'))
  order by n.created_at,n.id limit 5 for update of n skip locked
 ), claimed as (
  update public.billing_notifications n set status='sending',attempts=n.attempts+1,claimed_at=now(),claim_token=gen_random_uuid(),notice_days=c.notice_days
  from candidates c where n.id=c.id returning n.*
 ), attempts as (
  insert into private.billing_notification_attempts(notification_id,attempt) select n.id,n.attempts from claimed n returning notification_id
 )
 select n.id,n.claim_token,p.email,p.full_name,s.id,s.name,n.billing_date,n.notice_days,
  n.billing_date-(now() at time zone 'America/Edmonton')::date,s.amount,s.currency
 from claimed n join attempts a on a.notification_id=n.id join public.profiles p on p.id=n.recipient_id join public.software_subscriptions s on s.id=n.subscription_id;
end $$;

create function public.finish_billing_notification(notification uuid,token uuid,successful boolean,email_provider text,email_subject text,email_body text)
 returns boolean language plpgsql security definer set search_path='' as $$
declare n public.billing_notifications;
begin
 update public.billing_notifications set status=case when successful then 'sent' else 'failed' end,
  provider=left(email_provider,50),subject=left(email_subject,500),body=left(email_body,10000),
  error=case when successful then null else 'Delivery failed. Check SMTP configuration.' end,
  delivered_at=case when successful then now() end
 where id=notification and status='sending' and claim_token=token and claimed_at>now()-interval '30 minutes' returning * into n;
 if not found then return false; end if;
 update private.billing_notification_attempts set finished_at=now(),status=n.status,error=n.error where notification_id=n.id and attempt=n.attempts;
 return true;
end $$;
revoke all on function public.prepare_billing_notifications(date),public.claim_billing_notifications(),public.finish_billing_notification(uuid,uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_billing_notifications(date),public.claim_billing_notifications(),public.finish_billing_notification(uuid,uuid,boolean,text,text,text) to service_role;
