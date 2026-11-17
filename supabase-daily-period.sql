-- Incremental migration: daily collection helper. Keeps all existing periods and songs.
-- Requires admin-workflow, database-integrity and test-mode migrations.
begin;

create or replace function public.admin_prepare_daily_period(
  p_target_date date, p_title text, p_start_time time, p_end_time time,
  p_expected_current_id uuid, p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  today date;
  day_start timestamptz;
  day_end timestamptz;
  start_at timestamptz;
  end_at timestamptz;
  previous public.playlist_periods%rowtype;
  new_id uuid;
begin
  if public.is_current_user_admin() is not true then raise exception 'Admin permission required.'; end if;
  -- Same lock as the existing creator, also excluding edits, archives and mode changes.
  lock table public.playlist_periods in share row exclusive mode;
  today = (clock_timestamp() at time zone 'Asia/Shanghai')::date;
  if p_target_date is null or p_target_date not in (today, today + 1) then
    raise exception '日期已变化，请重新选择今天或明天。';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 80
    or p_start_time is null or p_end_time is null or p_end_time <= p_start_time or p_end_time >= time '24:00' then
    raise exception '请填写标题和当天有效的征集时间，结束时间须晚于开始时间。';
  end if;
  day_start = p_target_date::timestamp at time zone 'Asia/Shanghai';
  day_end = (p_target_date + 1)::timestamp at time zone 'Asia/Shanghai';
  start_at = (p_target_date + p_start_time) at time zone 'Asia/Shanghai';
  end_at = (p_target_date + p_end_time) at time zone 'Asia/Shanghai';
  if end_at <= clock_timestamp() then raise exception '结束时间已经过去，请调整时间或选择明天。'; end if;
  select * into previous from public.playlist_periods where status='active';
  if coalesce(previous.is_test,false) then raise exception '当前为测试期，请到征集期管理确认正式开放安排。'; end if;
  -- Retried saves and a second operator reuse the existing day, preserving submissions.
  if previous.starts_at < day_end and previous.ends_at > day_start then
    return jsonb_build_object('id', previous.id, 'created', false);
  end if;
  if previous.starts_at >= day_end then raise exception '已有更晚日期的征集安排，请到征集期管理核对。'; end if;
  if previous.id is distinct from p_expected_current_id or previous.updated_at is distinct from p_expected_updated_at then
    raise exception '征集安排已被其他管理员修改，请重新读取后再确认。';
  end if;
  new_id = public.admin_create_playlist_period(p_title, start_at, end_at);
  return jsonb_build_object('id', new_id, 'created', true);
end;
$$;
revoke all on function public.admin_prepare_daily_period(date,text,time,time,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_prepare_daily_period(date,text,time,time,uuid,timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
