<script setup>
import { computed } from "vue";
import { useSongsStore } from "../stores/songs";
import { useDraftStore } from "../stores/draft";
import { usePeriodStatus } from "../composables/usePeriodStatus";
import { useRouter } from "vue-router";
import ConnectionNotice from "./ConnectionNotice.vue";

const songsStore = useSongsStore();
const { period, status: periodState } = usePeriodStatus();
const router = useRouter();
const draftStore = useDraftStore();
const draft = draftStore.draft;

const canMutate = computed(() => songsStore.canMutate);

async function handleSubmit() {
  const ok = await songsStore.submitSong(draft.title, draft.artist);
  if (ok) draftStore.clear();
}

function viewSubmission() {
  const submission = songsStore.lastSubmission;
  if (!submission) return;
  router.push({ name: "playlist", query: {
    ...(submission.songId ? { song: submission.songId } : { songTitle: submission.title, songArtist: submission.artist }),
    period: submission.periodId,
  } });
}
</script>

<template>
  <section class="card form-panel" id="submit" :aria-busy="songsStore.isLoading || songsStore.isSubmitting">
    <div class="section-head">
      <div>
        <h2>今天，你想听什么？</h2>
      </div>
      <span class="no-login-note">{{ period?.isTest ? '测试账号已登录' : '无需登录' }}</span>
    </div>

    <div class="submission-period-card">
      <span class="period-state-chip" :class="periodState.className">{{ periodState.label }}</span>
      <div>
        <strong>{{ period?.title ?? "校园点歌征集" }}</strong>
        <p>{{ periodState.copy }}</p>
      </div>
    </div>

    <ConnectionNotice />
    <form class="song-form" @submit.prevent="handleSubmit">
      <label class="field">
        <span>歌曲标题</span>
        <input
          v-model="draft.title"
          type="text"
          maxlength="80"
          placeholder="例如：晴天"
          :disabled="songsStore.isSubmitting"
          required
        />
      </label>
      <label class="field">
        <span>歌手名称</span>
        <input
          v-model="draft.artist"
          type="text"
          maxlength="80"
          placeholder="填写歌手或乐队名称"
          :disabled="songsStore.isSubmitting"
          required
        />
      </label>
      <button class="primary-button" type="submit" :disabled="songsStore.isSubmitting || !canMutate">
        {{ songsStore.isSubmitting ? "正在投递…" : "提交这首歌 ↗" }}
      </button>
    </form>
    <p
      class="form-hint"
      :class="{ 'is-error': songsStore.formHintType === 'error', 'is-success': songsStore.formHintType === 'success' }"
      role="status"
    >
      {{ songsStore.formHint || (draftStore.hasDraft ? (draftStore.storageAvailable ? "草稿已暂存在当前标签页，切换页面或刷新后可继续填写。" : "浏览器未允许保存草稿，刷新或关闭页面后可能丢失。") : "提交后会出现在榜单中，同一首歌请勿重复投稿。") }}
    </p>
    <button v-if="draftStore.hasDraft" class="text-link" type="button" :disabled="songsStore.isSubmitting" @click="draftStore.clear()">清空草稿</button>
    <button v-if="songsStore.formHintType === 'success' && songsStore.lastSubmission" class="text-link" type="button" @click="viewSubmission">查看刚提交的歌曲 ↗</button>
    <router-link class="text-link participation-link" :to="{ name: 'home', hash: '#participationTitle' }">查看参与说明 ↓</router-link>
  </section>
</template>
