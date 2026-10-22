<script setup>
import { ElAlert, ElButton, ElCard, ElCheckbox, ElEmpty, ElInputNumber, ElOption, ElSelect, ElTable, ElTableColumn, ElTag, ElMessage, ElMessageBox } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/checkbox/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/input-number/style/css";
import "element-plus/es/components/option/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/table-column/style/css";
import "element-plus/es/components/tag/style/css";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { useAdminStore } from "../stores/admin";
import { useAuthStore } from "../stores/auth";
import * as api from "../services/api";
import { sanitizeFilename, formatDateForFilename, formatDateTime } from "../utils/format";
const store = useAdminStore(), auth = useAuthStore();
const periodId = ref(""), songs = ref([]), loading = ref(false), loadError = ref("");
const items = ref([]), version = ref(0), remoteVersion = ref(0), baseline = ref("[]");
const boardError = ref(""), boardReady = ref(false), updated = ref(null), saving = ref(false), exporting = ref(false);
const storageAvailable = ref(true), candidateId = ref(""), order = ref("likes-desc"), count = ref(10), includeLocked = ref(false);
const autoCount = ref(8), generating = ref(false);
const options = computed(() => [...store.periods].sort((a,b) => Number(b.id === store.currentPeriod?.id) - Number(a.id === store.currentPeriod?.id)));
const period = computed(() => options.value.find(p => p.id === periodId.value));
const dirty = computed(() => JSON.stringify(items.value) !== baseline.value);
const conflict = computed(() => remoteVersion.value !== version.value);
const busy = computed(() => loading.value || saving.value || exporting.value || generating.value);
const songMap = computed(() => new Map(songs.value.map(s => [s.id,s])));
const boardRows = computed(() => items.value.map((item,index) => {
  const live = songMap.value.get(item.song_id);
  return { ...item, index, song: live && item.status === "confirmed" && item.snapshot ? { ...live, ...item.snapshot, likesCount: item.snapshot.likes_count } : live,
    live, renamed: live && item.snapshot && (item.snapshot.title !== live.title || item.snapshot.artist !== live.artist) };
}));
const confirmed = computed(() => boardRows.value.filter(i => i.status === "confirmed"));
const available = computed(() => songs.value.filter(s => !s.isLocked && !items.value.some(i => i.song_id === s.id)).sort((a,b) => b.likesCount - a.likesCount));
const ranking = computed(() => songs.value.filter(s => includeLocked.value || !s.isLocked).sort((a,b) => (a.likesCount - b.likesCount) * (order.value === "likes-asc" ? 1 : -1)).slice(0, Math.max(1, Math.min(Number(count.value) || 10, 500))));
const draftKey = id => "chu:broadcast-draft:" + auth.adminUser.id + ":" + id;
function persistDraft() {
  if (loading.value || !boardReady.value || !periodId.value) return;
  try {
    if (dirty.value) localStorage.setItem(draftKey(periodId.value), JSON.stringify({ items: items.value, version: version.value }));
    else localStorage.removeItem(draftKey(periodId.value));
    storageAvailable.value = true;
  } catch { storageAvailable.value = false; }
}
watch(items, persistDraft, { deep: true, flush: "sync" });
let request = 0;
async function load(id, discard = false) {
  const token = ++request;
  loading.value = true; loadError.value = ""; boardError.value = ""; boardReady.value = false; candidateId.value = "";
  songs.value = []; items.value = []; version.value = 0; remoteVersion.value = 0; baseline.value = "[]"; updated.value = null;
  try {
    const fetched = await api.fetchSongs(id);
    if (token !== request) return;
    songs.value = fetched;
    try {
      const board = await api.fetchBroadcastPlaylist(id);
      if (token !== request) return;
      items.value = board.items; version.value = board.version; remoteVersion.value = board.version;
      baseline.value = JSON.stringify(board.items); updated.value = board.updated_at ? board : null;
      try {
        if (discard) localStorage.removeItem(draftKey(id));
        const draft = JSON.parse(localStorage.getItem(draftKey(id)) || "null");
        if (draft && Number.isInteger(draft.version) && draft.version >= 0 && Array.isArray(draft.items) && draft.items.length <= 500
          && draft.items.every(i => i && typeof i.song_id === "string" && ["candidate","confirmed"].includes(i.status))) {
          items.value = draft.items; version.value = draft.version;
        }
        storageAvailable.value = true;
      } catch { storageAvailable.value = false; }
      boardReady.value = true;
    } catch(e) { boardError.value = e.message || "播出歌单读取失败"; }
  } catch(e) { if (token === request) loadError.value = e.message || "歌曲读取失败"; }
  finally { if (token === request) loading.value = false; }
}
async function switchPeriod(id) {
  if (busy.value || id === periodId.value) return;
  if (!await allowLeave()) return;
  persistDraft(); periodId.value = id; await load(id);
}
async function reload() {
  if (dirty.value) {
    try { await ElMessageBox.confirm("重新读取会丢弃本地未保存的歌单修改，以数据库记录为准。", "重新读取播出歌单", { type: "warning", confirmButtonText: "丢弃并读取", cancelButtonText: "保留草稿" }); }
    catch { return; }
  }
  await load(periodId.value, true);
}
function addCandidate() {
  if (!candidateId.value) return ElMessage.warning("请先选择歌曲");
  if (items.value.length >= 500) return ElMessage.warning("一份播出歌单最多保存 500 首歌曲");
  items.value.push({ song_id: candidateId.value, status: "candidate" }); candidateId.value = "";
}
async function generateBroadcastList() {
  if (busy.value || !boardReady.value || conflict.value) return;
  const id = periodId.value, token = request;
  generating.value = true;
  try {
    if (dirty.value) {
      try {
        await ElMessageBox.confirm("一键生成会清空当前未保存的歌单修改，确定继续？", "覆盖当前歌单", { type: "warning", confirmButtonText: "覆盖并生成", cancelButtonText: "取消" });
      } catch { return; }
    }
    const fresh = await api.fetchSongs(id);
    // Ignore responses after this panel has been unloaded or its period changed.
    if (token !== request || id !== periodId.value) return;
    songs.value = fresh;
    const ranked = [...fresh].sort((a, b) => b.likesCount - a.likesCount);
    const picked = ranked.filter(s => !s.isLocked);
    if (!picked.length) throw new Error("没有未锁定的歌曲可生成，当前歌单已保留");
    const n = Math.min(Math.max(1, Math.floor(Number(autoCount.value) || 8)), picked.length);
    const skipped = ranked.filter(s => s.isLocked);
    items.value = picked.slice(0, n).map(s => ({ song_id: s.id, status: "confirmed" }));
    ElMessage.success(`已自动生成 ${n} 首播出单${skipped.length ? `，已跳过 ${skipped.length} 首被锁定的歌曲` : ""}`);
  } catch (e) {
    ElMessage.error(e.message || "生成失败");
  } finally { generating.value = false; }
}
function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= items.value.length) return;
  const next = [...items.value]; [next[index], next[target]] = [next[target], next[index]]; items.value = next;
}
async function save() {
  if (saving.value) return false;
  if (!boardReady.value || conflict.value) return false;
  saving.value = true;
  try {
    const fresh = await api.fetchSongs(periodId.value);
    songs.value = fresh;
    const freshMap = new Map(fresh.map(s => [s.id,s]));
    if (items.value.some(i => !freshMap.has(i.song_id) || (i.status === "confirmed" && freshMap.get(i.song_id).isLocked))) throw new Error("歌单中有不存在或已锁定的确认歌曲，请移除或退回候选后保存。");
    const saved = await api.saveBroadcastPlaylist(periodId.value, items.value, version.value);
    version.value = saved.version; remoteVersion.value = saved.version; baseline.value = JSON.stringify(saved.items);
    items.value = saved.items;
    updated.value = saved;
    persistDraft(); ElMessage.success("播出歌单已保存，可供其他值班同学读取"); return true;
  } catch(e) {
    if (e.message?.includes("其他管理员更新") || e.message?.includes("歌单已保存，但")) remoteVersion.value = -1;
    ElMessage.error(e.message || "保存失败，本地草稿已保留"); return false;
  }
  finally { saving.value = false; }
}
function download(content, suffix, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = sanitizeFilename(period.value?.title) + "_" + suffix + "_" + formatDateForFilename(new Date()) + (suffix === "data" ? ".json" : ".txt");
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
async function exportList(kind, copy) {
  exporting.value = true;
  try {
    if (kind === "broadcast") {
      if (!boardReady.value || conflict.value) throw new Error("请先成功读取最新播出歌单");
      if (dirty.value && !await save()) return;
    }
    songs.value = await api.fetchSongs(periodId.value);
    const rows = kind === "broadcast" ? confirmed.value.map(i => i.song) : ranking.value;
    if (kind === "broadcast" && rows.some(s => !s || s.isLocked)) throw new Error("确认歌单有歌曲已被锁定或移除，请重新读取并退回候选后保存。");
    if (!rows.length) throw new Error(kind === "broadcast" ? "还没有确认播出的歌曲" : "没有符合条件的歌曲");
    const title = kind === "broadcast" ? "确认播出歌单" : "排名参考清单";
    const text = (period.value?.title || "") + " · " + title + "\n" + rows.map((s,i) => (i+1) + ". " + s.title + " - " + s.artist + " (" + s.likesCount + " 喜欢)" + (s.isLocked ? " [已锁定]" : "")).join("\n");
    if (copy) await navigator.clipboard.writeText(text); else download(text, kind);
    ElMessage.success((copy ? "已复制 " : "已下载 ") + rows.length + " 首" + title);
  } catch(e) { ElMessage.error(e.message || "导出失败"); } finally { exporting.value = false; }
}
async function exportData() {
  exporting.value = true;
  try {
    const [currentSongs, likes, dislikes, reports] = await Promise.all([api.fetchSongs(periodId.value), api.fetchVoteRows("song_likes", periodId.value), api.fetchVoteRows("song_dislikes", periodId.value), api.fetchAllReports(periodId.value)]);
    download(JSON.stringify(api.buildAntiCheatReport(period.value, currentSongs, likes, dislikes, reports), null, 2), "data", "application/json;charset=utf-8");
    ElMessage.success("所选征集期数据已导出");
  } catch(e) { ElMessage.error(e.message || "导出失败"); } finally { exporting.value = false; }
}
async function allowLeave() {
  if (saving.value || exporting.value || generating.value) { ElMessage.warning("正在生成、保存或导出歌单，请稍候"); return false; }
  if (!dirty.value || storageAvailable.value) return true;
  try { await ElMessageBox.confirm("浏览器无法保存草稿，离开后未保存的歌单修改将丢失。", "离开歌单编辑", { type: "warning", confirmButtonText: "放弃修改并离开", cancelButtonText: "继续编辑" }); return true; } catch { return false; }
}
onBeforeRouteLeave(allowLeave); onBeforeRouteUpdate(allowLeave);
function beforeUnload(event) { if ((dirty.value && !storageAvailable.value) || saving.value) { event.preventDefault(); event.returnValue = ""; } }
onMounted(() => { window.addEventListener("beforeunload", beforeUnload); periodId.value = options.value[0]?.id || ""; if (periodId.value) load(periodId.value); });
onBeforeUnmount(() => { request++; window.removeEventListener("beforeunload", beforeUnload); });
</script>
<template>
  <el-card class="panel-card" shadow="never">
    <template #header>选择征集期</template>
    <div class="toolbar"><el-select :model-value="periodId" :disabled="busy" placeholder="选择征集期" aria-label="导出征集期" @update:model-value="switchPeriod"><el-option v-for="p in options" :key="p.id" :label="p.title" :value="p.id" /></el-select><el-button :disabled="!periodId || busy" @click="reload">重新读取歌单</el-button></div>
    <p class="muted">下方播出歌单、排名参考和数据归档均对应：{{ period?.title || '未选择征集期' }}。</p>
  </el-card>
  <el-empty v-if="!periodId" description="暂无征集期，请先新建一期" />
  <p v-else-if="loading" role="status">正在读取歌曲与播出歌单…</p>
  <div v-else-if="loadError"><el-alert :title="loadError" type="error" :closable="false" /><el-button @click="load(periodId)">重新读取</el-button></div>
  <template v-else>
    <el-card class="panel-card" shadow="never">
      <template #header><div class="panel-heading"><span>播出歌单 · {{ confirmed.length }} 首已确认</span><el-tag :type="dirty ? 'warning' : 'info'">{{ dirty ? '有未保存修改' : '已同步' }}</el-tag></div></template>
      <template v-if="boardError"><el-alert :title="boardError" type="error" :closable="false" /><el-button @click="load(periodId)">重试播出歌单读取</el-button></template>
      <template v-else-if="boardReady">
        <el-alert v-if="conflict" title="数据库歌单已更新，本地草稿来自旧版本。请重新读取，确认丢弃草稿后再编辑。" type="warning" :closable="false" />
        <el-alert v-if="!storageAvailable" title="浏览器存储不可用，未保存修改仅保留在当前页面，请及时保存。" type="warning" :closable="false" />
        <p class="muted">{{ updated ? '上次保存：' + updated.updated_by_name + ' · ' + formatDateTime(Date.parse(updated.updated_at)) : '尚未保存播出歌单' }}。{{ storageAvailable ? '未保存草稿在本机保留，交接前请保存到数据库。' : '' }}</p>
        <fieldset class="workflow-fieldset" :disabled="busy || conflict">
          <div class="toolbar"><el-select v-model="candidateId" filterable placeholder="搜索并选择歌曲" aria-label="添加候选歌曲" :disabled="busy || conflict"><el-option v-for="s in available" :key="s.id" :label="s.title + ' - ' + s.artist + ' · ' + s.likesCount + ' 喜欢'" :value="s.id" /></el-select><el-button :disabled="busy || conflict || !candidateId" @click="addCandidate">加入候选</el-button></div>
          <el-table :data="boardRows" stripe>
            <el-table-column type="index" label="顺序" width="65" />
            <el-table-column label="歌曲" min-width="210"><template #default="{ row }"><strong>{{ row.song?.title || row.snapshot?.title || '歌曲已不存在' }}</strong><p class="muted">{{ row.song?.artist || row.snapshot?.artist }}</p><p v-if="row.renamed" class="muted">保留确认快照；当前名称：{{ row.live.title }} · {{ row.live.artist }}</p><p v-if="row.snapshot?.source === 'migration'" class="muted">旧歌单快照采集于数据库升级时</p><el-tag v-if="row.song?.isLocked" type="danger">已锁定，请退回候选或移除</el-tag></template></el-table-column>
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="row.status === 'confirmed' ? 'primary' : 'warning'">{{ row.status === 'confirmed' ? '确认播出' : '候选' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" min-width="330"><template #default="{ row }"><div class="row-actions"><el-button size="small" :disabled="busy || conflict || (row.status !== 'confirmed' && (!row.song || row.song.isLocked))" @click="items[row.index].status = row.status === 'confirmed' ? 'candidate' : 'confirmed'">{{ row.status === 'confirmed' ? '退回候选' : '确认播出' }}</el-button><el-button size="small" :disabled="busy || conflict || row.index === 0" @click="move(row.index,-1)">上移</el-button><el-button size="small" :disabled="busy || conflict || row.index === items.length - 1" @click="move(row.index,1)">下移</el-button><el-button size="small" type="danger" plain :disabled="busy || conflict" @click="items.splice(row.index,1)">移除</el-button></div></template></el-table-column>
            <template #empty><el-empty description="从本期歌曲中加入候选，再确认播出与调整顺序" :image-size="60" /></template>
          </el-table>
        </fieldset>
        <div class="toolbar">
          <el-input-number v-model="autoCount" :min="1" :max="50" size="small" style="width:110px" :disabled="busy || conflict" />
          <el-button type="success" :loading="generating" :disabled="busy || conflict" @click="generateBroadcastList">一键生成播出单（自动跳过锁定）</el-button>
        </div>
        <div class="toolbar export-actions"><el-button type="primary" :disabled="busy || !dirty || conflict" @click="save">保存播出歌单</el-button><el-button :disabled="busy || !confirmed.length || conflict" @click="exportList('broadcast', true)">复制播出歌单</el-button><el-button :disabled="busy || !confirmed.length || conflict" @click="exportList('broadcast', false)">下载播出 TXT</el-button></div>
        <p class="muted">只导出确认播出的歌曲，按表格顺序排列，保留确认时的歌名、歌手和票数；导出前自动保存修改并核对锁定状态。需要更新快照时，请先退回候选并保存，再重新确认。</p>
      </template>
    </el-card>
    <el-card class="panel-card" shadow="never">
      <template #header>排名参考与预览</template>
      <div class="toolbar"><el-select v-model="order" aria-label="排名排序" :disabled="busy"><el-option label="喜欢数从高到低" value="likes-desc" /><el-option label="喜欢数从低到高" value="likes-asc" /></el-select><el-input-number v-model="count" :min="1" :max="500" aria-label="排名数量" :disabled="busy" /><el-checkbox v-model="includeLocked" :disabled="busy">包含锁定歌曲（仅排名参考）</el-checkbox></div>
      <p class="muted">默认排除锁定歌曲。当前预览 {{ ranking.length }} 首，排名清单供选曲参考，播出安排以确认歌单为准。</p>
      <el-table :data="ranking" max-height="430" stripe><el-table-column type="index" label="#" width="55" /><el-table-column prop="title" label="歌曲" min-width="180" /><el-table-column prop="artist" label="歌手" min-width="150" /><el-table-column prop="likesCount" label="喜欢" width="80" /><el-table-column label="状态" width="90"><template #default="{ row }">{{ row.isLocked ? '已锁定' : '正常' }}</template></el-table-column></el-table>
      <div class="toolbar export-actions"><el-button :disabled="busy || !ranking.length" @click="exportList('ranking', true)">复制排名清单</el-button><el-button :disabled="busy || !ranking.length" @click="exportList('ranking', false)">下载排名 TXT</el-button></div>
    </el-card>
    <el-card class="panel-card" shadow="never"><template #header>所选征集期数据归档</template><p class="muted">JSON 包含此期全部歌曲、投票明细、举报与反作弊聚合；其中包括锁定歌曲，便于复核记录。</p><el-button :disabled="busy || !period" @click="exportData">导出「{{ period?.title }}」数据 JSON</el-button></el-card>
  </template>
</template>
