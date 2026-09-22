<script setup>
import { useRoute } from "vue-router";
import AppHeader from "../components/AppHeader.vue";
import AppFooter from "../components/AppFooter.vue";

defineEmits(["open-admin-login"]);

const route = useRoute();
const isActive = (path) => route.path === path;
</script>

<template>
  <div class="page-shell desktop-shell">
    <AppHeader @open-admin-login="$emit('open-admin-login')" />

    <!-- 桌面端：顶部横向导航 -->
    <nav class="desktop-nav" aria-label="页面导航">
      <router-link to="/" :class="{ 'is-active': isActive('/') }">首页</router-link>
      <router-link to="/playlist" :class="{ 'is-active': isActive('/playlist') }">榜单</router-link>
      <router-link to="/history" :class="{ 'is-active': isActive('/history') }">往期</router-link>
    </nav>

    <main id="top">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>
