<script setup>
import { useAuthStore } from "../stores/auth";
import { useQqLoginModal } from "../composables/useQqLoginModal";
const auth = useAuthStore();
const { openQqLogin } = useQqLoginModal();
</script>

<template>
  <div v-if="!auth.isQqLoggedIn" class="notice identity-notice" role="status">
    <strong>游客模式 · 仅可浏览。</strong> QQ 登录后可投稿、点喜欢和点踩。
    <button class="text-link" type="button" :disabled="auth.qqBusy" @click="openQqLogin()">QQ 登录 ↗</button>
  </div>
</template>
