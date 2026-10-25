<script setup>
import { useRoute } from "vue-router";
import AppHeader from "../components/AppHeader.vue";
import AppNav from "../components/AppNav.vue";
import AppFooter from "../components/AppFooter.vue";
const route = useRoute();
</script>

<template>
  <div class="page-shell">
    <AppHeader />
    <nav class="desktop-nav" aria-label="页面导航">
      <router-link to="/" :class="{ 'is-active': route.path === '/' }">首页</router-link>
      <router-link to="/playlist" :class="{ 'is-active': route.path === '/playlist' }">榜单</router-link>
      <router-link to="/history" :class="{ 'is-active': route.path === '/history' }">往期</router-link>
      <router-link to="/me" :class="{ 'is-active': route.path === '/me' }">我的</router-link>
    </nav>
    <main id="top"><slot /></main>
    <AppFooter />
  </div>
  <AppNav />
</template>
