<script setup>
import { computed, ref, watch } from "vue";
import { useAuthStore } from "../stores/auth";
import { qqAuthBase, qqEnabled, qqErrorMessages } from "../services/qq";
import { useQqLoginModal } from "../composables/useQqLoginModal";
import { useDialog } from "../composables/useDialog";
import Icon from "./Icon.vue";
import qqLoginIcon from "../assets/qq-login-icon.png";

const auth = useAuthStore();
const { qqLoginOpen, closeQqLogin } = useQqLoginModal();
const dialog = useDialog(() => qqLoginOpen.value, close);
const accounts = ref([]);
const busyAccount = ref(-1);
const error = ref("");
let profileRequest = 0;

const busy = computed(() => busyAccount.value >= 0);

async function loadMockAccounts() {
  if (!qqEnabled || auth.qqMode === "real") return;
  const request = ++profileRequest;
  try {
    const response = await fetch(`${qqAuthBase}/mock/profiles`, {
      credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;
    const data = await response.json();
    if (request === profileRequest && Array.isArray(data.accounts)) accounts.value = data.accounts;
  } catch { /* Real deployments do not expose mock accounts. */ }
}

watch(qqLoginOpen, (open) => {
  if (!open) { profileRequest += 1; return; }
  error.value = "";
  busyAccount.value = -1;
  accounts.value = [];
  loadMockAccounts();
});

function close() {
  if (busy.value) return;
  closeQqLogin();
}

function startRealLogin() {
  if (!qqEnabled || busy.value) {
    error.value = qqEnabled ? "" : "QQ 登录暂未开放，请稍后再试。";
    return;
  }
  error.value = "";
  auth.qqLogin();
  if (auth.qqError) error.value = auth.qqError;
}

async function mockLogin(index) {
  if (busy.value) return;
  busyAccount.value = index;
  error.value = "";
  try {
    const response = await fetch(`${qqAuthBase}/mock/login`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: index }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.user) throw new Error(qqErrorMessages[data.error] || "登录未完成，请重试。");
    await auth.restoreQqUser();
    if (!auth.isQqLoggedIn) throw new Error("登录状态确认失败，请重试。");
    closeQqLogin();
  } catch (loginError) {
    error.value = loginError?.name === "TimeoutError"
      ? "登录服务响应超时，请重试。"
      : loginError?.message || "登录未完成，请重试。";
  } finally {
    busyAccount.value = -1;
  }
}
</script>

<template>
  <div v-if="qqLoginOpen" class="modal-overlay qq-login-overlay" @click.self="close">
    <div ref="dialog" class="qq-login-modal" role="dialog" aria-modal="true" aria-labelledby="qqLoginTitle" tabindex="-1">
      <div class="modal-header">
        <div>
          <p class="section-tag">Sign in</p>
          <h2 id="qqLoginTitle">QQ 登录</h2>
        </div>
        <button class="icon-button" type="button" aria-label="关闭 QQ 登录" :disabled="busy" @click="close">
          <Icon name="close" :size="16" />
        </button>
      </div>

      <p class="modal-copy">登录后可投稿、点喜欢和点踩，并保留本期参与记录。游客浏览不受影响。</p>

      <div v-if="accounts.length" class="login-accounts">
        <p class="login-accounts-label">本地模拟账号</p>
        <button
          v-for="(account, index) in accounts"
          :key="account.nickname"
          class="login-account"
          type="button"
          :disabled="busy"
          @click="mockLogin(index)"
        >
          <span class="login-account-avatar" aria-hidden="true">{{ account.nickname.slice(0, 1) }}</span>
          <span class="login-account-text">
            <strong>{{ account.nickname }}</strong>
            <small>本地模拟登录</small>
          </span>
          <span v-if="busyAccount === index" class="login-account-state">登录中…</span>
          <Icon v-else name="arrow-right" :size="15" />
        </button>
        <p class="section-note">模拟账号仅用于本地演示，不会写入正式数据。</p>
      </div>

      <div v-else class="login-real">
        <button class="primary-button login-real-button" type="button" :disabled="busy || !qqEnabled" @click="startRealLogin">
          <img :src="qqLoginIcon" width="16" height="16" alt="" aria-hidden="true" />前往 QQ 授权
        </button>
        <p v-if="qqEnabled" class="section-note">QQ 授权将在跳转页面完成，完成后回到本站。</p>
        <p v-else class="section-note">QQ 登录尚未配置，请联系站点管理员。</p>
      </div>

      <p v-if="error" class="form-hint is-error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>