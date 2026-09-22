import { createRouter, createWebHashHistory } from "vue-router";
import HomeView from "../views/HomeView.vue";
import PlaylistView from "../views/PlaylistView.vue";
import HistoryView from "../views/HistoryView.vue";
import AdminView from "../views/AdminView.vue";

const routes = [
  { path: "/", name: "home", component: HomeView },
  { path: "/playlist", name: "playlist", component: PlaylistView },
  { path: "/history", name: "history", component: HistoryView },
  { path: "/admin", name: "admin", component: AdminView },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition || { top: 0 };
  },
});

export default router;
