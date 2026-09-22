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

const SONGS_PER_PAGE = 12;
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
    likedSongIds: [],
    dislikedSongIds: [],
    likingSongId: "",
    dislikingSongId: "",
    isSubmitting: false,
    formHint: "",
    recommendedSongIds: [],
    recommendationDateKey: "",
    errorMessage: "",
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
      if (!authStore.backendReady || !authStore.visitorId || !period) return false;
      if (period.status !== "active") return false;
      const now = Date.now();
      return period.startsAt <= now && now <= period.endsAt;
    },
  },

  actions: {
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

      this.songs = await fetchSongs(period.id);

      const [likes, dislikes] = await Promise.all([
        fetchMyLikes(period.id, authStore.visitorId),
        fetchMyDislikes(period.id, authStore.visitorId),
      ]);
      this.likedSongIds = new Set(likes);
      this.dislikedSongIds = new Set(dislikes);

      this.ensureDailyRecommendations(period);
    },

    resetForNoPeriod() {
      this.songs = [];
      this.likedSongIds = [];
      this.dislikedSongIds = [];
      this.recommendedSongIds = [];
      this.recommendationDateKey = "";
      this.currentPage = 1;
      this.errorMessage = "";
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

    async submitSong(title, artist) {
      const authStore = useAuthStore();
      const periodStore = usePeriodStore();
      const period = periodStore.currentPeriod;

      if (!this.canMutate) {
        this.formHint = "当前不在征集时间内，无法投稿。";
        return false;
      }
      if (!title.trim() || !artist.trim()) {
        this.formHint = "请填写歌曲标题和歌手名称。";
        return false;
      }
      if (this.songs.some((song) => song.titleLower === normalizeText(title) && song.artistLower === normalizeText(artist))) {
        this.formHint = "这首歌已经有人提交过啦，请勿重复投稿。";
        return false;
      }

      this.isSubmitting = true;
      this.formHint = "";
      try {
        await submitSong({
          title: title.trim(),
          artist: artist.trim(),
          playlistDate: period.id,
          voterCookie: authStore.visitorId,
        });
        await this.fetchAllData();
        this.formHint = "提交成功！这首歌已经出现在歌单里了。";
        return true;
      } catch (error) {
        this.formHint = resolveErrorMessage(error);
        return false;
      } finally {
        this.isSubmitting = false;
      }
    },

    async toggleLikeSong(song) {
      if (!this.canMutate || this.likingSongId) return;
      const authStore = useAuthStore();
      const periodStore = usePeriodStore();
      const period = periodStore.currentPeriod;
      const isLiked = this.likedSongIds.has(song.id);
      const action = isLiked ? "off" : "on";

      this.likingSongId = song.id;
      try {
        await toggleLike({
          songId: song.id,
          playlistDate: period.id,
          voterCookie: authStore.visitorId,
          action,
        });
        if (action === "on") {
          this.likedSongIds.add(song.id);
          this.dislikedSongIds.delete(song.id);
          song.likesCount += 1;
        } else {
          this.likedSongIds.delete(song.id);
          song.likesCount = Math.max(0, song.likesCount - 1);
        }
      } finally {
        this.likingSongId = "";
      }
    },

    async toggleDislikeSong(song, reason = "") {
      if (!this.canMutate || this.dislikingSongId) return;
      const authStore = useAuthStore();
      const periodStore = usePeriodStore();
      const period = periodStore.currentPeriod;
      const isDisliked = this.dislikedSongIds.has(song.id);
      const action = isDisliked ? "off" : "on";

      if (action === "on" && !reason.trim()) {
        this.formHint = "点踩需要填写理由（不超过 20 字），以便管理员审核。";
        return false;
      }

      this.dislikingSongId = song.id;
      try {
        await toggleDislike({
          songId: song.id,
          playlistDate: period.id,
          voterCookie: authStore.visitorId,
          action,
          reason: action === "on" ? reason.trim().slice(0, 20) : null,
        });
        if (action === "on") {
          this.dislikedSongIds.add(song.id);
          this.likedSongIds.delete(song.id);
          song.dislikesCount += 1;
        } else {
          this.dislikedSongIds.delete(song.id);
          song.dislikesCount = Math.max(0, song.dislikesCount - 1);
        }
        this.formHint = "";
        return true;
      } catch (error) {
        this.formHint = resolveErrorMessage(error);
        return false;
      } finally {
        this.dislikingSongId = "";
      }
    },
  },
});
