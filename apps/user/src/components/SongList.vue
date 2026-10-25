<script setup>
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useSongsStore } from "../stores/songs";
import { usePeriodStatus } from "../composables/usePeriodStatus";
import { formatDateTime, normalizeText } from "../utils/format";
import { revealListElement } from "../utils/listNavigation";
import SongCard from "./SongCard.vue";
import Pagination from "./Pagination.vue";
import DailyRecommendations from "./DailyRecommendations.vue";
import { SONGS_PER_PAGE } from "../utils/pagination";
import ConnectionNotice from "./ConnectionNotice.vue";

const songsStore = useSongsStore();
const route = useRoute();
const listStart = ref(null);
const locatedSongId = ref("");
let locatedKey = "";
const { period, status } = usePeriodStatus();
const heading = computed(() => status.value.label === "本期已结束" ? "本期歌单结果" : "本期点歌榜单");
const hasTarget = computed(() => typeof route.query.song === "string" || (typeof route.query.songTitle === "string" && typeof route.query.songArtist === "string"));
const targetSong = computed(() => {
  if (route.query.period && route.query.period !== period.value?.id) return null;
  return songsStore.songs.find((song) => route.query.song
    ? song.id === route.query.song
    : song.titleLower === normalizeText(route.query.songTitle || "") && song.artistLower === normalizeText(route.query.songArtist || ""));
});
watch(() => route.fullPath, () => { locatedKey = ""; locatedSongId.value = ""; });
watch([() => route.fullPath, () => songsStore.songs, () => songsStore.isRefreshing, () => songsStore.isLoading], async () => {
  if (!hasTarget.value || songsStore.isLoading || songsStore.isRefreshing || songsStore.errorMessage || songsStore.refreshError || locatedKey === route.fullPath) return;
  const song = targetSong.value;
  if (!song || !songsStore.locateSong(song.id)) return;
  locatedKey = route.fullPath;
  locatedSongId.value = song.id;
  await revealListElement(() => listStart.value?.querySelector(`[data-song-id="${CSS.escape(song.id)}"]`));
}, { immediate: true, flush: "post" });

async function changePage(page) {
  songsStore.setPage(page);
  await revealListElement(() => listStart.value);
}
</script>

<template>
  <section class="card list-panel" :aria-busy="songsStore.isLoading">
    <div class="section-head list-head">
      <div>
        <h2>{{ heading }}</h2>
      </div>
      <button class="text-link" type="button" :disabled="songsStore.isRefreshing" @click="songsStore.refresh({ background: true })">{{ songsStore.isRefreshing ? '正在更新…' : '刷新榜单 ↻' }}</button>
    </div>

    <div class="playlist-period" role="status">
      <span class="period-state-chip" :class="status.className">{{ status.label }}</span>
      <span>{{ period?.title ?? '校园点歌征集' }} · {{ status.copy }}</span>
    </div>
    <details class="voting-guide">
      <summary>投票说明<span v-if="songsStore.lastUpdatedAt"> · {{ formatDateTime(songsStore.lastUpdatedAt) }} 更新</span></summary>
      <p>QQ 登录后可投票，游客仅可浏览。{{ period?.isTest ? '测试期还需登录已授权的测试账号。' : '' }}喜欢与点踩互斥，再次点击可取消；点踩需填写理由，已提交的举报不会随取消点踩撤回。点击歌名可展开完整信息。</p>
    </details>
    <div class="controls">
      <label class="field search-field">
        <span>搜索</span>
        <input
          type="search"
          maxlength="60"
          placeholder="搜索歌曲或歌手"
          :value="songsStore.searchTerm"
          @input="songsStore.setSearchTerm($event.target.value)"
        />
      </label>
      <label class="field sort-field">
        <span>排序</span>
        <select :value="songsStore.sortMode" @change="songsStore.setSortMode($event.target.value)">
          <option value="likes">喜欢数优先</option>
          <option value="time">最新投稿</option>
        </select>
      </label>
    </div>
    <DailyRecommendations v-if="!songsStore.searchTerm && !songsStore.errorMessage && !songsStore.refreshError" />

    <ConnectionNotice />
    <p v-if="songsStore.voteError" class="form-hint is-error" role="alert">{{ songsStore.voteError }}</p>
    <p v-if="hasTarget && !songsStore.isLoading && !songsStore.isRefreshing && !songsStore.errorMessage && !songsStore.refreshError" class="location-hint" role="status">
      {{ targetSong ? '已定位到你要找的歌曲，完整歌名可点击展开。' : '暂未在本期找到这首歌，请刷新榜单重试，或到往期歌单查看。' }}
      <router-link v-if="!targetSong" class="text-link" to="/history">查看往期 ↗</router-link>
    </p>

    <div ref="listStart" class="songs-list" tabindex="-1" :aria-label="`歌单第 ${songsStore.currentPage} 页，共 ${songsStore.pageCount} 页`">
      <div v-if="!songsStore.isLoading && songsStore.visibleSongs.length" class="list-pagination-top">
        <span>共 {{ songsStore.visibleSongs.length }} 首<span v-if="songsStore.searchTerm">匹配歌曲</span><span v-else> · 每页 {{ SONGS_PER_PAGE }} 首</span></span>
        <Pagination compact label="榜单顶部翻页" :current-page="songsStore.currentPage" :page-count="songsStore.pageCount" :disabled="songsStore.isRefreshing" @change="changePage" />
      </div>
      <div v-if="songsStore.isLoading" class="empty-state" role="status"><span class="loading-signal" aria-hidden="true"></span><h3 class="empty-title">正在接收歌单</h3><p class="empty-copy">马上就能看到大家的选择。</p></div>
      <template v-else-if="songsStore.paginatedSongs.length">
        <SongCard
          v-for="(song, index) in songsStore.paginatedSongs"
          :key="song.id"
          :song="song"
          :rank="(songsStore.currentPage - 1) * SONGS_PER_PAGE + index + 1"
          :featured="songsStore.sortMode === 'likes' && !songsStore.searchTerm && songsStore.currentPage === 1 && index < 3"
          :highlighted="song.id === locatedSongId"
        />
      </template>
      <div v-else-if="!songsStore.errorMessage" class="empty-state">
        <h3 class="empty-title">{{ songsStore.searchTerm ? "没有找到这首歌" : "第一首歌，等你来选" }}</h3>
        <p class="empty-copy">{{ songsStore.searchTerm ? "试试其他歌名或歌手，也可以清除搜索查看全部。" : "征集开放后，你提交的歌曲会出现在这里。" }}</p>
        <button v-if="songsStore.searchTerm" class="text-link" type="button" @click="songsStore.setSearchTerm('')">清除搜索 ↗</button>
        <router-link v-else class="text-link" to="/">去点一首歌 ↗</router-link>
      </div>
    </div>

    <Pagination
      v-if="songsStore.pageCount > 1 && !songsStore.isLoading"
      :current-page="songsStore.currentPage"
      :page-count="songsStore.pageCount"
      :disabled="songsStore.isRefreshing"
      label="榜单底部分页"
      @change="changePage"
    />
  </section>
</template>
