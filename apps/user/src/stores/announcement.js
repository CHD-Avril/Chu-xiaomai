import { defineStore } from "pinia";
import { fetchAnnouncements } from "../services/api";

export const useAnnouncementStore = defineStore("announcement", {
  state: () => ({
    announcements: [],
    currentAnnouncement: null,
    modalOpen: false,
    modalTarget: null, // 'auto' | 'manual'
    configError: false,
  }),

  actions: {
    async fetchAnnouncements() {
      try {
        this.announcements = await fetchAnnouncements();
        this.configError = false;
      } catch (error) {
        this.configError = true;
        console.error("读取公告失败:", error);
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
