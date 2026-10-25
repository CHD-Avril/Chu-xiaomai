import { createRouter, createWebHashHistory } from "vue-router";
import HomeView from "../views/HomeView.vue";
import PlaylistView from "../views/PlaylistView.vue";
import HistoryView from "../views/HistoryView.vue";
import ProfileView from "../views/ProfileView.vue";
import { getAdminUrl } from "../services/adminEntry";

const routes = [
  { path: "/", name: "home", component: HomeView },
  { path: "/playlist", name: "playlist", component: PlaylistView },
  { path: "/history", name: "history", component: HistoryView },
  { path: "/me", name: "profile", component: ProfileView },
  { path: "/admin", name: "admin", beforeEnter: () => { location.replace(getAdminUrl()); return false; } },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    if (to.hash) return { el: to.hash, top: 16 };
    // The song list reveals a target only after data and its page have rendered.
    if (to.name === "playlist" && (to.query.song || to.query.songTitle)) return false;
    return savedPosition || { top: 0 };
  },
});

export default router;
