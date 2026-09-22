<script setup>
import { ref, onMounted } from "vue";
import { useAuthStore } from "./stores/auth";
import { usePeriodStore } from "./stores/period";
import { useSongsStore } from "./stores/songs";
import { useAnnouncementStore } from "./stores/announcement";
import { hasValidConfig } from "./services/supabase";
import { qqEnabled } from "./services/qq";
import { useDevice } from "./composables/useDevice";
import MobileLayout from "./layouts/MobileLayout.vue";
import DesktopLayout from "./layouts/DesktopLayout.vue";
import AnnouncementModal from "./components/AnnouncementModal.vue";
import AdminLoginModal from "./components/AdminLoginModal.vue";

const authModalVisible = ref(false);
const authStore = useAuthStore();
const periodStore = usePeriodStore();
const songsStore = useSongsStore();
const announcementStore = useAnnouncementStore();

const { isMobile } = useDevice();

onMounted(async () => {
  authStore.initIdentity();

  // QQ 授权回调处理（Mock 模式：localhost:5173/?code=...&state=...）
  const params = new URLSearchParams(location.search);
  const qqCode = params.get("code");
  if (qqCode && qqEnabled) {
    try {
      await authStore.handleQqCallback(qqCode);
    } catch (error) {
      console.warn("QQ 登录失败:", error);
    } finally {
      history.replaceState(null, "", location.pathname + location.hash);
    }
  }
  authStore.restoreQqUser();

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
  <!-- 设备感知切换布局外壳：业务逻辑 / API / store 全部共享 -->
  <component
    :is="isMobile ? MobileLayout : DesktopLayout"
    @open-admin-login="authModalVisible = true"
  >
    <router-view />
  </component>

  <AdminLoginModal v-if="authModalVisible" @close="authModalVisible = false" />
  <AnnouncementModal />
</template>
