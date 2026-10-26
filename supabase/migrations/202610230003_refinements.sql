alter table public.software_subscriptions add column billing_paused boolean not null default false;
alter table public.software_subscriptions add column license_expiry_date date;
-- Application-owned review timestamps and creation history cannot be forged by clients.
revoke insert,update on public.software_subscriptions from authenticated;
grant insert(name,vendor_id,team_id,owner_id,category,description,website,cost_centre,purchase_date,purchase_type,amount,currency,billing_cycle,custom_interval_months,billing_start_date,next_billing_date,auto_renew,cancellation_notice_days,licenses_purchased,licenses_used,license_notes,payment_method_id,invoice_reference,internal_reference,notes,status,review_frequency_months,billing_paused,license_expiry_date),update(name,vendor_id,team_id,owner_id,category,description,website,cost_centre,purchase_date,purchase_type,amount,currency,billing_cycle,custom_interval_months,billing_start_date,next_billing_date,auto_renew,cancellation_notice_days,licenses_purchased,licenses_used,license_notes,payment_method_id,invoice_reference,internal_reference,notes,status,review_frequency_months,billing_paused,license_expiry_date) on public.software_subscriptions to authenticated;
-- Confirmed records may be corrected, preserving their original ownership/payment snapshots.
create policy expenses_update on public.expense_records for update to authenticated using(private.is_finance()) with check(private.is_finance());
grant update(transaction_date,amount,tax,currency,invoice_reference,notes) on public.expense_records to authenticated;
create function public.remove_membership(department uuid,employee uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.is_admin() then raise exception 'Access denied'; end if;
 if exists(select 1 from public.software_subscriptions where team_id=department and owner_id=employee and status not in ('archived','cancelled','expired')) then raise exception 'Transfer active software ownership before removing department access'; end if;
 insert into public.audit_logs(actor_id,entity,record_id,action,before_data) select auth.uid(),'team_members',employee::text,'DELETE',to_jsonb(m) from public.team_members m where team_id=department and profile_id=employee;
 delete from public.team_members where team_id=department and profile_id=employee;
end $$;
revoke all on function public.remove_membership(uuid,uuid) from public,anon;
grant execute on function public.remove_membership(uuid,uuid) to authenticated;