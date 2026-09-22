<script setup>
import { useAnnouncementStore } from "../stores/announcement";
import { formatDateTime } from "../utils/format";

const store = useAnnouncementStore();
</script>

<template>
  <aside class="card notice-board">
    <p class="section-tag">Notice Board</p>
    <h2>告示栏</h2>
    <p class="section-note" style="text-align: left">广播台通知会保存在这里，点击告示可查看完整内容。</p>
    <div class="notice-board-list">
      <template v-if="store.configError">
        <div class="empty-inline">公告读取失败，请稍后刷新重试。</div>
      </template>
      <template v-else-if="store.announcements.length">
        <button
          v-for="item in store.announcements"
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
  </aside>
</template>
