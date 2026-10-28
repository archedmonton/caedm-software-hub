-- Commit the enum addition before the following migration uses the new value.
alter type public.app_role add value if not exists 'super_admin';
