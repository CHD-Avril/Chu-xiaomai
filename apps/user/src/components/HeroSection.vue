<script setup>
import { computed } from "vue";
import { useSongsStore } from "../stores/songs";
import { usePeriodStatus } from "../composables/usePeriodStatus";
import Icon from "./Icon.vue";

const store = useSongsStore();
const { period, status } = usePeriodStatus();
const statsReady = computed(() => !store.isLoading && !store.errorMessage);
const likes = computed(() => store.songs.reduce((sum, song) => sum + (song.likesCount || 0), 0));
</script>

<template>
  <section class="hero" aria-labelledby="heroTitle">
    <div class="hero-copy">
      <p class="hero-eyebrow">
        <span class="live-dot" aria-hidden="true"></span>
        CHU Broadcast · 校园点歌
      </p>
      <h1 id="heroTitle">把想听的歌，<br /><em>交给校园广播。</em></h1>
      <p class="hero-text">
        一首想听的歌，一段想分享的心情。从广播台确认音源的曲库中选一首，让它在下一次校园广播里被更多人听见。
      </p>
      <div class="hero-actions">
        <router-link class="primary-button" :to="{ name: 'home', hash: '#submit' }">
          开始点歌
          <Icon name="arrow-up-right" :size="16" />
        </router-link>
        <router-link class="button-ghost" to="/playlist">
          查看本期榜单
          <Icon name="arrow-right" :size="15" />
        </router-link>
      </div>
    </div>

    <aside class="hero-panel" aria-label="本期征集状态">
      <div>
        <div class="hero-panel-head">
          <span class="live-dot" aria-hidden="true"></span>
          <span>ON AIR</span>
          <span class="onair-state">{{ status.label }}</span>
        </div>
        <strong class="hero-period-title">{{ period?.title || "校园点歌征集" }}</strong>
        <p class="hero-period-meta">{{ status.copy }}</p>
        <div class="hero-wave" aria-hidden="true">
          <i v-for="n in 12" :key="n"></i>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <strong>{{ statsReady ? store.songs.length : "—" }}</strong>
          <span>首歌曲已投递</span>
        </div>
        <div class="hero-stat">
          <strong>{{ statsReady ? likes : "—" }}</strong>
          <span>次喜欢已收到</span>
        </div>
      </div>
    </aside>
  </section>
</template>