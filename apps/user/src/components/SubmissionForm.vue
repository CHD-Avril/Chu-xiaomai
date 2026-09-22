<script setup>
import { computed, ref } from "vue";
import { useSongsStore } from "../stores/songs";
import { usePeriodStore } from "../stores/period";
import { formatPeriodRange } from "../utils/format";

const songsStore = useSongsStore();
const periodStore = usePeriodStore();
const title = ref("");
const artist = ref("");

const period = computed(() => periodStore.currentPeriod);
const canMutate = computed(() => songsStore.canMutate);

const periodState = computed(() => {
  const item = period.value;
  if (!item) return { label: "暂无征集期", className: "is-missing", copy: "管理员设置征集期后即可投稿。" };
  const now = Date.now();
  if (now < item.startsAt) return { label: "未开始", className: "is-pending", copy: `征集将于 ${formatPeriodRange(item)} 开始。` };
  if (now > item.endsAt) return { label: "已结束", className: "is-closed", copy: "本期征集已结束，感谢参与！" };
  return { label: "开放中", className: "is-open", copy: formatPeriodRange(item) };
});

async function handleSubmit() {
  const ok = await songsStore.submitSong(title.value, artist.value);
  if (ok) {
    title.value = "";
    artist.value = "";
  }
}
</script>

<template>
  <section class="card form-panel" id="submit">
    <div class="section-head">
      <div>
        <p class="section-tag">Submit</p>
        <h2>提交你的歌单</h2>
      </div>
    </div>

    <div class="submission-period-card">
      <span class="period-state-chip" :class="periodState.className">{{ periodState.label }}</span>
      <div>
        <strong>{{ period?.title ?? "正在读取征集期" }}</strong>
        <p>{{ periodState.copy }}</p>
      </div>
    </div>

    <form class="song-form" @submit.prevent="handleSubmit">
      <label class="field">
        <span>歌曲标题</span>
        <input
          v-model="title"
          type="text"
          maxlength="80"
          placeholder="给你的歌单起一个名字吧"
          required
        />
      </label>
      <label class="field">
        <span>歌手名称</span>
        <input
          v-model="artist"
          type="text"
          maxlength="80"
          placeholder="填写歌手或乐队名称"
          required
        />
      </label>
      <button class="primary-button" type="submit" :disabled="songsStore.isSubmitting || !canMutate">
        {{ songsStore.isSubmitting ? "提交中..." : "✈ 提交歌单" }}
      </button>
    </form>
    <p
      class="form-hint"
      :class="{ 'is-error': songsStore.formHint && !canMutate, 'is-success': songsStore.formHint && canMutate }"
    >
      {{ songsStore.formHint || "提交后会出现在榜单中，同一首歌请勿重复投稿。" }}
    </p>
  </section>
</template>
