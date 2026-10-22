<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { getQqAuthorizeUrl, qqEnabled } from "../services/qq";
import qqLoginIcon from "../assets/qq-login-icon.png";

const authStore = useAuthStore();
const isLocalPreview = import.meta.env.DEV;
const route = useRoute();
const qqLoginHref = computed(() => {
  const returnTo = new URL(location.href);
  returnTo.hash = route.fullPath;
  try { return getQqAuthorizeUrl(returnTo.href, window.matchMedia("(max-width: 767px)").matches); }
  catch { return ""; }
});
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
        <span v-if="authStore.qqMode === 'mock'" class="qq-mock-label">本地模拟</span>
        <span v-else-if="isLocalPreview" class="qq-mock-label">本地预览</span>
        <div v-if="authStore.isQqLoggedIn" class="qq-account-session">
          <span class="qq-user" :title="authStore.qqUser.nickname">
            <span class="qq-avatar" aria-hidden="true">
              <img v-if="authStore.qqUser.avatar" :src="authStore.qqUser.avatar" alt="" referrerpolicy="no-referrer" />
              <span v-else>QQ</span>
            </span>
            <span class="qq-nickname">{{ authStore.qqUser.nickname }}</span>
          </span>
          <button class="text-link qq-logout" type="button" :disabled="authStore.qqBusy" @click="authStore.qqLogout()">{{ authStore.qqBusy ? '退出中…' : '退出' }}</button>
        </div>
        <a v-else-if="qqEnabled && qqLoginHref" class="qq-login-button" :href="qqLoginHref" aria-label="QQ 登录">
          <img :src="qqLoginIcon" width="16" height="16" alt="" aria-hidden="true" />
          <span>QQ 登录</span>
        </a>
        <button v-else class="qq-login-button" type="button" aria-label="QQ 登录" @click="authStore.qqLogin()">
          <img :src="qqLoginIcon" width="16" height="16" alt="" aria-hidden="true" />
          <span>QQ 登录</span>
        </button>
      </div>
    </div>
    <p v-if="authStore.qqError" class="qq-login-hint" role="status">{{ authStore.qqError }}</p>
  </header>
</template>
