<script setup>
import { useAnnouncementStore } from "../stores/announcement";
import { formatDateTime } from "../utils/format";
import { computed, ref, watch } from "vue";
import Pagination from "./Pagination.vue";

const store = useAnnouncementStore();
const currentPage = ref(1);
const pageCount = computed(() => Math.max(1, Math.ceil(store.announcements.length / 2)));
const announcements = computed(() => store.announcements.slice((currentPage.value - 1) * 2, currentPage.value * 2));
watch(pageCount, count => { currentPage.value = Math.min(currentPage.value, count); });
</script>

<template>
  <aside id="station-notices" class="card notice-board">
    <div class="section-head"><h2>广播台公告</h2><span class="section-note">近期消息</span></div>
    <div class="notice-board-list">
      <template v-if="store.configError">
        <div class="empty-inline">公告读取失败，请稍后刷新重试。</div>
        <button class="text-link" type="button" @click="store.fetchAnnouncements()">重试 ↻</button>
      </template>
      <div v-else-if="store.isLoading" class="empty-inline" role="status">正在读取广播台消息…</div>
      <template v-else-if="store.announcements.length">
        <button
          v-for="item in announcements"
          :key="item.id"
          class="notice-item"
          type="button"
          @click="store.openModal(item, 'manual')"
        >
          <strong>{{ item.title }}</strong>
          <time :datetime="item.created_at">{{ formatDateTime(Date.parse(item.created_at) || 0) }}</time>
        </button>
      </template>
      <div v-else class="empty-inline">暂时还没有公告，稍后再来看看吧。</div>
    </div>
    <Pagination v-if="!store.isLoading && !store.configError" compact label="公告翻页" :current-page="currentPage" :page-count="pageCount" @change="currentPage = $event" />
  </aside>
</template>
