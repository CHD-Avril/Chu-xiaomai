<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import Icon from "./Icon.vue";
import QqAccountButton from "./QqAccountButton.vue";

const route = useRoute();
const items = [
  { to: "/", label: "首页", icon: "home", hint: "01" },
  { to: "/playlist", label: "榜单", icon: "chart", hint: "02" },
  { to: "/history", label: "往期", icon: "history", hint: "03" },
  { to: "/me", label: "我的", icon: "user", hint: "04" },
];
const isActive = (path) => route.path === path;
const activeIndex = computed(() => Math.max(0, items.findIndex((item) => isActive(item.to))));
</script>

<template>
  <aside class="app-sidebar">
    <router-link to="/" class="sidebar-brand" aria-label="小麦点歌台首页">
      <span class="brand-mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </span>
      <span>
        <strong>小麦点歌台</strong>
        <small>XIAOMAI RADIO</small>
      </span>
    </router-link>

    <nav class="side-nav" :style="{ '--nav-index': activeIndex }" aria-label="页面导航">
      <span class="side-nav-indicator" aria-hidden="true"></span>
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

    <div class="side-account">
      <QqAccountButton />
    </div>
  </aside>
</template>