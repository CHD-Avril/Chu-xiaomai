<script setup>
import { computed, ref, watch } from "vue";
import { useAuthStore } from "../stores/auth";
import qqLoginIcon from "../assets/qq-login-icon.png";

const auth = useAuthStore();
const avatarFailed = ref(false);
const nickname = computed(() => auth.qqUser?.nickname || "QQ 用户");
watch(() => auth.qqUser?.avatar, () => { avatarFailed.value = false; });
</script>

<template>
  <section class="card profile-panel" aria-labelledby="profile-title">
    <div class="section-head">
      <h1 id="profile-title">个人中心</h1>
      <span class="profile-status" :class="{ 'is-guest': !auth.isQqLoggedIn }">{{ auth.isQqLoggedIn ? 'QQ 已登录' : '游客模式' }}</span>
    </div>

    <div class="profile-summary">
      <div class="profile-avatar" aria-hidden="true">
        <img v-if="auth.isQqLoggedIn && auth.qqUser.avatar && !avatarFailed" :src="auth.qqUser.avatar" alt="" referrerpolicy="no-referrer" @error="avatarFailed = true" />
        <svg v-else viewBox="0 0 48 48" fill="none"><circle cx="24" cy="17" r="8" /><path d="M9 41v-3a15 15 0 0 1 30 0v3" /></svg>
      </div>
      <div class="profile-intro">
        <h2>{{ auth.isQqLoggedIn ? nickname : '欢迎来到点歌台' }}</h2>
        <p>{{ auth.isQqLoggedIn ? '用喜欢的音乐，留下你的校园声音。' : '登录 QQ，和大家一起分享想听的歌。' }}</p>
      </div>
    </div>

    <dl v-if="auth.isQqLoggedIn" class="profile-details">
      <div><dt>昵称</dt><dd>{{ nickname }}</dd></div>
      <div><dt>登录方式</dt><dd>QQ 登录<span v-if="auth.qqMode === 'mock'" class="profile-mock">本地模拟</span></dd></div>
      <div><dt>当前身份</dt><dd>已登录用户</dd></div>
    </dl>

    <div class="profile-note">
      <strong>{{ auth.isQqLoggedIn ? '参与点歌' : '游客仅可浏览' }}</strong>
      <p>{{ auth.isQqLoggedIn ? '征集开放期间可以投稿、点喜欢和点踩。退出后将恢复游客模式。' : '你可以查看榜单、往期歌单和公告；投稿、点喜欢和点踩需要先 QQ 登录。' }}</p>
    </div>

    <div class="profile-actions">
      <button v-if="!auth.isQqLoggedIn" class="primary-button" type="button" :disabled="auth.qqBusy" @click="auth.qqLogin()">
        <img :src="qqLoginIcon" width="16" height="16" alt="" aria-hidden="true" />QQ 登录
      </button>
      <router-link class="primary-button secondary-btn" to="/playlist">查看榜单 ↗</router-link>
      <button v-if="auth.isQqLoggedIn" class="text-link profile-logout" type="button" :disabled="auth.qqBusy" @click="auth.qqLogout()">{{ auth.qqBusy ? '正在退出…' : '退出登录' }}</button>
    </div>
  </section>
</template>

<style scoped>
.profile-panel { max-width: 720px; margin: 24px auto; }
.section-head { align-items: center; gap: 12px; }
h1 { margin: 0; font-size: 1.2rem; }
.profile-status { flex-shrink: 0; padding: 6px 10px; border-radius: 4px; background: var(--accent-dim); color: var(--accent); font-size: .75rem; }
.profile-status.is-guest { color: var(--yellow-ink); background: var(--yellow-bg); }
.profile-summary { display: flex; align-items: center; gap: 18px; padding: 20px 0 28px; }
.profile-avatar { display: grid; place-items: center; flex-shrink: 0; width: 76px; height: 76px; overflow: hidden; border: 1px solid var(--line); border-radius: 50%; background: var(--accent-dim); color: var(--accent); }
.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.profile-avatar svg { width: 44px; height: 44px; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.profile-intro { min-width: 0; }
.profile-intro h2 { margin: 0; font-size: 1.25rem; overflow-wrap: anywhere; }
.profile-intro p, .profile-note p { margin: 8px 0 0; color: var(--muted); font-size: .8125rem; line-height: 1.8; }
.profile-details { margin: 0 0 24px; border-top: 1px solid var(--line); }
.profile-details > div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--line); font-size: .875rem; }
.profile-details dt { color: var(--muted); }
.profile-details dd { margin: 0; overflow-wrap: anywhere; }
.profile-mock { display: inline-block; margin-left: 10px; color: var(--yellow-ink); font-size: .75rem; }
.profile-note { padding: 16px; border-left: 3px solid var(--yellow); background: var(--yellow-bg); font-size: .875rem; }
.profile-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.profile-logout { min-height: 44px; margin-left: auto; }
@media (max-width: 480px) {
  .profile-summary { gap: 14px; }
  .profile-avatar { width: 64px; height: 64px; }
  .profile-intro h2 { font-size: 1.1rem; }
}
</style>
