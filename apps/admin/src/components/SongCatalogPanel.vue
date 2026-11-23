<script setup>
import { ElAlert, ElButton, ElCard, ElCheckbox, ElDialog, ElEmpty, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElSwitch, ElTable, ElTableColumn, ElTag } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/checkbox/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/form-item/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/input-number/style/css";
import "element-plus/es/components/switch/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/table-column/style/css";
import "element-plus/es/components/tag/style/css";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import { computed, ref, watch } from "vue";
import { useAdminStore } from "../stores/admin";
import * as api from "../services/api";

const store = useAdminStore();
const songs = ref([]), loading = ref(true), error = ref(""), saving = ref(false);
const keyword = ref(""), whitelistEnabled = ref(false), allowedIds = ref([]);
const editing = ref(null);
const startsAt = ref(""), endsAt = ref(""), version = ref(0), loadedPeriod = ref("");
const page = ref(1);
const paged = computed(() => filtered.value.slice((page.value - 1) * 30, page.value * 30));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 30)));
watch(keyword, () => { page.value = 1; });
function localDate(value) { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); }
function toggleAllowed(id, enabled) { allowedIds.value = enabled ? [...new Set([...allowedIds.value,id])] : allowedIds.value.filter(value => value !== id); }
let loadToken = 0;
const filtered = computed(() => {
  const key = keyword.value.trim().toLowerCase();
  return songs.value.filter(song => !key || `${song.title} ${song.artist}`.toLowerCase().includes(key));
});

async function load() {
  const token = ++loadToken, id = store.currentPeriod?.id;
  loading.value = true; error.value = ""; loadedPeriod.value = "";
  try {
    const rows = await api.fetchSongCatalog();
    const policy = id ? await api.fetchPeriodCatalogPolicy(id) : { whitelist_enabled:false, allowed_catalog_ids:[], version:0 };
    if (token !== loadToken) return;
    songs.value = rows;
    whitelistEnabled.value = policy.whitelist_enabled === true;
    allowedIds.value = policy.allowed_catalog_ids ?? [];
    startsAt.value = localDate(policy.starts_at); endsAt.value = localDate(policy.ends_at);
    version.value = Number(policy.version); loadedPeriod.value = id || "";
  } catch (e) { if (token === loadToken) error.value = e.message || "曲库读取失败"; }
  finally { if (token === loadToken) loading.value = false; }
}

function openCreate() { editing.value = { id: "", title: "", artist: "", sourceUrl: "", durationSeconds: null, isAvailable: false, isActive: true, notes: "" }; }
function openEdit(song) { editing.value = { id: song.id, title: song.title, artist: song.artist, sourceUrl: song.source_url || "", durationSeconds: song.duration_seconds, isAvailable: song.is_available, isActive: song.is_active, notes: song.notes || "" }; }
async function saveSong() {
  if (saving.value) return;
  if (!editing.value?.title.trim() || !editing.value?.artist.trim()) return ElMessage.warning("请填写歌曲名和歌手");
  saving.value = true;
  try { await api.upsertSongCatalog(editing.value); editing.value = null; songs.value = await api.fetchSongCatalog(); ElMessage.success("曲库已保存"); }
  catch (e) { ElMessage.error(e.message || "保存失败"); }
  finally { saving.value = false; }
}
async function savePolicy() {
  if (saving.value || loading.value || error.value) return;
  const id = loadedPeriod.value;
  if (!id || id !== store.currentPeriod?.id) return ElMessage.warning("请重新读取当前征集期");
  if ([startsAt.value, endsAt.value].some(value => value && !Number.isFinite(Date.parse(value)))) return ElMessage.warning("请填写有效的时间");
  const start = startsAt.value ? new Date(startsAt.value).toISOString() : null;
  const end = endsAt.value ? new Date(endsAt.value).toISOString() : null;
  if (start && end && start >= end) return ElMessage.warning("开始时间必须早于结束时间");
  if (whitelistEnabled.value && !allowedIds.value.length) {
    try { await ElMessageBox.confirm("当前白名单为空，开启后同学将无法选择任何歌曲。仍要开启吗？", "确认开启白名单", { type: "warning" }); } catch { return; }
  }
  saving.value = true;
  try { await api.savePeriodCatalogPolicy(id, whitelistEnabled.value, allowedIds.value, start, end, version.value); await load(); ElMessage.success("本期选曲规则已保存"); }
  catch (e) { ElMessage.error(e.message || "规则保存失败"); }
  finally { saving.value = false; }
}
watch(() => store.currentPeriod?.id, load, { immediate: true });
</script>

<template>
  <div>
    <el-card class="panel-card" shadow="never">
      <template #header><div class="panel-heading"><span>本期选曲范围</span><el-button :loading="saving" :disabled="loading || !!error || !loadedPeriod" @click="savePolicy">保存规则</el-button></div></template>
      <el-alert title="曲库只展示广播台确认有音源的歌曲。开启白名单后，用户端只能从勾选的歌曲中投稿。规则按当前征集期生效。" type="info" :closable="false" show-icon />
      <div class="policy-row"><el-switch v-model="whitelistEnabled" active-text="开启本期白名单" inactive-text="使用全部可播歌曲" :disabled="loading || saving" /><span class="muted">开启前请先勾选允许投稿的歌曲</span></div>
      <div class="policy-row"><label>开始时间（本地时区，留空立即生效）<input type="datetime-local" v-model="startsAt" :disabled="loading || saving" /></label><label>结束时间（留空持续生效）<input type="datetime-local" v-model="endsAt" :disabled="loading || saving" /></label></div>
      <p class="muted">已选 {{ allowedIds.length }} 首；保存后生效，时间结束后自动恢复全部可播歌曲。历史投稿保留。</p>
      <el-button :disabled="saving" @click="load">重新读取</el-button>
      <el-button type="primary" :disabled="loading || saving || !!error || !loadedPeriod" @click="savePolicy">保存当前征集期规则</el-button>
    </el-card>

    <el-card class="panel-card" shadow="never">
      <template #header><div class="panel-heading"><span>可播歌曲曲库（{{ filtered.length }} 首）</span><div><el-input v-model="keyword" placeholder="搜索歌曲或歌手" clearable style="width: 220px; margin-right: 10px" /><el-button type="primary" @click="openCreate">新增歌曲</el-button></div></div></template>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <el-table v-else-if="!loading" :data="paged" stripe row-key="id">
        <el-table-column label="本期白名单" width="110"><template #default="{ row }"><el-checkbox :model-value="allowedIds.includes(row.id)" :disabled="saving" :aria-label="'允许 ' + row.title" @change="checked => toggleAllowed(row.id, checked)" /></template></el-table-column>
        <el-table-column prop="title" label="歌曲" min-width="180" />
        <el-table-column prop="artist" label="歌手" min-width="140" />
        <el-table-column label="音源状态" width="120"><template #default="{ row }"><el-tag :type="row.is_available && row.is_active ? 'success' : 'info'">{{ row.is_available && row.is_active ? '可投稿' : row.is_active ? '待补音源' : '已停用' }}</el-tag></template></el-table-column>
        <el-table-column label="时长" width="100"><template #default="{ row }">{{ row.duration_seconds ? `${Math.floor(row.duration_seconds / 60)}:${String(row.duration_seconds % 60).padStart(2, '0')}` : '-' }}</template></el-table-column>
        <el-table-column label="操作" width="100"><template #default="{ row }"><el-button size="small" @click="openEdit(row)">编辑</el-button></template></el-table-column>
        <template #empty><el-empty description="曲库暂无歌曲" :image-size="60" /></template>
      </el-table>
      <p v-else class="muted" role="status">正在读取曲库…</p>
      <div v-if="pageCount > 1" class="policy-row"><el-button :disabled="page === 1" @click="page--">上一页</el-button><span>{{ page }} / {{ pageCount }}</span><el-button :disabled="page === pageCount" @click="page++">下一页</el-button></div>
    </el-card>

    <el-dialog :model-value="!!editing" :title="editing?.id ? '编辑曲库歌曲' : '新增曲库歌曲'" width="min(520px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" @close="editing = null">
      <el-form v-if="editing" label-position="top" :disabled="saving">
        <el-form-item label="歌曲名" required><el-input v-model="editing.title" maxlength="80" /></el-form-item>
        <el-form-item label="歌手" required><el-input v-model="editing.artist" maxlength="80" /></el-form-item>
        <el-form-item label="音源地址或内部编号"><el-input v-model="editing.sourceUrl" maxlength="500" placeholder="用于工作人员核对，不直接暴露给用户" /></el-form-item>
        <el-form-item label="时长（秒）"><el-input-number v-model="editing.durationSeconds" :min="1" :max="3600" :controls="false" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="editing.isAvailable" active-text="确认有音源" /><el-switch v-model="editing.isActive" active-text="允许出现在曲库" style="margin-left: 20px" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="editing.notes" type="textarea" maxlength="500" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="editing = null">取消</el-button><el-button type="primary" :loading="saving" @click="saveSong">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.policy-row { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin: 18px 0; }
.policy-row label { display: flex; flex-direction: column; gap: 8px; }
.policy-row input { padding: 10px; border: 1px solid #ccd3df; border-radius: 4px; }
.muted { color: var(--el-text-color-secondary); }
</style>
