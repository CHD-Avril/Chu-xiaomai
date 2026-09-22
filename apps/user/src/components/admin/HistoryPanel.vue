<script setup>
import { onMounted, ref } from "vue";
import { usePeriodStore } from "../../stores/period";
import { formatPeriodRange } from "../../utils/format";

const HISTORY_PREVIEW_LIMIT = 6;

const periodStore = usePeriodStore();
const selectedId = ref("");

onMounted(async () => {
  await periodStore.fetchArchivedPeriods();
});

async function viewPeriod(periodId) {
  selectedId.value = periodId;
  await periodStore.loadHistoryPeriod(periodId);
}
</script>

<template>
  <div class="history-panel admin-block">
    <p class="section-tag">History</p>
    <h3>历史歌单</h3>
    <p class="section-note">查看或导出已归档的往期征集。</p>

    <div class="period-history-list">
      <template v-if="periodStore.archivedPeriods.length">
        <button
          v-for="period in periodStore.archivedPeriods"
          :key="period.id"
          class="period-history-item"
          type="button"
          @click="viewPeriod(period.id)"
        >
          <strong>{{ period.title }}</strong>
          <small>{{ formatPeriodRange(period) }}</small>
        </button>
      </template>
      <div v-else class="empty-inline">还没有归档的征集期。</div>
    </div>

    <div v-if="selectedId && periodStore.historySongs.length" class="history-songs-list">
      <div
        v-for="song in periodStore.historySongs.slice(0, HISTORY_PREVIEW_LIMIT)"
        :key="song.id"
        class="history-song-row"
      >
        <span class="hs-title" :title="song.title">{{ song.title }}</span>
        <span class="hs-artist" :title="song.artist">{{ song.artist }}</span>
        <span class="hs-likes">{{ song.likesCount || 0 }}</span>
      </div>
      <p v-if="periodStore.historySongs.length > HISTORY_PREVIEW_LIMIT" class="form-hint">
        共 {{ periodStore.historySongs.length }} 首，仅预览前 {{ HISTORY_PREVIEW_LIMIT }} 首。
      </p>
    </div>
    <p class="form-hint" :class="{ 'is-error': periodStore.historyHint.includes('失败') }">
      {{ periodStore.historyHint }}
    </p>
  </div>
</template>
