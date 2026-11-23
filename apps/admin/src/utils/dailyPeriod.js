const DAY = 86400000;
const OFFSET = 8 * 3600000;
export const EVENING_HOUR = 18;

export function isDailyReminderTime(now = Date.now()) {
  return new Date(now + OFFSET).getUTCHours() >= EVENING_HOUR;
}

// Daily collection dates always follow Beijing time, including on overseas devices.
export function beijingDate(now = Date.now(), offsetDays = 0) {
  return new Date(now + OFFSET + offsetDays * DAY).toISOString().slice(0, 10);
}

export function dailyPeriodDraft(now = Date.now(), offsetDays) {
  const tomorrow = isDailyReminderTime(now);
  const date = beijingDate(now, offsetDays ?? (tomorrow ? 1 : 0));
  const [, month, day] = date.split('-').map(Number);
  return { date, title: `${month}月${day}日歌单征集`, startTime: '00:00', endTime: '18:00' };
}

export function dailyPeriodWindow(draft) {
  const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date ?? '') || !validTime(draft.startTime) || !validTime(draft.endTime)) return null;
  const startsAt = Date.parse(`${draft.date}T${draft.startTime}:00+08:00`);
  const endsAt = Date.parse(`${draft.date}T${draft.endTime}:00+08:00`);
  if (!Number.isFinite(startsAt) || beijingDate(startsAt) !== draft.date || startsAt >= endsAt) return null;
  return { startsAt, endsAt };
}

export function dailyPeriodError(draft, now = Date.now()) {
  if (!draft.title?.trim() || draft.title.trim().length > 80) return '请填写 1–80 字的征集标题。';
  if (![beijingDate(now), beijingDate(now, 1)].includes(draft.date)) return '日期已变化，请重新选择今天或明天。';
  const range = dailyPeriodWindow(draft);
  if (!range) return '请填写当天有效的时间，结束时间须晚于开始时间。';
  if (range.endsAt <= now) return '结束时间已经过去，请调整时间或选择明天。';
  return '';
}

export function dailyPeriodState(periods, draft, now = Date.now()) {
  const current = periods.find(period => period.status === 'active');
  if (!current) return { kind: 'missing', current: null };
  if (current.isTest) return { kind: 'blocked', current, message: '当前为测试期，请到征集期管理确认正式开放安排。' };
  const dayStart = Date.parse(`${draft.date}T00:00:00+08:00`);
  if (current.startsAt < dayStart + DAY && current.endsAt > dayStart) {
    return { kind: current.endsAt <= now ? 'ended' : 'exists', current };
  }
  if (current.startsAt >= dayStart + DAY) {
    return { kind: 'blocked', current, message: '已有更晚日期的征集安排，请到征集期管理核对。' };
  }
  return { kind: 'missing', current };
}

export function formatBeijingTime(value) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
}

export function formatCollectionDate(date) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(Date.parse(`${date}T00:00:00+08:00`));
}
