<script setup>
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";
import { qqEnabled } from "../services/qq";
import qqLoginIcon from "../assets/qq-login-icon.png";

const authStore = useAuthStore();
const loginHint = ref("");

function login() {
  if (!qqEnabled) {
    loginHint.value = "QQ 登录暂未开放，请稍后再试。";
    return;
  }
  loginHint.value = "";
  authStore.qqLogin();
}
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
      <span class="header-note">校园点歌 · 为喜欢发声</span>
      <div class="qq-account">
        <div v-if="authStore.isQqLoggedIn" class="qq-account-session">
          <span class="qq-user" :title="authStore.qqUser.nickname">
            <span class="qq-avatar" aria-hidden="true">
              <img v-if="authStore.qqUser.avatar" :src="authStore.qqUser.avatar" alt="" referrerpolicy="no-referrer" />
              <span v-else>QQ</span>
            </span>
            <span class="qq-nickname">{{ authStore.qqUser.nickname }}</span>
          </span>
          <button class="text-link qq-logout" type="button" @click="authStore.qqLogout()">退出</button>
        </div>
        <button v-else class="qq-login-button" type="button" aria-label="QQ 登录" @click="login">
          <img :src="qqLoginIcon" width="16" height="16" alt="" aria-hidden="true" />
          <span>QQ 登录</span>
        </button>
      </div>
    </div>
    <p v-if="loginHint" class="qq-login-hint" role="status">{{ loginHint }}</p>
  </header>
</template>
