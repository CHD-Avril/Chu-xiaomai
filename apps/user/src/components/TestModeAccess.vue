<script setup>
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";
import { usePeriodStore } from "../stores/period";
import { useSongsStore } from "../stores/songs";
const auth = useAuthStore(), periods = usePeriodStore(), songs = useSongsStore();
const email = ref(""), password = ref(""), busy = ref(false), hint = ref("");
async function login() {
  if (busy.value) return;
  busy.value = true; hint.value = "";
  try {
    await auth.testLogin(email.value, password.value);
    password.value = "";
    await songs.refresh();
  } catch (error) { hint.value = error?.message || "登录失败，请稍后重试。"; }
  finally { busy.value = false; }
}
async function logout() {
  busy.value = true; hint.value = "";
  songs.resetForNoPeriod();
  try { await auth.testLogout(); }
  catch (error) { hint.value = error.message; }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="card test-mode-access" aria-labelledby="testModeTitle" :aria-busy="busy">
    <div class="test-mode-heading"><span class="test-mode-badge">测试期</span><h2 id="testModeTitle">{{ periods.currentPeriod?.title }}</h2></div>
    <template v-if="auth.isTester">
      <p>已登录测试账号：{{ auth.testUser?.email }}。本期仅向授权测试账号开放。</p>
      <button class="text-link" type="button" :disabled="busy" @click="logout">退出测试账号</button>
    </template>
    <template v-else>
      <p>当前征集期处于测试模式，请使用运营人员授权的测试账号登录后查看歌单、投稿和投票。</p>
      <form class="test-login-form" @submit.prevent="login">
        <label class="field"><span>测试账号邮箱</span><input v-model="email" type="email" autocomplete="username" required :disabled="busy" placeholder="运营人员提供的账号邮箱" /></label>
        <label class="field"><span>密码</span><input v-model="password" type="password" autocomplete="current-password" required :disabled="busy" /></label>
        <button class="primary-button" type="submit" :disabled="busy">{{ busy ? '正在登录…' : '登录测试账号' }}</button>
      </form>
      <p class="section-note">没有测试账号？请联系运营人员。正常征集期仍可免登录参与。</p>
    </template>
    <p v-if="hint" class="form-hint is-error" role="alert">{{ hint }}</p>
    <button v-if="songs.errorMessage || songs.refreshError" class="text-link" type="button" :disabled="busy || songs.isRefreshing" @click="songs.refresh()">重新验证并读取 ↻</button>
  </section>
</template>
