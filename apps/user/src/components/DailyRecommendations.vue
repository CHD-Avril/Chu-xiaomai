<script setup>
import { useSongsStore } from "../stores/songs";

const songsStore = useSongsStore();
</script>

<template>
  <section v-if="songsStore.dailyRecommendations.length" class="card recommendations-panel">
    <div class="section-head">
      <div>
        <p class="section-tag">Daily Picks</p>
        <h2>每日推荐</h2>
      </div>
      <p class="section-note">每天从本期投稿中抽取至多五首，不按喜欢数量排序。</p>
    </div>
    <div class="recommendations-list">
      <article
        v-for="(song, index) in songsStore.dailyRecommendations"
        :key="song.id"
        class="recommendation-card"
      >
        <span class="rec-rank">DAY PICK {{ String(index + 1).padStart(2, "0") }}</span>
        <strong :title="song.title">{{ song.title }}</strong>
        <p :title="song.artist">{{ song.artist }}</p>
      </article>
    </div>
  </section>
</template>
