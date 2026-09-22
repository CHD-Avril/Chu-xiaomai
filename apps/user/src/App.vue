<script setup>
import { ref, onMounted } from "vue";
import { useAuthStore } from "./stores/auth";
import { usePeriodStore } from "./stores/period";
import { useSongsStore } from "./stores/songs";
import { useAnnouncementStore } from "./stores/announcement";
import { hasValidConfig } from "./services/supabase";
import AppHeader from "./components/AppHeader.vue";
import AppNav from "./components/AppNav.vue";
import AppFooter from "./components/AppFooter.vue";
import AnnouncementModal from "./components/AnnouncementModal.vue";
import AdminLoginModal from "./components/AdminLoginModal.vue";

const authModalVisible = ref(false);
const authStore = useAuthStore();
const periodStore = usePeriodStore();
const songsStore = useSongsStore();
const announcementStore = useAnnouncementStore();

onMounted(async () => {
  authStore.initIdentity();
  try {
    await authStore.syncAdminSession();
  } catch (error) {
    console.warn("管理员会话同步失败:", error);
  }

  if (hasValidConfig) {
    try {
      await periodStore.fetchPeriods();
      await songsStore.fetchAllData();
    } catch (error) {
      songsStore.errorMessage = error?.message || error?.details || "读取数据失败，请稍后刷新重试。";
      console.error("初始化数据失败:", error);
    }
  } else {
    songsStore.errorMessage = "Supabase 尚未配置，请在 .env 中填写项目地址和 anon key。";
  }

  await announcementStore.fetchAnnouncements();
  // 与旧版行为一致：每次加载自动弹出最新公告
  const latest = announcementStore.announcements[0];
  if (latest) announcementStore.openModal(latest, "auto");
});
</script>

<template>
  <div class="page-shell">
    <AppHeader @open-admin-login="authModalVisible = true" />
    <main id="top">
      <router-view />
    </main>
    <AppFooter />
  </div>

  <AppNav />
  <AdminLoginModal v-if="authModalVisible" @close="authModalVisible = false" />
  <AnnouncementModal />
</template>
