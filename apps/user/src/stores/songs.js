import { defineStore } from "pinia";
import { useAuthStore } from "./auth";
import { usePeriodStore } from "./period";
import {
  fetchSongs,
  fetchMyLikes,
  fetchMyDislikes,
  submitSong,
  toggleLike,
  toggleDislike,
} from "../services/api";
import { normalizeText, resolveErrorMessage } from "../utils/format";
import { SONGS_PER_PAGE } from "../utils/pagination";
import { describeConnectionIssue } from "../utils/connectionIssue";

const DAILY_RECOMMENDATION_LIMIT = 5;

// FNV-1a 32 位稳定哈希（每日推荐随机排序使用）
function fnv1a(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getDailyRecommendationKey(period, song) {
  return `${period.id}|${song.id}|${song.createdAtMs}`;
}

export const useSongsStore = defineStore("songs", {
  state: () => ({
    songs: [],
    searchTerm: "",
    sortMode: "likes",
    currentPage: 1,
    likedSongIds: new Set(),
    dislikedSongIds: new Set(),
    likingSongId: "",
    dislikingSongId: "",
    isSubmitting: false,
    formHint: "",
    formHintType: "",
    voteError: "",
    isLoading: true,
    isRefreshing: false,
    recommendedSongIds: [],
    recommendationDateKey: "",
    recommendationPeriodId: "",
    errorMessage: "",
    refreshError: "",
    connectionIssue: null,
    lastUpdatedAt: 0,
    lastSubmission: null,
  }),

  getters: {
    pageCount(state) {
      return Math.max(1, Math.ceil(this.visibleSongs.length / SONGS_PER_PAGE));
    },

    visibleSongs(state) {
      const keyword = normalizeText(state.searchTerm);
      const filtered = keyword
        ? state.songs.filter(
            (song) =>
              song.titleLower.includes(keyword) || song.artistLower.includes(keyword),
          )
        : state.songs;

      if (state.sortMode === "time") {
        return [...filtered].sort((a, b) => b.createdAtMs - a.createdAtMs);
      }
      return [...filtered].sort((a, b) => {
        const likeGap = (b.likesCount || 0) - (a.likesCount || 0);
        return likeGap || (b.createdAtMs || 0) - (a.createdAtMs || 0);
      });
    },

    paginatedSongs() {
      const start = (this.currentPage - 1) * SONGS_PER_PAGE;
      return this.visibleSongs.slice(start, start + SONGS_PER_PAGE);
    },

    dailyRecommendations() {
      const periodStore = usePeriodStore();
      const period = periodStore.currentPeriod;
      if (!period || this.recommendationDateKey !== this.todayKey()) return [];
      return this.recommendedSongIds
        .map((songId) => this.songs.find((song) => song.id === songId))
        .filter(Boolean);
    },

    canMutate() {
      const authStore = useAuthStore();
      const periodStore = usePeriodStore();
      const period = periodStore.currentPeriod;
      if (this.isLoading || this.isRefreshing || this.errorMessage || this.refreshError || !authStore.backendReady || !period) return false;
      if (period.isTest ? !authStore.isTester || !authStore.testUser?.id : !authStore.visitorId) return false;
      return periodStore.isWithinCurrentPeriod;
    },
  },

  actions: {
    async refresh({ background = false, maxAge = 0 } = {}) {
      if (this.isRefreshing || this.isSubmitting || this.likingSongId || this.dislikingSongId) return;
      if (maxAge && Date.now() - this.lastUpdatedAt < maxAge && !this.errorMessage && !this.refreshError) return;
      const previousPeriodId = usePeriodStore().currentPeriod?.id;
      this.isRefreshing = true;
      this.isLoading = !background || !this.lastUpdatedAt;
      try {
        if (!useAuthStore().backendReady) throw Object.assign(new Error("点歌台配置异常"), { code: "CLIENT_CONFIG", operation: "连接点歌台" });
        await usePeriodStore().fetchPeriods();
        if (usePeriodStore().currentPeriod?.isTest) {
          await useAuthStore().syncTestSession();
        }
        if (previousPeriodId !== usePeriodStore().currentPeriod?.id) {
          this.resetForNoPeriod();
          this.isLoading = true;
        }
        await this.fetchAllData();
        this.lastUpdatedAt = Date.now();
        this.errorMessage = "";
        this.refreshError = "";
        this.connectionIssue = null;
      } catch (error) {
        if (usePeriodStore().currentPeriod?.isTest) this.resetForNoPeriod();
        this.connectionIssue = describeConnectionIssue(error);
        if (this.isLoading) this.errorMessage = this.connectionIssue.message;
        else this.refreshError = this.connectionIssue.message;
      } finally {
        this.isLoading = false;
        this.isRefreshing = false;
      }
    },

    todayKey() {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    },

    async fetchAllData() {
      const periodStore = usePeriodStore();
      const authStore = useAuthStore();
      const period = periodStore.currentPeriod;
      if (!period) {
        this.resetForNoPeriod();
        return;
      }

      if (period.isTest && !authStore.isTester) {
        this.resetForNoPeriod();
        return;
      }
      const voterId = period.isTest ? authStore.testUser?.id : authStore.visitorId;

      const [songs, likes, dislikes] = await Promise.all([
        fetchSongs(period.id),
        voterId ? fetchMyLikes(period.id, voterId) : Promise.resolve([]),
        voterId ? fetchMyDislikes(period.id, voterId) : Promise.resolve([]),
      ]);
      if (period.isTest && (!authStore.isTester || authStore.testUser?.id !== voterId)) {
        this.resetForNoPeriod();
        return;
      }
      this.songs = songs;
      this.likedSongIds = new Set(likes);
      this.dislikedSongIds = new Set(dislikes);

      this.ensureDailyRecommendations(period);
      this.currentPage = Math.min(this.currentPage, this.pageCount);
      this.lastUpdatedAt = Date.now();
    },

    resetForNoPeriod() {
      this.songs = [];
      this.likedSongIds = new Set();
      this.dislikedSongIds = new Set();
      this.recommendedSongIds = [];
      this.recommendationDateKey = "";
      this.currentPage = 1;
      this.errorMessage = "";
      this.connectionIssue = null;
      this.lastSubmission = null;
      this.formHint = "";
      this.formHintType = "";
      this.voteError = "";
    },

    ensureDailyRecommendations(period) {
      if (this.recommendationDateKey === this.todayKey() && this.recommendationPeriodId === period.id) {
        return;
      }
      const dateKey = this.todayKey();
      const scored = this.songs
        .map((song) => ({
          song,
          score: fnv1a(`${dateKey}|${getDailyRecommendationKey(period, song)}`),
        }))
        .sort((a, b) => a.score - b.score);

      this.recommendedSongIds = scored.slice(0, DAILY_RECOMMENDATION_LIMIT).map((item) => item.song.id);
      this.recommendationDateKey = dateKey;
      this.recommendationPeriodId = period.id;
    },

    setSearchTerm(value) {
      this.searchTerm = value;
      this.currentPage = 1;
    },

    setSortMode(value) {
      this.sortMode = value;
      this.currentPage = 1;
    },

    setPage(page) {
      this.currentPage = Math.min(Math.max(Number(page) || 1, 1), this.pageCount);
    },

    locateSong(songId) {
      this.searchTerm = "";
      const index = this.visibleSongs.findIndex((song) => song.id === songId);
      if (index < 0) return false;
      this.setPage(Math.floor(index / SONGS_PER_PAGE) + 1);
      return true;
    },

    async submitSong(title, artist) {
      if (this.isSubmitting) return false;
      const authStore = useAuthStore();
      const periodStore = usePeriodStore();
      const period = periodStore.currentPeriod;

      if (!this.canMutate) {
        this.formHintType = "error";
        this.formHint = authStore.identityError || "当前暂时无法投稿，请查看征集状态或刷新页面重试。";
        return false;
      }
      if (!title.trim() || !artist.trim()) {
        this.formHintType = "error";
        this.formHint = "请填写歌曲标题和歌手名称。";
        return false;
      }
      if (this.songs.some((song) => song.titleLower === normalizeText(title) && song.artistLower === normalizeText(artist))) {
        this.formHintType = "error";
        this.formHint = "这首歌已经有人提交过啦，请勿重复投稿。";
        return false;
      }

      this.isSubmitting = true;
      this.formHint = "";
      this.formHintType = "";
      try {
        const submitted = await submitSong({
          title: title.trim(),
          artist: artist.trim(),
          playlistDate: period.id,
          voterCookie: period.isTest ? authStore.testUser.id : authStore.visitorId,
        });
        this.lastSubmission = { songId: submitted?.id, title: title.trim(), artist: artist.trim(), periodId: period.id };
        try {
          await this.fetchAllData();
        } catch (error) {
          this.connectionIssue = describeConnectionIssue(error);
          this.errorMessage = "投稿已收到，但榜单暂时无法更新，请重新读取。";
          this.formHintType = "success";
          this.formHint = "投稿已收到，榜单更新暂时失败。请到榜单刷新查看，无需重复提交。";
          return true;
        }
        this.formHintType = "success";
        this.formHint = "提交成功！这首歌已经出现在歌单里了。";
        return true;
      } catch (error) {
        this.formHintType = "error";
        this.formHint = resolveErrorMessage(error);
        return false;
      } finally {
        this.isSubmitting = false;
      }
    },

    async toggleLikeSong(song) {
      if (!this.canMutate || song.isLocked || this.likingSongId || this.dislikingSongId) return;
      const authStore = useAuthStore();
      const periodStore = usePeriodStore();
      const period = periodStore.currentPeriod;
      const isLiked = this.likedSongIds.has(song.id);
      const action = isLiked ? "off" : "on";

      this.likingSongId = song.id;
      this.voteError = "";
      try {
        await toggleLike({
          songId: song.id,
          playlistDate: period.id,
          voterCookie: period.isTest ? authStore.testUser.id : authStore.visitorId,
          action,
        });
        if (action === "on") {
          this.likedSongIds.add(song.id);
          if (this.dislikedSongIds.has(song.id)) song.dislikesCount = Math.max(0, song.dislikesCount - 1);
          this.dislikedSongIds.delete(song.id);
          song.likesCount += 1;
        } else {
          this.likedSongIds.delete(song.id);
          song.likesCount = Math.max(0, song.likesCount - 1);
        }
      } catch (error) {
        this.voteError = resolveErrorMessage(error);
      } finally {
        this.likingSongId = "";
      }
    },

    async toggleDislikeSong(song, reason = "") {
      if (!this.canMutate || song.isLocked || this.dislikingSongId || this.likingSongId) return;
      const authStore = useAuthStore();
      const periodStore = usePeriodStore();
      const period = periodStore.currentPeriod;
      const isDisliked = this.dislikedSongIds.has(song.id);
      const action = isDisliked ? "off" : "on";

      if (action === "on" && !reason.trim()) {
        this.voteError = "请填写点踩理由（不超过 20 字），以便管理员审核。";
        return false;
      }

      this.dislikingSongId = song.id;
      this.voteError = "";
      try {
        await toggleDislike({
          songId: song.id,
          playlistDate: period.id,
          voterCookie: period.isTest ? authStore.testUser.id : authStore.visitorId,
          action,
          reason: action === "on" ? reason.trim().slice(0, 20) : null,
        });
        if (action === "on") {
          this.dislikedSongIds.add(song.id);
          if (this.likedSongIds.has(song.id)) song.likesCount = Math.max(0, song.likesCount - 1);
          this.likedSongIds.delete(song.id);
          song.dislikesCount += 1;
        } else {
          this.dislikedSongIds.delete(song.id);
          song.dislikesCount = Math.max(0, song.dislikesCount - 1);
        }
        return true;
      } catch (error) {
        this.voteError = resolveErrorMessage(error);
        return false;
      } finally {
        this.dislikingSongId = "";
      }
    },
  },
});
