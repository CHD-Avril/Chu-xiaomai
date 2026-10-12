<script setup>
import { ElAlert, ElAside, ElButton, ElContainer, ElHeader, ElMain, ElMenu, ElMenuItem, ElTag } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/aside/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/container/style/css";
import "element-plus/es/components/header/style/css";
import "element-plus/es/components/main/style/css";
import "element-plus/es/components/menu/style/css";
import "element-plus/es/components/menu-item/style/css";
import "element-plus/es/components/tag/style/css";
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useAdminStore } from "../stores/admin";
import OverviewPanel from "../components/OverviewPanel.vue";

const authStore = useAuthStore();
const adminStore = useAdminStore();
const router = useRouter();
const route = useRoute();

const activeView = computed(() => Object.hasOwn(viewComponents, route.query.view) ? route.query.view : "overview");
function selectView(view, action) {
  router.replace({ query: { ...route.query, view, action: typeof action === "string" ? action : undefined } });
}
const frontendUrl = import.meta.env.VITE_USER_URL || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:5173/` : new URL("/", location.origin).href);
const periodLabel = computed(() => {
  const p = adminStore.currentPeriod;
  if (!p) return "暂无征集期";
  const state = adminStore.now < p.startsAt ? "未开始" : adminStore.now > p.endsAt ? "已结束" : "进行中";
  return `${p.title}${p.isTest ? ' · 测试期' : ''} · ${state}`;
});

const viewComponents = {
  overview: OverviewPanel,
  songs: defineAsyncComponent(() => import("../components/SongTable.vue")),
  reports: defineAsyncComponent(() => import("../components/ReportReview.vue")),
  periods: defineAsyncComponent(() => import("../components/PeriodManage.vue")),
  announcements: defineAsyncComponent(() => import("../components/AnnouncementManage.vue")),
  anticheat: defineAsyncComponent(() => import("../components/AntiCheatPanel.vue")),
  export: defineAsyncComponent(() => import("../components/ExportPanel.vue")),
};

const viewTitles = {
  overview: "运营总览",
  songs: "歌曲管理",
  reports: "举报审核",
  periods: "征集期管理",
  announcements: "公告管理",
  anticheat: "防作弊明细",
  export: "播出歌单与导出",
};

const currentComponent = computed(() => viewComponents[activeView.value]);
const currentTitle = computed(() => viewTitles[activeView.value]);

async function handleLogout() {
  await authStore.logout();
  router.push({ name: "login" });
}

async function refreshDashboard() {
  try { await adminStore.refreshAll(); }
  catch { /* The shared error panel below exposes failures and a retry action. */ }
}
let clock;
onMounted(() => {
  adminStore.now = Date.now();
  clock = setInterval(() => { adminStore.now = Date.now(); }, 1000);
  refreshDashboard();
});
onBeforeUnmount(() => clearInterval(clock));
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
      <el-menu :default-active="activeView" @select="selectView">
        <el-menu-item index="overview">总览</el-menu-item>
        <el-menu-item index="songs">歌曲管理</el-menu-item>
        <el-menu-item index="reports">举报审核</el-menu-item>
        <el-menu-item index="periods">征集期</el-menu-item>
        <el-menu-item index="announcements">公告</el-menu-item>
        <el-menu-item index="anticheat">防作弊明细</el-menu-item>
        <el-menu-item index="export">播出歌单与导出</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="admin-header">
        <div class="header-context"><div class="header-title">{{ currentTitle }}</div><small class="period-context">{{ periodLabel }}</small></div>
        <div class="header-right">
          <el-tag type="info" effect="plain">{{ authStore.adminUser?.email }}</el-tag>
          <el-button :loading="adminStore.loading" @click="refreshDashboard">刷新数据</el-button>
          <el-button type="primary" plain @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>

      <el-main class="admin-main" v-loading="adminStore.loading">
        <div v-if="adminStore.errorMessage" class="data-error" role="alert">
          <el-alert type="error" title="工作台数据读取失败" :description="adminStore.errorMessage" :closable="false" show-icon />
          <p class="muted">数据尚未完整读取，暂不展示统计和管理操作。</p>
          <el-button type="primary" :loading="adminStore.loading" @click="refreshDashboard">重新读取</el-button>
        </div>
        <template v-else-if="adminStore.loaded">
          <div class="workspace-context"><span>{{ periodLabel }}</span><a :href="frontendUrl" target="_blank" rel="noopener">预览前台 ↗</a></div>
          <component :is="currentComponent" @navigate="selectView" />
        </template>
        <p v-else class="muted" role="status">正在读取工作台数据…</p>
      </el-main>
    </el-container>
  </el-container>
</template>
