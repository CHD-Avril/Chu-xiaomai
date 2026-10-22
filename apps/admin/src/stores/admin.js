import { defineStore } from "pinia";
import {
  fetchAllPeriods,
  fetchSongs,
  fetchPendingReports,
  fetchAnnouncements,
} from "../services/api";

let refreshInFlight = null;

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
    now: Date.now(),
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
      if (refreshInFlight) {
        // A mutation may finish while an older snapshot is being fetched.
        // Wait, then fetch again so the caller receives the committed state.
        try { await refreshInFlight; } catch { /* Retry below. */ }
        return this.refreshAll();
      }
      this.loading = true;
      this.errorMessage = "";
      const refresh = async () => {
      try {
        const periods = await fetchAllPeriods();
        const currentPeriod = periods.find((period) => period.status === "active") ?? null;
        // Commit a complete snapshot so a failed request cannot masquerade as zero activity.
        const results = await Promise.allSettled([
          currentPeriod ? fetchSongs(currentPeriod.id) : Promise.resolve([]),
          fetchPendingReports(),
          fetchAnnouncements(),
        ]);
        const failure = results.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
        this.periods = periods;
        this.currentPeriod = currentPeriod;
        [this.songs, this.pendingReports, this.announcements] = results.map((result) => result.value);
        this.loaded = true;
      } catch (error) {
        this.loaded = false;
        this.errorMessage = error?.message || error?.details || "数据加载失败。";
        throw error;
      } finally {
        this.loading = false;
      }
      };
      refreshInFlight = refresh();
      try { await refreshInFlight; }
      finally { refreshInFlight = null; }
    },
  },
});
