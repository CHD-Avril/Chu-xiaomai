<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElAlert, ElButton, ElCard, ElDialog, ElEmpty, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox, ElOption, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/form-item/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import "element-plus/es/components/option/style/css";
import "element-plus/es/components/pagination/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/table-column/style/css";
import "element-plus/es/components/tag/style/css";
import * as api from "../services/api";
import { formatDateTime } from "../utils/format";
import { ACCOUNT_ACTION_LABELS, TIMED_ACCOUNT_ACTIONS } from "../../../shared/accountModeration";

const accounts = ref([]), total = ref(0), page = ref(1), search = ref(""), keyword = ref("");
const loading = ref(false), error = ref(""), detail = ref(null), detailLoading = ref(false), detailError = ref("");
const dialog = ref(false), saving = ref(false), action = ref("warn"), reason = ref(""), duration = ref(168);
const timed = computed(() => TIMED_ACCOUNT_ACTIONS.includes(action.value));
let listRequest = 0, detailRequest = 0, disposed = false;
onBeforeUnmount(() => { disposed = true; ++listRequest; ++detailRequest; });
const expiry = value => value ? formatDateTime(new Date(value).getTime()) : "长期，直至管理员解除";
async function load() {
  const request = ++listRequest; loading.value = true; error.value = "";
  try {
    const result = await api.fetchQqAccounts(keyword.value, page.value);
    if (disposed || request !== listRequest) return;
    accounts.value = result.items; total.value = result.total;
  } catch (cause) { if (!disposed && request === listRequest) error.value = cause?.message || "账号读取失败。"; }
  finally { if (request === listRequest) loading.value = false; }
}
function searchAccounts() { if (saving.value || loading.value) return; keyword.value = search.value; page.value = 1; load(); }
function changePage(value) { page.value = value; load(); }
async function readDetail(id) {
  const request = ++detailRequest; detailLoading.value = true; detailError.value = ""; detail.value = null;
  try { const result = await api.fetchAccountModeration(id); if (!disposed && request === detailRequest) detail.value = result; }
  catch (cause) { if (!disposed && request === detailRequest) detailError.value = cause?.message || "账号详情读取失败。"; }
  finally { if (request === detailRequest) detailLoading.value = false; }
}
function open(account) { if (saving.value) return; dialog.value = true; action.value = "warn"; reason.value = ""; duration.value = 168; readDetail(account.id); }
async function submit() {
  if (saving.value || detailLoading.value || !detail.value || !reason.value.trim()) return;
  const payload = { accountId: detail.value.account.id, action: action.value, reason: reason.value.trim(), durationHours: timed.value ? duration.value || null : null, expectedVersion: detail.value.moderation.version };
  saving.value = true; detailError.value = "";
  let written = false;
  try {
    await ElMessageBox.confirm(`确认对「${detail.value.account.nickname}」发布${ACCOUNT_ACTION_LABELS[payload.action]}？处理原因将展示给该账号，并记录你的管理员身份。`, "发布账号处理", { confirmButtonText: "确认发布", cancelButtonText: "取消", type: "warning" });
    if (disposed) return;
    await api.moderateAccount(payload); written = true;
    if (disposed) return;
    reason.value = ""; await readDetail(payload.accountId); await load();
    ElMessage.success("账号处理已发布，相关限制由后端执行。");
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close" && !disposed) detailError.value = written ? "处理已发布，但详情刷新失败，请重新读取，避免重复发布。" : cause?.message || "发布失败，请重试。";
  } finally { if (!disposed) saving.value = false; }
}
onMounted(load);
</script>

<template>
  <el-card class="panel-card" shadow="never">
    <template #header><div class="panel-heading"><span>站内账号管理</span><el-button :disabled="loading || saving" @click="load">刷新账号</el-button></div></template>
    <p>仅管理员可向站内账号发布警告、限制投票或投稿、限时或长期封禁及解除限制。所有操作必须填写原因，并保留管理员和处理时间。</p>
    <el-form class="account-search" @submit.prevent="searchAccounts"><el-input v-model="search" maxlength="100" placeholder="搜索 QQ 昵称或完整站内账号 ID" aria-label="搜索站内账号" :disabled="loading || saving" clearable /><el-button type="primary" native-type="submit" :disabled="loading || saving">搜索</el-button></el-form>
    <el-alert v-if="error" :title="error" description="首次使用需执行 supabase-account-moderation.sql；读取失败时不会开放处理操作。" type="error" :closable="false" show-icon />
    <p v-if="loading" role="status">正在读取站内账号…</p>
    <template v-else-if="!error">
      <el-table v-if="accounts.length" :data="accounts" stripe>
        <el-table-column label="站内账号" min-width="250"><template #default="{ row }"><strong>{{ row.nickname }}</strong><small class="account-id">{{ row.id }}</small></template></el-table-column>
        <el-table-column label="当前状态" min-width="200"><template #default="{ row }"><div class="account-tags"><el-tag v-if="row.moderation.banned" type="danger">封禁中</el-tag><el-tag v-if="row.moderation.vote_restricted" type="warning">投票受限</el-tag><el-tag v-if="row.moderation.submission_restricted" type="warning">投稿受限</el-tag><el-tag v-if="!row.moderation.banned && !row.moderation.vote_restricted && !row.moderation.submission_restricted" type="success">正常</el-tag></div></template></el-table-column>
        <el-table-column label="操作" width="130"><template #default="{ row }"><el-button type="primary" plain :disabled="saving" @click="open(row)">处理账号</el-button></template></el-table-column>
      </el-table>
      <el-empty v-else description="暂无匹配的站内账号；用户首次登录并读取账号资料后会进入列表" :image-size="60" />
      <el-pagination v-if="total > 20" :current-page="page" :page-size="20" :total="total" layout="prev, pager, next, total" :disabled="loading || saving" @current-change="changePage" />
    </template>
    <el-dialog v-model="dialog" title="账号处理与记录" width="780px" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" @closed="++detailRequest">
      <p v-if="detailLoading" role="status">正在读取账号处理记录…</p>
      <el-alert v-if="detailError" :title="detailError" type="error" :closable="false" show-icon />
      <template v-if="detail">
        <h3>{{ detail.account.nickname }}</h3><p class="muted account-id">站内账号：{{ detail.account.id }}</p>
        <div class="moderation-state"><p v-if="detail.moderation.banned">封禁中：{{ expiry(detail.moderation.ban_until) }}</p><p v-if="detail.moderation.vote_restricted">投票受限：{{ expiry(detail.moderation.vote_until) }}</p><p v-if="detail.moderation.submission_restricted">投稿受限：{{ expiry(detail.moderation.submission_until) }}</p><p v-if="!detail.moderation.banned && !detail.moderation.vote_restricted && !detail.moderation.submission_restricted">当前无生效中的限制。</p></div>
        <el-form label-position="top" @submit.prevent="submit">
          <div class="moderation-fields"><el-form-item label="处理类型"><el-select v-model="action" :disabled="saving" aria-label="账号处理类型"><el-option v-for="(label, key) in ACCOUNT_ACTION_LABELS" :key="key" :label="label" :value="key" /></el-select></el-form-item><el-form-item v-if="timed" label="处理时长"><el-select v-model="duration" :disabled="saving" aria-label="账号限制时长"><el-option label="1 天" :value="24" /><el-option label="3 天" :value="72" /><el-option label="7 天" :value="168" /><el-option label="30 天" :value="720" /><el-option label="长期，直至管理员解除" :value="0" /></el-select></el-form-item></div>
          <el-form-item label="处理原因（会展示给该账号）" required><el-input v-model="reason" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="填写具体行为、处理依据及需注意的事项" :disabled="saving" aria-label="账号处理原因" /></el-form-item>
          <p class="muted">限时处理到期自动恢复。封禁禁止投稿及所有投票操作，仍可登录浏览和查看通知；解除封禁不会撤销单独设置的投票或投稿限制。</p>
          <el-button type="danger" native-type="submit" :loading="saving" :disabled="!reason.trim() || detailLoading">发布处理</el-button><el-button :disabled="saving || detailLoading" @click="readDetail(detail.account.id)">重新读取状态</el-button>
        </el-form>
        <h3>最近 100 条处理记录</h3>
        <el-table v-if="detail.actions.length" :data="detail.actions" max-height="320"><el-table-column label="处理" width="110"><template #default="{ row }">{{ ACCOUNT_ACTION_LABELS[row.action] }}</template></el-table-column><el-table-column prop="reason" label="原因" min-width="220" /><el-table-column prop="actor_name" label="管理员" min-width="180" /><el-table-column label="时间 / 期限" min-width="190"><template #default="{ row }">{{ formatDateTime(new Date(row.created_at).getTime()) }}<small v-if="TIMED_ACCOUNT_ACTIONS.includes(row.action)" class="account-id">至 {{ expiry(row.expires_at) }}</small></template></el-table-column></el-table>
        <p v-else class="muted">暂无处理记录。</p>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.account-search { display: flex; gap: 12px; max-width: 640px; margin: 20px 0; }
.account-id { display: block; font-size: .75rem; overflow-wrap: anywhere; margin-top: 6px; }
.account-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.moderation-state { padding: 8px 14px; margin: 16px 0; background: var(--el-fill-color-light); border-left: 3px solid var(--el-color-warning); }
.moderation-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.moderation-fields :deep(.el-select) { width: 100%; }
:deep(.el-pagination) { margin-top: 20px; }
@media (max-width: 767px) { .moderation-fields { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>
