<script setup>
import { computed, onMounted, ref } from "vue";
import { fetchArchivedPeriods, fetchSongs } from "../services/api";
import { formatDateTime, formatPeriodRange } from "../utils/format";
import Pagination from "../components/Pagination.vue";

const SONGS_PER_PAGE = 12;

const archivedPeriods = ref([]);
const selectedPeriodId = ref("");
const historySongs = ref([]);
const currentPage = ref(1);
const status = ref("正在读取往期歌单...");
const statusError = ref(false);

const selectedPeriod = computed(() => archivedPeriods.value.find((p) => p.id === selectedPeriodId.value));
const totalLikes = computed(() => historySongs.value.reduce((sum, song) => sum + (song.likesCount || 0), 0));
const pageCount = computed(() => Math.max(1, Math.ceil(historySongs.value.length / SONGS_PER_PAGE)));
const paginatedSongs = computed(() => {
  const start = (currentPage.value - 1) * SONGS_PER_PAGE;
  return historySongs.value.slice(start, start + SONGS_PER_PAGE);
});

function sortByLikes(songs) {
  return [...songs].sort(
    (a, b) => (b.likesCount || 0) - (a.likesCount || 0) || (b.createdAtMs || 0) - (a.createdAtMs || 0),
  );
}

async function loadSongs(periodId) {
  const period = archivedPeriods.value.find((p) => p.id === periodId);
  if (!period) return;
  selectedPeriodId.value = periodId;
  currentPage.value = 1;
  historySongs.value = sortByLikes(await fetchSongs(periodId));
}

async function onPeriodChange(event) {
  try {
    await loadSongs(event.target.value);
  } catch (error) {
    status.value = "读取失败";
    statusError.value = true;
    console.error("读取往期歌单失败:", error);
  }
}

onMounted(async () => {
  try {
    const periods = await fetchArchivedPeriods();
    archivedPeriods.value = periods;
    if (!periods.length) {
      status.value = "暂无往期歌单";
      return;
    }
    await loadSongs(periods[0].id);
    status.value = `已保存 ${periods.length} 期往期歌单`;
  } catch (error) {
    status.value = "读取失败";
    statusError.value = true;
    console.error("读取往期歌单失败:", error);
  }
});
</script>

<template>
  <div class="history-page">
    <section class="history-hero card">
      <div>
        <p class="section-tag">Archive</p>
        <h1>往期征集歌单</h1>
        <p>这里保存已经归档的征集结果，只读展示，方便回看每一期同学们留下的歌曲。</p>
      </div>
      <span class="pill" :class="{ 'is-closed': statusError }">{{ status }}</span>
    </section>

    <section class="card history-browser">
      <div class="section-head">
        <div>
          <p class="section-tag">History</p>
          <h2>选择一期歌单</h2>
        </div>
        <p class="section-note" v-if="selectedPeriod">
          {{ selectedPeriod.title }} · {{ formatPeriodRange(selectedPeriod) }}
        </p>
      </div>

      <label class="field history-period-field">
        <span>往期征集</span>
        <select :value="selectedPeriodId" :disabled="!archivedPeriods.length" @change="onPeriodChange">
          <option v-if="!archivedPeriods.length" value="">暂无已归档歌单</option>
          <option
            v-for="period in archivedPeriods"
            :key="period.id"
            :value="period.id"
          >
            {{ period.title }} | {{ formatPeriodRange(period) }}
          </option>
        </select>
      </label>

      <div class="history-summary" aria-label="歌单统计">
        <div class="stat-card">
          <span class="stat-label">收录歌曲</span>
          <strong class="stat-value">{{ historySongs.length }}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">累计喜欢</span>
          <strong class="stat-value">{{ totalLikes }}</strong>
        </div>
      </div>

      <div class="readonly-songs-list" aria-live="polite">
        <template v-if="paginatedSongs.length">
          <div class="readonly-table-header" aria-hidden="true">
            <span>序号</span>
            <span>歌曲</span>
            <span>歌手</span>
            <span>喜欢</span>
          </div>
          <article
            v-for="(song, index) in paginatedSongs"
            :key="song.id"
            class="readonly-song-row"
          >
            <div class="song-index">{{ String((currentPage - 1) * SONGS_PER_PAGE + index + 1).padStart(2, "0") }}</div>
            <div class="song-title" :title="song.title">{{ song.title }}</div>
            <div class="song-artist" :title="song.artist">{{ song.artist }}</div>
            <div class="song-like-count">{{ song.likesCount || 0 }}</div>
          </article>
        </template>
        <div v-else-if="!statusError" class="empty-state">
          <h3 class="empty-title">{{ historySongs.length ? "暂无歌曲" : "暂无往期歌单" }}</h3>
          <p class="empty-copy">管理员归档征集期后，这里会显示对应歌单。</p>
        </div>
      </div>

      <Pagination
        :current-page="currentPage"
        :page-count="pageCount"
        @change="currentPage = $event"
      />
    </section>
  </div>
</template>
