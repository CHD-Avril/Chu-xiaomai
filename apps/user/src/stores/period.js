import { defineStore } from "pinia";
import { fetchPeriods, fetchArchivedPeriods, fetchSongs } from "../services/api";

export const usePeriodStore = defineStore("period", {
  state: () => ({
    periods: [],
    currentPeriod: null,
    archivedPeriods: [],
    historyPeriodId: "",
    historySongs: [],
    historyLoading: false,
    historyHint: "选择一个征集期查看。",
  }),

  getters: {
    isWithinCurrentPeriod(state) {
      const period = state.currentPeriod;
      if (!period) return false;
      const now = Date.now();
      return period.startsAt <= now && now <= period.endsAt;
    },
  },

  actions: {
    async fetchPeriods() {
      this.periods = await fetchPeriods();
      this.currentPeriod = this.periods.find((period) => period.status === "active") ?? null;
      return this.currentPeriod;
    },

    async fetchArchivedPeriods() {
      this.archivedPeriods = await fetchArchivedPeriods();
      return this.archivedPeriods;
    },

    clearForNoPeriod() {
      this.currentPeriod = null;
      this.historyPeriodId = "";
      this.historySongs = [];
    },

    async loadHistoryPeriod(periodId) {
      const period = this.archivedPeriods.find((item) => item.id === periodId);
      if (!period) return;
      this.historyPeriodId = periodId;
      this.historyLoading = true;
      this.historyHint = "正在读取历史歌单...";
      try {
        this.historySongs = await fetchSongs(periodId);
        this.historyHint = "历史歌单已读取。";
      } catch (error) {
        this.historyHint = `读取失败：${error?.message || error?.details || "未知错误"}`;
        throw error;
      } finally {
        this.historyLoading = false;
      }
    },
  },
});
