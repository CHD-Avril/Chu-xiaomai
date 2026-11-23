<script setup>
import AmbientBackground from "../components/AmbientBackground.vue";
import AppSidebar from "../components/AppSidebar.vue";
import AppTopbar from "../components/AppTopbar.vue";
import AppFooter from "../components/AppFooter.vue";
import AppNav from "../components/AppNav.vue";
</script>

<template>
  <AmbientBackground />
  <div class="app-frame">
    <AppSidebar />
    <div class="app-main">
      <AppTopbar />
      <main id="top" class="app-content"><slot /></main>
      <AppFooter />
    </div>
  </div>
  <AppNav />
</template>