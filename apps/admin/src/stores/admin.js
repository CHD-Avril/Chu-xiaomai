import { defineStore } from "pinia";
import {
  fetchAllPeriods,
  fetchSongs,
  fetchPendingReports,
  fetchAnnouncements,
} from "../services/api";

export const useAdminStore = defineStore("admin", {
  state: () => ({
    periods: [],
    currentPeriod: null,
    songs: [],
    pendingReports: [],
    announcements: [],
    loading: false,
    loaded: false,
    errorMessage: "",
  }),

  actions: {
    async refreshPeriods() {
      this.periods = await fetchAllPeriods();
      this.currentPeriod = this.periods.find((period) => period.status === "active") ?? null;
    },

    async refreshSongs() {
      if (!this.currentPeriod) {
        this.songs = [];
        return;
      }
      this.songs = await fetchSongs(this.currentPeriod.id);
    },

    async refreshReports() {
      this.pendingReports = await fetchPendingReports();
    },

    async refreshAnnouncements() {
      this.announcements = await fetchAnnouncements();
    },

    async refreshAll() {
      this.loading = true;
      this.errorMessage = "";
      try {
        await this.refreshPeriods();
        await Promise.all([
          this.refreshSongs(),
          this.refreshReports(),
          this.refreshAnnouncements(),
        ]);
        this.loaded = true;
      } catch (error) {
        this.errorMessage = error?.message || error?.details || "数据加载失败。";
        throw error;
      } finally {
        this.loading = false;
      }
    },
  },
});
