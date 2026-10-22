const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ref, computed, watch, effectScope } = require("vue");
const { parse } = require("@vue/compiler-sfc");

function readComponent(relativePath) {
  return parse(fs.readFileSync(path.join(__dirname, "../src", relativePath), "utf8"));
}

// Run the component's actual setup with network, dialogs and lifecycle hooks controlled by each test.
function setupComponent(t, relativePath, exposed, overrides = {}) {
  const parsed = readComponent(relativePath);
  assert.deepEqual(parsed.errors, []);
  const messages = [];
  const unmount = [];
  const store = { songs: [], periods: [{ id: "A" }, { id: "B" }], currentPeriod: { id: "A" } };
  const context = {
    ref, computed, watch,
    useAdminStore: () => store,
    useAuthStore: () => ({ adminUser: { id: "test-admin" } }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    onMounted() {},
    onBeforeUnmount: callback => unmount.push(callback),
    onBeforeRouteLeave() {}, onBeforeRouteUpdate() {},
    window: { removeEventListener() {} },
    ElMessage: Object.fromEntries(["success", "error", "warning"].map(kind => [kind, text => messages.push({ kind, text })])),
    ElMessageBox: { confirm: async () => true },
    ...overrides,
  };
  vm.createContext(context);
  const scope = effectScope();
  t.after(() => scope.stop());
  const script = parsed.descriptor.scriptSetup.content.replace(/^import .*;\r?$/gm, "");
  scope.run(() => vm.runInContext(script + `\nthis.exposed = { ${exposed.join(", ")} };`, context));
  return { ...context.exposed, messages, unmount };
}

function setupExport(t, api, overrides) {
  const panel = setupComponent(t, "components/ExportPanel.vue", [
    "generateBroadcastList", "switchPeriod", "allowLeave", "periodId", "songs", "items", "baseline",
    "autoCount", "busy", "generating", "boardReady", "remoteVersion",
  ], { api, ...overrides });
  panel.periodId.value = "A";
  panel.boardReady.value = true;
  panel.items.value = [{ song_id: "original", status: "confirmed" }];
  panel.baseline.value = JSON.stringify(panel.items.value);
  return panel;
}

const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("all changed Vue templates compile without syntax errors", () => {
  for (const file of ["components/AutoModerationPanel.vue", "components/ExportPanel.vue", "views/DashboardView.vue"]) {
    assert.deepEqual(readComponent(file).errors, [], file);
  }
});

test("ordinary Chinese and English songs remain unflagged", t => {
  const panel = setupComponent(t, "components/AutoModerationPanel.vue", ["evaluate"]);
  for (const song of [
    { title: "晴天", artist: "周杰伦" },
    { title: "稻香", artist: "周杰伦" },
    { title: "Hello", artist: "Adele" },
    { title: "Love Story", artist: "Taylor Swift" },
  ]) assert.equal(panel.evaluate(song), null, song.title);
});

test("annotation, year, symbol and high-risk rules still identify their intended input", t => {
  const panel = setupComponent(t, "components/AutoModerationPanel.vue", ["evaluate"]);
  for (const title of ["晴天 (Live)", "晴天（现场）", "晴天【现场】"]) {
    assert.match(panel.evaluate({ title, artist: "周杰伦" }).reason, /括号/);
  }
  assert.match(panel.evaluate({ title: "夏天2024", artist: "歌手" }).reason, /年份/);
  assert.match(panel.evaluate({ title: "晴天★", artist: "歌手" }).reason, /特殊符号/);
  assert.equal(panel.evaluate({ title: "晴天 DJ版", artist: "歌手" }).level, "high");
});

test("generation ranks by likes and fills the requested slots with unlocked songs", async t => {
  const panel = setupExport(t, { fetchSongs: async () => [
    { id: "low", likesCount: 3, isLocked: false },
    { id: "locked", likesCount: 100, isLocked: true },
    { id: "high", likesCount: 80, isLocked: false },
    { id: "middle", likesCount: 30, isLocked: false },
  ] });
  panel.autoCount.value = 2;
  await panel.generateBroadcastList();
  assert.deepEqual(plain(panel.items.value), [
    { song_id: "high", status: "confirmed" }, { song_id: "middle", status: "confirmed" },
  ]);
  assert.match(panel.messages.find(m => m.kind === "success").text, /2 首.*跳过 1 首/);
  assert.equal(panel.busy.value, false);
});

test("fewer available songs reports the actual generated count", async t => {
  const panel = setupExport(t, { fetchSongs: async () => [{ id: "only", likesCount: 1, isLocked: false }] });
  await panel.generateBroadcastList();
  assert.equal(panel.items.value.length, 1);
  assert.match(panel.messages[0].text, /生成 1 首/);
});

for (const [label, rows] of [["empty period", []], ["all songs locked", [{ id: "locked", likesCount: 10, isLocked: true }]]]) {
  test(`${label} preserves the current playlist and reports failure`, async t => {
    const panel = setupExport(t, { fetchSongs: async () => rows });
    const before = plain(panel.items.value);
    await panel.generateBroadcastList();
    assert.deepEqual(plain(panel.items.value), before);
    assert.equal(panel.messages.filter(m => m.kind === "success").length, 0);
    assert.match(panel.messages.find(m => m.kind === "error").text, /没有未锁定的歌曲/);
  });
}

test("generation prevents switching periods or navigating away while a request is pending", async t => {
  const response = deferred();
  const fetched = [];
  const panel = setupExport(t, { fetchSongs: id => { fetched.push(id); return response.promise; } });
  const generation = panel.generateBroadcastList();
  assert.equal(panel.busy.value, true);
  await panel.switchPeriod("B");
  assert.equal(await panel.allowLeave(), false);
  assert.equal(panel.periodId.value, "A");
  assert.deepEqual(fetched, ["A"]);
  response.resolve([{ id: "A-song", likesCount: 20, isLocked: false }]);
  await generation;
  assert.equal(panel.items.value[0].song_id, "A-song");
  assert.equal(panel.busy.value, false);
});

test("an obsolete response after unmount cannot replace the playlist", async t => {
  const response = deferred();
  const panel = setupExport(t, { fetchSongs: () => response.promise });
  const before = plain(panel.items.value);
  const generation = panel.generateBroadcastList();
  for (const callback of panel.unmount) callback();
  response.resolve([{ id: "obsolete", likesCount: 20, isLocked: false }]);
  await generation;
  assert.deepEqual(plain(panel.items.value), before);
  assert.equal(panel.messages.filter(m => m.kind === "success").length, 0);
});

test("cancelling replacement keeps the draft and blocks period switching during confirmation", async t => {
  const confirmation = deferred();
  let fetched = false;
  const panel = setupExport(t, { fetchSongs: async () => { fetched = true; return []; } }, {
    ElMessageBox: { confirm: () => confirmation.promise },
  });
  panel.items.value.push({ song_id: "unsaved", status: "candidate" });
  const before = plain(panel.items.value);
  const generation = panel.generateBroadcastList();
  await panel.switchPeriod("B");
  assert.equal(panel.periodId.value, "A");
  confirmation.reject(new Error("cancel"));
  await generation;
  assert.equal(fetched, false);
  assert.deepEqual(plain(panel.items.value), before);
  assert.equal(panel.busy.value, false);
});

test("fetch failure preserves the current draft and releases the busy state", async t => {
  const panel = setupExport(t, { fetchSongs: async () => { throw new Error("network unavailable"); } });
  const before = plain(panel.items.value);
  await panel.generateBroadcastList();
  assert.deepEqual(plain(panel.items.value), before);
  assert.equal(panel.busy.value, false);
  assert.match(panel.messages[0].text, /network unavailable/);
});
