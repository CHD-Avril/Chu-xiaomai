<script setup>
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox } from 'element-plus';
import 'element-plus/es/components/alert/style/css';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/form/style/css';
import 'element-plus/es/components/form-item/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/message-box/style/css';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAdminStore } from '../stores/admin';
import { useAuthStore } from '../stores/auth';
import * as api from '../services/api';
import { beijingDate, dailyPeriodDraft, dailyPeriodError, dailyPeriodState, dailyPeriodWindow, formatBeijingTime, formatCollectionDate, isDailyReminderTime } from '../utils/dailyPeriod';

const emit = defineEmits(['navigate']);
const adminStore = useAdminStore();
const authStore = useAuthStore();
const route = useRoute();
const visible = ref(false);
const saving = ref(false);
const error = ref('');
const draft = ref(dailyPeriodDraft());
const periods = ref([]);
const seen = new Set();
const recommended = computed(() => dailyPeriodDraft(adminStore.now));
const state = computed(() => dailyPeriodState(periods.value, draft.value, adminStore.now));
const range = computed(() => dailyPeriodWindow(draft.value));
const dateLabel = computed(() => formatCollectionDate(draft.value.date));
const targetLabel = computed(() => draft.value.date === beijingDate(adminStore.now, 1) ? '明日' : draft.value.date === beijingDate(adminStore.now) ? '今日' : '每日');
const ready = computed(() => adminStore.loaded && !adminStore.loading && !adminStore.errorMessage);

function remember(date) {
  const key = `chu:daily-period:v1:${authStore.adminUser?.id ?? ''}:${date}`;
  seen.add(key);
  try { sessionStorage.setItem(key, 'shown'); } catch { /* In-memory suppression still works. */ }
}

function alreadyShown(date) {
  const key = `chu:daily-period:v1:${authStore.adminUser?.id ?? ''}:${date}`;
  try { return seen.has(key) || sessionStorage.getItem(key) === 'shown'; }
  catch { return seen.has(key); }
}

function open(offsetDays) {
  if (!ready.value || saving.value) return;
  draft.value = dailyPeriodDraft(Date.now(), offsetDays);
  periods.value = adminStore.periods.map(period => ({ ...period }));
  error.value = '';
  remember(draft.value.date);
  visible.value = true;
}

function chooseDay(offsetDays) {
  draft.value = dailyPeriodDraft(Date.now(), offsetDays);
  error.value = '';
  remember(draft.value.date);
}

function maybePrompt() {
  // Daytime is intentionally quiet. Manual setup remains available at any hour.
  if (!ready.value || visible.value || saving.value || route.query.action || !isDailyReminderTime(adminStore.now)) return;
  const next = recommended.value;
  if (alreadyShown(next.date) || dailyPeriodState(adminStore.periods, next, adminStore.now).kind !== 'missing') return;
  open();
}

watch([() => adminStore.loaded, () => adminStore.loading, () => adminStore.errorMessage,
  () => recommended.value.date, () => adminStore.currentPeriod?.id, () => authStore.adminUser?.id], maybePrompt, { immediate: true });

function manageExisting() {
  visible.value = false;
  emit('navigate', 'periods', 'edit');
}

async function save() {
  if (saving.value || !ready.value) return;
  const payload = { ...draft.value };
  error.value = dailyPeriodError(payload, Date.now());
  if (error.value) return;
  saving.value = true;
  let written = false;
  try {
    // Re-read before confirming; the RPC also checks the snapshot under a write lock.
    periods.value = await api.fetchAllPeriods();
    const latest = dailyPeriodState(periods.value, payload, Date.now());
    if (latest.kind !== 'missing') {
      error.value = latest.message || '这一天已有征集，请查看并调整原期，已收歌曲和票数会保留。';
      return;
    }
    const window = dailyPeriodWindow(payload);
    const active = latest.current;
    if (active && active.endsAt > Date.now()) {
      try {
        await ElMessageBox.confirm(`保存后将立即归档「${active.title}」，原期投稿和投票会关闭。新征集时间为北京时间 ${formatBeijingTime(window.startsAt)} 至 ${formatBeijingTime(window.endsAt)}。确认切换？`, '确认征集安排', {
          confirmButtonText: '确认切换', cancelButtonText: '继续编辑', type: 'warning',
        });
      } catch { return; }
    }
    if (window.endsAt - window.startsAt < 3600000) {
      try {
        await ElMessageBox.confirm('征集时间不足 1 小时，请检查是否把下午 18:00 填成了凌晨 00:18。仍要保存吗？', '核对征集时长', {
          confirmButtonText: '时间无误，保存', cancelButtonText: '返回修改', type: 'warning',
        });
      } catch { return; }
    }
    const result = await api.prepareDailyPeriod(payload, active);
    written = true;
    visible.value = false;
    await adminStore.refreshAll();
    if (result.created) ElMessage.success(`${payload.title}已设置，${payload.startTime} 开始，${payload.endTime} 截止（北京时间）`);
    else {
      ElMessage.info('这一天已由管理员设置，已读取现有征集。');
      emit('navigate', 'periods');
    }
  } catch (cause) {
    const message = cause?.message || '保存失败，请重试。';
    if (written) ElMessage.error('征集已保存，但工作台刷新失败，请重新读取数据。');
    else error.value = message;
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog v-model="visible" :title="`设置${targetLabel}征集`" width="min(520px, 94vw)"
    :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" destroy-on-close>
    <p class="daily-intro">{{ targetLabel }}的征集时间已填好，核对后即可保存。所有时间均为北京时间。</p>
    <div class="daily-day-buttons">
      <el-button :disabled="saving" :type="draft.date === beijingDate(adminStore.now) ? 'primary' : 'default'" plain @click="chooseDay(0)">今天</el-button>
      <el-button :disabled="saving" :type="draft.date === beijingDate(adminStore.now, 1) ? 'primary' : 'default'" plain @click="chooseDay(1)">明天</el-button>
    </div>
    <p class="daily-date">{{ dateLabel }}</p>
    <template v-if="state.kind !== 'missing'">
      <el-alert :type="state.kind === 'exists' ? 'success' : 'warning'" :closable="false" show-icon
        :title="state.message || (state.kind === 'ended' ? '这一天的征集已结束，可以调整原期时间' : '这一天已经有征集安排')" />
      <p>「{{ state.current.title }}」</p>
      <p>{{ formatBeijingTime(state.current.startsAt) }} 至 {{ formatBeijingTime(state.current.endsAt) }}（北京时间）</p>
      <p class="muted">调整原期会保留已收歌曲和票数。</p>
    </template>
    <el-form v-else label-position="top" :disabled="saving" @submit.prevent="save">
      <el-form-item label="征集标题" required><el-input v-model="draft.title" maxlength="80" /></el-form-item>
      <div class="daily-time-fields">
        <el-form-item label="开始时间（24 小时制）" required>
          <input v-model="draft.startTime" type="time" step="60" :disabled="saving" aria-label="开始时间（北京时间）" />
        </el-form-item>
        <el-form-item label="结束时间（24 小时制）" required>
          <input v-model="draft.endTime" type="time" step="60" :disabled="saving" aria-label="结束时间（北京时间）" />
        </el-form-item>
      </div>
      <el-alert v-if="range" type="info" :closable="false" show-icon title="请核对完整日期与时间"
        :description="`${formatBeijingTime(range.startsAt)} 开始 → ${formatBeijingTime(range.endsAt)} 截止（北京时间）`" />
      <p class="daily-note">保存后立即切换至本期，旧期归档。明日征集在明天开始前无法投稿或投票。</p>
    </el-form>
    <el-alert v-if="error" class="daily-error" type="error" :title="error" :closable="false" show-icon />
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">稍后设置</el-button>
      <el-button v-if="state.kind !== 'missing'" type="primary" :disabled="saving" @click="manageExisting">查看并调整</el-button>
      <el-button v-else type="primary" :loading="saving" :disabled="!ready" @click="save">确认创建征集</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.daily-intro, .daily-note { color: #606266; line-height: 1.7; }
.daily-intro { margin-top: 0; }
.daily-day-buttons { display: flex; gap: 8px; }
.daily-day-buttons .el-button + .el-button { margin-left: 0; }
.daily-date { font-weight: 600; font-size: 17px; color: #303133; }
.daily-time-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.daily-time-fields input { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid #dcdfe6; border-radius: 4px; padding: 8px; font: inherit; background: white; color: #303133; }
.daily-error { margin-top: 12px; }
</style>
