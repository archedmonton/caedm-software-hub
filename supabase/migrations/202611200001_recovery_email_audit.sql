-- Record delivery outcomes without storing reset links, password values or email bodies.
create function public.record_account_recovery_email(recovery uuid,accepted boolean,email_provider text default null)
 returns void language plpgsql security definer set search_path='' as $$
declare person uuid;
begin
 perform private.require_recovery_operator(true);
 if accepted is null or (accepted and (email_provider is null or email_provider not in ('resend','smtp','local'))) then raise exception 'Invalid recovery delivery outcome'; end if;
 select r.profile_id into person from private.account_recoveries r
 where r.id=recovery and r.issuer_id=auth.uid() and r.token_digest is not null
 and r.expires_at>clock_timestamp() and private.recovery_target(r.profile_id);
 if person is null then raise exception 'Recovery delivery cannot be recorded'; end if;
 insert into private.developer_audit(actor_id,subject_id,action,detail)
 values(auth.uid(),person,case when accepted then 'account_recovery_email_accepted' else 'account_recovery_email_failed' end,
 jsonb_build_object('recovery_id',recovery,'provider',case when accepted then email_provider else null end));
end $$;
revoke all on function public.record_account_recovery_email(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.record_account_recovery_email(uuid,boolean,text) to authenticated;

create or replace function public.account_recovery_console() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_recovery_operator();
 return jsonb_build_object('require_mfa',coalesce((select require_mfa from private.developer_governance where singleton),false),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,'role',p.role,'pending',r.profile_id is not null and r.completed_at is null,'expires_at',r.expires_at) order by p.full_name,p.id),'[]') from public.profiles p left join private.account_recoveries r on r.profile_id=p.id where private.recovery_target(p.id)),
 'history',(select coalesce(jsonb_agg(x),'[]') from (select a.id,a.actor_id,a.subject_id,a.action,a.created_at from private.developer_audit a where a.action in ('account_recovery_started','account_recovery_prepared','account_recovery_completed','account_recovery_email_accepted','account_recovery_email_failed') order by a.created_at desc limit 30) x));
end $$;
