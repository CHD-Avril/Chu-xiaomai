const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ref, reactive, computed, watch, effectScope, nextTick } = require('vue');
const { parse } = require('@vue/compiler-sfc');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

test('catalog panel restores selections across searches/pages, retains drafts after adding songs, saves dates/version, and rejects stale period writes', async t => {
  const parsed = parse(fs.readFileSync(path.join(__dirname,'../src/components/SongCatalogPanel.vue'),'utf8'));
  assert.deepEqual(parsed.errors,[]);
  const store=reactive({currentPeriod:{id:'A'}}), writes=[], messages=[];
  let fail=false;
  const rows=Array.from({length:35},(_,i)=>({id:`song-${i}`,title:`歌曲${i}`,artist:'歌手',is_active:true,is_available:true}));
  const api={
    fetchSongCatalog:async()=>rows,
    fetchPeriodCatalogPolicy:async()=>{if(fail)throw new Error('network');return {whitelist_enabled:true,allowed_catalog_ids:['song-1','song-32'],version:4,starts_at:'2026-11-03T00:00:00Z',ends_at:'2026-11-04T00:00:00Z'};},
    savePeriodCatalogPolicy:async(...args)=>writes.push(plain(args)),
    upsertSongCatalog:async()=>{},
  };
  const context={ref,reactive,computed,watch,api,useAdminStore:()=>store,
    ElMessage:{success:m=>messages.push(m),warning:m=>messages.push(m),error:m=>messages.push(m)},ElMessageBox:{confirm:async()=>true}};
  vm.createContext(context);
  const scope=effectScope();t.after(()=>scope.stop());
  scope.run(()=>vm.runInContext(parsed.descriptor.scriptSetup.content.replace(/^import .*;\r?$/gm,'')+
    '\nthis.panel={load,savePolicy,saveSong,openCreate,editing,keyword,allowedIds,whitelistEnabled,startsAt,endsAt,version,loadedPeriod,loading,error,page,paged,toggleAllowed};',context));
  const p=context.panel;
  await flush();assert.equal(p.loadedPeriod.value,'A');
  assert.deepEqual(plain(p.allowedIds.value),['song-1','song-32']);
  p.keyword.value='歌曲1';await nextTick();p.toggleAllowed('song-12',true);
  p.keyword.value='';p.page.value=2;await nextTick();
  assert.deepEqual(plain(p.allowedIds.value),['song-1','song-32','song-12']);
  p.openCreate();p.editing.value.title='新增';p.editing.value.artist='歌手';await p.saveSong();
  assert(p.allowedIds.value.includes('song-12'),'Adding catalog songs must not discard an unsaved whitelist');
  p.whitelistEnabled.value=false;await p.savePolicy();
  assert.equal(writes.length,1);assert.equal(writes[0][0],'A');assert.equal(writes[0][1],false);
  assert.deepEqual(writes[0][2],['song-1','song-32','song-12']);
  assert.equal(writes[0][3],'2026-11-03T00:00:00.000Z');assert.equal(writes[0][5],4);
  p.startsAt.value='bad-date';await p.savePolicy();assert.equal(writes.length,1);
  fail=true;store.currentPeriod={id:'B'};await nextTick();await flush();
  assert.equal(p.loadedPeriod.value,'');assert(p.error.value);await p.savePolicy();assert.equal(writes.length,1);
  fail=false;await p.load();assert.equal(p.loadedPeriod.value,'B');
  await p.savePolicy();assert.equal(writes.at(-1)[0],'B');
});
