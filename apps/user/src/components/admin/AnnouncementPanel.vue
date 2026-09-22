<script setup>
import { ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import { useAnnouncementStore } from "../../stores/announcement";
import * as api from "../../services/api";

const authStore = useAuthStore();
const announcementStore = useAnnouncementStore();

const title = ref("");
const content = ref("");
const hint = ref("");
const publishing = ref(false);
const disabling = ref(false);

async function handlePublish() {
  if (!title.value.trim() || !content.value.trim()) {
    hint.value = "请填写公告标题和内容。";
    return;
  }
  publishing.value = true;
  hint.value = "";
  try {
    await api.insertAnnouncement({
      title: title.value.trim(),
      content: content.value.trim(),
      createdBy: authStore.adminUser?.id ?? "",
    });
    title.value = "";
    content.value = "";
    await announcementStore.fetchAnnouncements();
    hint.value = "公告已发布。";
  } catch (error) {
    hint.value = error?.message || error?.details || "发布失败。";
  } finally {
    publishing.value = false;
  }
}

async function handleDisable() {
  const latest = announcementStore.announcements[0];
  if (!latest) {
    hint.value = "当前没有活跃公告。";
    return;
  }
  disabling.value = true;
  hint.value = "";
  try {
    await api.disableAnnouncement(latest.id);
    await announcementStore.fetchAnnouncements();
    hint.value = "最新公告已关闭。";
  } catch (error) {
    hint.value = error?.message || error?.details || "操作失败。";
  } finally {
    disabling.value = false;
  }
}
</script>

<template>
  <form class="announcement-form admin-block" @submit.prevent="handlePublish">
    <p class="section-tag">Notice</p>
    <h3>公告发布</h3>
    <label class="field">
      <span>公告标题</span>
      <input v-model="title" type="text" maxlength="100" placeholder="如：本期征集开始啦" required />
    </label>
    <label class="field">
      <span>公告内容</span>
      <textarea v-model="content" maxlength="1000" placeholder="写下要展示给同学们的通知" rows="5" required></textarea>
    </label>
    <div class="admin-actions">
      <button class="primary-button compact-button" type="submit" :disabled="publishing">
        {{ publishing ? "发布中..." : "发布公告" }}
      </button>
      <button class="primary-button secondary-btn compact-button" type="button" :disabled="disabling" @click="handleDisable">
        {{ disabling ? "处理中..." : "关闭最新公告" }}
      </button>
    </div>
    <p class="form-hint">{{ hint || "最新公告会弹窗展示，最近三条公告会保存在首页告示栏。" }}</p>
  </form>
</template>
