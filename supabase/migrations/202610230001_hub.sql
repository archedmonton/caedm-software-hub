-- CAEDM Software Hub. Run as postgres through Supabase migrations.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create type public.app_role as enum ('admin','finance','staff');
create type public.account_status as enum ('pending_approval','active','rejected','suspended','deactivated');
create type public.subscription_status as enum ('trial','active','pending_cancellation','cancelled','expired','archived');
create table public.profiles (
 id uuid primary key references auth.users on delete restrict,
 full_name text not null check(length(full_name) between 1 and 150),
 email text not null unique check(email ~* '^[^@[:space:]]+@caedm\.ca$'),
 role public.app_role not null default 'staff', status public.account_status not null default 'pending_approval',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.teams (id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 1 and 100), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.team_members (team_id uuid references public.teams on delete restrict, profile_id uuid references public.profiles on delete restrict, can_manage boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(team_id,profile_id));
create index team_members_profile_idx on public.team_members(profile_id);
create table public.vendors (id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 1 and 150), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.payment_methods (id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams, nickname text not null check(length(nickname) between 1 and 100), brand text not null default '' check(length(brand)<=40), last_four text not null default '' check(last_four = '' or last_four ~ '^[0-9]{4}$'), notes text not null default '' check(length(notes)<=2000), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(team_id,nickname), unique(id,team_id));
create table public.software_subscriptions (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 150), vendor_id uuid not null references public.vendors,
 team_id uuid not null references public.teams, owner_id uuid references public.profiles,
 category text not null check(length(category) between 1 and 80), description text not null default '' check(length(description)<=3000), website text not null default '' check(website='' or website ~* '^https?://[^[:space:]]+$'), cost_centre text not null default '' check(length(cost_centre)<=80),
 purchase_date date not null, purchase_type text not null check(purchase_type in ('subscription','one_time')), amount numeric(12,2) not null check(amount>=0), currency text not null check(currency ~ '^[A-Z]{3}$'),
 billing_cycle text not null check(billing_cycle in ('monthly','quarterly','annually','custom','one_time')), custom_interval_months integer not null default 1 check(custom_interval_months between 1 and 120), billing_start_date date not null, next_billing_date date,
 auto_renew boolean not null default true, cancellation_notice_days integer not null default 0 check(cancellation_notice_days between 0 and 730),
 cancellation_deadline date generated always as (next_billing_date-cancellation_notice_days) stored,
 licenses_purchased integer not null default 1 check(licenses_purchased between 0 and 1000000), licenses_used integer check(licenses_used>=0 and licenses_used<=licenses_purchased), license_notes text not null default '' check(length(license_notes)<=3000),
 payment_method_id uuid, invoice_reference text not null default '' check(length(invoice_reference)<=500), internal_reference text not null default '' check(length(internal_reference)<=100), notes text not null default '' check(length(notes)<=5000), status public.subscription_status not null default 'active',
 review_frequency_months integer not null default 12 check(review_frequency_months between 1 and 120), last_reviewed_at date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(payment_method_id,team_id) references public.payment_methods(id,team_id),
 check((purchase_type='one_time')=(billing_cycle='one_time')),
 check(purchase_type='one_time' or next_billing_date is not null), check(next_billing_date is null or next_billing_date>=billing_start_date)
);
create index subscriptions_team_idx on public.software_subscriptions(team_id);
create index subscriptions_owner_idx on public.software_subscriptions(owner_id);
create index subscriptions_next_idx on public.software_subscriptions(next_billing_date) where status in ('active','trial','pending_cancellation');
create table public.expense_records (
 id uuid primary key default gen_random_uuid(), subscription_id uuid not null references public.software_subscriptions,
 transaction_date date not null, amount numeric(12,2) not null check(amount>=0), tax numeric(12,2) not null default 0 check(tax>=0), currency text not null check(currency ~ '^[A-Z]{3}$'), invoice_reference text not null default '' check(length(invoice_reference)<=500), notes text not null default '' check(length(notes)<=3000),
 vendor_name text not null, team_name text not null, cost_centre text not null, payment_reference text not null,
 recorded_by uuid not null default auth.uid() references public.profiles,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index expenses_date_idx on public.expense_records(transaction_date);
create table public.usage_reviews (
 id uuid primary key default gen_random_uuid(), subscription_id uuid not null references public.software_subscriptions,
 owner_id uuid references public.profiles, renewal_date date not null, deadline date not null,
 response text check(response in ('still_needed','not_needed','unsure')), comment text not null default '' check(length(comment)<=3000), responded_at timestamptz, escalated_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(subscription_id,renewal_date),
 check((response is null)=(responded_at is null))
);
create index reviews_owner_idx on public.usage_reviews(owner_id);
create table public.notification_logs (
 id uuid primary key default gen_random_uuid(), review_id uuid not null references public.usage_reviews,
 recipient_id uuid not null references public.profiles, kind text not null check(kind in ('initial','follow_up','escalation','response')),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')), provider text, attempts integer not null default 0, claimed_at timestamptz, delivered_at timestamptz, error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(review_id,recipient_id,kind)
);
create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid, entity text not null, record_id text not null, action text not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default now());
create table public.application_settings (id boolean primary key default true check(id), organization_name text not null default 'CAEDM', timezone text not null default 'America/Edmonton' check(timezone='America/Edmonton'), currencies text[] not null default array['CAD','USD'] check(cardinality(currencies) between 1 and 20), initial_reminder_days integer not null default 30 check(initial_reminder_days between 1 and 365), follow_up_days integer not null default 7 check(follow_up_days between 1 and 90), updated_at timestamptz not null default now());
insert into public.application_settings(id) values(true);
create table private.rate_limits (key text primary key, window_start timestamptz not null, hits integer not null);

create function private.active_role() returns public.app_role language sql stable security definer set search_path='' as $$
 select p.role from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.status='active' and u.email_confirmed_at is not null and lower(u.email)=lower(p.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$'
$$;
create function private.is_finance() returns boolean language sql stable security definer set search_path='' as $$ select coalesce(private.active_role() in ('admin','finance'),false) $$;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select coalesce(private.active_role()='admin',false) $$;
create function private.in_team(t uuid, manage boolean default false) returns boolean language sql stable security definer set search_path='' as $$ select private.active_role() is not null and exists(select 1 from public.team_members m where m.team_id=t and m.profile_id=auth.uid() and (not manage or m.can_manage)) $$;
create function private.can_view_subscription(s uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.software_subscriptions where id=s and (private.is_finance() or private.in_team(team_id))) $$;
create function private.owner_valid(t uuid, p uuid) returns boolean language sql stable security definer set search_path='' as $$ select p is null or exists(select 1 from public.team_members m join public.profiles pr on pr.id=m.profile_id where m.team_id=t and m.profile_id=p and pr.status='active') $$;
create function private.shares_team(p uuid) returns boolean language sql stable security definer set search_path='' as $$ select private.active_role() is not null and exists(select 1 from public.team_members a join public.team_members b on a.team_id=b.team_id where a.profile_id=auth.uid() and b.profile_id=p) $$;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

create function public.before_user_created(event jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 if coalesce(event->'user'->>'email','') !~* '^[^@[:space:]]+@caedm\.ca$' then
  return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Only @caedm.ca work emails may register.'));
 end if; return '{}'::jsonb;
end $$;
revoke all on function public.before_user_created(jsonb) from public,anon,authenticated;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
create function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Defence in depth even if the dashboard hook has not yet been enabled.
 if new.email !~* '^[^@[:space:]]+@caedm\.ca$' then raise exception 'Only @caedm.ca work emails may register'; end if;
 insert into public.profiles(id,full_name,email) values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1)),150),lower(new.email));
 return new;
end $$;
create trigger hub_new_user after insert on auth.users for each row execute function private.new_profile();

create function private.touch() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
create function private.audit() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.audit_logs(actor_id,entity,record_id,action,before_data,after_data) values(auth.uid(),tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'profile_id'),tg_op,case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new)); return new;
end $$;
create function private.limit_write() returns trigger language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if auth.uid() is null then return new; end if;
 insert into private.rate_limits(key,window_start,hits) values(auth.uid()::text,now(),1)
 on conflict(key) do update set hits=case when private.rate_limits.window_start < now()-interval '1 minute' then 1 else private.rate_limits.hits+1 end, window_start=case when private.rate_limits.window_start<now()-interval '1 minute' then now() else private.rate_limits.window_start end returning hits into n;
 if n>120 then raise exception 'Too many changes. Try again in a minute.'; end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['profiles','teams','team_members','vendors','payment_methods','software_subscriptions','expense_records','usage_reviews','notification_logs','application_settings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create trigger touch before update on public.%I for each row execute function private.touch()',t);
  if t not in ('notification_logs','application_settings') then execute format('create trigger audit after insert or update on public.%I for each row execute function private.audit()',t); end if;
  execute format('create trigger rate_limit before insert or update on public.%I for each row execute function private.limit_write()',t);
 end loop;
end $$;
alter table public.audit_logs enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id=auth.uid() or private.is_finance() or private.shares_team(id));
create policy profiles_admin on public.profiles for update to authenticated using(private.is_admin()) with check(private.is_admin());
create policy teams_read on public.teams for select to authenticated using(private.active_role() is not null);
create policy teams_insert on public.teams for insert to authenticated with check(private.is_admin());
create policy teams_update on public.teams for update to authenticated using(private.is_admin()) with check(private.is_admin());
create policy members_read on public.team_members for select to authenticated using(private.is_finance() or private.in_team(team_id));
create policy members_insert on public.team_members for insert to authenticated with check(private.is_admin());
create policy members_update on public.team_members for update to authenticated using(private.is_admin()) with check(private.is_admin());
create policy vendors_read on public.vendors for select to authenticated using(private.active_role() is not null);
create policy vendors_insert on public.vendors for insert to authenticated with check(private.is_finance());
create policy vendors_update on public.vendors for update to authenticated using(private.is_finance()) with check(private.is_finance());
create policy payments_read on public.payment_methods for select to authenticated using(private.is_finance() or private.in_team(team_id));
create policy payments_insert on public.payment_methods for insert to authenticated with check(private.is_finance());
create policy payments_update on public.payment_methods for update to authenticated using(private.is_finance()) with check(private.is_finance());
create policy subscriptions_read on public.software_subscriptions for select to authenticated using(private.is_finance() or private.in_team(team_id));
create policy subscriptions_insert on public.software_subscriptions for insert to authenticated with check((private.is_finance() or private.in_team(team_id,true)) and private.owner_valid(team_id,owner_id));
create policy subscriptions_update on public.software_subscriptions for update to authenticated using(private.is_finance() or private.in_team(team_id,true)) with check((private.is_finance() or private.in_team(team_id,true)) and private.owner_valid(team_id,owner_id));
create policy expenses_read on public.expense_records for select to authenticated using(private.is_finance());
create policy expenses_insert on public.expense_records for insert to authenticated with check(private.is_finance() and recorded_by=auth.uid());
create policy reviews_read on public.usage_reviews for select to authenticated using(private.is_finance() or (owner_id=auth.uid() and private.can_view_subscription(subscription_id)));
create policy notifications_read on public.notification_logs for select to authenticated using(private.is_finance() or (recipient_id=auth.uid() and private.active_role() is not null));
create policy audit_read on public.audit_logs for select to authenticated using(private.is_finance());
create policy settings_read on public.application_settings for select to authenticated using(private.active_role() is not null);
create policy settings_update on public.application_settings for update to authenticated using(private.is_admin()) with check(private.is_admin());
-- Explicit grants: no client deletes, no review mutation bypass, no anonymous business data.
revoke all on all tables in schema public from anon,authenticated;
grant select on public.profiles,public.teams,public.team_members,public.vendors,public.payment_methods,public.software_subscriptions,public.expense_records,public.usage_reviews,public.notification_logs,public.audit_logs,public.application_settings to authenticated;
grant update(role,status) on public.profiles to authenticated;
grant insert,update on public.teams,public.team_members,public.vendors,public.payment_methods,public.software_subscriptions to authenticated;
grant insert(subscription_id,transaction_date,amount,tax,currency,invoice_reference,notes) on public.expense_records to authenticated;
grant update(organization_name,currencies,initial_reminder_days,follow_up_days) on public.application_settings to authenticated;

create function private.snapshot_expense() returns trigger language plpgsql security definer set search_path='' as $$ begin
 select v.name,t.name,s.cost_centre,coalesce(p.nickname,'') || case when p.last_four<>'' then ' • '||p.last_four else '' end into new.vendor_name,new.team_name,new.cost_centre,new.payment_reference from public.software_subscriptions s join public.vendors v on v.id=s.vendor_id join public.teams t on t.id=s.team_id left join public.payment_methods p on p.id=s.payment_method_id where s.id=new.subscription_id;
 return new;
end $$;
create trigger snapshot_expense before insert on public.expense_records for each row execute function private.snapshot_expense();

create function public.respond_to_review(review_id uuid, answer text, response_comment text default '') returns void language plpgsql security definer set search_path='' as $$
declare r public.usage_reviews;
begin
 if private.active_role() is null then raise exception 'Access denied'; end if;
 select * into r from public.usage_reviews where id=review_id for update;
 if r.id is null or r.owner_id is distinct from auth.uid() or not private.can_view_subscription(r.subscription_id) then raise exception 'Access denied'; end if;
 if r.response is not null then raise exception 'This review has already been completed'; end if;
 if answer not in ('still_needed','not_needed','unsure') or answer is null or length(response_comment)>3000 then raise exception 'Invalid response'; end if;
 update public.usage_reviews set response=answer,comment=response_comment,responded_at=now() where id=review_id;
 update public.software_subscriptions set last_reviewed_at=(now() at time zone 'America/Edmonton')::date where id=r.subscription_id;
 insert into public.notification_logs(review_id,recipient_id,kind) select r.id,p.id,'response' from public.profiles p join auth.users u on u.id=p.id where p.status='active' and p.role in ('admin','finance') and u.email_confirmed_at is not null on conflict do nothing;
end $$;
create function public.request_usage_review(subscription uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.software_subscriptions; result uuid;
begin
 if not private.is_admin() then raise exception 'Access denied'; end if;
 select * into s from public.software_subscriptions where id=subscription;
 if s.id is null or s.owner_id is null or s.next_billing_date is null or s.purchase_type='one_time' or s.status not in ('active','trial','pending_cancellation') then raise exception 'Assign an owner and an eligible renewal first'; end if;
 insert into public.usage_reviews(subscription_id,owner_id,renewal_date,deadline) values(s.id,s.owner_id,s.next_billing_date,s.cancellation_deadline) on conflict(subscription_id,renewal_date) do nothing;
 select id into result from public.usage_reviews where subscription_id=s.id and renewal_date=s.next_billing_date;
 insert into public.notification_logs(review_id,recipient_id,kind) values(result,s.owner_id,'initial') on conflict do nothing;
 return result;
end $$;
-- Revoke all newly created definer functions by default. Only named public RPCs are granted.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.active_role(),private.is_finance(),private.is_admin(),private.in_team(uuid,boolean),private.can_view_subscription(uuid),private.owner_valid(uuid,uuid),private.shares_team(uuid) to authenticated;
revoke all on function public.respond_to_review(uuid,text,text),public.request_usage_review(uuid) from public,anon;
grant execute on function public.respond_to_review(uuid,text,text),public.request_usage_review(uuid) to authenticated;