<script setup>
import { computed } from "vue";
import { useSongsStore } from "../stores/songs";
const store = useSongsStore();
const likes = computed(() => store.songs.reduce((sum, song) => sum + (song.likesCount || 0), 0));
</script>

<template>
  <section class="stats-row" aria-label="本期参与情况">
    <div><strong>{{ store.isLoading || store.errorMessage ? '—' : store.songs.length }}</strong><span>首歌曲已投递</span></div>
    <div><strong>{{ store.isLoading || store.errorMessage ? '—' : likes }}</strong><span>次喜欢已收到</span></div>
    <router-link class="text-link" to="/playlist">去为喜欢的歌投票 ↗</router-link>
  </section>
</template>
