<script setup>
import QqAccountButton from "./QqAccountButton.vue";
</script>

<template>
  <header class="topbar">
    <router-link to="/" class="topbar-brand" aria-label="小麦点歌台首页">
      <span class="brand-mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </span>
      <span class="topbar-brand-text">
        <strong>小麦点歌台</strong>
        <small>XIAOMAI RADIO</small>
      </span>
    </router-link>

    <div class="topbar-actions">
      <span class="topbar-account">
        <QqAccountButton variant="compact" />
      </span>
    </div>
  </header>
</template>