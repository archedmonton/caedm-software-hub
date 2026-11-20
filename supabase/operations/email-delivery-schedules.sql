-- Operator setup for the explicitly selected CAEDM Software Hub production project.
-- First store its existing Vercel CRON_SECRET in Vault under the exact name below.
-- Never put a literal credential in this file or the cron command.
begin;
set local lock_timeout='5s';
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function private.dispatch_application_email_jobs()
 returns void language plpgsql security definer set search_path='' as $$
declare worker_secret text; endpoint text;
begin
 select decrypted_secret into worker_secret from vault.decrypted_secrets
 where name='caedm_software_hub_cron_secret';
 if worker_secret is null or length(worker_secret)<32 then
  raise exception 'Application email scheduler credential is not configured';
 end if;
 foreach endpoint in array array['account-emails','feature-requests','announcements'] loop
  perform net.http_post(
   url:='https://caedm-software-hub.vercel.app/api/jobs/'||endpoint,
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_secret),
   body:='{}'::jsonb,
   timeout_milliseconds:=300000
  );
 end loop;
end $$;
revoke all on function private.dispatch_application_email_jobs() from public,anon,authenticated,service_role;

-- cron.schedule updates the named job if this reviewed operator script is rerun.
select cron.schedule('caedm-application-email-queues','*/5 * * * *',
 'select private.dispatch_application_email_jobs();');
commit;
