<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const emit = defineEmits(["close"]);
const authStore = useAuthStore();
const router = useRouter();

const email = ref("");
const password = ref("");
const hint = ref("");
const loading = ref(false);

async function handleSubmit() {
  hint.value = "";
  loading.value = true;
  try {
    await authStore.adminLogin(email.value.trim(), password.value);
    emit("close");
    router.push({ name: "admin" });
  } catch (error) {
    hint.value = error?.message || "登录失败，请重试。";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <div class="modal-header">
        <div>
          <p class="section-tag">Settings</p>
          <h2 id="settingsTitle">管理员登录</h2>
        </div>
        <button class="icon-button" type="button" aria-label="关闭管理员登录" @click="emit('close')">&times;</button>
      </div>
      <form class="admin-login-form" @submit.prevent="handleSubmit">
        <p class="modal-copy">仅限已授权管理员登录。账号由主管理员创建并授权。</p>
        <label class="field">
          <span>管理员邮箱</span>
          <input
            v-model="email"
            type="email"
            autocomplete="username"
            placeholder="请输入管理员邮箱"
            required
          />
        </label>
        <label class="field">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            required
          />
        </label>
        <button class="primary-button" type="submit" :disabled="loading">
          {{ loading ? "登录中..." : "登录管理后台" }}
        </button>
        <p class="form-hint admin-login-hint" :class="{ 'is-error': hint }">{{ hint }}</p>
      </form>
    </div>
  </div>
</template>
