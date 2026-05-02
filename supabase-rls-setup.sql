-- Deprecated.
-- Do not use the old RLS setup script. It previously granted anonymous users
-- broad write/read access and is intentionally replaced by the secure schema.
--
-- Run supabase-schema.sql instead. It drops the old dangerous policies and
-- recreates the safe Auth/RPC-based access rules.

select 'Deprecated: run supabase-schema.sql instead of supabase-rls-setup.sql.' as notice;
