<script setup>
import { ref } from "vue";
import Icon from "./Icon.vue";
defineProps({ title: { type: String, required: true }, artist: { type: String, required: true } });
const expanded = ref(false);
</script>

<template>
  <button
    class="song-identity"
    :class="{ 'is-expanded': expanded }"
    type="button"
    :aria-expanded="expanded"
    :aria-label="`${expanded ? '收起' : '展开'}完整歌名和歌手：${title} / ${artist}`"
    @click="expanded = !expanded"
  >
    <span class="song-title">{{ title }}</span>
    <span class="song-artist">{{ artist }}</span>
    <span class="song-expand-icon" aria-hidden="true"><Icon name="chevron-down" :size="13" /></span>
  </button>
</template>