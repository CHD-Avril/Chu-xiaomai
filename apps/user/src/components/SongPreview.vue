<script setup>
import { computed } from "vue";
import { useSongsStore } from "../stores/songs";
import SongCard from "./SongCard.vue";
const store = useSongsStore();
const songs = computed(() => [...store.songs].sort((a, b) => b.likesCount - a.likesCount || b.createdAtMs - a.createdAtMs).slice(0, 3));
</script>

<template>
  <section class="card song-preview" :aria-busy="store.isLoading">
    <div class="section-head">
      <div><h2>大家想听</h2><p class="section-note">{{ store.isLoading || store.errorMessage ? '本期人气投稿' : '本期 ' + store.songs.length + ' 首 · 人气前三' }}</p></div>
      <router-link class="text-link" to="/playlist">完整榜单 <span aria-hidden="true">↗</span></router-link>
    </div>
    <p v-if="store.voteError" class="form-hint is-error" role="alert">{{ store.voteError }}</p>
    <div v-if="store.isLoading" class="empty-inline" role="status">正在接收本期歌单…</div>
    <div v-else-if="store.errorMessage" class="empty-inline">歌单暂时无法读取，重试后再来看看。</div>
    <div v-else-if="songs.length" class="songs-list">
      <SongCard v-for="(song, index) in songs" :key="song.id" :song="song" :rank="index + 1" featured />
    </div>
    <div v-else class="empty-state"><h3 class="empty-title">第一首歌，等你来选</h3><p class="empty-copy">征集开放后，提交你想在校园里听到的歌。</p></div>
  </section>
</template>
