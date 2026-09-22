<script setup>
import { computed } from "vue";
import { useSongsStore } from "../stores/songs";
import { usePeriodStore } from "../stores/period";

const songsStore = useSongsStore();
const periodStore = usePeriodStore();

const songCount = computed(() => songsStore.songs.length);
const likeCount = computed(() => songsStore.songs.reduce((sum, song) => sum + (song.likesCount || 0), 0));

const statusText = computed(() => {
  if (songsStore.errorMessage) return "连接异常";
  if (!periodStore.currentPeriod) return "无征集期";
  const now = Date.now();
  if (now < periodStore.currentPeriod.startsAt) return "未开始";
  if (now > periodStore.currentPeriod.endsAt) return "已结束";
  return "征集开放中";
});
</script>

<template>
  <section class="stats-row" aria-label="征集状态">
    <div class="stat-card">
      <span class="stat-label">已投稿歌曲</span>
      <strong class="stat-value">{{ songCount }}</strong>
    </div>
    <div class="stat-card">
      <span class="stat-label">累计喜欢</span>
      <strong class="stat-value">{{ likeCount }}</strong>
    </div>
    <div class="stat-card">
      <span class="stat-label">当前状态</span>
      <strong class="stat-value stat-status">{{ statusText }}</strong>
    </div>
  </section>
</template>
