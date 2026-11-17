import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ref, computed, reactive, watch, effectScope, nextTick } from 'vue';
import { parse } from '@vue/compiler-sfc';
import * as daily from '../src/utils/dailyPeriod.js';

const instant = value => Date.parse(value + '+08:00');
const evening = instant('2026-11-06T20:00:00');
const period = (date = '2026-11-07') => ({ id: 'period-1', title: '已设置的征集', status: 'active', isTest: false,
  startsAt: instant(`${date}T00:00:00`), endsAt: instant(`${date}T18:00:00`), updatedAt: '2026-11-06T10:00:00.123456Z' });

test('Beijing date boundaries, month/year rollover and valid 24-hour windows', () => {
  for (const [now, date, shouldPrompt] of [
    ['2026-11-06T17:59:59', '2026-11-06', false],
    ['2026-11-06T18:00:00', '2026-11-07', true],
    ['2026-11-07T00:00:00', '2026-11-07', false],
    ['2026-11-30T23:59:59', '2026-12-01', true],
    ['2026-12-31T18:00:00', '2027-01-01', true],
    ['2028-02-28T18:00:00', '2028-02-29', true],
  ]) {
    assert.equal(daily.dailyPeriodDraft(instant(now)).date, date);
    assert.equal(daily.isDailyReminderTime(instant(now)), shouldPrompt);
  }
  const draft = daily.dailyPeriodDraft(evening);
  assert.deepEqual(daily.dailyPeriodWindow(draft), { startsAt: instant('2026-11-07T00:00:00'), endsAt: instant('2026-11-07T18:00:00') });
  assert.equal(daily.dailyPeriodError(draft, evening), '');
  assert.match(daily.dailyPeriodError({ ...draft, date: '2026-11-06' }, evening), /已经过去/);
  assert.match(daily.dailyPeriodError(draft, instant('2026-11-08T00:00:00')), /日期已变化/);
  assert.equal(daily.dailyPeriodWindow({ ...draft, endTime: '00:00' }), null);
  assert.equal(daily.dailyPeriodWindow({ ...draft, endTime: '24:00' }), null);
  assert.equal(daily.dailyPeriodWindow({ ...draft, date: '2026-02-30' }), null);
  assert.match(daily.formatBeijingTime(instant('2026-11-07T00:00:00')), /00:00/);
});

test('existing, overlapping, expired, test and future periods are preserved', () => {
  const draft = daily.dailyPeriodDraft(evening);
  assert.equal(daily.dailyPeriodState([], draft, evening).kind, 'missing');
  assert.equal(daily.dailyPeriodState([period()], draft, evening).kind, 'exists');
  assert.equal(daily.dailyPeriodState([{ ...period(), startsAt: instant('2026-11-05T00:00:00') }], draft, evening).kind, 'exists');
  assert.equal(daily.dailyPeriodState([period('2026-11-06')], draft, evening).kind, 'missing');
  assert.equal(daily.dailyPeriodState([period('2026-11-06')], { ...draft, date: '2026-11-06' }, evening).kind, 'ended');
  assert.equal(daily.dailyPeriodState([{ ...period(), isTest: true }], draft, evening).kind, 'blocked');
  assert.equal(daily.dailyPeriodState([period('2026-11-08')], draft, evening).kind, 'blocked');
});

function mount(t, { now = evening, rows = [], loaded = true, storage = new Map(), storeOverrides = {} } = {}) {
  const parsed = parse(fs.readFileSync(new URL('../src/components/DailyPeriodDialog.vue', import.meta.url), 'utf8'));
  assert.deepEqual(parsed.errors, []);
  const store = reactive({ now, loaded, loading: false, errorMessage: '', periods: rows, currentPeriod: rows.find(row => row.status === 'active') ?? null, ...storeOverrides });
  const auth = reactive({ adminUser: { id: 'admin-1' } });
  const messages = [], writes = [], events = [], confirms = [];
  let readRows = rows, fail = false, failRefresh = false, clock = now;
  store.refreshAll = async () => { if (failRefresh) throw new Error('refresh failed'); };
  const api = {
    fetchAllPeriods: async () => { if (fail) throw new Error('读取失败'); return readRows; },
    prepareDailyPeriod: async (...args) => { writes.push(args); return { id: 'new-period', created: true }; },
  };
  const route = reactive({ query: {} });
  const context = { ...daily, ref, computed, watch, useRoute: () => route, useAdminStore: () => store, useAuthStore: () => auth, api,
    defineEmits: () => (...args) => events.push(args), defineExpose: () => {},
    Date: class extends Date { static now() { return clock; } },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    ElMessage: Object.fromEntries(['success', 'error', 'info'].map(level => [level, message => messages.push({ level, message })])),
    ElMessageBox: { confirm: async message => { confirms.push(message); } },
  };
  vm.createContext(context);
  const scope = effectScope(); t.after(() => scope.stop());
  scope.run(() => vm.runInContext(parsed.descriptor.scriptSetup.content.replace(/^import .*;\r?$/gm, '') +
    '\nthis.panel = { visible, saving, draft, error, state, open, chooseDay, save, manageExisting, maybePrompt };', context));
  return { p: context.panel, store, auth, writes, events, confirms, messages, api, storage,
    setRows: value => { readRows = value; }, setFailure: value => { fail = value; },
    setRefreshFailure: value => { failRefresh = value; }, setTime: value => { clock = value; store.now = value; },
  };
}

test('daytime never prompts; evening prompts after successful load once per account/date/session', async t => {
  const h = mount(t, { now: instant('2026-11-06T10:00:00') });
  assert.equal(h.p.visible.value, false);
  h.setTime(instant('2026-11-06T18:00:00')); await nextTick();
  assert.equal(h.p.visible.value, true); assert.equal(h.p.draft.value.date, '2026-11-07');
  h.p.visible.value = false;
  h.store.loading = true; await nextTick(); h.store.loading = false; await nextTick();
  assert.equal(h.p.visible.value, false);
  const reopened = mount(t, { storage: h.storage }); assert.equal(reopened.p.visible.value, false);
  h.auth.adminUser = { id: 'admin-2' }; await nextTick(); assert.equal(h.p.visible.value, true);
  h.p.visible.value = false; h.setTime(instant('2026-11-07T00:01:00')); await nextTick(); assert.equal(h.p.visible.value, false);
  h.setTime(instant('2026-11-07T18:00:00')); await nextTick(); assert.equal(h.p.visible.value, true);
  const delayed = mount(t, { loaded: false }); assert.equal(delayed.p.visible.value, false);
  delayed.store.loaded = true; await nextTick(); assert.equal(delayed.p.visible.value, true);
  for (const rows of [[period()], [{ ...period(), isTest: true }], [period('2026-11-08')]]) {
    const existing = mount(t, { rows }); assert.equal(existing.p.visible.value, false);
    existing.p.open(1); assert.equal(existing.p.visible.value, true);
    existing.p.manageExisting(); assert.deepEqual(existing.events[0], ['navigate', 'periods', 'edit']);
  }
});

test('save rechecks latest periods, prevents duplicate creation, and retains failed drafts', async t => {
  const h = mount(t);
  h.setRows([period()]); await h.p.save(); assert.equal(h.writes.length, 0); assert.match(h.p.error.value, /已有征集/);
  h.setRows([]); h.setFailure(true); await h.p.save(); assert.equal(h.writes.length, 0); assert.equal(h.p.visible.value, true);
  assert.match(h.p.error.value, /读取失败/); h.setFailure(false);
  h.setRows([{ ...period('2026-11-06'), endsAt: instant('2026-11-06T22:00:00') }]);
  await h.p.save(); assert.equal(h.writes.length, 1); assert.equal(h.confirms.length, 1);
  assert.equal(h.writes[0][0].date, '2026-11-07'); assert.equal(h.writes[0][1].updatedAt, '2026-11-06T10:00:00.123456Z');
  assert.equal(h.p.visible.value, false);
  const stale = mount(t); stale.setTime(instant('2026-11-08T10:00:00')); await stale.p.save();
  assert.equal(stale.writes.length, 0); assert.match(stale.p.error.value, /日期已变化/);
  const refresh = mount(t); refresh.setRefreshFailure(true); await refresh.p.save();
  assert.equal(refresh.writes.length, 1); assert.equal(refresh.p.visible.value, false);
  assert.match(refresh.messages.at(-1).message, /已保存.*刷新失败/);
});

test('rapid double clicks write once, and a suspicious 18-minute window needs confirmation', async t => {
  const h = mount(t);
  let resolve;
  h.api.fetchAllPeriods = () => new Promise(done => { resolve = done; });
  h.p.draft.value.endTime = '00:18';
  const first = h.p.save(); await h.p.save(); assert.equal(h.writes.length, 0);
  resolve([]); await first;
  assert.equal(h.writes.length, 1); assert.match(h.confirms[0], /00:18/);
});
