<script setup>
import { ElAlert, ElButton, ElCard, ElDialog, ElEmpty, ElForm, ElFormItem, ElInput, ElOption, ElPagination, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTag, ElMessage, ElMessageBox } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/form-item/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/option/style/css";
import "element-plus/es/components/pagination/style/css";
import "element-plus/es/components/switch/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/table-column/style/css";
import "element-plus/es/components/tag/style/css";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import { computed, ref, watch } from "vue";
import { useAdminStore } from "../stores/admin";
import * as api from "../services/api";
import { formatDateTime } from "../utils/format";

const store = useAdminStore();
const keyword = ref(""), status = ref("all"), page = ref(1);
const sort = ref({ prop: "likesCount", order: "descending" });
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const pending = new Set(store.pendingReports.map(r => r.song_id));
  const songs = store.songs.filter(s => (!kw || (s.title + " " + s.artist).toLowerCase().includes(kw))
    && (status.value === "all" || (status.value === "locked" ? s.isLocked : status.value === "pending" ? pending.has(s.id) : !s.isLocked)));
  if (sort.value.order) songs.sort((a,b) => (a[sort.value.prop] - b[sort.value.prop]) * (sort.value.order === "ascending" ? 1 : -1));
  return songs;
});
const paged = computed(() => filtered.value.slice((page.value - 1) * 20, page.value * 20));
watch([keyword, status], () => { page.value = 1; });
watch(() => filtered.value.length, n => { page.value = Math.min(page.value, Math.max(1, Math.ceil(n / 20))); });
const editing = ref(null), originalLocked = ref(false), reason = ref(""), saving = ref(false);
function openEdit(song, toggle = false) {
  editing.value = { ...song, isLocked: toggle ? !song.isLocked : song.isLocked };
  originalLocked.value = song.isLocked; reason.value = "";
}
async function save() {
  if (saving.value) return;
  if (!editing.value.title.trim() || !editing.value.artist.trim() || !reason.value.trim()) return ElMessage.warning("请填写歌名、歌手及操作原因");
  saving.value = true;
  if (editing.value.isLocked !== originalLocked.value) {
    try { await ElMessageBox.confirm(editing.value.isLocked ? "锁定后停止投票，默认排除于排名导出，不能确认播出。前台仍显示锁定状态。" : "解除锁定后，在开放的征集期内恢复投票，并允许加入播出歌单。", "确认变更歌曲状态", { type: "warning", confirmButtonText: "确认保存", cancelButtonText: "返回编辑" }); }
    catch { saving.value = false; return; }
  }
  let written = false;
  try { await api.updateSong(editing.value, reason.value); written = true; editing.value = null; await store.refreshSongs(); ElMessage.success("歌曲已保存，操作记录已保留"); }
  catch(e) { ElMessage.error(written ? "歌曲已保存，但列表刷新失败，请刷新数据。" : e.message || "保存失败"); } finally { saving.value = false; }
}
const logSong = ref(null), log = ref([]), logLoading = ref(false), logError = ref("");
async function showLog(song) {
  logSong.value = song; log.value = []; logError.value = ""; logLoading.value = true;
  try { log.value = await api.fetchSongLog(song.id); } catch(e) { logError.value = e.message || "读取失败"; } finally { logLoading.value = false; }
}
</script>
<template>
  <el-card class="panel-card" shadow="never">
    <template #header>本期歌曲（{{ store.songs.length }} 首）</template>
    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索歌曲或歌手" aria-label="搜索歌曲或歌手" clearable />
      <el-select v-model="status" aria-label="歌曲状态"><el-option label="全部状态" value="all" /><el-option label="正常" value="normal" /><el-option label="已锁定" value="locked" /><el-option label="有待审举报" value="pending" /></el-select>
      <span class="muted">找到 {{ filtered.length }} 首</span>
    </div>
    <el-alert v-if="!store.currentPeriod" title="当前没有征集期，请先新建一期。" type="info" :closable="false" />
    <el-table :data="paged" stripe :default-sort="{ prop: 'likesCount', order: 'descending' }" @sort-change="sort = $event; page = 1">
      <el-table-column type="index" label="#" width="55" :index="i => (page - 1) * 20 + i + 1" />
      <el-table-column prop="title" label="歌曲" min-width="180" />
      <el-table-column prop="artist" label="歌手" min-width="150" />
      <el-table-column prop="likesCount" label="喜欢" width="95" sortable="custom" />
      <el-table-column prop="dislikesCount" label="点踩" width="95" sortable="custom" />
      <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.isLocked ? 'danger' : 'success'">{{ row.isLocked ? '已锁定' : '正常' }}</el-tag></template></el-table-column>
      <el-table-column label="投稿时间" width="180"><template #default="{ row }">{{ formatDateTime(row.createdAtMs) }}</template></el-table-column>
      <el-table-column label="操作" width="245"><template #default="{ row }"><div class="row-actions"><el-button size="small" @click="openEdit(row)">编辑</el-button><el-button size="small" :type="row.isLocked ? 'primary' : 'danger'" plain @click="openEdit(row, true)">{{ row.isLocked ? '解除锁定' : '锁定' }}</el-button><el-button size="small" @click="showLog(row)">记录</el-button></div></template></el-table-column>
      <template #empty><el-empty :description="keyword || status !== 'all' ? '没有找到匹配歌曲，请调整筛选条件' : '还没有歌曲投稿'" :image-size="60" /></template>
    </el-table>
    <el-pagination v-if="filtered.length > 20" v-model:current-page="page" :page-size="20" :total="filtered.length" layout="prev, pager, next" :pager-count="5" class="table-pagination" />
  </el-card>
  <el-dialog :model-value="!!editing" title="维护歌曲" width="min(520px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" @close="editing = null">
    <el-form v-if="editing" label-position="top" :disabled="saving" @submit.prevent="save">
      <el-form-item label="歌名（最多 80 字）" required><el-input v-model="editing.title" maxlength="80" /></el-form-item>
      <el-form-item label="歌手（最多 80 字）" required><el-input v-model="editing.artist" maxlength="80" /></el-form-item>
      <el-form-item label="歌曲状态"><el-switch v-model="editing.isLocked" active-text="锁定" inactive-text="正常" aria-label="锁定歌曲" /></el-form-item>
      <el-form-item label="操作原因（写入记录）" required><el-input v-model="reason" type="textarea" maxlength="500" show-word-limit :rows="3" /></el-form-item>
    </el-form>
    <template #footer><el-button :disabled="saving" @click="editing = null">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存修改</el-button></template>
  </el-dialog>
  <el-dialog :model-value="!!logSong" :title="'操作记录 · ' + (logSong?.title || '')" width="min(650px, 94vw)" @close="logSong = null">
    <p v-if="logLoading" role="status">正在读取记录…</p>
    <el-alert v-else-if="logError" :title="logError" type="error" :closable="false" />
    <el-empty v-else-if="!log.length" description="暂无歌曲维护记录；举报处理记录请到举报审核查看" :image-size="60" />
    <ol v-else class="audit-list"><li v-for="entry in log" :key="entry.id"><strong>{{ entry.actor_name }}</strong> · {{ formatDateTime(Date.parse(entry.created_at)) }}<p>{{ entry.details.reason }}</p><p class="muted" v-if="entry.details.before">{{ entry.details.before.title }} / {{ entry.details.before.artist }} / {{ entry.details.before.locked ? '锁定' : '正常' }} → {{ entry.details.after.title }} / {{ entry.details.after.artist }} / {{ entry.details.after.locked ? '锁定' : '正常' }}</p></li></ol>
  </el-dialog>
</template>
