<script setup>
import { useSongsStore } from "../stores/songs";
import { computed, ref, watch } from "vue";

const songsStore = useSongsStore();
const index = ref(0);
const song = computed(() => songsStore.dailyRecommendations[index.value]);
watch(() => songsStore.dailyRecommendations.map(item => item.id).join(','), () => { index.value = 0; });
function next() { index.value = (index.value + 1) % songsStore.dailyRecommendations.length; }
</script>

<template>
  <aside v-if="song" class="recommendations-panel" aria-label="每日推荐">
    <span class="recommendation-label" title="每天随机抽取至多五首，不按喜欢数量排序">今日随机</span>
      <router-link
        :key="song.id"
        class="recommendation-card"
        :to="{ name: 'playlist', query: { song: song.id } }"
        :aria-label="`在榜单中查看并支持 ${song.title} / ${song.artist}`"
      >
        <strong :title="song.title">{{ song.title }}</strong>
        <p :title="song.artist">{{ song.artist }}</p>
        <span class="recommendation-action" aria-hidden="true">↗</span>
      </router-link>
    <button v-if="songsStore.dailyRecommendations.length > 1" class="text-link recommendation-next" type="button" @click="next">换一首 <span class="recommendation-position">{{ index + 1 }}/{{ songsStore.dailyRecommendations.length }}</span></button>
  </aside>
</template>
