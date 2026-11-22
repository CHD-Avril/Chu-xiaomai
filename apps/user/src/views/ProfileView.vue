<script setup>
import { computed, ref, watch } from "vue";
import { useAuthStore } from "../stores/auth";
import qqLoginIcon from "../assets/qq-login-icon.png";
import { ACCOUNT_ACTION_LABELS, TIMED_ACCOUNT_ACTIONS } from "../../../shared/accountModeration";
import { formatDateTime } from "../utils/format";

const auth = useAuthStore();
const avatarFailed = ref(false);
const readingNotice = ref(false), noticeError = ref("");
const nickname = computed(() => auth.qqUser?.nickname || "QQ 用户");
watch(() => auth.qqUser?.avatar, () => { avatarFailed.value = false; });
watch(() => auth.qqUser?.openid, () => { noticeError.value = ""; if (auth.isQqLoggedIn) auth.refreshQqAccount(); }, { immediate: true });
const moderation = computed(() => auth.qqAccount?.moderation);
const restricted = computed(() => moderation.value?.banned || moderation.value?.vote_restricted || moderation.value?.submission_restricted);
const expiry = value => value ? formatDateTime(new Date(value).getTime()) : "长期，直至管理员解除";
async function markRead(id = null) {
  if (readingNotice.value) return;
  readingNotice.value = true; noticeError.value = "";
  try { await auth.readQqNotice(id); } catch (error) { noticeError.value = error.message; }
  finally { readingNotice.value = false; }
}
</script>

<template>
  <section class="card profile-panel" aria-labelledby="profile-title">
    <div class="section-head">
      <div>
        <p class="section-tag">Your account</p>
        <h1 id="profile-title">个人中心</h1>
      </div>
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
      <div v-if="auth.qqAccount?.id"><dt>站内账号</dt><dd class="site-account-id">{{ auth.qqAccount.id }}</dd></div>
    </dl>

    <div class="profile-note">
      <strong>{{ restricted ? '账号参与权限受限' : auth.isQqLoggedIn ? '参与点歌' : '游客仅可浏览' }}</strong>
      <template v-if="restricted">
        <p v-if="moderation.banned">账号封禁中 · {{ expiry(moderation.ban_until) }}。期间不能投稿或投票，仍可浏览歌单和查看通知。</p>
        <p v-if="moderation.vote_restricted">投票权限受限（包括取消投票） · {{ expiry(moderation.vote_until) }}。</p>
        <p v-if="moderation.submission_restricted">投稿权限受限 · {{ expiry(moderation.submission_until) }}。</p>
      </template>
      <p v-else>{{ auth.isQqLoggedIn ? '征集开放期间可以投稿、点喜欢和点踩。退出后将恢复游客模式。' : '你可以查看榜单、往期歌单和公告；投稿、点喜欢和点踩需要先 QQ 登录。' }}</p>
    </div>

    <section v-if="auth.isQqLoggedIn" class="account-notices" aria-labelledby="account-notices-title">
      <div class="section-head"><h2 id="account-notices-title">站内通知<span v-if="auth.qqAccount?.unread_count"> · {{ auth.qqAccount.unread_count }} 条未读</span></h2><button class="text-link" type="button" :disabled="auth.qqAccountLoading || readingNotice" @click="auth.refreshQqAccount()">刷新通知</button></div>
      <p v-if="auth.qqAccountError || noticeError" class="form-hint is-error" role="alert">{{ auth.qqAccountError || noticeError }}</p>
      <p v-if="auth.qqAccountLoading && !auth.qqAccount" class="section-note" role="status">正在读取账号状态和通知…</p>
      <template v-if="auth.qqAccount">
        <p v-if="!auth.qqAccount.notices?.length" class="section-note">暂无站内通知。</p>
        <article v-for="notice in auth.qqAccount.notices" :key="notice.id" class="account-notice" :class="{ 'is-unread': !notice.is_read }">
          <div class="notice-heading"><strong>{{ ACCOUNT_ACTION_LABELS[notice.action] || '账号处理通知' }}</strong><span v-if="!notice.is_read" class="unread-label">未读</span><time>{{ formatDateTime(new Date(notice.created_at).getTime()) }}</time></div>
          <p class="notice-reason">{{ notice.reason }}</p>
          <p v-if="TIMED_ACCOUNT_ACTIONS.includes(notice.action)" class="section-note">处理期限：{{ expiry(notice.expires_at) }}</p>
          <button v-if="!notice.is_read" class="text-link" type="button" :disabled="readingNotice" @click="markRead(notice.id)">标为已读</button>
        </article>
        <button v-if="auth.qqAccount.unread_count" class="text-link" type="button" :disabled="readingNotice" @click="markRead()">全部标为已读</button>
        <p v-if="auth.qqAccount.notices?.length === 50" class="section-note">当前展示最近 50 条通知。</p>
      </template>
    </section>

    <div class="profile-actions">
      <button v-if="!auth.isQqLoggedIn" class="primary-button" type="button" :disabled="auth.qqBusy" @click="auth.qqLogin()">
        <img :src="qqLoginIcon" width="16" height="16" alt="" aria-hidden="true" />QQ 登录
      </button>
      <router-link class="primary-button secondary-btn" to="/playlist">查看榜单 ↗</router-link>
      <button v-if="auth.isQqLoggedIn" class="text-link profile-logout" type="button" :disabled="auth.qqBusy" @click="auth.qqLogout()">{{ auth.qqBusy ? '正在退出…' : '退出登录' }}</button>
    </div>
  </section>
</template>

