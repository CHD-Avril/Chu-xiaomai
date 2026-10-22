-- Deprecated: this old repair script must not overwrite hardened RPCs.
-- Run supabase-database-integrity.sql after supabase-admin-workflow.sql instead.
select 'Run supabase-database-integrity.sql; no functions were changed.' as notice;
