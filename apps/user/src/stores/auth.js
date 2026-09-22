import { defineStore } from "pinia";
import { supabase, hasValidConfig } from "../services/supabase";
import { getOrCreateVisitorId } from "../services/identity";
import { isAdminEmailAllowed, isCurrentUserAdmin } from "../services/api";
import { qqAuthBase, qqEnabled, QQ_USER_STORAGE_KEY } from "../services/qq";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    visitorId: "",
    backendReady: false,
    configError: false,
    isAdmin: false,
    adminUser: null,
    qqUser: null,
  }),

  getters: {
    isQqLoggedIn: (state) => Boolean(state.qqUser?.openid),
  },

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

    // ---------- QQ 登录（任务①，Mock 联调） ----------

    restoreQqUser() {
      if (!qqEnabled) return;
      try {
        const saved = localStorage.getItem(QQ_USER_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.openid) this.qqUser = parsed;
        }
      } catch (error) {
        console.warn("恢复 QQ 登录态失败:", error);
      }
    },

    // 跳转 QQ 授权页（Mock 模式下为本地模拟登录页）
    qqLogin() {
      if (!qqEnabled) return;
      const state = (crypto?.randomUUID?.() ?? `state_${Date.now()}`);
      const redirectUri = `${location.origin}${location.pathname}`;
      location.href = `${qqAuthBase}/qq/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    },

    // 用授权回调的 code 换取用户信息（Mock 走本地 server；真实版由后端代理）
    async handleQqCallback(code) {
      if (!qqEnabled || !code) return false;

      const tokenResp = await fetch(`${qqAuthBase}/qq/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!tokenResp.ok) throw new Error("获取 QQ 授权令牌失败");

      const { access_token: accessToken } = await tokenResp.json();
      if (!accessToken) throw new Error("QQ 授权令牌为空");

      const meResp = await fetch(`${qqAuthBase}/qq/me?access_token=${encodeURIComponent(accessToken)}`);
      if (!meResp.ok) throw new Error("获取 QQ 用户信息失败");

      const profile = await meResp.json();
      this.qqUser = {
        openid: profile.openid,
        nickname: profile.nickname || "QQ 用户",
        avatar: profile.figureurl || "",
      };
      localStorage.setItem(QQ_USER_STORAGE_KEY, JSON.stringify(this.qqUser));
      return true;
    },

    qqLogout() {
      this.qqUser = null;
      localStorage.removeItem(QQ_USER_STORAGE_KEY);
    },
  },
});
