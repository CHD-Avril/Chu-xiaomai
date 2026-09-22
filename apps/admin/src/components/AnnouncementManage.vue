<script setup>
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAdminStore } from "../stores/admin";
import { useAuthStore } from "../stores/auth";
import * as api from "../services/api";
import { formatDateTime } from "../utils/format";

const adminStore = useAdminStore();
const authStore = useAuthStore();

const form = reactive({ title: "", content: "" });
const publishing = ref(false);
const disablingId = ref("");

async function handlePublish() {
  if (!form.title.trim() || !form.content.trim()) {
    ElMessage.warning("请填写公告标题和内容");
    return;
  }
  publishing.value = true;
  try {
    await api.insertAnnouncement({
      title: form.title.trim(),
      content: form.content.trim(),
      createdBy: authStore.adminUser?.id ?? "",
    });
    form.title = "";
    form.content = "";
    await adminStore.refreshAnnouncements();
    ElMessage.success("公告已发布");
  } catch (error) {
    ElMessage.error(error?.message || "发布失败");
  } finally {
    publishing.value = false;
  }
}

async function handleDisable(item) {
  disablingId.value = item.id;
  try {
    await api.disableAnnouncement(item.id);
    await adminStore.refreshAnnouncements();
    ElMessage.success("公告已关闭");
  } catch (error) {
    ElMessage.error(error?.message || "操作失败");
  } finally {
    disablingId.value = "";
  }
}
</script>

<template>
  <div>
    <el-card class="panel-card" shadow="never">
      <template #header>发布公告</template>
      <el-form label-width="80px" @submit.prevent="handlePublish">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="100" placeholder="如：本期征集开始啦" />
        </el-form-item>
        <el-form-item label="内容" required>
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="5"
            maxlength="1000"
            show-word-limit
            placeholder="写下要展示给同学们的通知"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="publishing" @click="handlePublish">发布公告</el-button>
        </el-form-item>
      </el-form>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="最新公告会弹窗展示，最近三条公告保存在首页告示栏。"
      />
    </el-card>

    <el-card class="panel-card" shadow="never">
      <template #header>活跃公告（{{ adminStore.announcements.length }}）</template>
      <el-table :data="adminStore.announcements" stripe>
        <el-table-column prop="title" label="标题" min-width="160" />
        <el-table-column prop="content" label="内容" min-width="260" show-overflow-tooltip />
        <el-table-column label="发布时间" width="180">
          <template #default="{ row }">{{ formatDateTime(Date.parse(row.created_at) || 0) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              type="danger"
              plain
              :loading="disablingId === row.id"
              @click="handleDisable(row)"
            >
              关闭
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
