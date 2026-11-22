<script setup>
import { useRoute } from "vue-router";
import { usePeriodStatus } from "../composables/usePeriodStatus";
import Icon from "./Icon.vue";
import QqAccountButton from "./QqAccountButton.vue";

const route = useRoute();
const { period, status } = usePeriodStatus();

const items = [
  { to: "/", label: "首页", icon: "home", hint: "01" },
  { to: "/playlist", label: "榜单", icon: "chart", hint: "02" },
  { to: "/history", label: "往期", icon: "history", hint: "03" },
  { to: "/me", label: "我的", icon: "user", hint: "04" },
];
const isActive = (path) => route.path === path;
</script>

<template>
  <aside class="app-sidebar">
    <router-link to="/" class="sidebar-brand" aria-label="长大小麦君首页">
      <span class="brand-mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </span>
      <span>
        <strong>长大小麦君</strong>
        <small>CHU BROADCAST</small>
      </span>
    </router-link>

    <nav class="side-nav" aria-label="页面导航">
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :class="{ 'is-active': isActive(item.to) }"
      >
        <Icon :name="item.icon" :size="19" />
        <span>{{ item.label }}</span>
        <span class="side-nav-hint" aria-hidden="true">{{ item.hint }}</span>
      </router-link>
    </nav>

    <router-link class="primary-button side-cta" :to="{ name: 'home', hash: '#submit' }">
      <Icon name="plus" :size="16" />
      去点一首歌
    </router-link>

    <div class="side-onair">
      <div class="onair-head">
        <span class="live-dot" aria-hidden="true"></span>
        <span>ON AIR</span>
        <span class="onair-state">{{ status.label }}</span>
      </div>
      <strong>{{ period?.title || "校园点歌征集" }}</strong>
      <p>{{ status.copy }}</p>
      <router-link class="onair-link" to="/playlist">
        查看实时榜单
        <Icon name="arrow-right" :size="14" />
      </router-link>
    </div>

    <div class="side-account">
      <QqAccountButton />
      <p class="side-meta">
        <span class="signal-dot" aria-hidden="true"></span>
        <span>数据连接正常 · 校园广播点歌台</span>
      </p>
    </div>
  </aside>
</template>