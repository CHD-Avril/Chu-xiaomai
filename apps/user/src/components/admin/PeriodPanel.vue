<script setup>
import { onMounted, ref } from "vue";
import { usePeriodStore } from "../../stores/period";
import { useAuthStore } from "../../stores/auth";
import * as api from "../../services/api";
import { formatDateTimeLocalInput, parseDateTimeLocal } from "../../utils/format";

const periodStore = usePeriodStore();
const authStore = useAuthStore();

const title = ref("");
const startValue = ref("");
const endValue = ref("");
const hint = ref("");
const saving = ref(false);
const archiving = ref(false);

onMounted(() => {
  const period = periodStore.currentPeriod;
  if (period) {
    title.value = period.title;
    startValue.value = formatDateTimeLocalInput(period.startsAt);
    endValue.value = formatDateTimeLocalInput(period.endsAt);
    hint.value = "当前征集期已加载，可直接修改后保存。";
  } else {
    hint.value = "当前没有进行中的征集期，可填写信息新建一期。";
  }
});

async function handleSave() {
  const startsAt = parseDateTimeLocal(startValue.value);
  const endsAt = parseDateTimeLocal(endValue.value);
  if (!title.value.trim()) {
    hint.value = "请填写征集期标题。";
    return;
  }
  if (!startsAt || !endsAt) {
    hint.value = "请填写完整的开始与结束时间。";
    return;
  }
  if (startsAt.getTime() >= endsAt.getTime()) {
    hint.value = "开始时间必须早于结束时间。";
    return;
  }

  saving.value = true;
  hint.value = "";
  try {
    const current = periodStore.currentPeriod;
    const createdBy = authStore.adminUser?.id ?? "";
    if (current) {
      await api.upsertPeriod({ id: current.id, title: title.value.trim(), startsAt: startsAt.getTime(), endsAt: endsAt.getTime(), createdBy });
    } else {
      // 与旧版一致：新建征集期前自动归档所有进行中的征集期
      await api.archiveAllActivePeriods();
      await api.upsertPeriod({ title: title.value.trim(), startsAt: startsAt.getTime(), endsAt: endsAt.getTime(), createdBy });
    }
    await periodStore.fetchPeriods();
    hint.value = "征集期已保存。";
  } catch (error) {
    hint.value = error?.message || error?.details || "保存失败。";
  } finally {
    saving.value = false;
  }
}

async function handleArchive() {
  if (!periodStore.currentPeriod) {
    hint.value = "当前没有可归档的征集期。";
    return;
  }
  archiving.value = true;
  hint.value = "";
  try {
    await api.archivePeriod(periodStore.currentPeriod.id);
    await periodStore.fetchPeriods();
    hint.value = "当前征集期已归档。";
  } catch (error) {
    hint.value = error?.message || error?.details || "归档失败。";
  } finally {
    archiving.value = false;
  }
}
</script>

<template>
  <div class="period-panel admin-block">
    <p class="section-tag">Period</p>
    <h3>征集期设置</h3>
    <p class="section-note">设置当前开放投稿与点赞的时间窗口。</p>
    <form class="period-form" @submit.prevent="handleSave">
      <label class="field">
        <span>征集期标题</span>
        <input v-model="title" type="text" maxlength="80" placeholder="如：第 12 期校园歌单" required />
      </label>
      <div class="period-time-grid">
        <label class="field">
          <span>开始时间</span>
          <input v-model="startValue" type="datetime-local" required />
        </label>
        <label class="field">
          <span>结束时间</span>
          <input v-model="endValue" type="datetime-local" required />
        </label>
      </div>
      <div class="admin-actions">
        <button class="primary-button compact-button" type="submit" :disabled="saving">
          {{ saving ? "保存中..." : "保存征集期" }}
        </button>
        <button class="primary-button secondary-btn compact-button" type="button" :disabled="archiving" @click="handleArchive">
          {{ archiving ? "归档中..." : "归档当前歌单" }}
        </button>
      </div>
    </form>
    <p class="form-hint" :class="{ 'is-error': hint && !periodStore.currentPeriod }">{{ hint }}</p>
  </div>
</template>
