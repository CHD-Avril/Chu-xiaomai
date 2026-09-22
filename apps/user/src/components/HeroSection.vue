<script setup>
import { computed } from "vue";
import { usePeriodStore } from "../stores/period";
import { formatPeriodRange } from "../utils/format";

defineEmits(["go-submit"]);
const periodStore = usePeriodStore();
const period = computed(() => periodStore.currentPeriod);

const periodState = computed(() => {
  const item = period.value;
  if (!item) return { label: "暂无征集期", className: "is-missing" };
  const now = Date.now();
  if (now < item.startsAt) return { label: "征集未开始", className: "is-pending" };
  if (now > item.endsAt) return { label: "征集已结束", className: "is-closed" };
  return { label: "征集进行中", className: "is-active" };
});
</script>

<template>
  <section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">CHU Broadcast Station</p>
      <h1><span>长大小麦君</span><strong>征集歌单</strong></h1>
      <p class="hero-text">每一首歌，都是故事。让长大小麦君，遇见你的歌单。</p>
      <div class="hero-actions">
        <button class="primary-button hero-button" type="button" @click="$emit('go-submit')">♪ 我要提交歌曲</button>
        <span class="pill period-pill" :class="periodState.className">
          <span>{{ period?.title ?? "正在读取征集期..." }}</span>
          <span v-if="period">{{ formatPeriodRange(period) }}</span>
        </span>
      </div>
    </div>

    <div class="hero-visual" aria-hidden="true">
      <div class="orbit orbit-one"></div>
      <div class="orbit orbit-two"></div>
      <div class="dot dot-blue"></div>
      <div class="dot dot-yellow"></div>
      <div class="record">
        <div class="record-core"></div>
      </div>
      <div class="wave-bars">
        <span></span><span></span><span></span><span></span><span></span>
        <span></span><span></span><span></span><span></span><span></span>
      </div>
    </div>
  </section>
</template>
