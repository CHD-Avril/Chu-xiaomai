import { createRouter, createWebHashHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import LoginView from "../views/LoginView.vue";
import DashboardView from "../views/DashboardView.vue";

const routes = [
  { path: "/login", name: "login", component: LoginView },
  { path: "/", name: "dashboard", component: DashboardView, meta: { requiresAuth: true } },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();
  if (!authStore.sessionChecked) {
    try {
      await authStore.restoreSession();
    } catch (error) {
      console.warn("会话恢复失败:", error);
    }
  }
  if (to.meta.requiresAuth && !authStore.isAdmin) {
    return { name: "login" };
  }
  if (to.name === "login" && authStore.isAdmin) {
    return { name: "dashboard" };
  }
  return true;
});

export default router;
