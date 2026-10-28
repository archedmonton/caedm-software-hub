-- Signed-in employees may queue retries of their own requests. Only the scheduled
-- email job may claim deliveries or acknowledge SMTP success/failure.
create function public.retry_feature_request_email(request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.feature_requests;
begin
 if not private.can_request_features() then raise exception 'A verified active or pending CAEDM account is required'; end if;
 select * into r from public.feature_requests where id=request_id and requester_id=auth.uid() for update;
 if not found then raise exception 'Request unavailable'; end if;
 if r.delivery_status='sent' then return jsonb_build_object('status','sent'); end if;
 if r.delivery_status='sending' and r.delivery_until>now() then return jsonb_build_object('status','sending'); end if;
 if r.last_attempt_at>now()-interval '1 minute' then raise exception 'Wait one minute before retrying email delivery'; end if;
 if r.delivery_attempts>=5 then raise exception 'Email retry limit reached. Contact the developer with your request reference'; end if;
 update public.feature_requests set delivery_status='pending',delivery_error=null,delivery_claim=null,delivery_until=null where id=r.id;
 return jsonb_build_object('status','pending');
end $$;
revoke all on function public.retry_feature_request_email(uuid) from public,anon;
grant execute on function public.retry_feature_request_email(uuid) to authenticated;

create function public.pending_feature_request_deliveries() returns table(id uuid,requester_id uuid)
language sql security definer set search_path='' as $$
 select r.id,r.requester_id from public.feature_requests r
 join public.profiles p on p.id=r.requester_id join auth.users u on u.id=p.id
 where p.status in ('active','pending_approval') and u.email_confirmed_at is not null
 and lower(u.email)=lower(p.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$'
 and (r.delivery_attempts<5 or (r.delivery_status='sending' and r.delivery_until<=now())) and (
  r.delivery_status='pending' or
  (r.delivery_status='failed' and r.last_attempt_at<=now()-interval '5 minutes') or
  (r.delivery_status='sending' and r.delivery_until<=now())
 ) and (r.last_attempt_at is null or r.last_attempt_at<=now()-interval '1 minute')
 order by r.last_attempt_at nulls first,r.created_at,r.id limit 3
$$;
revoke all on function public.pending_feature_request_deliveries() from public,anon,authenticated;
grant execute on function public.pending_feature_request_deliveries() to service_role;
