<script setup>
import { computed } from "vue";
import { useSongsStore } from "../stores/songs";
import { supabaseUrl } from "../services/supabase";

const songs = useSongsStore();
const serviceHost = computed(() => {
  try { return new URL(supabaseUrl).host; }
  catch { return "未配置"; }
});
const issueTime = computed(() => songs.connectionIssue
  ? new Date(songs.connectionIssue.occurredAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "");
</script>

<template>
  <div v-if="songs.errorMessage || songs.refreshError" class="connection-notice" role="alert">
    <strong>{{ songs.refreshError ? '更新失败，当前为上次读取的结果' : '连接恢复后即可继续参与' }}</strong>
    <p>{{ songs.connectionIssue?.advice || '请重新连接点歌台；若仍失败，请联系广播台管理员。' }}</p>
    <p class="connection-action-note">暂时无法投稿和投票，已填写的内容会保留。</p>
    <button class="text-link" type="button" :disabled="songs.isRefreshing" @click="songs.refresh({ background: Boolean(songs.lastUpdatedAt) })">
      {{ songs.isRefreshing ? '正在重新连接…' : '重新连接点歌台 ↻' }}
    </button>
    <details v-if="songs.connectionIssue">
      <summary>查看诊断信息（可截图反馈）</summary>
      <dl>
        <dt>失败环节</dt><dd>{{ songs.connectionIssue.operation }}</dd>
        <dt>错误代码</dt><dd>{{ songs.connectionIssue.code }}<template v-if="songs.connectionIssue.status"> · HTTP {{ songs.connectionIssue.status }}</template></dd>
        <dt>数据服务</dt><dd>{{ serviceHost }}</dd>
        <dt>北京时间</dt><dd>{{ issueTime }}</dd>
      </dl>
    </details>
  </div>
</template>
