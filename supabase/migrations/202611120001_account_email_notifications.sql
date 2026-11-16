-- Durable operational notices. No profile, role, financial record or preference is rewritten.
create table private.account_email_notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid references public.profiles(id) on delete set null,
 kind text not null check(kind in ('approval','access_changed','role_changed')),
 before_role text not null,
 after_role text not null,
 before_status text not null,
 after_status text not null,
 actor_id uuid,
 created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','superseded')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 claimed_at timestamptz,
 claim_token uuid,
 delivered_at timestamptz,
 provider text check(provider in ('local','smtp','resend'))
);
alter table private.account_email_notifications enable row level security;
revoke all on private.account_email_notifications from public,anon,authenticated,service_role;
create index account_email_pending on private.account_email_notifications(created_at) where status<>'sent';

create function private.queue_account_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Only real, verified account identities generate operational email.
 if not exists(select 1 from auth.users u where u.id=new.id and u.email_confirmed_at is not null and lower(u.email)=lower(new.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$') then return new; end if;
 -- Invited users receive the existing invitation/setup flow, not a second approval email.
 if old.status is distinct from new.status and not (old.status='pending_approval' and new.status='active' and exists(select 1 from public.employee_invitations i where i.email=lower(new.email) and i.onboarding_user_id=new.id)) then
  insert into private.account_email_notifications(recipient_id,kind,before_role,after_role,before_status,after_status,actor_id)
  values(new.id,case when old.status='pending_approval' and new.status='active' then 'approval' else 'access_changed' end,old.role::text,new.role::text,old.status::text,new.status::text,auth.uid());
 end if;
 if old.role is distinct from new.role and old.status='active' then
  insert into private.account_email_notifications(recipient_id,kind,before_role,after_role,before_status,after_status,actor_id)
  values(new.id,'role_changed',old.role::text,new.role::text,old.status::text,new.status::text,auth.uid());
 end if;
 return new;
end $$;
revoke all on function private.queue_account_email() from public,anon,authenticated,service_role;
create trigger queue_account_email after update of role,status on public.profiles for each row execute function private.queue_account_email();

create function public.claim_account_emails()
 returns table(id uuid,claim_token uuid,kind text,email text,full_name text,before_role text,after_role text,before_status text,after_status text,created_at timestamptz)
 language plpgsql security definer set search_path='' as $$
begin
 -- Do not send an obsolete approval after a later access change.
 update private.account_email_notifications n set status='superseded',claim_token=null
 from public.profiles p where n.recipient_id=p.id and n.kind='approval' and n.status in ('pending','failed') and p.status::text<>n.after_status;
 return query with candidates as (
  select n.id from private.account_email_notifications n join public.profiles p on p.id=n.recipient_id join auth.users u on u.id=p.id
  where n.attempts<5 and (n.status in ('pending','failed') and (n.claimed_at is null or n.claimed_at<now()-interval '5 minutes') or n.status='sending' and n.claimed_at<now()-interval '5 minutes')
   and u.email_confirmed_at is not null and lower(u.email)=lower(p.email) and u.email ~* '^[^@[:space:]]+@caedm\.ca$'
  order by n.created_at,n.id limit 10 for update of n skip locked
 ), claimed as (
  update private.account_email_notifications n set status='sending',attempts=n.attempts+1,claimed_at=now(),claim_token=gen_random_uuid() from candidates c where n.id=c.id returning n.*
 ) select n.id,n.claim_token,n.kind,p.email,p.full_name,n.before_role,n.after_role,n.before_status,n.after_status,n.created_at from claimed n join public.profiles p on p.id=n.recipient_id;
end $$;
revoke all on function public.claim_account_emails() from public,anon,authenticated;
grant execute on function public.claim_account_emails() to service_role;

create function public.finish_account_email(notification uuid,token uuid,successful boolean,email_provider text)
 returns boolean language plpgsql security definer set search_path='' as $$
begin
 if successful is null or email_provider not in ('local','smtp','resend') or email_provider is null then raise exception 'Invalid delivery result'; end if;
 update private.account_email_notifications set status=case when successful then 'sent' else 'failed' end,
  delivered_at=case when successful then now() else null end,provider=email_provider,claim_token=null
 where id=notification and status='sending' and claim_token=token and token is not null and claimed_at>now()-interval '5 minutes';
 return found;
end $$;
revoke all on function public.finish_account_email(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_account_email(uuid,uuid,boolean,text) to service_role;
