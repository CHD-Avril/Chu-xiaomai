<script setup>
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAdminStore } from "../stores/admin";
import * as api from "../services/api";
import { buildAntiCheatReport } from "../services/api";
import { sanitizeFilename, formatDateForFilename } from "../utils/format";

const adminStore = useAdminStore();

const targetPeriodId = ref("");
const order = ref("likes-desc");
const count = ref(10);

const targetOptions = computed(() => {
  const options = [];
  if (adminStore.currentPeriod) {
    options.push({ id: adminStore.currentPeriod.id, title: adminStore.currentPeriod.title });
  }
  adminStore.periods
    .filter((p) => p.status !== "active")
    .forEach((period) => options.push({ id: period.id, title: period.title }));
  return options;
});

const currentPeriodTitle = computed(() => {
  const option = targetOptions.value.find((item) => item.id === targetPeriodId.value);
  return option?.title ?? "playlist";
});

onMounted(async () => {
  if (!adminStore.periods.length) await adminStore.refreshPeriods();
  targetPeriodId.value = targetOptions.value[0]?.id ?? "";
});

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

async function handleCopy() {
  try {
    const songs = await loadSongsForExport(targetPeriodId.value);
    if (!songs.length) {
      ElMessage.warning("这个征集期还没有歌曲");
      return;
    }
    await navigator.clipboard.writeText(buildPlaylistText(songs));
    ElMessage.success(`已复制 ${songs.length} 首歌单`);
  } catch (error) {
    ElMessage.error(error?.message || "复制失败");
  }
}

async function handleDownloadTxt() {
  try {
    const songs = await loadSongsForExport(targetPeriodId.value);
    if (!songs.length) {
      ElMessage.warning("这个征集期还没有歌曲");
      return;
    }
    const blob = new Blob([buildPlaylistText(songs)], { type: "text/plain;charset=utf-8" });
    triggerDownload(blob, `${sanitizeFilename(currentPeriodTitle.value)}_${formatDateForFilename(new Date())}.txt`);
    ElMessage.success(`已下载 ${songs.length} 首歌单`);
  } catch (error) {
    ElMessage.error(error?.message || "下载失败");
  }
}

async function handleDownloadJson() {
  const period = adminStore.currentPeriod;
  if (!period) {
    ElMessage.warning("当前没有进行中的征集期，无法导出");
    return;
  }
  try {
    const [songs, likes, dislikes, reports] = await Promise.all([
      api.fetchSongs(period.id),
      api.fetchVoteRows("song_likes", period.id),
      api.fetchVoteRows("song_dislikes", period.id),
      api.fetchAllReports(period.id),
    ]);
    const payload = buildAntiCheatReport(period, songs, likes, dislikes, reports);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    triggerDownload(blob, `${sanitizeFilename(period.title)}_data_${formatDateForFilename(new Date())}.json`);
    ElMessage.success("当前征集期数据已导出");
  } catch (error) {
    ElMessage.error(error?.message || "导出失败");
  }
}
</script>

<template>
  <div>
    <el-card class="panel-card" shadow="never">
      <template #header>歌单导出</template>
      <el-form label-width="90px" style="max-width: 560px">
        <el-form-item label="征集期">
          <el-select v-model="targetPeriodId" style="width: 100%">
            <el-option
              v-for="option in targetOptions"
              :key="option.id"
              :label="option.title"
              :value="option.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="排序方式">
          <el-select v-model="order" style="width: 100%">
            <el-option label="喜欢数从高到低" value="likes-desc" />
            <el-option label="喜欢数从低到高" value="likes-asc" />
          </el-select>
        </el-form-item>
        <el-form-item label="导出数量">
          <el-input-number v-model="count" :min="1" :max="500" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleCopy">复制歌单</el-button>
          <el-button @click="handleDownloadTxt">下载 TXT</el-button>
          <el-button type="warning" plain @click="handleDownloadJson">导出当前征集期数据</el-button>
        </el-form-item>
      </el-form>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="「导出当前征集期数据」为 JSON 格式，包含全部投票明细与反作弊聚合结果。"
      />
    </el-card>
  </div>
</template>
