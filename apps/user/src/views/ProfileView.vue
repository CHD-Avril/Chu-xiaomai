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
.site-account-id { font-size: .75rem; overflow-wrap: anywhere; }
.account-notices { margin-top: 28px; }
.account-notices h2 { font-size: 1rem; }
.account-notices h2 span { font-size: .75rem; font-weight: 400; color: var(--muted); }
.account-notice { padding: 16px 0; border-bottom: 1px solid var(--line); }
.account-notice.is-unread { border-left: 3px solid var(--yellow); padding-left: 12px; }
.notice-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: .875rem; }
.notice-heading time { margin-left: auto; color: var(--muted); font-size: .75rem; }
.unread-label { color: var(--accent); font-size: .75rem; }
.notice-reason { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; font-size: .875rem; }
@media (max-width: 480px) {
  .profile-summary { gap: 14px; }
  .profile-avatar { width: 64px; height: 64px; }
  .profile-intro h2 { font-size: 1.1rem; }
}
</style>
