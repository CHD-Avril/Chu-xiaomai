-- Deprecated.
-- Do not use the old RLS setup script. It previously granted anonymous users
-- broad write/read access and is intentionally replaced by the secure schema.
--
-- Follow the complete migration sequence in README.md. It drops old dangerous policies and
-- recreates the safe Auth/RPC-based access rules.

select 'Deprecated: follow README.md; finish with supabase-database-integrity.sql.' as notice;
