import { defineStore } from "pinia";
import { supabase, hasValidConfig } from "../services/supabase";
import { isAdminEmailAllowed, isCurrentUserAdmin } from "../services/api";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    isAdmin: false,
    adminUser: null,
    sessionChecked: false,
    configError: false,
  }),

  actions: {
    async restoreSession() {
      this.sessionChecked = true;
      if (!supabase) {
        this.configError = true;
        return;
      }
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session?.user) return;

      const isAdmin = await isCurrentUserAdmin();
      if (isAdmin !== true) {
        await supabase.auth.signOut();
        return;
      }
      this.isAdmin = true;
      this.adminUser = data.session.user;
    },

    async login(email, password) {
      if (!supabase) throw new Error("Supabase 尚未配置，无法登录。");
      const isAllowed = await isAdminEmailAllowed(email);
      if (isAllowed !== true) throw new Error("这个邮箱未被授权为管理员。");

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const isAdmin = await isCurrentUserAdmin();
      if (isAdmin !== true) {
        await supabase.auth.signOut();
        throw new Error("这个邮箱未被授权为管理员。");
      }
      this.isAdmin = true;
      this.adminUser = data.session.user;
      this.sessionChecked = true;
      return true;
    },

    async logout() {
      if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) console.warn("退出登录失败:", error);
      }
      this.isAdmin = false;
      this.adminUser = null;
      this.sessionChecked = true;
    },
  },
});
