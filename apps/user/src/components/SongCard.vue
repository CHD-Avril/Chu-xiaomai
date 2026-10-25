<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useSongsStore } from "../stores/songs";
import { usePeriodStatus } from "../composables/usePeriodStatus";
import { useAuthStore } from "../stores/auth";
import SongIdentity from "./SongIdentity.vue";

const props = defineProps({
  song: { type: Object, required: true },
  rank: { type: Number, required: true },
  highlighted: { type: Boolean, default: false },
  featured: { type: Boolean, default: false },
});

const songsStore = useSongsStore();
const { status } = usePeriodStatus();
const auth = useAuthStore();
const showReason = ref(false);
const reason = ref("");
const reasonInput = ref(null);

const isLiked = computed(() => songsStore.likedSongIds.has(props.song.id));
const isDisliked = computed(() => songsStore.dislikedSongIds.has(props.song.id));
const canMutate = computed(() => songsStore.canVote);
watch(canMutate, (allowed) => { if (!allowed) { showReason.value = false; reason.value = ""; } });
const disabledReason = computed(() => {
  if (!auth.isQqLoggedIn) return "游客模式仅可浏览，请先 QQ 登录再投票。";
  if (auth.qqAccount?.moderation?.banned || auth.qqAccount?.moderation?.vote_restricted) return "该账号暂不能投票，请到个人中心查看处理详情。";
  if (props.song.isLocked) return "这首歌正在审核，暂时无法投票。";
  if (songsStore.personalVotesAccount !== auth.qqUser.openid) return "正在确认你的投票记录；读取失败时请刷新榜单。";
  if (!canMutate.value) return status.value.copy;
  if (songsStore.likingSongId || songsStore.dislikingSongId) return "正在保存投票，请稍候。";
  return "";
});

async function onLike() {
  await songsStore.toggleLikeSong(props.song);
}

async function onDislike() {
  if (!canMutate.value || props.song.isLocked) return;
  if (isDisliked.value) {
    await songsStore.toggleDislikeSong(props.song, "");
    return;
  }
  showReason.value = true;
  await nextTick();
  reasonInput.value?.focus();
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
  <article class="song-card" :class="{ 'is-locked': song.isLocked, 'is-highlighted': highlighted, 'is-top-three': featured }" :data-song-id="song.id" tabindex="-1">
    <div class="song-index">{{ String(rank).padStart(2, "0") }}</div>
    <div class="song-info">
      <SongIdentity :title="song.title" :artist="song.artist" />
      <div v-if="song.isLocked || highlighted" class="song-meta">
        <span v-if="song.isLocked" class="lock-chip">审核锁定</span>
        <span v-if="highlighted" class="located-chip">已定位</span>
      </div>
    </div>
    <div class="song-side">
      <div class="vote-buttons">
        <button
          class="vote-button vote-like"
          :class="{ 'is-liked': isLiked }"
          type="button"
          :disabled="!canMutate || song.isLocked || !!songsStore.likingSongId || !!songsStore.dislikingSongId"
          :aria-label="`${isLiked ? '取消喜欢' : '喜欢'} ${song.title}`"
          :aria-pressed="isLiked"
          :title="disabledReason || (isLiked ? '取消喜欢' : '喜欢这首歌')"
          @click="onLike"
        >
          <span aria-hidden="true">{{ isLiked ? '♥' : '♡' }}</span>
          <span>{{ isLiked ? '已喜欢' : '喜欢' }}</span>
          <span>{{ song.likesCount }}</span>
        </button>
        <button
          class="vote-button vote-dislike"
          :class="{ 'is-disliked': isDisliked }"
          type="button"
          :disabled="!canMutate || song.isLocked || !!songsStore.dislikingSongId || !!songsStore.likingSongId"
          :aria-label="`${isDisliked ? '取消点踩' : '点踩'} ${song.title}`"
          :aria-pressed="isDisliked"
          :aria-expanded="showReason"
          :title="disabledReason || (isDisliked ? '取消点踩' : '点踩并填写理由')"
          @click="onDislike"
        >
          <span>{{ isDisliked ? '已点踩' : '点踩' }}</span>
          <span v-if="song.dislikesCount">{{ song.dislikesCount }}</span>
        </button>
      </div>
      <form v-if="showReason" class="dislike-reason" @submit.prevent="confirmDislike">
        <p class="dislike-explanation">点踩需填写理由，供管理员审核；会取消你对这首歌的喜欢。</p>
        <input
          ref="reasonInput"
          v-model="reason"
          type="text"
          maxlength="20"
          placeholder="点踩理由（≤20 字）"
          aria-label="点踩理由"
          required
        />
        <button class="primary-button compact-button" type="submit" :disabled="!canMutate || !!songsStore.dislikingSongId || !!songsStore.likingSongId">确认</button>
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
  height: 44px;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 12px;
  font-size: 0.875rem;
  color: var(--text);
  background: var(--bg);
}

.dislike-reason .primary-button { min-height: 44px; }

@media (max-width: 560px) {
  .song-side {
    align-items: stretch;
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
