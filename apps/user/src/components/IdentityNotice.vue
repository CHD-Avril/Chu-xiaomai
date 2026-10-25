<script setup>
import { useAuthStore } from "../stores/auth";
const auth = useAuthStore();
</script>

<template>
  <div v-if="!auth.isQqLoggedIn" class="notice identity-notice" role="status">
    <strong>游客模式 · 仅可浏览。</strong> QQ 登录后可投稿、点喜欢和点踩。
    <button class="text-link" type="button" :disabled="auth.qqBusy" @click="auth.qqLogin()">QQ 登录 ↗</button>
  </div>
</template>
