<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { usePeriodStatus } from "../composables/usePeriodStatus";
import QqAccountButton from "./QqAccountButton.vue";

const route = useRoute();
const { status } = usePeriodStatus();

const titles = {
  "/": "点歌台",
  "/playlist": "本期榜单",
  "/history": "往期歌单",
  "/me": "个人中心",
};
const title = computed(() => titles[route.path] || "点歌台");
const today = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
}).format(new Date());
</script>

<template>
  <header class="topbar">
    <router-link to="/" class="topbar-brand" aria-label="长大小麦君首页">
      <span class="brand-mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </span>
      <span class="topbar-brand-text">
        <strong>长大小麦君</strong>
        <small>CHU BROADCAST</small>
      </span>
    </router-link>

    <div class="topbar-context">
      <span class="topbar-kicker">CHU BROADCAST / 点歌台</span>
      <strong class="topbar-title">{{ title }}</strong>
    </div>

    <div class="topbar-actions">
      <span class="status-chip" :class="status.className">{{ status.label }}</span>
      <span class="topbar-date">{{ today }}</span>
      <span class="topbar-account">
        <QqAccountButton variant="compact" />
      </span>
    </div>
  </header>
</template>