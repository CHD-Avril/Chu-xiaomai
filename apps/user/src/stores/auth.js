import { defineStore } from "pinia";
import { supabase, hasValidConfig } from "../services/supabase";
import { getOrCreateVisitorId } from "../services/identity";
import { isAdminEmailAllowed, isCurrentUserAdmin } from "../services/api";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    visitorId: "",
    backendReady: false,
    configError: false,
    isAdmin: false,
    adminUser: null,
  }),

  actions: {
    // 初始化访客身份（Cookie），标记后端可用
    initIdentity() {
      if (!hasValidConfig) {
        this.configError = true;
        this.backendReady = false;
        return;
      }
      this.visitorId = getOrCreateVisitorId();
      this.backendReady = true;
    },

    async syncAdminSession(sessionOverride) {
      if (!supabase) {
        this.setAdmin(false);
        return false;
      }
      let session = sessionOverride;
      if (!session) {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        session = data.session;
      }
      if (!session?.user) {
        this.setAdmin(false);
        return false;
      }

      const isAdmin = await isCurrentUserAdmin();
      if (isAdmin !== true) {
        await supabase.auth.signOut();
        this.setAdmin(false);
        return false;
      }

      this.setAdmin(true, session.user);
      return true;
    },

    setAdmin(isAdmin, user = null) {
      this.isAdmin = Boolean(isAdmin);
      this.adminUser = isAdmin ? user : null;
    },

    async adminLogin(email, password) {
      if (!supabase) throw new Error("Supabase 尚未配置，无法登录。");

      const isAllowed = await isAdminEmailAllowed(email);
      if (isAllowed !== true) throw new Error("这个邮箱未被授权为管理员。");

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const ok = await this.syncAdminSession(data.session);
      if (!ok) throw new Error("这个邮箱未被授权为管理员。");
      return true;
    },

    async adminLogout() {
      if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) console.warn("管理员退出失败:", error);
      }
      this.setAdmin(false);
    },
  },
});
