<script setup>
import { ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAdminStore } from "../stores/admin";
import * as api from "../services/api";
import { formatDateTime } from "../utils/format";

const adminStore = useAdminStore();
const processingId = ref("");

async function handleReview(row, approve) {
  const actionText = approve ? "同意并锁定歌曲" : "驳回举报";
  try {
    await ElMessageBox.confirm(
      approve
        ? `确认同意举报「${row.song?.title ?? "未知歌曲"}」？歌曲将被锁定，不再参与榜单。`
        : "确认驳回这条举报？",
      actionText,
      { confirmButtonText: "确认", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }

  processingId.value = row.id;
  try {
    await api.reviewReport(row.id, approve);
    adminStore.pendingReports = adminStore.pendingReports.filter((item) => item.id !== row.id);
    await adminStore.refreshSongs();
    ElMessage.success(approve ? "已同意，歌曲已锁定" : "已驳回");
  } catch (error) {
    ElMessage.error(error?.message || "操作失败");
  } finally {
    processingId.value = "";
  }
}
</script>

<template>
  <div>
    <el-card class="panel-card" shadow="never">
      <template #header>
        <div style="display: flex; align-items: center; justify-content: space-between">
          <span>待审核举报（{{ adminStore.pendingReports.length }}）</span>
          <el-button size="small" @click="adminStore.refreshReports()">刷新</el-button>
        </div>
      </template>

      <el-table :data="adminStore.pendingReports" stripe>
        <el-table-column label="歌曲" min-width="220">
          <template #default="{ row }">
            <strong>{{ row.song?.title ?? "未知歌曲" }}</strong>
            <span class="muted"> - {{ row.song?.artist ?? "" }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="点踩理由" min-width="240" show-overflow-tooltip />
        <el-table-column label="举报时间" width="180">
          <template #default="{ row }">{{ formatDateTime(Date.parse(row.created_at) || 0) }}</template>
        </el-table-column>
        <el-table-column label="歌曲数据" width="200">
          <template #default="{ row }">
            <span class="muted">喜欢 {{ row.song?.likes_count ?? 0 }} · 点踩 {{ row.song?.dislikes_count ?? 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              type="danger"
              :loading="processingId === row.id"
              @click="handleReview(row, true)"
            >
              同意并锁定
            </el-button>
            <el-button
              size="small"
              :loading="processingId === row.id"
              @click="handleReview(row, false)"
            >
              驳回
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty
        v-if="!adminStore.pendingReports.length"
        description="暂无待审核举报"
        :image-size="80"
      />
    </el-card>
  </div>
</template>
