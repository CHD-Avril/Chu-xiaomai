-- Deprecated.
-- The anti-cheat rules are now part of supabase-schema.sql:
-- - get_my_likes RPC
-- - toggle_song_like RPC
-- - submit_song RPC
-- - vote_attempts rate limiting
-- - safe RLS policies
--
-- Follow the complete migration sequence in README.md instead of this file.

select 'Deprecated: follow README.md; finish with supabase-database-integrity.sql.' as notice;
