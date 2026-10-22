<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { fetchArchivedPeriods, fetchSongs } from "../services/api";
import { formatPeriodRange } from "../utils/format";
import Pagination from "../components/Pagination.vue";
import SongIdentity from "../components/SongIdentity.vue";
import { revealListElement } from "../utils/listNavigation";
import { SONGS_PER_PAGE } from "../utils/pagination";


const PERIODS_PER_PAGE = 5;
const archivedPeriods = ref([]);
const periodPage = ref(1);
const periodSelector = ref(null);
const periodSelectorSummary = ref(null);
const selectedPeriodId = ref("");
const historySongs = ref([]);
const currentPage = ref(1);
const status = ref("正在读取往期歌单...");
const statusError = ref(false);
const loading = ref(true);
const listStart = ref(null);
let requestId = 0;

const selectedPeriod = computed(() => archivedPeriods.value.find((p) => p.id === selectedPeriodId.value));
const periodPageCount = computed(() => Math.max(1, Math.ceil(archivedPeriods.value.length / PERIODS_PER_PAGE)));
const paginatedPeriods = computed(() => {
  const start = (periodPage.value - 1) * PERIODS_PER_PAGE;
  return archivedPeriods.value.slice(start, start + PERIODS_PER_PAGE);
});
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
  periodPage.value = Math.floor(archivedPeriods.value.indexOf(period) / PERIODS_PER_PAGE) + 1;
  currentPage.value = 1;
  historySongs.value = [];
  const request = ++requestId;
  loading.value = true;
  statusError.value = false;
  status.value = "正在读取往期歌单…";
  try {
    const songs = await fetchSongs(periodId);
    if (request !== requestId) return;
    historySongs.value = sortByLikes(songs);
    status.value = `已保存 ${archivedPeriods.value.length} 期往期歌单`;
  } catch (error) {
    if (request !== requestId) return;
    status.value = "读取失败，请重试";
    statusError.value = true;
  } finally {
    if (request === requestId) loading.value = false;
  }
}

async function selectPeriod(periodId) {
  if (loading.value) return;
  if (periodSelector.value) periodSelector.value.open = false;
  const pending = loadSongs(periodId);
  await nextTick();
  periodSelectorSummary.value?.focus({ preventScroll: true });
  await pending;
}

function changePeriodPage(page) {
  periodPage.value = Math.min(Math.max(page, 1), periodPageCount.value);
}

async function refreshHistory() {
  const previousId = selectedPeriodId.value;
  loading.value = true;
  statusError.value = false;
  try {
    const periods = await fetchArchivedPeriods();
    archivedPeriods.value = periods;
    if (!periods.length) {
      status.value = "暂无往期歌单";
      historySongs.value = [];
      selectedPeriodId.value = "";
      currentPage.value = 1;
      periodPage.value = 1;
      return;
    }
    if (previousId && !periods.some((period) => period.id === previousId)) {
      selectedPeriodId.value = "";
      historySongs.value = [];
      periodPage.value = 1;
      status.value = "原先选择的征集期已不可用，请重新选择";
      return;
    }
    await loadSongs(previousId || periods[0].id);
  } catch (error) {
    status.value = "读取失败";
    statusError.value = true;
    console.error("读取往期歌单失败:", error);
  } finally {
    loading.value = false;
  }
}
async function changePage(page) {
  currentPage.value = Math.min(Math.max(page, 1), pageCount.value);
  await revealListElement(() => listStart.value);
}
onMounted(refreshHistory);
</script>

<template>
  <div class="history-page">
    <header class="history-hero">
      <div>
        <h1>往期征集歌单</h1>
        <p>回看同学们的选择 · 已归档歌单仅供浏览</p>
      </div>
      <span class="pill" :class="{ 'is-closed': statusError }">{{ status }}</span>
    </header>

    <section class="card history-browser" :aria-busy="loading">
      <details v-if="archivedPeriods.length" ref="periodSelector" class="history-period-selector">
        <summary ref="periodSelectorSummary" class="history-period-trigger">
          <span class="history-period-current"><span>当前征集期</span><strong>{{ selectedPeriod?.title || '请选择一期歌单' }}</strong></span>
          <span class="history-period-action">切换征集期 <span aria-hidden="true">⌄</span></span>
        </summary>
        <div class="history-period-picker">
          <div class="list-pagination-top">
            <span>共 {{ archivedPeriods.length }} 期 · 每页 {{ PERIODS_PER_PAGE }} 期</span>
            <Pagination compact label="征集期翻页" :current-page="periodPage" :page-count="periodPageCount" :disabled="loading" @change="changePeriodPage" />
          </div>
          <div class="history-period-options" role="group" aria-label="选择征集期">
            <button v-for="period in paginatedPeriods" :key="period.id" type="button" class="history-period-option" :aria-pressed="period.id === selectedPeriodId" :disabled="loading" @click="selectPeriod(period.id)">
              <span>{{ period.title }}</span><span v-if="period.id === selectedPeriodId" class="history-period-selected" aria-hidden="true">当前</span>
            </button>
          </div>
        </div>
      </details>
      <p v-if="selectedPeriod" class="history-period-range">征集时间：{{ formatPeriodRange(selectedPeriod) }}</p>

      <div class="history-summary" aria-label="歌单统计">
        <div class="stat-card">
          <span class="stat-label">收录歌曲</span>
          <strong class="stat-value">{{ loading || statusError ? '—' : historySongs.length }}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">累计喜欢</span>
          <strong class="stat-value">{{ loading || statusError ? '—' : totalLikes }}</strong>
        </div>
      </div>

      <div ref="listStart" class="readonly-songs-list" tabindex="-1" :aria-label="`往期歌单第 ${currentPage} 页，共 ${pageCount} 页`">
        <div v-if="!loading && !statusError && historySongs.length" class="list-pagination-top">
          <span>每页 {{ SONGS_PER_PAGE }} 首</span>
          <Pagination compact label="往期顶部翻页" :current-page="currentPage" :page-count="pageCount" @change="changePage" />
        </div>
        <div v-if="loading" class="empty-state" role="status"><span class="loading-signal" aria-hidden="true"></span><h3 class="empty-title">正在读取往期歌单</h3></div>
        <div v-else-if="statusError" class="empty-state"><h3 class="empty-title">歌单暂时无法读取</h3><button class="text-link" type="button" @click="refreshHistory">重新读取 ↻</button></div>
        <template v-else-if="paginatedSongs.length">
          <div class="readonly-table-header" aria-hidden="true">
            <span>序号</span>
            <span>歌曲 / 歌手</span>
            <span>喜欢</span>
          </div>
          <article
            v-for="(song, index) in paginatedSongs"
            :key="song.id"
            class="readonly-song-row"
          >
            <div class="song-index">{{ String((currentPage - 1) * SONGS_PER_PAGE + index + 1).padStart(2, "0") }}</div>
            <SongIdentity :title="song.title" :artist="song.artist" />
            <div class="song-like-count">{{ song.likesCount || 0 }}</div>
          </article>
        </template>
        <div v-else-if="!statusError" class="empty-state">
          <h3 class="empty-title">{{ selectedPeriod ? "本期暂无收录歌曲" : "暂无往期歌单" }}</h3>
          <p class="empty-copy">{{ selectedPeriod ? "可以选择其他征集期继续回看。" : "管理员归档征集期后，这里会显示对应歌单。" }}</p>
        </div>
      </div>

      <Pagination
        v-if="pageCount > 1 && !loading"
        :current-page="currentPage"
        :page-count="pageCount"
        label="往期底部分页"
        @change="changePage"
      />
    </section>
  </div>
</template>
