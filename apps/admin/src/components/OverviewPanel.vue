<script setup>
import { ElAlert, ElButton, ElCard, ElDescriptions, ElDescriptionsItem, ElEmpty, ElTag } from "element-plus";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/descriptions/style/css";
import "element-plus/es/components/descriptions-item/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/tag/style/css";
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useAdminStore } from "../stores/admin";
import { formatPeriodRange } from "../utils/format";

const adminStore = useAdminStore();
const emit = defineEmits(["navigate"]);
const media = window.matchMedia("(max-width: 768px)");
const compact = ref(media.matches);
const onMediaChange = (event) => { compact.value = event.matches; };
onMounted(() => media.addEventListener("change", onMediaChange));
onBeforeUnmount(() => media.removeEventListener("change", onMediaChange));

const period = computed(() => adminStore.currentPeriod);
const songCount = computed(() => adminStore.songs.length);
const totalLikes = computed(() => adminStore.songs.reduce((sum, song) => sum + (song.likesCount || 0), 0));
const totalDislikes = computed(() => adminStore.songs.reduce((sum, song) => sum + (song.dislikesCount || 0), 0));
const reportCount = computed(() => adminStore.pendingReports.length);

const periodStatus = computed(() => {
  if (!period.value) return { label: "无进行中征集期", type: "info" };
  const now = adminStore.now;
  if (period.value.status !== "active") return { label: "已归档", type: "info" };
  if (now < period.value.startsAt) return { label: "未开始", type: "warning" };
  if (now > period.value.endsAt) return { label: "已结束", type: "danger" };
  return { label: "进行中", type: "success" };
});
</script>

<template>
  <div>
    <div class="stat-strip">
      <div class="stat-box">
        <span class="stat-label">当前征集期</span>
        <strong class="stat-value is-accent">{{ period?.title ?? "无" }}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">状态</span>
        <strong class="stat-value"><el-tag :type="periodStatus.type" size="large">{{ periodStatus.label }}</el-tag></strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">本期投稿歌曲</span>
        <strong class="stat-value">{{ songCount }}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">累计喜欢 / 点踩</span>
        <strong class="stat-value">
          {{ totalLikes }} <span class="muted">/ {{ totalDislikes }}</span>
        </strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">待审核举报</span>
        <strong class="stat-value" :class="{ 'is-warn': reportCount > 0 }">{{ reportCount }}</strong>
      </div>
    </div>

    <el-card class="panel-card" shadow="never">
      <template #header>当前征集期详情</template>
      <el-descriptions v-if="period" :column="compact ? 1 : 3" border>
        <el-descriptions-item label="标题">{{ period.title }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="periodStatus.type" size="small">{{ periodStatus.label }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="时间窗口">{{ formatPeriodRange(period) }}</el-descriptions-item>
      </el-descriptions>
      <el-empty v-else description="当前没有进行中的征集期，请到「征集期」新建一期。" :image-size="80" />
    </el-card>

    <el-card class="panel-card" shadow="never">
      <template #header>待办提醒</template>
      <div class="toolbar quick-actions">
        <el-button type="primary" @click="emit('navigate', 'reports')">审核举报（{{ reportCount }}）</el-button>
        <el-button @click="emit('navigate', 'periods', period ? 'edit' : 'create')">{{ period ? '调整截止时间' : '新建征集期' }}</el-button>
        <el-button @click="emit('navigate', 'announcements')">发布公告</el-button>
        <el-button type="warning" plain @click="emit('navigate', 'periods')">测试模式</el-button>
        <el-button type="warning" plain @click="emit('navigate', 'export')">整理本期歌单</el-button>
      </div>
      <el-alert v-if="periodStatus.label === '进行中' && period.endsAt - adminStore.now <= 86400000" type="warning" :closable="false" title="本期将在 24 小时内截止，请确认公告与播出安排。" show-icon style="margin-bottom: 12px" />
      <el-alert
        v-if="reportCount > 0"
        type="warning"
        :closable="false"
        show-icon
        :title="`有 ${reportCount} 条举报待审核，请及时到「举报审核」处理。`"
        style="margin-bottom: 12px"
      />
      <el-alert
        v-if="!period"
        type="info"
        :closable="false"
        show-icon
        title="当前没有开放的征集期，学生无法投稿和点赞。"
        style="margin-bottom: 12px"
      />
      <el-alert
        v-else-if="periodStatus.type === 'warning'"
        type="warning"
        :closable="false"
        show-icon
        :title="`征集期「${period.title}」尚未开始，将于 ${formatPeriodRange(period)} 开放。`"
      />
      <el-alert
        v-else-if="periodStatus.type === 'danger' || periodStatus.type === 'info'"
        type="info"
        :closable="false"
        show-icon
        :title="`征集期「${period.title}」已结束，投稿和投票已关闭，结果仍可查看和导出。`"
      />
      <el-alert
        v-else
        type="success"
        :closable="false"
        show-icon
        :title="`征集期「${period?.title}」运行正常，共 ${songCount} 首歌、${totalLikes} 次喜欢。`"
      />
    </el-card>
  </div>
</template>
