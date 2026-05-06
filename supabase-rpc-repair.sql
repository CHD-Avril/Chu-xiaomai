-- Chu Xiaomai Supabase RPC repair.
-- Run this whole file in Supabase SQL Editor when submit/vote RPCs are missing
-- from the PostgREST schema cache or were dropped by a failed migration.

begin;

insert into public.security_settings (id)
values (true)
on conflict (id) do nothing;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.admin_users admin_user
      where lower(admin_user.email) = lower(auth.email())
    );
$$;

create or replace function public.is_admin_email_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users admin_user
    where lower(admin_user.email) = lower(nullif(btrim(p_email), ''))
  );
$$;

create or replace function public.request_client_ip()
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  headers jsonb := '{}'::jsonb;
  header_text text;
  raw_ip text;
begin
  header_text := current_setting('request.headers', true);

  if header_text is not null and header_text <> '' then
    begin
      headers := header_text::jsonb;
    exception when others then
      headers := '{}'::jsonb;
    end;
  end if;

  raw_ip := coalesce(
    headers ->> 'cf-connecting-ip',
    headers ->> 'x-real-ip',
    split_part(headers ->> 'x-forwarded-for', ',', 1)
  );

  raw_ip := nullif(btrim(raw_ip), '');
  if raw_ip is null then
    return null;
  end if;

  return left(raw_ip, 128);
end;
$$;

create or replace function public.assert_valid_voter_cookie(p_voter_cookie text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized_cookie text := nullif(btrim(p_voter_cookie), '');
begin
  if normalized_cookie is null
    or length(normalized_cookie) < 8
    or length(normalized_cookie) > 128
    or normalized_cookie !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception 'Browser cookies are required before submitting or voting.';
  end if;

  return normalized_cookie;
end;
$$;

create or replace function public.record_rate_limited_attempt(
  p_attempt_type text,
  p_playlist_date text,
  p_voter_cookie text,
  p_voter_ip text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.security_settings%rowtype;
  cookie_count integer;
  ip_count integer;
begin
  if p_playlist_date is null or length(p_playlist_date) > 64 then
    raise exception 'Invalid playlist period.';
  end if;

  select *
  into settings
  from public.security_settings
  where public.security_settings.id = true;

  if not found then
    raise exception 'Security settings are missing.';
  end if;

  delete from public.vote_attempts
  where created_at < now() - interval '7 days';

  if p_attempt_type = 'vote' then
    select count(*)::integer into cookie_count
    from public.vote_attempts
    where attempt_type = 'vote'
      and voter_cookie = p_voter_cookie
      and created_at >= now() - interval '1 minute';

    if cookie_count >= settings.vote_cookie_per_minute then
      raise exception 'Voting too frequently. Please wait a minute and try again.';
    end if;

    if p_voter_ip is not null then
      select count(*)::integer into ip_count
      from public.vote_attempts
      where attempt_type = 'vote'
        and voter_ip = p_voter_ip
        and created_at >= now() - interval '1 minute';

      if ip_count >= settings.vote_ip_per_minute then
        raise exception 'This network is voting too frequently. Please wait a minute and try again.';
      end if;
    end if;
  elsif p_attempt_type = 'submission' then
    select count(*)::integer into cookie_count
    from public.vote_attempts
    where attempt_type = 'submission'
      and voter_cookie = p_voter_cookie
      and created_at >= now() - interval '1 minute';

    if cookie_count >= settings.submission_cookie_per_minute then
      raise exception 'Submitting too frequently. Please wait a minute and try again.';
    end if;

    if p_voter_ip is not null then
      select count(*)::integer into ip_count
      from public.vote_attempts
      where attempt_type = 'submission'
        and voter_ip = p_voter_ip
        and created_at >= now() - interval '1 minute';

      if ip_count >= settings.submission_ip_per_minute then
        raise exception 'This network is submitting too frequently. Please wait a minute and try again.';
      end if;
    end if;
  else
    raise exception 'Unknown rate limit type.';
  end if;

  insert into public.vote_attempts (attempt_type, playlist_date, voter_cookie, voter_ip)
  values (p_attempt_type, p_playlist_date, p_voter_cookie, p_voter_ip);
end;
$$;

drop function if exists public.get_my_likes(text, text);
create function public.get_my_likes(
  p_playlist_date text,
  p_voter_cookie text
)
returns table (song_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_cookie text;
begin
  normalized_cookie := public.assert_valid_voter_cookie(p_voter_cookie);

  return query
  select like_row.song_id
  from public.song_likes like_row
  where like_row.playlist_date = p_playlist_date
    and like_row.voter_cookie = normalized_cookie
  order by like_row.created_at desc
  limit 500;
end;
$$;

drop function if exists public.toggle_song_like(uuid, text, text, text);
create function public.toggle_song_like(
  p_song_id uuid,
  p_playlist_date text,
  p_voter_cookie text,
  p_action text
)
returns table (liked boolean, likes_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_cookie text;
  client_ip text;
  next_likes_count integer := 0;
  max_likes integer;
  already_liked boolean := false;
begin
  normalized_cookie := public.assert_valid_voter_cookie(p_voter_cookie);
  client_ip := public.request_client_ip();
  perform public.record_rate_limited_attempt('vote', p_playlist_date, normalized_cookie, client_ip);

  if p_action not in ('like', 'unlike') then
    raise exception 'Unknown voting action.';
  end if;

  if not exists (
    select 1
    from public.songs song
    join public.playlist_periods period on period.id::text = song.playlist_date
    where song.id = p_song_id
      and song.playlist_date = p_playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  ) then
    raise exception 'This song is not in an open voting period.';
  end if;

  select exists (
    select 1
    from public.song_likes like_row
    where like_row.song_id = p_song_id
      and like_row.playlist_date = p_playlist_date
      and like_row.voter_cookie = normalized_cookie
  ) into already_liked;

  if p_action = 'like' and not already_liked then
    select public.security_settings.max_likes_per_period
    into max_likes
    from public.security_settings
    where public.security_settings.id = true;

    if (
      select count(*)::integer
      from public.song_likes like_row
      where like_row.playlist_date = p_playlist_date
        and like_row.voter_cookie = normalized_cookie
    ) >= max_likes then
      raise exception 'This browser has reached the like limit for this period.';
    end if;

    insert into public.song_likes (song_id, user_id, playlist_date, voter_cookie, voter_ip)
    values (p_song_id, normalized_cookie, p_playlist_date, normalized_cookie, client_ip);
  elsif p_action = 'unlike' then
    delete from public.song_likes like_row
    where like_row.song_id = p_song_id
      and like_row.playlist_date = p_playlist_date
      and like_row.voter_cookie = normalized_cookie;
  end if;

  update public.songs
  set likes_count = (
    select count(*)::integer
    from public.song_likes like_row
    where like_row.song_id = p_song_id
      and like_row.playlist_date = p_playlist_date
  )
  where public.songs.id = p_song_id
  returning public.songs.likes_count into next_likes_count;

  return query
  select exists (
    select 1
    from public.song_likes like_row
    where like_row.song_id = p_song_id
      and like_row.playlist_date = p_playlist_date
      and like_row.voter_cookie = normalized_cookie
  ), coalesce(next_likes_count, 0);
end;
$$;

drop function if exists public.submit_song(text, text, text, text);
create function public.submit_song(
  p_title text,
  p_artist text,
  p_playlist_date text,
  p_voter_cookie text
)
returns table (
  id uuid,
  title text,
  artist text,
  playlist_date text,
  likes_count integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_cookie text;
  client_ip text;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_artist text := btrim(coalesce(p_artist, ''));
  clean_title_lower text;
  clean_artist_lower text;
  max_submissions integer;
  submitter_hash text;
begin
  normalized_cookie := public.assert_valid_voter_cookie(p_voter_cookie);
  client_ip := public.request_client_ip();
  perform public.record_rate_limited_attempt('submission', p_playlist_date, normalized_cookie, client_ip);

  if char_length(clean_title) < 1 or char_length(clean_title) > 80 then
    raise exception 'Song title must be 1-80 characters.';
  end if;

  if char_length(clean_artist) < 1 or char_length(clean_artist) > 80 then
    raise exception 'Artist name must be 1-80 characters.';
  end if;

  if not exists (
    select 1
    from public.playlist_periods period
    where period.id::text = p_playlist_date
      and period.status = 'active'
      and now() between period.starts_at and period.ends_at
  ) then
    raise exception 'The current period is not open for submissions.';
  end if;

  submitter_hash := 'cookie:' || md5(normalized_cookie);

  select public.security_settings.submission_cookie_per_period
  into max_submissions
  from public.security_settings
  where public.security_settings.id = true;

  if (
    select count(*)::integer
    from public.songs song
    where song.playlist_date = p_playlist_date
      and song.created_by = submitter_hash
  ) >= max_submissions then
    raise exception 'This browser has reached the submission limit for this period.';
  end if;

  clean_title_lower := lower(clean_title);
  clean_artist_lower := lower(clean_artist);

  if exists (
    select 1
    from public.songs song
    where song.playlist_date = p_playlist_date
      and song.title_lower = clean_title_lower
      and song.artist_lower = clean_artist_lower
  ) then
    raise exception 'This song is already in the current playlist.';
  end if;

  return query
  insert into public.songs (
    title,
    artist,
    title_lower,
    artist_lower,
    playlist_date,
    likes_count,
    created_by
  )
  values (
    clean_title,
    clean_artist,
    clean_title_lower,
    clean_artist_lower,
    p_playlist_date,
    0,
    submitter_hash
  )
  returning public.songs.id,
    public.songs.title,
    public.songs.artist,
    public.songs.playlist_date,
    public.songs.likes_count,
    public.songs.created_at;
end;
$$;

revoke all on function public.is_current_user_admin() from public;
revoke all on function public.is_admin_email_allowed(text) from public;
revoke all on function public.request_client_ip() from public;
revoke all on function public.assert_valid_voter_cookie(text) from public;
revoke all on function public.record_rate_limited_attempt(text, text, text, text) from public;
revoke all on function public.get_my_likes(text, text) from public;
revoke all on function public.toggle_song_like(uuid, text, text, text) from public;
revoke all on function public.submit_song(text, text, text, text) from public;

grant execute on function public.is_current_user_admin() to anon, authenticated;
grant execute on function public.is_admin_email_allowed(text) to anon, authenticated;
grant execute on function public.get_my_likes(text, text) to anon, authenticated;
grant execute on function public.toggle_song_like(uuid, text, text, text) to anon, authenticated;
grant execute on function public.submit_song(text, text, text, text) to anon, authenticated;
grant usage on schema public to anon, authenticated;

commit;

notify pgrst, 'reload schema';

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_my_likes',
    'toggle_song_like',
    'submit_song',
    'is_current_user_admin',
    'is_admin_email_allowed'
  )
order by p.proname;
