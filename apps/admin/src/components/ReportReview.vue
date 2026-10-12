<script setup>
import { ElAlert, ElButton, ElCard, ElDialog, ElEmpty, ElFormItem, ElInput, ElOption, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag, ElMessage, ElMessageBox } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/form-item/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/option/style/css";
import "element-plus/es/components/pagination/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/table-column/style/css";
import "element-plus/es/components/tag/style/css";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import { computed, onMounted, ref, watch } from "vue";
import { useAdminStore } from "../stores/admin";
import * as api from "../services/api";
import { formatDateTime } from "../utils/format";
const store = useAdminStore();
const history = ref([]), historyLoading = ref(false), historyError = ref("");
const mode = ref("pending"), periodId = ref(""), page = ref(1);
const reviewing = ref(null), approve = ref(false), reason = ref(""), saving = ref(false);
const rows = computed(() => (mode.value === "pending" ? store.pendingReports : history.value).filter(r => !periodId.value || r.playlist_date === periodId.value));
const paged = computed(() => rows.value.slice((page.value - 1) * 20, page.value * 20));
watch([mode, periodId], () => { page.value = 1; });
watch(() => rows.value.length, n => { page.value = Math.min(page.value, Math.max(1, Math.ceil(n / 20))); });
function periodName(id) { return store.periods.find(p => p.id === id)?.title || id; }
async function loadHistory() {
  historyLoading.value = true; historyError.value = "";
  try { history.value = await api.fetchReviewedReports(); } catch(e) { historyError.value = e.message || "审核记录读取失败"; }
  finally { historyLoading.value = false; }
}
onMounted(loadHistory);
async function refresh() {
  try { await store.refreshReports(); await loadHistory(); } catch(e) { ElMessage.error(e.message || "读取失败"); }
}
function openReview(row, decision) { reviewing.value = row; approve.value = decision; reason.value = ""; }
async function saveReview() {
  if (saving.value) return;
  if (!reason.value.trim()) return ElMessage.warning("请填写审核原因");
  saving.value = true; let written = false;
  try {
    await api.reviewReport(reviewing.value.id, approve.value, reason.value); written = true;
    reviewing.value = null; await Promise.all([store.refreshReports(), store.refreshSongs(), loadHistory()]);
    ElMessage.success("审核结果已保存");
  } catch(e) { ElMessage.error(written ? "审核已保存，数据刷新失败，请重新读取。" : e.message || "审核失败"); }
  finally { saving.value = false; }
}
const unlocking = ref("");
async function unlock(row) {
  let result;
  try { result = await ElMessageBox.prompt("解除锁定后，开放期内恢复投票，并允许确认播出。请填写恢复原因。", "解除锁定 · " + row.song.title, {
    inputType: "textarea", inputPattern: /\S/, inputErrorMessage: "请填写原因", confirmButtonText: "确认解除锁定", cancelButtonText: "取消",
    inputValidator: value => value?.trim() && value.trim().length <= 500 ? true : "请填写 1–500 字原因",
  }); } catch { return; }
  unlocking.value = row.song_id;
  try { await api.setSongLock(row.song_id, false, result.value); await Promise.all([store.refreshSongs(), loadHistory()]); ElMessage.success("已解除锁定，原审核记录仍保留"); }
  catch(e) { ElMessage.error(e.message || "解除锁定失败"); } finally { unlocking.value = ""; }
}
</script>
<template>
  <el-card class="panel-card" shadow="never">
    <template #header><div class="panel-heading"><span>举报审核</span><el-button size="small" @click="refresh">刷新</el-button></div></template>
    <div class="toolbar"><el-button :type="mode === 'pending' ? 'primary' : 'default'" @click="mode = 'pending'">待审核（{{ store.pendingReports.length }}）</el-button><el-button :type="mode === 'history' ? 'primary' : 'default'" @click="mode = 'history'">审核记录</el-button><el-select v-model="periodId" placeholder="全部征集期" clearable aria-label="筛选征集期"><el-option v-for="p in store.periods" :key="p.id" :label="p.title" :value="p.id" /></el-select></div>
    <el-alert title="举报成立将锁定歌曲：停止投票，默认排除于排名导出，不能确认播出；前台仍展示锁定状态。" type="info" :closable="false" style="margin-bottom:16px" />
    <template v-if="mode === 'history' && historyError"><el-alert :title="historyError" type="error" :closable="false" /><el-button @click="loadHistory">重试记录读取</el-button></template>
    <p v-else-if="mode === 'history' && historyLoading" role="status">正在读取审核记录…</p>
    <template v-else>
      <el-table :data="paged" stripe>
        <el-table-column label="歌曲 / 征集期" min-width="210"><template #default="{ row }"><strong>{{ row.song?.title || '歌曲已不存在' }}</strong><p class="muted">{{ row.song?.artist }} · {{ periodName(row.playlist_date) }}</p></template></el-table-column>
        <el-table-column prop="reason" label="举报理由" min-width="190" />
        <el-table-column v-if="mode === 'pending'" label="举报时间" width="180"><template #default="{ row }">{{ formatDateTime(Date.parse(row.created_at)) }}</template></el-table-column>
        <template v-else>
          <el-table-column label="审核结果" width="110"><template #default="{ row }"><el-tag :type="row.status === 'approved' ? 'danger' : 'info'">{{ row.status === 'approved' ? '举报成立' : '已驳回' }}</el-tag></template></el-table-column>
          <el-table-column prop="review_reason" label="审核原因" min-width="180"><template #default="{ row }">{{ row.review_reason || '旧记录未填写原因' }}</template></el-table-column>
          <el-table-column label="处理人 / 时间" min-width="230"><template #default="{ row }">{{ row.reviewed_by_name || row.reviewed_by || '未记录' }}<p class="muted">{{ formatDateTime(Date.parse(row.reviewed_at)) }}</p></template></el-table-column>
        </template>
        <el-table-column label="操作" width="240"><template #default="{ row }"><div v-if="mode === 'pending'" class="row-actions"><el-button size="small" type="danger" plain @click="openReview(row, true)">举报成立，锁定</el-button><el-button size="small" @click="openReview(row, false)">驳回</el-button></div><el-button v-else-if="row.song?.is_locked" size="small" :loading="unlocking === row.song_id" @click="unlock(row)">解除锁定</el-button><span v-else class="muted">歌曲当前未锁定</span></template></el-table-column>
        <template #empty><el-empty :description="mode === 'pending' ? '暂无待审核举报' : '暂无审核记录'" :image-size="60" /></template>
      </el-table>
      <el-pagination v-if="rows.length > 20" v-model:current-page="page" :page-size="20" :total="rows.length" layout="prev, pager, next" :pager-count="5" class="table-pagination" />
      <p v-if="mode === 'history'" class="muted">显示最近 500 条审核记录；解除锁定不会抹去此前审核结果。</p>
    </template>
  </el-card>
  <el-dialog :model-value="!!reviewing" :title="approve ? '举报成立，锁定歌曲' : '驳回举报'" width="min(520px, 94vw)" :close-on-click-modal="false" :show-close="!saving" :close-on-press-escape="!saving" @close="reviewing = null">
    <p>{{ reviewing?.song?.title }} · {{ reviewing?.song?.artist }}</p><p>举报理由：{{ reviewing?.reason }}</p>
    <el-form-item label="审核原因" required><el-input v-model="reason" :disabled="saving" type="textarea" maxlength="500" show-word-limit :rows="4" placeholder="填写判断依据，方便其他值班同学了解处理过程" /></el-form-item>
    <p class="muted">{{ approve ? '确认后歌曲锁定，停止投票并排除于默认排名导出。可在歌曲管理或审核记录解除锁定。' : '驳回仅处理此条举报，不改变歌曲锁定状态。' }}</p>
    <template #footer><el-button :disabled="saving" @click="reviewing = null">取消</el-button><el-button type="primary" :loading="saving" @click="saveReview">确认审核</el-button></template>
  </el-dialog>
</template>
