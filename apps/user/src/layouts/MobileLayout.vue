<script setup>
import AppHeader from "../components/AppHeader.vue";
import AppNav from "../components/AppNav.vue";
import AppFooter from "../components/AppFooter.vue";

defineEmits(["open-admin-login"]);
</script>

<template>
  <div class="page-shell mobile-shell">
    <AppHeader @open-admin-login="$emit('open-admin-login')" />
    <main id="top">
      <slot />
    </main>
    <AppFooter />
  </div>

  <!-- 移动端：底部悬浮导航 -->
  <AppNav />
</template>
