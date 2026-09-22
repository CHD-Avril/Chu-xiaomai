<script setup>
import { useAuthStore } from "../stores/auth";
import { qqEnabled } from "../services/qq";

defineEmits(["open-admin-login"]);
const authStore = useAuthStore();
</script>

<template>
  <header class="site-header">
    <a class="brand" href="#/" aria-label="长安大学广播台首页">
      <span class="brand-mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </span>
      <span>
        <strong>长安大学广播台</strong>
        <small>CHU Broadcast Station</small>
      </span>
    </a>

    <div class="header-actions">
      <template v-if="authStore.isQqLoggedIn">
        <span class="qq-user" :title="authStore.qqUser.openid">
          <span v-if="authStore.qqUser.avatar" class="qq-avatar">
            <img :src="authStore.qqUser.avatar" alt="" />
          </span>
          <span v-else class="qq-avatar qq-avatar-fallback">{{ authStore.qqUser.nickname.slice(0, 1) }}</span>
          {{ authStore.qqUser.nickname }}
        </span>
        <button class="nav-action" type="button" @click="authStore.qqLogout()">退出</button>
      </template>
      <button
        v-else-if="qqEnabled"
        class="nav-action"
        type="button"
        title="QQ 登录"
        @click="authStore.qqLogin()"
      >
        <span aria-hidden="true">💬</span>
        QQ 登录
      </button>
      <button
        class="nav-action"
        type="button"
        aria-label="管理员入口"
        title="管理员入口"
        @click="$emit('open-admin-login')"
      >
        <span aria-hidden="true">✈</span>
        管理员入口
      </button>
    </div>
  </header>
</template>
