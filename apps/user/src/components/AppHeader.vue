<script setup>
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { getQqAuthorizeUrl, qqEnabled, demoLoginEnabled, demoText } from "../services/qq";
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
const demoEmail = ref(""), demoPassword = ref(""), demoHint = ref("");
async function submitDemo() {
  if (authStore.qqBusy) return;
  demoHint.value = "";
  try {
    await authStore.demoLogin(demoEmail.value, demoPassword.value);
    demoPassword.value = "";
  } catch (error) {
    demoHint.value = error?.message || "登录失败，请稍后重试。";
  }
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
        <span v-if="authStore.qqMode === 'mock'" class="qq-mock-label">本地模拟</span>
        <span v-else-if="demoLoginEnabled" class="qq-mock-label">参赛演示</span>
        <span v-else-if="isLocalPreview" class="qq-mock-label">本地预览</span>
        <div v-if="authStore.isQqLoggedIn" class="qq-account-session">
          <span class="qq-user" :title="authStore.qqUser.nickname">
            <span class="qq-avatar" aria-hidden="true">
              <img v-if="authStore.qqUser.avatar" :src="authStore.qqUser.avatar" alt="" referrerpolicy="no-referrer" />
              <span v-else>{{ demoLoginEnabled ? '演' : 'QQ' }}</span>
            </span>
            <span class="qq-nickname">{{ authStore.qqUser.nickname }}</span>
          </span>
          <button class="text-link qq-logout" type="button" :disabled="authStore.qqBusy" @click="authStore.qqLogout()">{{ authStore.qqBusy ? '退出中…' : '退出' }}</button>
        </div>
        <button v-else-if="demoLoginEnabled" class="qq-login-button" type="button" :aria-label="demoText.login" @click="authStore.qqLogin()">
          <span>{{ demoText.login }}</span>
        </button>
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
    <div v-if="authStore.demoDialogOpen" class="demo-dialog-mask" @click.self="authStore.demoDialogOpen = false">
      <section class="card demo-dialog" role="dialog" aria-modal="true" aria-labelledby="demoLoginTitle">
        <h2 id="demoLoginTitle">演示登录</h2>
        <p class="section-note">使用演示账号登录后，即可投稿、点喜欢和点踩。</p>
        <form @submit.prevent="submitDemo">
          <label class="field"><span>邮箱</span><input v-model="demoEmail" type="email" autocomplete="username" required :disabled="authStore.qqBusy" placeholder="演示账号邮箱" /></label>
          <label class="field"><span>密码</span><input v-model="demoPassword" type="password" autocomplete="current-password" required :disabled="authStore.qqBusy" /></label>
          <p v-if="demoHint" class="form-hint is-error" role="alert">{{ demoHint }}</p>
          <div class="demo-dialog-actions">
            <button class="text-link" type="button" @click="authStore.demoDialogOpen = false">取消</button>
            <button class="primary-button" type="submit" :disabled="authStore.qqBusy">{{ authStore.qqBusy ? '正在登录…' : '登录' }}</button>
          </div>
        </form>
      </section>
    </div>
  </header>
</template>

<style scoped>
.demo-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 16px;
  background: #0a2b5766;
}
.demo-dialog {
  display: grid;
  gap: 12px;
  width: min(360px, 100%);
  padding: 24px;
}
.demo-dialog h2 {
  margin: 0;
  font-size: 20px;
}
.demo-dialog form {
  display: grid;
  gap: 12px;
}
.demo-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}
</style>
