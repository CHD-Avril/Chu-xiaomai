<script setup>
import { computed } from "vue";
import { useAuthStore } from "../stores/auth";
const auth = useAuthStore();
const restricted = computed(() => { const m = auth.qqAccount?.moderation; return m?.banned || m?.vote_restricted || m?.submission_restricted; });
</script>
<template>
  <div v-if="auth.isQqLoggedIn && (restricted || auth.qqAccount?.unread_count)" class="notice" role="status">
    <strong>{{ restricted ? '账号参与权限受限。' : `你有 ${auth.qqAccount.unread_count} 条未读站内通知。` }}</strong>
    <router-link class="text-link" to="/me">查看通知与处理详情 ↗</router-link>
  </div>
</template>
