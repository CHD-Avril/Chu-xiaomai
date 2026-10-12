<script setup>
import { useAnnouncementStore } from "../stores/announcement";
import { useDialog } from "../composables/useDialog";

const store = useAnnouncementStore();
const dialog = useDialog(() => store.modalOpen, handleClose);

function handleClose() {
  if (store.currentAnnouncement?.id) {
    localStorage.setItem("chu_announcement_seen", String(store.currentAnnouncement.id));
  }
  store.closeModal();
}
</script>

<template>
  <div
    v-if="store.modalOpen && store.currentAnnouncement"
    class="modal-overlay"
    @click.self="handleClose()"
  >
    <div ref="dialog" class="announcement-modal" role="dialog" aria-modal="true" aria-labelledby="announcementTitle" tabindex="-1">
      <div class="modal-header">
        <div>
          <p class="section-tag">广播台公告</p>
          <h2 id="announcementTitle">公告</h2>
        </div>
        <button class="icon-button" type="button" aria-label="关闭公告" @click="handleClose()">&times;</button>
      </div>
      <div class="announcement-modal-body">
        <h3 class="announcement-title">{{ store.currentAnnouncement.title }}</h3>
        <p>{{ store.currentAnnouncement.content }}</p>
      </div>
      <div class="modal-footer">
        <button class="primary-button compact-button" type="button" @click="handleClose()">我知道了</button>
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
