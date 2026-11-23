<script setup>
import { computed } from "vue";
import { useSongsStore } from "../stores/songs";
import { usePeriodStatus } from "../composables/usePeriodStatus";
import { useAuthStore } from "../stores/auth";
import Icon from "./Icon.vue";

const store = useSongsStore();
const auth = useAuthStore();
const { period, status } = usePeriodStatus();
const statsReady = computed(() => !store.isLoading && !store.errorMessage);
const likes = computed(() => store.songs.reduce((sum, song) => sum + (song.likesCount || 0), 0));

const waveColors = ["#7aa8ff", "#4fd1c0", "#ffb27a", "#ff9ec4", "#b39dff"];
const waveBars = Array.from({ length: 56 }, (_, index) => ({
  height: 8 + Math.round(Math.abs(Math.sin(index * 0.55)) * 18 + Math.abs(Math.cos(index * 0.17)) * 10),
  color: waveColors[index % waveColors.length],
  delay: `${(index % 13) * 0.17}s`,
  duration: `${(2.4 + (index % 8) * 0.2).toFixed(1)}s`,
  opacity: (0.5 + ((index * 37) % 36) / 100).toFixed(2),
}));
</script>

<template>
  <section class="hero" aria-labelledby="heroTitle">
    <div class="hero-onair" role="status">
      <span class="live-dot" aria-hidden="true"></span>
      <span class="hero-onair-label">ON AIR</span>
      <span class="hero-onair-state">{{ status.label }}</span>
    </div>

    <div class="hero-copy">
      <p class="hero-eyebrow">XIAOMAI RADIO · 校园点歌</p>
      <h1 id="heroTitle">把想听的歌，<br />交给<span class="hero-keyword">校园广播</span>。</h1>
      <p class="hero-text">
        本期《{{ period?.title || "校园点歌征集" }}》 · {{ status.copy }}
        {{ auth.isQqLoggedIn ? "选一首想听的歌，把它交给下一次校园广播。" : "游客可浏览，QQ 登录后可点歌和投票。" }}
      </p>
      <div class="hero-actions">
        <router-link class="primary-button" :to="{ name: 'home', hash: '#submit' }">
          开始点歌
          <Icon name="arrow-up-right" :size="16" />
        </router-link>
        <router-link class="secondary-button" to="/playlist">
          查看本期榜单
          <Icon name="arrow-right" :size="15" />
        </router-link>
        <p class="hero-figures" aria-label="本期参与数据">
          <span><strong>{{ statsReady ? store.songs.length : "—" }}</strong> 首已投递</span>
          <span class="hero-figure-divider" aria-hidden="true"></span>
          <span><strong>{{ statsReady ? likes : "—" }}</strong> 次喜欢</span>
        </p>
      </div>
    </div>

    <div class="hero-wave" aria-hidden="true">
      <i
        v-for="(bar, index) in waveBars"
        :key="index"
        :style="{
          height: `${bar.height}px`,
          background: bar.color,
          opacity: bar.opacity,
          animationDelay: bar.delay,
          animationDuration: bar.duration,
        }"
      ></i>
    </div>
  </section>
</template>