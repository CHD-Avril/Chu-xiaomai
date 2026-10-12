import { defineStore } from "pinia";
import { fetchAnnouncements } from "../services/api";

export const useAnnouncementStore = defineStore("announcement", {
  state: () => ({
    announcements: [],
    currentAnnouncement: null,
    modalOpen: false,
    modalTarget: null, // 'auto' | 'manual'
    configError: false,
    isLoading: true,
    isFetching: false,
    lastFetchedAt: 0,
  }),

  actions: {
    async fetchAnnouncements({ background = false, maxAge = 0 } = {}) {
      if (this.isFetching || (maxAge && Date.now() - this.lastFetchedAt < maxAge && !this.configError)) return;
      this.isFetching = true;
      this.isLoading = !background || !this.lastFetchedAt;
      try {
        this.announcements = await fetchAnnouncements();
        this.configError = false;
        this.lastFetchedAt = Date.now();
      } catch (error) {
        this.configError = true;
        console.error("读取公告失败:", error);
      } finally {
        this.isLoading = false;
        this.isFetching = false;
      }
    },

    openModal(announcement, target = "manual") {
      this.currentAnnouncement = announcement;
      this.modalTarget = target;
      this.modalOpen = true;
    },

    closeModal() {
      this.modalOpen = false;
      this.currentAnnouncement = null;
      this.modalTarget = null;
    },
  },
});
