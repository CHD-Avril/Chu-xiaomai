<script setup>
import { ElAlert, ElButton, ElCard, ElDatePicker, ElDescriptions, ElDescriptionsItem, ElDialog, ElEmpty, ElForm, ElFormItem, ElInput, ElTable, ElTableColumn, ElTag } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/date-picker/style/css";
import "element-plus/es/components/descriptions/style/css";
import "element-plus/es/components/descriptions-item/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/form-item/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/table-column/style/css";
import "element-plus/es/components/tag/style/css";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAdminStore } from "../stores/admin";
import { useAuthStore } from "../stores/auth";
import * as api from "../services/api";
import { formatDateTime, formatDateTimeLocalInput, parseDateTimeLocal } from "../utils/format";
import TestModePanel from "./TestModePanel.vue";

const adminStore = useAdminStore();
const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

const dialogVisible = ref(false);
const saving = ref(false);
const form = ref({ title: "", startsAt: "", endsAt: "" });
const editingId = ref(null);
const archivingId = ref("");

onMounted(() => {
  if (route.query.action === "edit" && adminStore.currentPeriod) openEdit(adminStore.currentPeriod);
  else if (route.query.action === "create") openCreate();
  if (route.query.action) router.replace({ query: { ...route.query, action: undefined } });
});

const periodStatus = (period) => {
  const now = adminStore.now;
  if (period.status !== "active") return { label: "已归档", type: "info" };
  if (now < period.startsAt) return { label: "未开始", type: "warning" };
  if (now > period.endsAt) return { label: "已结束", type: "danger" };
  return { label: "进行中", type: "success" };
};

function openCreate() {
  editingId.value = null;
  form.value = { title: "", startsAt: "", endsAt: "" };
  dialogVisible.value = true;
}

function openEdit(period) {
  editingId.value = period.id;
  form.value = {
    title: period.title,
    startsAt: formatDateTimeLocalInput(period.startsAt),
    endsAt: formatDateTimeLocalInput(period.endsAt),
  };
  dialogVisible.value = true;
}

async function handleSave() {
  if (saving.value) return;
  if (!form.value.title.trim()) {
    ElMessage.warning("请填写征集期标题");
    return;
  }
  const startsAt = parseDateTimeLocal(form.value.startsAt);
  const endsAt = parseDateTimeLocal(form.value.endsAt);
  if (!startsAt || !endsAt) {
    ElMessage.warning("请选择开始与结束时间");
    return;
  }
  if (startsAt.getTime() >= endsAt.getTime()) {
    ElMessage.warning("开始时间必须早于结束时间");
    return;
  }

  saving.value = true;
  if (!editingId.value && adminStore.currentPeriod) {
    try {
      await ElMessageBox.confirm(`创建「${form.value.title.trim()}」将立即归档「${adminStore.currentPeriod.title}」，停止旧期投稿和投票。${startsAt.getTime() > Date.now() ? "新期尚未开始，两期之间将暂时无法参与。" : ""}确认切换？`, "切换征集期", {
        confirmButtonText: "确认切换", cancelButtonText: "继续编辑", type: "warning",
      });
    } catch { saving.value = false; return; }
  }

  let written = false;
  try {
    const createdBy = authStore.adminUser?.id ?? "";
    if (editingId.value) {
      await api.upsertPeriod({
        id: editingId.value,
        title: form.value.title.trim(),
        startsAt: startsAt.getTime(),
        endsAt: endsAt.getTime(),
        createdBy,
      });
    } else {
      await api.createPeriod({
        title: form.value.title.trim(),
        startsAt: startsAt.getTime(),
        endsAt: endsAt.getTime(),
        createdBy,
      });
    }
    written = true;
    dialogVisible.value = false;
    await adminStore.refreshAll();
    ElMessage.success("征集期已保存");
  } catch (error) {
    ElMessage.error(written ? "征集期已保存，但数据刷新失败，请重新读取工作台。" : error?.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

async function handleArchive(period) {
  try {
    await ElMessageBox.confirm(`确认归档「${period.title}」？归档后学生将无法再向它投稿。`, "归档征集期", {
      confirmButtonText: "确认归档",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  archivingId.value = period.id;
  let written = false;
  try {
    await api.archivePeriod(period.id);
    written = true;
    await adminStore.refreshAll();
    ElMessage.success("已归档");
  } catch (error) {
    ElMessage.error(written ? "征集期已归档，但数据刷新失败，请重新读取工作台。" : error?.message || "归档失败");
  } finally {
    archivingId.value = "";
  }
}
</script>

<template>
  <div>
    <el-card class="panel-card" shadow="never">
      <template #header>
        <div style="display: flex; align-items: center; justify-content: space-between">
          <span>当前进行中的征集期</span>
          <el-button type="primary" @click="openCreate">新建征集期</el-button>
        </div>
      </template>

      <el-descriptions v-if="adminStore.currentPeriod" :column="1" border>
        <el-descriptions-item label="标题">{{ adminStore.currentPeriod.title }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag v-if="adminStore.currentPeriod.isTest" type="warning" size="small">测试期</el-tag>
          <el-tag :type="periodStatus(adminStore.currentPeriod).type" size="small">
            {{ periodStatus(adminStore.currentPeriod).label }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="操作">
          <el-button size="small" @click="openEdit(adminStore.currentPeriod)">编辑</el-button>
          <el-button
            size="small"
            type="danger"
            plain
            :loading="archivingId === adminStore.currentPeriod.id"
            @click="handleArchive(adminStore.currentPeriod)"
          >
            归档
          </el-button>
        </el-descriptions-item>
        <el-descriptions-item label="开始时间">{{ formatDateTime(adminStore.currentPeriod.startsAt) }}</el-descriptions-item>
        <el-descriptions-item label="结束时间">{{ formatDateTime(adminStore.currentPeriod.endsAt) }}</el-descriptions-item>
        <el-descriptions-item label="本期歌曲">{{ adminStore.songs.length }} 首</el-descriptions-item>
      </el-descriptions>
      <el-empty v-else description="当前没有进行中的征集期" :image-size="80" />
    </el-card>

    <TestModePanel />

    <el-card class="panel-card" shadow="never">
      <template #header>历史征集期</template>
      <el-table :data="adminStore.periods.filter((p) => p.status !== 'active')" stripe>
        <el-table-column prop="title" label="标题" min-width="180" />
        <el-table-column label="开始时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.startsAt) }}</template>
        </el-table-column>
        <el-table-column label="结束时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.endsAt) }}</template>
        </el-table-column>
        <el-table-column label="归档时间" width="180">
          <template #default="{ row }">{{ row.archivedAtMs ? formatDateTime(row.archivedAtMs) : "-" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.isTest" type="warning" size="small">测试期</el-tag>
            <el-tag :type="periodStatus(row).type" size="small">{{ periodStatus(row).label }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑征集期' : '新建征集期'"
      width="min(480px, 94vw)"
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      :show-close="!saving"
      destroy-on-close
    >
      <el-form label-width="90px" :disabled="saving" @submit.prevent="handleSave">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="80" placeholder="如：第 12 期校园歌单" />
        </el-form-item>
        <el-form-item label="开始时间" required>
          <el-date-picker
            v-model="form.startsAt"
            type="datetime"
            placeholder="选择开始时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="结束时间" required>
          <el-date-picker
            v-model="form.endsAt"
            type="datetime"
            placeholder="选择结束时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-alert
          v-if="!editingId"
          type="info"
          :closable="false"
          show-icon
          title="保存后立即切换征集期，旧期将归档。若新期开始时间在未来，在开始前无法投稿或投票；切换失败则保留旧期。"
          style="margin-bottom: 12px"
        />
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
