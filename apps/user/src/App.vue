<script setup>
import { computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { usePeriodStore } from "./stores/period";
import { useSongsStore } from "./stores/songs";
import { useAnnouncementStore } from "./stores/announcement";
import AppLayout from "./layouts/AppLayout.vue";
import AnnouncementModal from "./components/AnnouncementModal.vue";
import IdentityNotice from "./components/IdentityNotice.vue";
import TestModeAccess from "./components/TestModeAccess.vue";
import { supabase } from "./services/supabase";

const route = useRoute();
const authStore = useAuthStore();
const periodStore = usePeriodStore();
const songsStore = useSongsStore();
const announcementStore = useAnnouncementStore();

let clock;
let refreshTimer;
let ready = false;
let disposed = false;
let authSubscription;
let authRefreshTimer;
const testLocked = computed(() => periodStore.currentPeriod?.isTest && !authStore.isTester);
function refreshVisibleData(maxAge = 15000) {
  if (!ready || document.visibilityState !== "visible") return;
  songsStore.refresh({ background: true, maxAge });
  announcementStore.fetchAnnouncements({ background: true, maxAge });
}
const onFocus = () => {
  refreshVisibleData();
  if (document.visibilityState === "visible") authStore.restoreQqUser();
};
const onOnline = () => refreshVisibleData(0);
watch(() => route.path, (path) => {
  if (path === "/" || path === "/playlist") refreshVisibleData(0);
});
watch(() => authStore.qqUser?.openid, () => {
  songsStore.clearPersonalState();
  if (ready) songsStore.refresh({ background: true });
});
onBeforeUnmount(() => {
  disposed = true;
  clearInterval(clock);
  clearInterval(refreshTimer);
  clearTimeout(authRefreshTimer);
  authSubscription?.unsubscribe();
  window.removeEventListener("focus", onFocus);
  window.removeEventListener("online", onOnline);
  document.removeEventListener("visibilitychange", onFocus);
});

onMounted(async () => {
  authStore.initBackend();
  clock = setInterval(() => { periodStore.now = Date.now(); }, 1000);

  // OAuth codes are consumed by the backend; only a verified session reaches Vue.
  authStore.readQqCallbackError();
  const qqSession = authStore.restoreQqUser();
  // Test login is verified by refresh() after reading the period. Public loading
  // must not wait on an unrelated tester permission request.
  if (disposed) return;
  authSubscription = supabase?.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" || authStore.testAuthBusy) return;
    // Avoid Supabase calls inside the auth callback's session lock.
    if (!session?.user) {
      authStore.clearTestSession();
      if (periodStore.currentPeriod?.isTest) songsStore.resetForNoPeriod();
    }
    clearTimeout(authRefreshTimer);
    authRefreshTimer = setTimeout(async () => {
      if (disposed) return;
      try { await authStore.syncTestSession(session); }
      catch { if (periodStore.currentPeriod?.isTest) songsStore.resetForNoPeriod(); }
      if (periodStore.currentPeriod?.isTest) songsStore.refresh();
    }, 0);
  }).data.subscription;

  // Public reading remains available even when a visitor identity cannot be stored.
  await Promise.allSettled([
    songsStore.refresh(),
    announcementStore.fetchAnnouncements(),
  ]);
  if (disposed) return;
  ready = true;
  // Login restoration runs independently of the public song read. If it settles
  // during that read, sync personal votes once the initial refresh has finished.
  qqSession.then(() => { if (!disposed && authStore.isQqLoggedIn) songsStore.refresh({ background: true }); });
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onFocus);
  refreshTimer = setInterval(() => refreshVisibleData(), 60000);
});
</script>

<template>
  <AppLayout>
    <IdentityNotice v-if="route.path !== '/me'" />
    <TestModeAccess v-if="periodStore.currentPeriod?.isTest && route.path !== '/me'" />
    <router-view v-if="!testLocked || route.path === '/history' || route.path === '/me'" :key="authStore.isTester ? authStore.testUser?.id : 'visitor'" />
  </AppLayout>

  <AnnouncementModal />
</template>
