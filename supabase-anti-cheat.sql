-- Deprecated.
-- The anti-cheat rules are now part of supabase-schema.sql:
-- - get_my_likes RPC
-- - toggle_song_like RPC
-- - submit_song RPC
-- - vote_attempts rate limiting
-- - safe RLS policies
--
-- Run supabase-schema.sql instead of this file.

select 'Deprecated: anti-cheat migration is included in supabase-schema.sql.' as notice;
