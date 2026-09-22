<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useAdminStore } from "../stores/admin";
import OverviewPanel from "../components/OverviewPanel.vue";
import SongTable from "../components/SongTable.vue";
import ReportReview from "../components/ReportReview.vue";
import PeriodManage from "../components/PeriodManage.vue";
import AnnouncementManage from "../components/AnnouncementManage.vue";
import AntiCheatPanel from "../components/AntiCheatPanel.vue";
import ExportPanel from "../components/ExportPanel.vue";

const authStore = useAuthStore();
const adminStore = useAdminStore();
const router = useRouter();

const activeView = ref("overview");

const viewComponents = {
  overview: OverviewPanel,
  songs: SongTable,
  reports: ReportReview,
  periods: PeriodManage,
  announcements: AnnouncementManage,
  anticheat: AntiCheatPanel,
  export: ExportPanel,
};

const viewTitles = {
  overview: "运营总览",
  songs: "歌曲管理",
  reports: "举报审核",
  periods: "征集期管理",
  announcements: "公告管理",
  anticheat: "防作弊明细",
  export: "歌单导出",
};

const currentComponent = computed(() => viewComponents[activeView.value]);
const currentTitle = computed(() => viewTitles[activeView.value]);

async function handleLogout() {
  await authStore.logout();
  router.push({ name: "login" });
}

onMounted(async () => {
  if (!adminStore.loaded) {
    try {
      await adminStore.refreshAll();
    } catch (error) {
      console.error("工作台数据加载失败:", error);
    }
  }
});
</script>

<template>
  <el-container class="admin-layout">
    <el-aside width="220px" class="admin-aside">
      <div class="aside-brand">
        <span class="login-brand-mark" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </span>
        <span>
          <strong>长大小麦君</strong>
          <small>CHU BROADCAST</small>
        </span>
      </div>
      <el-menu :default-active="activeView" @select="(key) => (activeView = key)">
        <el-menu-item index="overview">总览</el-menu-item>
        <el-menu-item index="songs">歌曲管理</el-menu-item>
        <el-menu-item index="reports">举报审核</el-menu-item>
        <el-menu-item index="periods">征集期</el-menu-item>
        <el-menu-item index="announcements">公告</el-menu-item>
        <el-menu-item index="anticheat">防作弊明细</el-menu-item>
        <el-menu-item index="export">导出</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="admin-header">
        <div class="header-title">{{ currentTitle }}</div>
        <div class="header-right">
          <el-tag type="info" effect="plain">{{ authStore.adminUser?.email }}</el-tag>
          <el-button type="primary" plain @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>

      <el-main class="admin-main" v-loading="adminStore.loading">
        <component :is="currentComponent" />
      </el-main>
    </el-container>
  </el-container>
</template>
