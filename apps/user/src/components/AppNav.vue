<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import Icon from "./Icon.vue";

const route = useRoute();
const isActive = (path) => route.path === path;
const items = [
  { to: "/", label: "首页", icon: "home" },
  { to: "/playlist", label: "榜单", icon: "chart" },
  { to: "/history", label: "往期", icon: "history" },
  { to: "/me", label: "我的", icon: "user" },
];
const activeIndex = computed(() => Math.max(0, items.findIndex((item) => isActive(item.to))));
</script>

<template>
  <nav class="site-nav" :style="{ '--nav-index': activeIndex }" aria-label="页面导航">
    <span class="site-nav-indicator" aria-hidden="true"></span>
    <router-link
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :class="{ 'is-active': isActive(item.to) }"
      :aria-label="item.label"
    >
      <Icon :name="item.icon" :size="21" />
      <span>{{ item.label }}</span>
    </router-link>
  </nav>
</template>