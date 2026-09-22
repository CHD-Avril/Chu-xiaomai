<script setup>
import { useAnnouncementStore } from "../stores/announcement";

const store = useAnnouncementStore();
</script>

<template>
  <div
    v-if="store.modalOpen && store.currentAnnouncement"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @click.self="store.closeModal()"
  >
    <div class="announcement-modal">
      <div class="modal-header">
        <div>
          <p class="section-tag">Notice</p>
          <h2>公告</h2>
        </div>
        <button class="icon-button" type="button" aria-label="关闭公告" @click="store.closeModal()">&times;</button>
      </div>
      <div class="announcement-modal-body">
        <h3 class="announcement-title">{{ store.currentAnnouncement.title }}</h3>
        <p>{{ store.currentAnnouncement.content }}</p>
      </div>
      <div class="modal-footer">
        <button class="primary-button compact-button" type="button" @click="store.closeModal()">我知道了</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.announcement-title {
  margin: 0 0 10px;
  font-size: 1.05rem;
  font-weight: 900;
}
</style>
