-- Run ONLY as the database administrator after the explicitly designated account
-- registered and verified its email. Replace the email below. No first-user promotion.
do $$ declare designated_email text := 'REPLACE_WITH_VERIFIED_ADMIN@caedm.ca'; target uuid;
begin
 select id into target from auth.users where lower(email)=lower(designated_email) and email_confirmed_at is not null and email ~* '^[^@[:space:]]+@caedm\.ca$';
 if target is null then raise exception 'Designated account is missing or unverified'; end if;
 update public.profiles set role='admin',status='active' where id=target;
 if not found then raise exception 'Profile is missing'; end if;
end $$;