<script setup>
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";
import { useSongsStore } from "../stores/songs";
const auth = useAuthStore();
const songs = useSongsStore();
const retrying = ref(false);
async function retry() {
  if (retrying.value) return;
  retrying.value = true;
  try {
    if (auth.initIdentity()) await songs.refresh({ background: true });
  } finally { retrying.value = false; }
}
</script>

<template>
  <div v-if="auth.identityError" class="notice identity-notice" role="status">
    <strong>目前仅可浏览。</strong> {{ auth.identityError }}
    <button class="text-link" type="button" :disabled="retrying || songs.isRefreshing" @click="retry">{{ retrying ? '正在尝试…' : '重新开启投稿和投票' }}</button>
  </div>
</template>
