<script setup>
import { computed, onMounted, ref } from "vue";
import { usePeriodStore } from "../../stores/period";
import * as api from "../../services/api";
import { sanitizeFilename, formatDateForFilename } from "../../utils/format";

const periodStore = usePeriodStore();

const targetPeriodId = ref("");
const order = ref("likes-desc");
const count = ref(10);
const hint = ref("");

const targetOptions = computed(() => {
  const options = [];
  if (periodStore.currentPeriod) {
    options.push({ id: periodStore.currentPeriod.id, label: `当前：${periodStore.currentPeriod.title}` });
  }
  periodStore.archivedPeriods.forEach((period) => {
    options.push({ id: period.id, label: `往期：${period.title}` });
  });
  return options;
});

const currentPeriodLabel = computed(() => {
  const option = targetOptions.value.find((item) => item.id === targetPeriodId.value);
  return option?.label ?? "playlist";
});

onMounted(async () => {
  if (!periodStore.archivedPeriods.length) await periodStore.fetchArchivedPeriods();
  targetPeriodId.value = targetOptions.value[0]?.id ?? "";
});

async function loadSongsForExport(periodId) {
  const songs = await api.fetchSongs(periodId);
  songs.sort((a, b) => {
    if (order.value === "likes-asc") return (a.likesCount || 0) - (b.likesCount || 0);
    return (b.likesCount || 0) - (a.likesCount || 0);
  });
  return songs.slice(0, Math.max(1, Math.min(Number(count.value) || 10, 500)));
}

function buildPlaylistText(songs) {
  return songs
    .map((song, index) => `${index + 1}. ${song.title} - ${song.artist} (${song.likesCount || 0} 喜欢)`)
    .join("\n");
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function handleCopy() {
  try {
    const songs = await loadSongsForExport(targetPeriodId.value);
    if (!songs.length) {
      hint.value = "这个征集期还没有歌曲。";
      return;
    }
    await navigator.clipboard.writeText(buildPlaylistText(songs));
    hint.value = `已复制 ${songs.length} 首歌单。`;
  } catch (error) {
    hint.value = error?.message || error?.details || "复制失败。";
  }
}

async function handleDownloadTxt() {
  try {
    const songs = await loadSongsForExport(targetPeriodId.value);
    if (!songs.length) {
      hint.value = "这个征集期还没有歌曲。";
      return;
    }
    const blob = new Blob([buildPlaylistText(songs)], { type: "text/plain;charset=utf-8" });
    triggerDownload(blob, `${sanitizeFilename(currentPeriodLabel.value)}_${formatDateForFilename(new Date())}.txt`);
    hint.value = `已下载 ${songs.length} 首歌单。`;
  } catch (error) {
    hint.value = error?.message || error?.details || "下载失败。";
  }
}

function buildAntiCheatReport(period, songs, likes, dislikes, reports) {
  const songMap = new Map(
    songs.map((song) => [
      song.id,
      {
        id: song.id,
        title: song.title,
        artist: song.artist,
        likes_count: song.likesCount,
        dislikes_count: song.dislikesCount,
        is_locked: song.isLocked,
      },
    ]),
  );

  const cookieLikeCount = {};
  const ipLikeCount = {};
  const cookieDislikeCount = {};
  const ipDislikeCount = {};

  likes.forEach((row) => {
    cookieLikeCount[row.voter_cookie] = (cookieLikeCount[row.voter_cookie] || 0) + 1;
    ipLikeCount[row.voter_ip] = (ipLikeCount[row.voter_ip] || 0) + 1;
  });
  dislikes.forEach((row) => {
    cookieDislikeCount[row.voter_cookie] = (cookieDislikeCount[row.voter_cookie] || 0) + 1;
    ipDislikeCount[row.voter_ip] = (ipDislikeCount[row.voter_ip] || 0) + 1;
  });

  const flaggedCookies = new Set();
  Object.entries(cookieLikeCount).forEach(([cookie, n]) => {
    if (n >= 5) flaggedCookies.add(cookie);
  });
  Object.entries(cookieDislikeCount).forEach(([cookie, n]) => {
    if (n >= 3) flaggedCookies.add(cookie);
  });

  const flaggedIps = new Set();
  Object.entries(ipLikeCount).forEach(([ip, n]) => {
    if (n >= 10) flaggedIps.add(ip);
  });
  Object.entries(ipDislikeCount).forEach(([ip, n]) => {
    if (n >= 8) flaggedIps.add(ip);
  });

  return {
    exported_at: new Date().toISOString(),
    period: {
      id: period.id,
      title: period.title,
      starts_at: new Date(period.startsAt).toISOString(),
      ends_at: new Date(period.endsAt).toISOString(),
    },
    thresholds: { like_cookie: 5, like_ip: 10, dislike_cookie: 3, dislike_ip: 8 },
    songs: [...songMap.values()],
    song_likes: likes,
    song_dislikes: dislikes,
    song_reports: reports,
    flagged_cookies: [...flaggedCookies],
    flagged_ips: [...flaggedIps],
  };
}

async function handleDownloadJson() {
  const period = periodStore.currentPeriod;
  if (!period) {
    hint.value = "当前没有进行中的征集期，无法导出。";
    return;
  }
  try {
    const [songs, likes, dislikes, reports] = await Promise.all([
      api.fetchSongs(period.id),
      api.fetchVoteRows("song_likes", period.id),
      api.fetchVoteRows("song_dislikes", period.id),
      api.fetchReportRows(period.id),
    ]);
    const payload = buildAntiCheatReport(period, songs, likes, dislikes, reports);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    triggerDownload(blob, `${sanitizeFilename(period.title)}_data_${formatDateForFilename(new Date())}.json`);
    hint.value = "当前征集期数据已导出。";
  } catch (error) {
    hint.value = error?.message || error?.details || "导出失败。";
  }
}
</script>

<template>
  <div class="export-panel admin-block">
    <p class="section-tag">Export</p>
    <h3>导出歌单</h3>
    <div class="export-controls">
      <label class="field">
        <span>征集期</span>
        <select v-model="targetPeriodId">
          <option v-for="option in targetOptions" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>排序方式</span>
        <select v-model="order">
          <option value="likes-desc">喜欢数从高到低</option>
          <option value="likes-asc">喜欢数从低到高</option>
        </select>
      </label>
      <label class="field">
        <span>导出数量</span>
        <input v-model.number="count" type="number" min="1" max="500" inputmode="numeric" />
      </label>
    </div>
    <div class="admin-actions">
      <button class="primary-button compact-button" type="button" @click="handleCopy">复制歌单</button>
      <button class="primary-button secondary-btn compact-button" type="button" @click="handleDownloadTxt">下载 TXT</button>
      <button class="primary-button secondary-btn compact-button" type="button" @click="handleDownloadJson">导出当前征集期数据</button>
    </div>
    <p class="form-hint">{{ hint || "可按当前或历史歌单导出；「导出当前征集期数据」包含反作弊聚合明细。" }}</p>
  </div>
</template>
