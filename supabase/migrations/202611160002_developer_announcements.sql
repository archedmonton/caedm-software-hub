create table public.developer_announcements (
 id uuid primary key,
 created_by uuid not null references public.profiles(id),
 template text not null check(template in ('welcome','whats_new','blank')),
 title text not null check(length(btrim(title)) between 1 and 200),
 subject text not null check(length(btrim(subject)) between 1 and 180 and subject !~ E'[\r\n]'),
 body text not null check(length(btrim(body)) between 10 and 20000),
 audience text not null check(audience in ('signed_up','invited','everyone','selected')),
 selected_emails text[] not null default '{}',
 content_hash text not null,
 previewed_hash text,
 test_accepted_hash text,
 state text not null default 'draft' check(state in ('draft','queued')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),queued_at timestamptz
);
create table private.announcement_recipients (
 id uuid primary key default gen_random_uuid(),
 announcement_id uuid not null references public.developer_announcements(id),
 email text not null check(email=lower(email) and email ~* '^[^@[:space:]]+@caedm\.ca$'),
 full_name text not null default '',is_test boolean not null default false,revision_hash text not null,
 status text not null default 'queued' check(status in ('queued','sending','accepted','delivered','failed','skipped')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 claim_token uuid,claimed_at timestamptz,accepted_at timestamptz,delivered_at timestamptz,
 provider text,provider_id text,delivery_ref uuid not null unique default gen_random_uuid(),safe_error text,message_payload jsonb,
 created_at timestamptz not null default now(),
 unique(announcement_id,email,is_test,revision_hash)
);
create index announcement_queue on private.announcement_recipients(created_at) where status in ('queued','sending','failed');
create table private.announcement_attempts (id uuid primary key default gen_random_uuid(),recipient_id uuid not null references private.announcement_recipients(id),attempt integer not null,started_at timestamptz not null default now(),finished_at timestamptz,outcome text,unique(recipient_id,attempt));
create table private.email_suppressions (email text primary key check(email=lower(email)),reason text not null check(reason in ('bounced','complained','suppressed','operator_blocked')),created_at timestamptz not null default now());
create table private.announcement_provider_events(event_id text primary key,recipient_id uuid not null references private.announcement_recipients(id),kind text not null,occurred_at timestamptz not null,received_at timestamptz not null default now());
alter table public.developer_announcements enable row level security;
revoke all on public.developer_announcements from public,anon,authenticated,service_role;
grant select on public.developer_announcements to authenticated;
create policy developer_announcements_read on public.developer_announcements for select to authenticated using(private.is_developer());
grant execute on function private.is_developer() to authenticated;
do $$ declare t text; begin foreach t in array array['announcement_recipients','announcement_attempts','email_suppressions','announcement_provider_events'] loop
 execute format('alter table private.%I enable row level security',t); execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
end loop; end $$;

create function private.announcement_candidates() returns table(email text,full_name text,source text,eligible boolean) language sql stable security definer set search_path='' as $$
  select lower(p.email),case when u.email_confirmed_at is not null then p.full_name else '' end,'signed_up'::text,
  p.status in ('active','pending_approval') and lower(u.email)=lower(p.email) and p.email ~* '^[^@[:space:]]+@caedm\.ca$' and not exists(select 1 from private.email_suppressions s where s.email=lower(p.email))
 from public.profiles p join auth.users u on u.id=p.id
 union all
 select i.email,i.full_name,'invited'::text,
  i.status<>'revoked' and (i.status='accepted' or i.expires_at>now()) and i.email ~* '^[^@[:space:]]+@caedm\.ca$'
  and not exists(select 1 from public.profiles p where lower(p.email)=i.email and p.status not in ('active','pending_approval'))
  and (i.status<>'accepted' or exists(select 1 from public.profiles p join auth.users u on u.id=p.id where lower(p.email)=i.email and lower(u.email)=i.email))
  and not exists(select 1 from private.email_suppressions s where s.email=i.email)
 from public.employee_invitations i
$$;
revoke all on function private.announcement_candidates() from public,anon,authenticated,service_role;
create function private.announcement_audience(kind text,selected text[]) returns jsonb language sql stable security definer set search_path='' as $$
 with raw as (select * from private.announcement_candidates() c where kind='everyone' or kind=c.source or kind='selected' and c.email=any(selected)),
 unique_people as (select distinct on(email) email,full_name from raw where eligible order by email,source desc)
 select jsonb_build_object('audience',kind,'eligible',(select count(*) from raw where eligible),'excluded',(select count(*) from raw where not eligible),'duplicates_removed',(select count(*) from raw where eligible)-(select count(*) from unique_people),'count',(select count(*) from unique_people),'people',(select coalesce(jsonb_agg(u order by u.full_name,u.email),'[]') from unique_people u))
$$;
revoke all on function private.announcement_audience(text,text[]) from public,anon,authenticated,service_role;
create function public.developer_announcement_audience(kind text,selected text[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_developer();
 if kind not in ('signed_up','invited','everyone','selected') or cardinality(selected)>1000 then raise exception 'Invalid audience'; end if;
 return private.announcement_audience(kind,array(select distinct lower(btrim(v)) from unnest(selected) v));
end $$;
create function public.save_developer_announcement(announcement uuid,chosen_template text,announcement_title text,email_subject text,email_body text,audience_kind text,selected text[] default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare revision text; existing public.developer_announcements;
begin
 perform private.require_developer(); perform pg_advisory_xact_lock(hashtextextended('announcement-actor:'||auth.uid()::text,0)); perform pg_advisory_xact_lock(hashtextextended('announcement:'||announcement::text,0));
 if announcement is null or cardinality(selected)>1000 then raise exception 'Invalid announcement'; end if;
 -- Match the existing per-actor durable write limiter; repeated submissions are idempotent.
 if (select count(*) from public.developer_announcements where created_by=auth.uid() and created_at>now()-interval '1 hour')>=20 and not exists(select 1 from public.developer_announcements where id=announcement) then raise exception 'Announcement limit reached'; end if;
 selected=array(select distinct lower(btrim(v)) from unnest(selected) v order by lower(btrim(v)));
 revision=md5(jsonb_build_array(chosen_template,btrim(announcement_title),btrim(email_subject),btrim(email_body),audience_kind,selected)::text);
 select * into existing from public.developer_announcements where id=announcement for update;
 if found and (existing.created_by<>auth.uid() or existing.state<>'draft') then raise exception 'This announcement cannot be edited'; end if;
 insert into public.developer_announcements(id,created_by,template,title,subject,body,audience,selected_emails,content_hash)
 values(announcement,auth.uid(),chosen_template,btrim(announcement_title),btrim(email_subject),btrim(email_body),audience_kind,selected,revision)
 on conflict(id) do update set template=excluded.template,title=excluded.title,subject=excluded.subject,body=excluded.body,audience=excluded.audience,selected_emails=excluded.selected_emails,
  previewed_hash=case when public.developer_announcements.content_hash=revision then public.developer_announcements.previewed_hash else null end,
  test_accepted_hash=case when public.developer_announcements.content_hash=revision then public.developer_announcements.test_accepted_hash else null end,content_hash=revision,updated_at=now();
 insert into private.developer_audit(actor_id,action,detail) values(auth.uid(),'announcement_saved',jsonb_build_object('announcement_id',announcement));
 return announcement;
end $$;
create function public.preview_developer_announcement(announcement uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.developer_announcements; actor public.profiles;
begin
 perform private.require_developer();
 select * into a from public.developer_announcements where id=announcement and created_by=auth.uid();
 if not found then raise exception 'Announcement not available'; end if;
 update public.developer_announcements set previewed_hash=content_hash where id=a.id;
 select * into actor from public.profiles where id=auth.uid();
 return jsonb_build_object('announcement',to_jsonb(a),'audience',private.announcement_audience(a.audience,a.selected_emails),'sender',jsonb_build_object('email',actor.email,'full_name',actor.full_name));
end $$;
create function public.queue_announcement_test(announcement uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.developer_announcements; p public.profiles; recipient uuid;
begin
 perform private.require_developer();
 select * into a from public.developer_announcements where id=announcement and created_by=auth.uid() for update;
 if not found or a.state<>'draft' or a.previewed_hash is distinct from a.content_hash then raise exception 'Preview the current draft before sending a test'; end if;
 select * into p from public.profiles where id=auth.uid();
 perform pg_advisory_xact_lock(hashtextextended('announcement-test:'||auth.uid()::text,0));
 if (select count(*) from private.announcement_recipients r join public.developer_announcements c on c.id=r.announcement_id where c.created_by=auth.uid() and r.is_test and r.created_at>now()-interval '1 hour')>=20 and not exists(select 1 from private.announcement_recipients where announcement_id=a.id and is_test and revision_hash=a.content_hash) then raise exception 'Test email hourly limit reached'; end if;
 if exists(select 1 from private.email_suppressions where email=p.email) then raise exception 'Your address is suppressed; contact the mail administrator'; end if;
 insert into private.announcement_recipients(announcement_id,email,full_name,is_test,revision_hash) values(a.id,p.email,p.full_name,true,a.content_hash)
 on conflict(announcement_id,email,is_test,revision_hash) do update set status=case when private.announcement_recipients.status='failed' and private.announcement_recipients.attempts<5 then 'queued' else private.announcement_recipients.status end returning id into recipient;
 return recipient;
end $$;
create function public.queue_developer_announcement(announcement uuid,expected_count integer,confirmed boolean) returns integer language plpgsql security definer set search_path='' as $$
declare a public.developer_announcements; recipients jsonb; total integer;
begin
 perform private.require_developer();
 select * into a from public.developer_announcements where id=announcement and created_by=auth.uid() for update;
 if not found then raise exception 'Announcement not available'; end if;
 if a.state='queued' then return (select count(*)::integer from private.announcement_recipients where announcement_id=a.id and not is_test); end if;
 if confirmed is distinct from true or a.previewed_hash is distinct from a.content_hash or a.test_accepted_hash is distinct from a.content_hash then raise exception 'Preview, successful test and confirmation are required for the current draft'; end if;
 recipients=private.announcement_audience(a.audience,a.selected_emails); total=(recipients->>'count')::integer;
 if total<1 or total<>expected_count then raise exception 'Audience changed or is empty. Review recipients again'; end if;
 insert into private.announcement_recipients(announcement_id,email,full_name,revision_hash)
 select a.id,x->>'email',x->>'full_name',a.content_hash from jsonb_array_elements(recipients->'people') x on conflict do nothing;
 update public.developer_announcements set state='queued',queued_at=now(),updated_at=now() where id=a.id;
 insert into private.developer_audit(actor_id,action,detail) values(auth.uid(),'announcement_queued',jsonb_build_object('announcement_id',a.id,'count',total,'audience',a.audience));
 return total;
end $$;
create function public.retry_developer_announcement(announcement uuid) returns integer language plpgsql security definer set search_path='' as $$
declare total integer;
begin
 perform private.require_developer();
 update private.announcement_recipients r set status='queued',safe_error=null where announcement_id=announcement and status='failed' and attempts<5 and not is_test and accepted_at is null
 and not exists(select 1 from private.announcement_attempts t where t.recipient_id=r.id and t.started_at<now()-interval '23 hours');
 get diagnostics total=row_count;
 insert into private.developer_audit(actor_id,action,detail) values(auth.uid(),'announcement_retry_queued',jsonb_build_object('announcement_id',announcement,'count',total));
 return total;
end $$;
revoke all on function public.developer_announcement_audience(text,text[]),public.save_developer_announcement(uuid,text,text,text,text,text,text[]),public.preview_developer_announcement(uuid),public.queue_announcement_test(uuid),public.queue_developer_announcement(uuid,integer,boolean),public.retry_developer_announcement(uuid) from public,anon;
grant execute on function public.developer_announcement_audience(text,text[]),public.save_developer_announcement(uuid,text,text,text,text,text,text[]),public.preview_developer_announcement(uuid),public.queue_announcement_test(uuid),public.queue_developer_announcement(uuid,integer,boolean),public.retry_developer_announcement(uuid) to authenticated;

create function public.claim_announcement_emails(test_recipient uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 with expired as (update private.role_previews set ended_at=expires_at,end_reason='expired' where ended_at is null and expires_at<=now() returning *)
 insert into private.developer_audit(actor_id,action,detail) select profile_id,'preview_expired',jsonb_build_object('preview_id',id,'actual_role',actual_role,'preview_role',preview_role,'ended_at',ended_at) from expired;
 -- Recipient and author eligibility is reevaluated after the campaign was queued.
 update private.announcement_recipients r set status='skipped',safe_error='Recipient or author is no longer eligible'
 from public.developer_announcements a where a.id=r.announcement_id and (r.status in ('queued','failed') or r.status='sending' and r.claimed_at<now()-interval '5 minutes') and
 (r.revision_hash<>a.content_hash or not private.has_developer_access(a.created_by) or not exists(select 1 from private.announcement_candidates() c where c.email=r.email and c.eligible));
 -- Resend idempotency expires after 24h. An unknown outcome beyond that window
 -- requires operator reconciliation, never an automatic potentially duplicate send.
 update private.announcement_recipients r set status='failed',safe_error='Delivery outcome requires operator review; automatic retry stopped',claim_token=null
 where accepted_at is null and (status in ('queued','failed') or status='sending' and claimed_at<now()-interval '5 minutes')
 and exists(select 1 from private.announcement_attempts t where t.recipient_id=r.id and t.started_at<now()-interval '23 hours');
 with candidates as (
 select r.id from private.announcement_recipients r join public.developer_announcements a on a.id=r.announcement_id
 where r.attempts<5 and r.accepted_at is null and not exists(select 1 from private.announcement_attempts t where t.recipient_id=r.id and t.started_at<now()-interval '23 hours') and (test_recipient is null or r.id=test_recipient and r.is_test) and (r.is_test or a.state='queued') and r.revision_hash=a.content_hash and private.has_developer_access(a.created_by)
 and (r.status='queued' or r.status='failed' and r.claimed_at<now()-interval '5 minutes' or r.status='sending' and r.claimed_at<now()-interval '5 minutes')
 order by r.is_test desc,r.created_at,r.id limit 10 for update of r skip locked
 ),claimed as (
 update private.announcement_recipients r set status='sending',attempts=r.attempts+1,claimed_at=now(),claim_token=gen_random_uuid() from candidates c where c.id=r.id returning r.*
 ),attempts as (
 insert into private.announcement_attempts(recipient_id,attempt) select id,attempts from claimed returning recipient_id
 ) select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'claim_token',r.claim_token,'delivery_ref',r.delivery_ref,'message_payload',r.message_payload,'email',r.email,'full_name',r.full_name,'is_test',r.is_test,'announcement_id',a.id,'title',a.title,'subject',a.subject,'body',a.body,'template',a.template,'reply_to',p.email)),'[]') into result
 from claimed r join attempts t on t.recipient_id=r.id join public.developer_announcements a on a.id=r.announcement_id join public.profiles p on p.id=a.created_by;
 return result;
end $$;
create function public.finish_announcement_email(recipient uuid,token uuid,accepted boolean,email_provider text,provider_message_id text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare r private.announcement_recipients;
begin
 if accepted is null or email_provider not in ('resend','smtp','local') then raise exception 'Invalid delivery result'; end if;
 update private.announcement_recipients set status=case when status in ('delivered','failed') then status when accepted then 'accepted' else 'failed' end,
 provider=email_provider,provider_id=coalesce(provider_id,left(provider_message_id,200)),accepted_at=case when accepted then coalesce(accepted_at,now()) else accepted_at end,
 safe_error=case when status in ('delivered','failed') then safe_error when accepted then null else 'Email provider did not confirm acceptance' end,claim_token=null
 where id=recipient and status in ('sending','delivered','failed') and claim_token=token and token is not null and claimed_at>now()-interval '5 minutes' returning * into r;
 if not found then return false; end if;
 update private.announcement_attempts set finished_at=now(),outcome=case when accepted then 'accepted' else 'failed' end where recipient_id=r.id and attempt=r.attempts;
 if accepted and r.is_test and r.status in ('accepted','delivered') then update public.developer_announcements set test_accepted_hash=r.revision_hash where id=r.announcement_id and content_hash=r.revision_hash; end if;
 return true;
end $$;
revoke all on function public.claim_announcement_emails(uuid),public.finish_announcement_email(uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.claim_announcement_emails(uuid),public.finish_announcement_email(uuid,uuid,boolean,text,text) to service_role;

-- Narrow delivery-receipt capability: no service credential and no ordinary business query.
-- The unguessable per-recipient capability is exposed only to the email worker/provider.
create function public.record_announcement_receipt(delivery_capability uuid,event_key text,event_kind text,provider_message_id text,event_time timestamptz) returns boolean language plpgsql security definer set search_path='' as $$
declare r private.announcement_recipients;
begin
 if event_kind is null or event_key is null or provider_message_id is null or event_time is null or event_kind not in ('delivered','bounced','complained','suppressed','failed') or length(event_key) not between 1 and 200 or length(provider_message_id) not between 1 and 200 or event_time>now()+interval '5 minutes' or event_time<now()-interval '30 days' then return false; end if;
 select * into r from private.announcement_recipients where delivery_ref=delivery_capability and created_at>now()-interval '30 days' and status in ('sending','accepted','delivered','failed') and (provider_id is null or provider_id=provider_message_id) for update;
 if not found then return false; end if;
 insert into private.announcement_provider_events(event_id,recipient_id,kind,occurred_at) values(event_key,r.id,event_kind,event_time) on conflict do nothing;
 if not found then return true; end if;
 update private.announcement_recipients set provider='resend',provider_id=provider_message_id,
 status=case when event_kind='delivered' and not exists(select 1 from private.announcement_provider_events e where e.recipient_id=r.id and e.kind<>'delivered') then 'delivered' when event_kind<>'delivered' then 'failed' else status end,
 accepted_at=coalesce(accepted_at,event_time),
 delivered_at=case when event_kind='delivered' then event_time else delivered_at end,
 safe_error=case when event_kind='delivered' then safe_error else 'Provider-confirmed '||event_kind end where id=r.id;
 if event_kind in ('bounced','complained','suppressed') then insert into private.email_suppressions(email,reason) values(r.email,event_kind) on conflict(email) do update set reason=excluded.reason; end if;
 return true;
end $$;
revoke all on function public.record_announcement_receipt(uuid,text,text,text,timestamptz) from public,authenticated,service_role;
grant execute on function public.record_announcement_receipt(uuid,text,text,text,timestamptz) to anon;

-- Freeze the rendered message before its first provider call. Retries remain byte
-- identical even if deployment/contact metadata changes between delivery attempts.
create function public.snapshot_announcement_message(recipient uuid,token uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.announcement_recipients;
begin
 select * into r from private.announcement_recipients where id=recipient and claim_token=token and token is not null and status='sending' and claimed_at>now()-interval '5 minutes' for update;
 if not found then raise exception 'Current delivery lease required'; end if;
 if not exists(select 1 from public.developer_announcements a where a.id=r.announcement_id and a.content_hash=r.revision_hash and private.has_developer_access(a.created_by)) or not exists(select 1 from private.announcement_candidates() c where c.email=r.email and c.eligible) then
  update private.announcement_recipients set status='skipped',claim_token=null,safe_error='Recipient, author or draft is no longer eligible' where id=r.id;
  update private.announcement_attempts set finished_at=now(),outcome='skipped' where recipient_id=r.id and attempt=r.attempts;
  return null;
 end if;
 if r.message_payload is not null then return r.message_payload; end if;
 if payload->>'id' is distinct from 'announcement-'||r.id::text or payload->>'to' is distinct from r.email or payload->>'purpose' is distinct from 'notifications' or payload->>'deliveryRef' is distinct from r.delivery_ref::text or octet_length(payload::text)>200000 then raise exception 'Invalid message snapshot'; end if;
 update private.announcement_recipients set message_payload=payload where id=r.id;
 return payload;
end $$;
revoke all on function public.snapshot_announcement_message(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.snapshot_announcement_message(uuid,uuid,jsonb) to service_role;

create function public.developer_email_activity() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_developer();
 return jsonb_build_object('announcements',(select coalesce(jsonb_agg(q),'[]') from (
  select a.id,a.title,a.subject,a.template,a.audience,a.created_by,a.created_at,a.queued_at,a.state,
  count(r.id) filter(where not r.is_test) as total,
  count(r.id) filter(where not r.is_test and r.status='queued') as queued,
  count(r.id) filter(where not r.is_test and r.status='sending') as sending,
  count(r.id) filter(where not r.is_test and r.status='accepted') as accepted,
  count(r.id) filter(where not r.is_test and r.status='delivered') as delivered,
  count(r.id) filter(where not r.is_test and r.status='failed') as failed,
  count(r.id) filter(where not r.is_test and r.status='skipped') as skipped
  from public.developer_announcements a left join private.announcement_recipients r on r.announcement_id=a.id group by a.id order by a.created_at desc limit 50) q),
 'outbox',(select coalesce(jsonb_agg(q),'[]') from (
  select r.id,'announcement'::text as type,a.subject,r.email,r.status,r.attempts,r.created_at,r.accepted_at,r.delivered_at,r.safe_error,r.is_test,a.id as announcement_id
  from private.announcement_recipients r join public.developer_announcements a on a.id=r.announcement_id
  union all
  select n.id,'usage_review',coalesce(n.subject,'Usage review'),p.email,case when n.status='sent' then 'accepted' else n.status end,n.attempts,n.created_at,n.delivered_at,null::timestamptz,n.error,false,null::uuid from public.notification_logs n join public.profiles p on p.id=n.recipient_id where private.is_finance() or n.recipient_id=auth.uid()
  union all
  select n.id,'billing',coalesce(n.subject,'Billing reminder'),p.email,case when n.status='sent' then 'accepted' else n.status end,n.attempts,n.created_at,n.delivered_at,null::timestamptz,n.error,false,null::uuid from public.billing_notifications n join public.profiles p on p.id=n.recipient_id where private.is_finance() or (n.recipient_id=auth.uid() and private.can_view_subscription(n.subscription_id))
  union all
  select r.id,'feature_request','Feature request delivery',r.requester_email,case when r.delivery_status='sent' then 'accepted' else r.delivery_status end,r.delivery_attempts,r.created_at,r.email_sent_at,null::timestamptz,r.delivery_error,false,null::uuid from public.feature_requests r where r.requester_id=auth.uid() or private.is_admin()
  union all
  select i.id,'invitation','Employee invitation',i.email,case when i.delivery_status='sent' then 'accepted' else i.delivery_status end,i.send_count,i.created_at,null::timestamptz,null::timestamptz,i.delivery_error,false,null::uuid from public.employee_invitations i where private.is_admin()
  union all
  select n.id,'account_notice',n.kind,p.email,case when n.status='sent' then 'accepted' else n.status end,n.attempts,n.created_at,n.delivered_at,null::timestamptz,null::text,false,null::uuid from private.account_email_notifications n join public.profiles p on p.id=n.recipient_id where private.is_admin() or n.recipient_id=auth.uid()
  union all
  select n.id,'developer_access',n.kind,p.email,n.status,n.attempts,n.created_at,n.accepted_at,null::timestamptz,null::text,false,null::uuid from private.developer_security_emails n join public.profiles p on p.id=n.recipient_id
  order by created_at desc limit 200) q));
end $$;
create function public.developer_announcement_detail(announcement uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_developer();
 return jsonb_build_object('announcement',(select to_jsonb(a) from public.developer_announcements a where id=announcement),
 'recipients',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'email',r.email,'full_name',r.full_name,'is_test',r.is_test,'status',r.status,'attempts',r.attempts,'accepted_at',r.accepted_at,'delivered_at',r.delivered_at,'safe_error',r.safe_error)),'[]') from private.announcement_recipients r where r.announcement_id=announcement),
 'attempts',(select coalesce(jsonb_agg(jsonb_build_object('recipient_id',t.recipient_id,'attempt',t.attempt,'started_at',t.started_at,'finished_at',t.finished_at,'outcome',t.outcome)),'[]') from private.announcement_attempts t join private.announcement_recipients r on r.id=t.recipient_id where r.announcement_id=announcement));
end $$;
revoke all on function public.developer_email_activity(),public.developer_announcement_detail(uuid) from public,anon;
grant execute on function public.developer_email_activity(),public.developer_announcement_detail(uuid) to authenticated;

create function public.claim_developer_security_emails() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 with candidates as (select n.id from private.developer_security_emails n join public.profiles p on p.id=n.recipient_id join auth.users u on u.id=p.id where n.attempts<5 and u.email_confirmed_at is not null and lower(p.email)=lower(u.email) and (n.status='queued' or n.status='failed' and n.claimed_at<now()-interval '5 minutes' or n.status='sending' and n.claimed_at<now()-interval '5 minutes') order by n.created_at limit 5 for update of n skip locked),
 claimed as (update private.developer_security_emails n set status='sending',attempts=n.attempts+1,claimed_at=now(),claim_token=gen_random_uuid() from candidates c where c.id=n.id returning n.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'claim_token',n.claim_token,'kind',n.kind,'email',p.email,'full_name',p.full_name,'actor_name',a.full_name)),'[]') into result from claimed n join public.profiles p on p.id=n.recipient_id left join public.profiles a on a.id=n.actor_id;
 return result;
end $$;
create function public.finish_developer_security_email(notification uuid,token uuid,accepted boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if accepted is null then return false; end if;
 update private.developer_security_emails set status=case when accepted then 'accepted' else 'failed' end,accepted_at=case when accepted then now() end,claim_token=null where id=notification and status='sending' and claim_token=token and token is not null and claimed_at>now()-interval '5 minutes';
 return found;
end $$;
revoke all on function public.claim_developer_security_emails(),public.finish_developer_security_email(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_developer_security_emails(),public.finish_developer_security_email(uuid,uuid,boolean) to service_role;
