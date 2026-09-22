<script setup>
import { useAuthStore } from "../stores/auth";
import PeriodPanel from "../components/admin/PeriodPanel.vue";
import AnnouncementPanel from "../components/admin/AnnouncementPanel.vue";
import HistoryPanel from "../components/admin/HistoryPanel.vue";
import ExportPanel from "../components/admin/ExportPanel.vue";
import ReportsPanel from "../components/admin/ReportsPanel.vue";

const authStore = useAuthStore();
</script>

<template>
  <section class="card admin-panel">
    <div class="section-head">
      <div>
        <p class="section-tag">Admin</p>
        <h2>管理员工作台</h2>
      </div>
      <button class="primary-button secondary-btn compact-button" type="button" @click="authStore.adminLogout()">
        退出登录
      </button>
    </div>

    <template v-if="authStore.isAdmin">
      <div class="admin-grid">
        <PeriodPanel />
        <AnnouncementPanel />
      </div>
      <div class="admin-grid">
        <HistoryPanel />
        <ExportPanel />
      </div>
      <ReportsPanel />
    </template>
    <div v-else class="empty-state">
      <h3 class="empty-title">需要管理员权限</h3>
      <p class="empty-copy">请先通过右上角「管理员入口」登录后再进入工作台。</p>
    </div>
  </section>
</template>
