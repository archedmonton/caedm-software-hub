-- Enforce reporting settings and expense currency at the database boundary too.
create function private.valid_currencies(codes text[]) returns boolean language sql immutable set search_path='' as $$select coalesce(bool_and(code ~ '^[A-Z]{3}$'),false) and count(*)=count(distinct code) from unnest(codes) as code$$;
alter table public.application_settings add constraint settings_currency_codes check(private.valid_currencies(currencies));
alter table public.application_settings add constraint settings_org_name check(length(organization_name) between 1 and 150);
alter table public.application_settings add constraint reminder_order check(follow_up_days<=initial_reminder_days);
create function private.validate_expense_currency() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.application_settings where id and new.currency=any(currencies)) then raise exception 'Currency is not configured'; end if;return new;
end $$;
create trigger validate_expense_currency before insert or update on public.expense_records for each row execute function private.validate_expense_currency();
revoke all on function private.valid_currencies(text[]),private.validate_expense_currency() from public,anon,authenticated;
grant execute on function private.valid_currencies(text[]) to authenticated;