<script setup>
import { useRoute } from "vue-router";

const route = useRoute();
const isActive = (path) => route.path === path;
</script>

<template>
  <nav class="site-nav" aria-label="页面导航">
    <router-link to="/" :class="{ 'is-active': isActive('/') }" aria-label="首页">首页</router-link>
    <router-link to="/playlist" :class="{ 'is-active': isActive('/playlist') }" aria-label="榜单">榜单</router-link>
    <router-link to="/history" :class="{ 'is-active': isActive('/history') }" aria-label="往期">往期</router-link>
  </nav>
</template>
