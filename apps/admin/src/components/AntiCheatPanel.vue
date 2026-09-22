<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import * as echarts from "echarts";
import { useAdminStore } from "../stores/admin";
import * as api from "../services/api";
import { buildAntiCheatReport } from "../services/api";
import { formatDateTime, sanitizeFilename, formatDateForFilename } from "../utils/format";

const adminStore = useAdminStore();
const chartRef = ref(null);
let chart = null;

const selectedPeriodId = ref("");
const loading = ref(false);
const report = ref(null);

const periodOptions = computed(() => {
  const options = [];
  if (adminStore.currentPeriod) {
    options.push({ id: adminStore.currentPeriod.id, title: adminStore.currentPeriod.title });
  }
  adminStore.periods
    .filter((p) => p.status !== "active")
    .forEach((period) => options.push({ id: period.id, title: period.title }));
  return options;
});

const selectedPeriod = computed(() => {
  const option = periodOptions.value.find((item) => item.id === selectedPeriodId.value);
  const full = adminStore.periods.find((period) => period.id === selectedPeriodId.value);
  return (
    full ?? {
      id: selectedPeriodId.value,
      title: option?.title ?? "未命名歌单",
      startsAt: 0,
      endsAt: 0,
      status: "archived",
    }
  );
});

const stats = computed(() => {
  if (!report.value) {
    return { songs: 0, likes: 0, dislikes: 0, reports: 0, cookies: 0, ips: 0 };
  }
  return {
    songs: report.value.songs.length,
    likes: report.value.song_likes.length,
    dislikes: report.value.song_dislikes.length,
    reports: report.value.song_reports.length,
    cookies: report.value.flagged_cookies.length,
    ips: report.value.flagged_ips.length,
  };
});

const topSongs = computed(() => {
  if (!report.value) return [];
  return [...report.value.songs]
    .sort((a, b) => b.likes_count + b.dislikes_count - (a.likes_count + a.dislikes_count))
    .slice(0, 10);
});

async function loadPeriod(periodId) {
  if (!periodId) return;
  loading.value = true;
  try {
    const [songs, likes, dislikes, reports] = await Promise.all([
      api.fetchSongs(periodId),
      api.fetchVoteRows("song_likes", periodId),
      api.fetchVoteRows("song_dislikes", periodId),
      api.fetchAllReports(periodId),
    ]);
    report.value = buildAntiCheatReport(selectedPeriod.value, songs, likes, dislikes, reports);
    await nextTick();
    renderChart();
  } catch (error) {
    report.value = null;
    ElMessage.error(error?.message || "加载明细失败");
  } finally {
    loading.value = false;
  }
}

function renderChart() {
  if (!chartRef.value) return;
  if (!chart) {
    chart = echarts.init(chartRef.value);
    window.addEventListener("resize", onResize);
  }
  const data = topSongs.value;
  chart.setOption(
    {
      tooltip: { trigger: "axis", confine: true },
      legend: { data: ["喜欢", "点踩"], top: 0 },
      grid: { left: 44, right: 20, top: 36, bottom: 64 },
      xAxis: {
        type: "category",
        data: data.map((song) => (song.title.length > 8 ? `${song.title.slice(0, 8)}…` : song.title)),
        axisLabel: { interval: 0, rotate: 32, fontSize: 11 },
      },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        {
          name: "喜欢",
          type: "bar",
          data: data.map((song) => song.likes_count),
          itemStyle: { color: "#1558cf", borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 22,
        },
        {
          name: "点踩",
          type: "bar",
          data: data.map((song) => song.dislikes_count),
          itemStyle: { color: "#d83b2e", borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 22,
        },
      ],
    },
    true,
  );
}

function onResize() {
  chart?.resize();
}

onMounted(async () => {
  if (!adminStore.periods.length) await adminStore.refreshPeriods();
  selectedPeriodId.value = periodOptions.value[0]?.id ?? "";
  if (selectedPeriodId.value) await loadPeriod(selectedPeriodId.value);
});

watch(selectedPeriodId, (periodId) => {
  loadPeriod(periodId);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
  chart?.dispose();
  chart = null;
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

function handleExportJson() {
  if (!report.value) {
    ElMessage.warning("暂无数据可导出");
    return;
  }
  const blob = new Blob([JSON.stringify(report.value, null, 2)], { type: "application/json;charset=utf-8" });
  triggerDownload(blob, `${sanitizeFilename(report.value.period.title)}_anticheat_${formatDateForFilename(new Date())}.json`);
  ElMessage.success("防作弊明细已导出");
}
</script>

<template>
  <div v-loading="loading">
    <div class="toolbar">
      <span class="muted">征集期：</span>
      <el-select v-model="selectedPeriodId" style="width: 320px">
        <el-option
          v-for="option in periodOptions"
          :key="option.id"
          :label="option.title"
          :value="option.id"
        />
      </el-select>
      <el-button type="warning" plain :disabled="!report" @click="handleExportJson">导出明细 JSON</el-button>
    </div>

    <div class="stat-strip">
      <div class="stat-box">
        <span class="stat-label">本期歌曲</span>
        <strong class="stat-value">{{ stats.songs }}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">喜欢记录</span>
        <strong class="stat-value is-accent">{{ stats.likes }}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">点踩记录</span>
        <strong class="stat-value">{{ stats.dislikes }}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">举报记录</span>
        <strong class="stat-value">{{ stats.reports }}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">疑似 Cookie</span>
        <strong class="stat-value" :class="{ 'is-warn': stats.cookies > 0 }">{{ stats.cookies }}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">疑似 IP</span>
        <strong class="stat-value" :class="{ 'is-warn': stats.ips > 0 }">{{ stats.ips }}</strong>
      </div>
    </div>

    <el-card class="panel-card" shadow="never">
      <template #header>歌曲喜欢 / 点踩对比（Top 10）</template>
      <div ref="chartRef" class="chart-box"></div>
      <p class="muted" style="margin: 8px 0 0">
        阈值口径：疑似 Cookie = 喜欢 ≥5 或 点踩 ≥3；疑似 IP = 喜欢 ≥10 或 点踩 ≥8。
      </p>
    </el-card>

    <el-card class="panel-card" shadow="never">
      <template #header>疑似刷票 Cookie（{{ report?.flagged_cookies.length ?? 0 }}）</template>
      <el-table v-if="report?.flagged_cookies.length" :data="report.flagged_cookies" stripe size="small">
        <el-table-column prop="cookie" label="Cookie 标识" min-width="320" show-overflow-tooltip />
        <el-table-column label="喜欢数" width="120">
          <template #default="{ row }">{{ row.like_count }}</template>
        </el-table-column>
        <el-table-column label="点踩数" width="120">
          <template #default="{ row }">{{ row.dislike_count }}</template>
        </el-table-column>
        <el-table-column label="判定" width="140">
          <template #default="{ row }">
            <el-tag v-if="row.like_count >= 5" type="danger" size="small">高频喜欢</el-tag>
            <el-tag v-if="row.dislike_count >= 3" type="warning" size="small" style="margin-left: 4px">高频点踩</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="未发现疑似 Cookie" :image-size="80" />
    </el-card>

    <el-card class="panel-card" shadow="never">
      <template #header>疑似刷票 IP（{{ report?.flagged_ips.length ?? 0 }}）</template>
      <el-table v-if="report?.flagged_ips.length" :data="report.flagged_ips" stripe size="small">
        <el-table-column prop="ip" label="IP 地址" min-width="200" />
        <el-table-column label="喜欢数" width="120">
          <template #default="{ row }">{{ row.like_count }}</template>
        </el-table-column>
        <el-table-column label="点踩数" width="120">
          <template #default="{ row }">{{ row.dislike_count }}</template>
        </el-table-column>
        <el-table-column label="判定" width="140">
          <template #default="{ row }">
            <el-tag v-if="row.like_count >= 10" type="danger" size="small">高频喜欢</el-tag>
            <el-tag v-if="row.dislike_count >= 8" type="warning" size="small" style="margin-left: 4px">高频点踩</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="未发现疑似 IP" :image-size="80" />
    </el-card>

    <el-card class="panel-card" shadow="never">
      <template #header>举报明细（{{ report?.song_reports.length ?? 0 }}）</template>
      <el-table
        v-if="report?.song_reports.length"
        :data="report.song_reports"
        stripe
        size="small"
        max-height="360"
      >
        <el-table-column prop="song_id" label="歌曲 ID" width="240" show-overflow-tooltip />
        <el-table-column prop="reason" label="理由" min-width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'danger' : 'info'" size="small">
              {{ row.status === "pending" ? "待审核" : row.status === "approved" ? "已同意" : "已驳回" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatDateTime(Date.parse(row.created_at) || 0) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="暂无举报记录" :image-size="80" />
    </el-card>
  </div>
</template>
