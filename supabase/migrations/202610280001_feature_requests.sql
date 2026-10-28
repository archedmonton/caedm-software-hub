-- Requests are available to verified active and pending employees only.
-- This does not change access to any existing workspace data.
create function private.can_request_features() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.status in ('active','pending_approval') and u.email_confirmed_at is not null
 and lower(p.email)=lower(u.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$')
$$;
revoke all on function private.can_request_features() from public,anon;
grant execute on function private.can_request_features() to authenticated;

create table public.feature_requests (
 id uuid primary key default gen_random_uuid(),
 requester_id uuid not null references public.profiles on delete restrict,
 requester_name text not null,
 requester_email text not null check(requester_email ~ '^[^@[:space:]]+@caedm\.ca$'),
 request_key uuid not null,
 title text not null check(length(btrim(title)) between 8 and 120 and title !~ E'[\r\n]'),
 area text not null check(area in ('General','Dashboard','Software Inventory','Upcoming Renewals','Usage Reviews','Finance Centre','Team Management','Settings')),
 priority text not null check(priority in ('Low','Normal','High')),
 department text not null default '' check(length(department)<=120),
 problem text not null check(length(btrim(problem)) between 20 and 3000),
 solution text not null check(length(btrim(solution)) between 20 and 4000),
 benefit text not null check(length(btrim(benefit)) between 10 and 2000),
 workaround text not null default '' check(length(workaround)<=1000),
 delivery_status text not null default 'pending' check(delivery_status in ('pending','sending','sent','failed')),
 delivery_error text,
 delivery_attempts integer not null default 0,
 delivery_claim uuid,
 delivery_until timestamptz,
 last_attempt_at timestamptz,
 email_sent_at timestamptz,
 created_at timestamptz not null default now(),
 unique(requester_id,request_key)
);
alter table public.feature_requests enable row level security;
create policy requests_read on public.feature_requests for select to authenticated using(
 (private.can_request_features() and requester_id=auth.uid()) or private.is_admin()
);
revoke all on public.feature_requests from public,anon,authenticated;
grant select(id,requester_id,requester_name,requester_email,title,area,priority,department,problem,solution,benefit,workaround,delivery_status,delivery_error,delivery_attempts,last_attempt_at,email_sent_at,created_at) on public.feature_requests to authenticated;
grant all on public.feature_requests to service_role;
create index feature_requests_owner_date on public.feature_requests(requester_id,created_at desc);

create function private.audit_feature_request() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(actor_id,entity,record_id,action,before_data,after_data)
 values(auth.uid(),'feature_requests',new.id::text,tg_op,
 case when tg_op='UPDATE' then jsonb_build_object('delivery_status',old.delivery_status,'delivery_attempts',old.delivery_attempts,'email_sent_at',old.email_sent_at) end,
 jsonb_build_object('delivery_status',new.delivery_status,'delivery_attempts',new.delivery_attempts,'email_sent_at',new.email_sent_at));
 return new;
end $$;
revoke all on function private.audit_feature_request() from public,anon,authenticated;
create trigger audit_feature_request after insert or update on public.feature_requests for each row execute function private.audit_feature_request();

create function public.submit_feature_request(client_key uuid, request_title text, request_area text, request_priority text,
 request_department text, request_problem text, request_solution text, request_benefit text, request_workaround text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.feature_requests; p public.profiles; hits integer;
begin
 if not private.can_request_features() then raise exception 'A verified active or pending CAEDM account is required'; end if;
 if client_key is null then raise exception 'Invalid request reference'; end if;
 perform pg_advisory_xact_lock(hashtextextended('feature-requests:'||auth.uid()::text,0));
 select * into r from public.feature_requests where requester_id=auth.uid() and request_key=client_key;
 if found then
  if row(r.title,r.area,r.priority,r.department,r.problem,r.solution,r.benefit,r.workaround) is distinct from
   row(btrim(request_title),request_area,request_priority,btrim(request_department),btrim(request_problem),btrim(request_solution),btrim(request_benefit),btrim(request_workaround)) then
   raise exception 'This reference already has different details. Start a new request';
  end if;
 else
  insert into private.rate_limits(key,window_start,hits) values('feature-requests:'||auth.uid()::text,now(),1)
  on conflict(key) do update set hits=case when private.rate_limits.window_start<now()-interval '1 hour' then 1 else private.rate_limits.hits+1 end,
   window_start=case when private.rate_limits.window_start<now()-interval '1 hour' then now() else private.rate_limits.window_start end returning private.rate_limits.hits into hits;
  if hits>5 then raise exception 'Feature request limit reached. Please try again in an hour'; end if;
  select * into p from public.profiles where id=auth.uid();
  insert into public.feature_requests(requester_id,requester_name,requester_email,request_key,title,area,priority,department,problem,solution,benefit,workaround)
  values(p.id,p.full_name,lower(p.email),client_key,btrim(request_title),request_area,request_priority,btrim(request_department),btrim(request_problem),btrim(request_solution),btrim(request_benefit),btrim(request_workaround)) returning * into r;
 end if;
 return jsonb_build_object('id',r.id,'title',r.title,'delivery_status',r.delivery_status,'created_at',r.created_at);
end $$;
revoke all on function public.submit_feature_request(uuid,text,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.submit_feature_request(uuid,text,text,text,text,text,text,text,text) to authenticated;

create function public.claim_feature_request_delivery(request_id uuid,employee uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.feature_requests; claim uuid;
begin
 select * into r from public.feature_requests where id=request_id and requester_id=employee for update;
 if not found then raise exception 'Request unavailable'; end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=employee and p.status in ('active','pending_approval') and u.email_confirmed_at is not null and lower(u.email)=lower(p.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$') then raise exception 'Account access is restricted'; end if;
 if r.delivery_status='sent' then return jsonb_build_object('status','sent'); end if;
 if r.delivery_status='sending' and r.delivery_until>now() then return jsonb_build_object('status','sending'); end if;
 if r.last_attempt_at>now()-interval '1 minute' then raise exception 'Wait one minute before retrying email delivery'; end if;
 if r.delivery_attempts>=5 then
  update public.feature_requests set delivery_status='failed',delivery_error='Email retry limit reached. Contact the developer with your request reference.',delivery_claim=null,delivery_until=null where id=r.id;
  return jsonb_build_object('status','failed');
 end if;
 claim=gen_random_uuid();
 update public.feature_requests set delivery_status='sending',delivery_error=null,delivery_claim=claim,delivery_until=now()+interval '5 minutes',delivery_attempts=delivery_attempts+1,last_attempt_at=now() where id=r.id;
 return jsonb_build_object('status','claimed','claim',claim,'request',to_jsonb(r)-array['request_key','delivery_claim','delivery_until','delivery_error']);
end $$;
create function public.finish_feature_request_delivery(request_id uuid,claim uuid,successful boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.feature_requests set delivery_status=case when successful then 'sent' else 'failed' end,
 delivery_error=case when successful then null else 'Your request is saved. Email delivery failed; retry later or contact the developer with its reference.' end,
 email_sent_at=case when successful then now() else null end,delivery_claim=null,delivery_until=null
 where id=request_id and delivery_claim=claim and delivery_status='sending';
 if not found then raise exception 'Email delivery claim changed'; end if;
end $$;
revoke all on function public.claim_feature_request_delivery(uuid,uuid),public.finish_feature_request_delivery(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_feature_request_delivery(uuid,uuid),public.finish_feature_request_delivery(uuid,uuid,boolean) to service_role;
