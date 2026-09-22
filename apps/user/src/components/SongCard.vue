<script setup>
import { computed, ref } from "vue";
import { useSongsStore } from "../stores/songs";
import { formatDateTime } from "../utils/format";

const props = defineProps({
  song: { type: Object, required: true },
  rank: { type: Number, required: true },
});

const songsStore = useSongsStore();
const showReason = ref(false);
const reason = ref("");

const isLiked = computed(() => songsStore.likedSongIds.has(props.song.id));
const isDisliked = computed(() => songsStore.dislikedSongIds.has(props.song.id));
const canMutate = computed(() => songsStore.canMutate);

async function onLike() {
  await songsStore.toggleLikeSong(props.song);
}

async function onDislike() {
  if (isDisliked.value) {
    await songsStore.toggleDislikeSong(props.song, "");
    return;
  }
  showReason.value = true;
}

async function confirmDislike() {
  const ok = await songsStore.toggleDislikeSong(props.song, reason.value);
  if (ok) {
    showReason.value = false;
    reason.value = "";
  }
}
</script>

<template>
  <article class="song-card" :class="{ 'is-locked': song.isLocked }">
    <div class="song-index">{{ String(rank).padStart(2, "0") }}</div>
    <div class="song-info">
      <div class="song-title" :title="song.title">{{ song.title }}</div>
      <div class="song-artist" :title="song.artist">{{ song.artist }}</div>
      <div class="song-meta">
        <span>{{ formatDateTime(song.createdAtMs) }}</span>
        <span v-if="song.isLocked" class="lock-chip">审核锁定</span>
      </div>
    </div>
    <div class="song-side">
      <div class="vote-buttons">
        <button
          class="vote-button"
          :class="{ 'is-liked': isLiked }"
          type="button"
          :disabled="!canMutate || songsStore.likingSongId === song.id"
          @click="onLike"
        >
          <span aria-hidden="true">♡</span>
          <span>{{ song.likesCount }}</span>
        </button>
        <button
          class="vote-button"
          :class="{ 'is-disliked': isDisliked }"
          type="button"
          :disabled="!canMutate || songsStore.dislikingSongId === song.id"
          @click="onDislike"
        >
          <span aria-hidden="true">♧</span>
          <span>{{ song.dislikesCount }}</span>
        </button>
      </div>
      <form v-if="showReason" class="dislike-reason" @submit.prevent="confirmDislike">
        <input
          v-model="reason"
          type="text"
          maxlength="20"
          placeholder="点踩理由（≤20 字）"
          aria-label="点踩理由"
        />
        <button class="primary-button compact-button" type="submit">确认</button>
        <button class="primary-button secondary-btn compact-button" type="button" @click="showReason = false">取消</button>
      </form>
    </div>
  </article>
</template>

<style scoped>
.song-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.dislike-reason {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.dislike-reason input {
  width: 150px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0 12px;
  font-size: 0.8rem;
}

@media (max-width: 560px) {
  .song-side {
    align-items: stretch;
    width: 100%;
  }

  .vote-buttons {
    justify-content: flex-end;
  }

  .dislike-reason {
    justify-content: flex-start;
  }

  .dislike-reason input {
    flex: 1;
    min-width: 0;
  }
}
</style>
