<script setup>
import { onMounted, ref } from "vue";
import * as api from "../../services/api";
import { formatDateTime } from "../../utils/format";

const reports = ref([]);
const hint = ref("");
const processingId = ref("");

async function loadReports() {
  try {
    reports.value = await api.fetchPendingReports();
    hint.value = reports.value.length ? `有 ${reports.value.length} 条待审核举报。` : "暂无待审核举报。";
  } catch (error) {
    hint.value = error?.message || error?.details || "读取举报失败。";
  }
}

async function review(report, approve) {
  processingId.value = report.id;
  hint.value = "";
  try {
    await api.reviewReport(report.id, approve);
    reports.value = reports.value.filter((item) => item.id !== report.id);
    hint.value = approve ? "已同意举报，歌曲已锁定。" : "已驳回举报。";
  } catch (error) {
    hint.value = error?.message || error?.details || "操作失败。";
  } finally {
    processingId.value = "";
  }
}

onMounted(loadReports);
</script>

<template>
  <div class="admin-block">
    <p class="section-tag">Review</p>
    <h3>举报审查</h3>
    <p class="section-note">同学点踩时填写的理由会汇总到这里，同意后歌曲将被锁定。</p>

    <div class="report-list">
      <template v-if="reports.length">
        <article v-for="report in reports" :key="report.id" class="report-item">
          <div class="report-song">
            {{ report.song?.title ?? "未知歌曲" }}
            <span style="color: var(--muted); font-weight: 400"> - {{ report.song?.artist ?? "" }}</span>
          </div>
          <p class="report-reason">“{{ report.reason }}”</p>
          <p class="report-meta">
            {{ formatDateTime(Date.parse(report.created_at) || 0) }} · 当前喜欢
            {{ report.song?.likes_count ?? 0 }} · 点踩 {{ report.song?.dislikes_count ?? 0 }}
          </p>
          <div class="report-actions">
            <button
              class="primary-button compact-button"
              type="button"
              :disabled="processingId === report.id"
              @click="review(report, true)"
            >
              同意并锁定歌曲
            </button>
            <button
              class="primary-button secondary-btn compact-button"
              type="button"
              :disabled="processingId === report.id"
              @click="review(report, false)"
            >
              驳回
            </button>
          </div>
        </article>
      </template>
      <div v-else class="empty-inline">{{ hint }}</div>
    </div>
    <p class="form-hint">{{ reports.length ? hint : "" }}</p>
  </div>
</template>
