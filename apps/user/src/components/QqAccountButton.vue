<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { getQqAuthorizeUrl, qqEnabled } from "../services/qq";
import qqLoginIcon from "../assets/qq-login-icon.png";
import Icon from "./Icon.vue";

const props = defineProps({
  variant: { type: String, default: "full" },
});

const auth = useAuthStore();
const route = useRoute();
const isCompact = computed(() => props.variant === "compact");
const qqLoginHref = computed(() => {
  const returnTo = new URL(location.href);
  returnTo.hash = route.fullPath;
  try {
    return getQqAuthorizeUrl(returnTo.href, window.matchMedia("(max-width: 1023px)").matches);
  } catch {
    return "";
  }
});
</script>

<template>
  <div v-if="auth.isQqLoggedIn" class="account-chip" :class="{ 'is-compact': isCompact }">
    <router-link to="/me" class="account-link" aria-label="打开个人中心">
      <span class="account-avatar" aria-hidden="true">
        <img v-if="auth.qqUser.avatar" :src="auth.qqUser.avatar" alt="" referrerpolicy="no-referrer" />
        <span v-else>QQ</span>
      </span>
      <span class="account-text">
        <strong>{{ auth.qqUser.nickname }}</strong>
        <small>{{ auth.qqMode === "mock" ? "本地模拟账号" : "个人中心" }}</small>
      </span>
    </router-link>
    <button
      class="icon-button account-logout"
      type="button"
      aria-label="退出 QQ 登录"
      :disabled="auth.qqBusy"
      @click="auth.qqLogout()"
    >
      <Icon name="logout" :size="15" />
    </button>
  </div>

  <template v-else>
    <a
      v-if="qqEnabled && qqLoginHref"
      class="qq-login-button"
      :class="isCompact ? 'is-compact' : 'is-full'"
      :href="qqLoginHref"
      aria-label="QQ 登录"
    >
      <img :src="qqLoginIcon" width="16" height="16" alt="" aria-hidden="true" />
      <span>QQ 登录</span>
    </a>
    <button
      v-else
      class="qq-login-button"
      :class="isCompact ? 'is-compact' : 'is-full'"
      type="button"
      aria-label="QQ 登录"
      :disabled="auth.qqBusy"
      @click="auth.qqLogin()"
    >
      <img :src="qqLoginIcon" width="16" height="16" alt="" aria-hidden="true" />
      <span>QQ 登录</span>
    </button>
    <p v-if="!isCompact && auth.qqMode === 'mock'" class="qq-mock-label">本地模拟登录</p>
    <p v-if="!isCompact && auth.qqError" class="qq-error-hint" role="status">{{ auth.qqError }}</p>
  </template>
</template>