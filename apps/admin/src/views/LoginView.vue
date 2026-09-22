<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const authStore = useAuthStore();
const router = useRouter();

const email = ref("");
const password = ref("");
const hint = ref("");
const loading = ref(false);

async function handleLogin() {
  hint.value = "";
  loading.value = true;
  try {
    await authStore.login(email.value.trim(), password.value);
    router.push({ name: "dashboard" });
  } catch (error) {
    hint.value = error?.message || "登录失败，请重试。";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <span class="login-brand-mark" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </span>
        <strong>长大小麦君</strong>
      </div>
      <h1>运营管理台</h1>
      <p class="login-sub">长安大学广播台 · 歌单征集管理后台</p>

      <el-form @submit.prevent="handleLogin">
        <el-form-item>
          <el-input
            v-model="email"
            size="large"
            type="email"
            placeholder="管理员邮箱"
            autocomplete="username"
            clearable
          />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="password"
            size="large"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="handleLogin">
          登 录
        </el-button>
      </el-form>
      <p class="login-error">{{ hint }}</p>
    </div>
  </div>
</template>
