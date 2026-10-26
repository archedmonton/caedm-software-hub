alter table public.expense_records add column team_id uuid references public.teams;
alter table public.expense_records add column payment_method_id uuid references public.payment_methods;
create or replace function private.snapshot_expense() returns trigger language plpgsql security definer set search_path='' as $$ begin
 select v.name,t.name,s.cost_centre,coalesce(p.nickname,'') || case when p.last_four<>'' then ' • '||p.last_four else '' end,s.team_id,s.payment_method_id into new.vendor_name,new.team_name,new.cost_centre,new.payment_reference,new.team_id,new.payment_method_id from public.software_subscriptions s join public.vendors v on v.id=s.vendor_id join public.teams t on t.id=s.team_id left join public.payment_methods p on p.id=s.payment_method_id where s.id=new.subscription_id; return new;
end $$;
alter table public.notification_logs add column subject text;
alter table public.notification_logs add column body text;
alter table public.notification_logs add column claim_token uuid;
create table public.notification_attempts(id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.notification_logs,attempt integer not null,started_at timestamptz not null default now(),finished_at timestamptz,status text not null default 'sending',error text,unique(notification_id,attempt));
alter table public.notification_attempts enable row level security;
create policy attempts_read on public.notification_attempts for select to authenticated using(private.is_finance());
revoke all on public.notification_attempts from public,anon,authenticated;
grant select on public.notification_attempts to authenticated;

create function private.guard_profile() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.status='active' and not exists(select 1 from auth.users where id=new.id and email_confirmed_at is not null and lower(email)=lower(new.email)) then raise exception 'Email must be verified before approval'; end if;
 if old.role='admin' and old.status='active' and (new.role<>'admin' or new.status<>'active') then
  perform pg_advisory_xact_lock(73301);
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id<>old.id and p.role='admin' and p.status='active' and u.email_confirmed_at is not null) then raise exception 'Keep at least one active administrator'; end if;
 end if;
 return new;
end $$;
create trigger guard_profile before update on public.profiles for each row execute function private.guard_profile();
create function private.validate_software() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if not private.owner_valid(new.team_id,new.owner_id) then raise exception 'Owner must be an active member of the software department'; end if;
 if not exists(select 1 from public.application_settings where id and new.currency=any(currencies)) then raise exception 'Currency is not configured'; end if;
 if new.purchase_type='one_time' then new.next_billing_date=null; new.auto_renew=false; end if;
 return new;
end $$;
create trigger validate_software before insert or update on public.software_subscriptions for each row execute function private.validate_software();
create function private.owner_changed() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.owner_id is distinct from old.owner_id then
  update public.notification_logs n set status='failed',attempts=5,error='Owner reassigned' from public.usage_reviews r where r.id=n.review_id and r.subscription_id=new.id and r.response is null and n.kind in ('initial','follow_up') and n.status in ('pending','failed');
  update public.usage_reviews set owner_id=new.owner_id where subscription_id=new.id and response is null;
  if new.owner_id is not null then insert into public.notification_logs(review_id,recipient_id,kind) select id,new.owner_id,'initial' from public.usage_reviews where subscription_id=new.id and response is null on conflict do nothing; end if;
 end if;return new;
end $$;
create trigger owner_changed after update on public.software_subscriptions for each row execute function private.owner_changed();
create function public.consume_auth_limit(bucket text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if length(bucket)<>64 then return false; end if;
 insert into private.rate_limits(key,window_start,hits) values('auth:'||bucket,now(),1) on conflict(key) do update set hits=case when private.rate_limits.window_start<now()-interval '15 minutes' then 1 else private.rate_limits.hits+1 end,window_start=case when private.rate_limits.window_start<now()-interval '15 minutes' then now() else private.rate_limits.window_start end returning hits into n;
 return n<=15;
end $$;
create function private.next_renewal(s public.software_subscriptions,as_of date) returns date language plpgsql immutable set search_path='' as $$
declare months integer; n integer; candidate date;
begin
 if coalesce((to_jsonb(s)->>'billing_paused')::boolean,false) then return null; end if;
 if s.next_billing_date>=as_of then return s.next_billing_date; end if;
 if not s.auto_renew or s.status='pending_cancellation' or s.purchase_type='one_time' then return null; end if;
 months=case s.billing_cycle when 'monthly' then 1 when 'quarterly' then 3 when 'annually' then 12 when 'custom' then s.custom_interval_months else 0 end;
 if months=0 then return null; end if;
 n=greatest(0,((extract(year from as_of)::integer-extract(year from s.billing_start_date)::integer)*12+extract(month from as_of)::integer-extract(month from s.billing_start_date)::integer)/months);
 candidate=(s.billing_start_date+make_interval(months=>n*months))::date;
 if candidate<as_of then candidate=(s.billing_start_date+make_interval(months=>(n+1)*months))::date; end if;
 return candidate;
end $$;
create function public.prepare_reminders(as_of date default (now() at time zone 'America/Edmonton')::date) returns integer language plpgsql security definer set search_path='' as $$
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
 select r.id,p.id,'escalation' from public.usage_reviews r join public.software_subscriptions s on s.id=r.subscription_id cross join public.profiles p join auth.users u on u.id=p.id where r.response is null and r.deadline<as_of and s.status in ('active','trial','pending_cancellation') and p.role in ('admin','finance') and not coalesce((to_jsonb(s)->>'billing_paused')::boolean,false) and p.status='active' and u.email_confirmed_at is not null on conflict do nothing;
 update public.usage_reviews r set escalated_at=now() where r.response is null and r.deadline<as_of and r.escalated_at is null and exists(select 1 from public.notification_logs n where n.review_id=r.id and n.kind='escalation');
 -- Bound retained authentication counters; expired keys are no longer useful.
 delete from private.rate_limits where window_start<now()-interval '1 day';
 return added;
end $$;
create function public.claim_notifications() returns table(id uuid,claim_token uuid,kind text,email text,full_name text,review_id uuid,software_name text,renewal_date date,deadline date,amount numeric,currency text) language plpgsql security definer set search_path='' as $$ begin
 return query with candidates as (
  select n.id from public.notification_logs n join public.usage_reviews r on r.id=n.review_id join public.software_subscriptions s on s.id=r.subscription_id join public.profiles p on p.id=n.recipient_id join auth.users u on u.id=p.id
  where n.attempts<5 and (n.status in ('pending','failed') or(n.status='sending' and n.claimed_at<now()-interval '30 minutes'))
   and not coalesce((to_jsonb(s)->>'billing_paused')::boolean,false) and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)
   and ((n.kind in ('initial','follow_up') and r.response is null and r.owner_id=n.recipient_id and s.status in ('active','trial','pending_cancellation')) or (n.kind='escalation' and r.response is null and p.role in ('admin','finance') and s.status in ('active','trial','pending_cancellation')) or(n.kind='response' and p.role in ('admin','finance')))
  order by n.created_at limit 25 for update of n skip locked
 ), claimed as (
  update public.notification_logs n set status='sending',attempts=n.attempts+1,claimed_at=now(),claim_token=gen_random_uuid() from candidates c where n.id=c.id returning n.*
 ), attempts as (insert into public.notification_attempts(notification_id,attempt) select c.id,c.attempts from claimed c returning notification_id)
 select n.id,n.claim_token,n.kind,p.email,p.full_name,r.id,s.name,r.renewal_date,r.deadline,s.amount,s.currency from claimed n join attempts a on a.notification_id=n.id join public.profiles p on p.id=n.recipient_id join public.usage_reviews r on r.id=n.review_id join public.software_subscriptions s on s.id=r.subscription_id;
end $$;
create function public.finish_notification(notification uuid,token uuid,successful boolean,email_provider text,email_subject text,email_body text) returns void language plpgsql security definer set search_path='' as $$
declare n public.notification_logs;
begin
 update public.notification_logs set status=case when successful then 'sent' else 'failed' end,provider=email_provider,subject=left(email_subject,500),body=left(email_body,10000),error=case when successful then null else 'Delivery failed. Check provider configuration.' end,delivered_at=case when successful then now() end where id=notification and claim_token=token and status='sending' returning * into n;
 if n.id is not null then update public.notification_attempts set finished_at=now(),status=n.status,error=n.error where notification_id=n.id and attempt=n.attempts; end if;
end $$;
revoke all on all functions in schema private from public,anon;
revoke all on function public.consume_auth_limit(text),public.prepare_reminders(date),public.claim_notifications(),public.finish_notification(uuid,uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.consume_auth_limit(text),public.prepare_reminders(date),public.claim_notifications(),public.finish_notification(uuid,uuid,boolean,text,text,text) to service_role;