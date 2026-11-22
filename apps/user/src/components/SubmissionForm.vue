<script setup>
import { computed, ref, watch } from "vue";
import { useSongsStore } from "../stores/songs";
import { useDraftStore } from "../stores/draft";
import { usePeriodStatus } from "../composables/usePeriodStatus";
import { useAuthStore } from "../stores/auth";
import { useRouter } from "vue-router";
import ConnectionNotice from "./ConnectionNotice.vue";
import Icon from "./Icon.vue";

const songs = useSongsStore(), auth = useAuthStore(), drafts = useDraftStore(), router = useRouter();
const { period, status } = usePeriodStatus();
const keyword = ref("");
const page = ref(1);
const filtered = computed(() => songs.catalogSongs.filter(song => (song.title + " " + song.artist).toLowerCase().includes(keyword.value.trim().toLowerCase())));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 8)));
const visible = computed(() => filtered.value.slice((page.value - 1) * 8, page.value * 8));
const selected = computed(() => songs.catalogSongs.find(song => song.id === drafts.draft.catalogId));
watch(keyword, () => { page.value = 1; });
watch(pageCount, n => { page.value = Math.min(page.value, n); });
watch(() => period.value?.id, () => { drafts.clear(); page.value = 1; });
function select(song) { Object.assign(drafts.draft, { catalogId: song.id, title: song.title, artist: song.artist }); }
function requested(song) { return songs.songs.find(item => item.titleLower === song.title.trim().toLowerCase() && item.artistLower === song.artist.trim().toLowerCase()); }
function locate(id) { router.push({ name: "playlist", query: { song: id, period: period.value?.id } }); }
async function submit() { if (selected.value && await songs.submitSong(selected.value.id)) drafts.clear(); }
</script>

<template>
  <section class="card form-panel" id="submit" :aria-busy="songs.isLoading || songs.isSubmitting">
    <div class="section-head">
      <div>
        <p class="section-tag">Request a song</p>
        <h2>今天，你想听什么？</h2>
      </div>
      <span class="no-login-note">
        <Icon :name="auth.isQqLoggedIn ? 'check' : 'user'" :size="13" />
        {{ auth.isQqLoggedIn ? 'QQ 已登录' : 'QQ 登录后可投稿' }}
      </span>
    </div>

    <div class="submission-period-card">
      <span class="period-state-chip" :class="status.className">{{ status.label }}</span>
      <div>
        <strong>{{ period?.title || '校园点歌征集' }}</strong>
        <p>{{ status.copy }}</p>
      </div>
    </div>

    <ConnectionNotice />
    <p class="section-note">从广播台确认音源的曲库中选择，本期节目选曲范围内的歌曲会显示在这里。</p>

    <label class="field">
      <span>搜索歌名或歌手</span>
      <div class="input-shell">
        <Icon name="search" :size="16" />
        <input v-model="keyword" name="catalog-keyword" type="search" maxlength="80" placeholder="搜索可播歌曲" :disabled="songs.isSubmitting" />
      </div>
    </label>

    <div v-if="songs.catalogError" class="connection-notice" role="alert">
      <strong>可播曲库暂时无法读取</strong>
      <p>{{ songs.catalogError }}</p>
      <button class="text-link" type="button" @click="songs.refresh()">重新读取 ↻</button>
    </div>
    <p v-else-if="songs.isLoading" class="empty-inline" role="status">正在读取曲库…</p>
    <template v-else>
      <div class="catalog-results" aria-label="可播歌曲">
        <article v-for="song in visible" :key="song.id" class="catalog-row" :class="{ selected: selected?.id === song.id }">
          <div class="catalog-main">
            <span class="catalog-disc" aria-hidden="true"><Icon name="music" :size="14" /></span>
            <div>
              <strong>{{ song.title }}</strong>
              <p>
                {{ song.artist }}<span v-if="song.duration_seconds"> · {{ Math.floor(song.duration_seconds / 60) }}:{{ String(song.duration_seconds % 60).padStart(2, '0') }}</span>
              </p>
            </div>
          </div>
          <button v-if="requested(song)" class="text-link" type="button" @click="locate(requested(song).id)">已有人点 · 去支持</button>
          <button
            v-else
            class="primary-button compact-button"
            :class="{ 'secondary-btn': selected?.id === song.id }"
            type="button"
            :disabled="songs.isSubmitting || !auth.isQqLoggedIn"
            :aria-pressed="selected?.id === song.id"
            @click="select(song)"
          >
            <Icon v-if="selected?.id === song.id" name="check" :size="13" />
            {{ selected?.id === song.id ? '已选择' : '选这首' }}
          </button>
        </article>
      </div>
      <p v-if="!filtered.length" class="section-note">{{ keyword ? '没有找到本期可点的歌曲，请换个关键词。' : '广播台正在准备本期曲库，暂时没有可点歌曲。' }}</p>
      <div v-if="pageCount > 1" class="catalog-pager">
        <button class="text-link" type="button" :disabled="page === 1" @click="page--">上一页</button>
        <span>{{ page }} / {{ pageCount }}</span>
        <button class="text-link" type="button" :disabled="page === pageCount" @click="page++">下一页</button>
      </div>
    </template>

    <form class="song-form" @submit.prevent="submit">
      <p v-if="selected">已选：{{ selected.title }} · {{ selected.artist }}</p>
      <p v-else-if="drafts.draft.catalogId">原选择已不在本期可点范围，请重新选择。</p>
      <button class="primary-button" type="submit" :disabled="!songs.canSubmit || !selected || !!songs.catalogError || songs.isSubmitting">
        {{ !auth.isQqLoggedIn ? 'QQ 登录后可投稿' : songs.isSubmitting ? '正在投递…' : '提交这首歌' }}
        <Icon v-if="auth.isQqLoggedIn && !songs.isSubmitting" name="arrow-up-right" :size="16" />
      </button>
    </form>

    <p class="form-hint" :class="{ 'is-error': songs.formHintType === 'error', 'is-success': songs.formHintType === 'success' }" role="status">{{ songs.formHint }}</p>
    <button v-if="songs.formHintType === 'success' && songs.lastSubmission?.songId" class="text-link" type="button" @click="locate(songs.lastSubmission.songId)">查看刚提交的歌曲 <Icon name="arrow-up-right" :size="14" /></button>
    <button v-if="drafts.hasDraft" class="text-link" type="button" :disabled="songs.isSubmitting" @click="drafts.clear()">清空选择</button>
    <router-link class="text-link participation-link" :to="{ name: 'home', hash: '#participationTitle' }">查看参与说明 ↓</router-link>
  </section>
</template>