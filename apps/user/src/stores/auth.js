import { defineStore } from "pinia";
import { supabase, hasValidConfig } from "../services/supabase";
import { getOrCreateVisitorId } from "../services/identity";
import { isAdminEmailAllowed, isCurrentUserAdmin } from "../services/api";
import { qqAuthBase, qqEnabled, QQ_USER_STORAGE_KEY } from "../services/qq";

let testSessionRequest = 0;

export const useAuthStore = defineStore("auth", {
  state: () => ({
    visitorId: "",
    backendReady: false,
    configError: false,
    identityError: "",
    isAdmin: false,
    adminUser: null,
    qqUser: null,
    testUser: null,
    isTester: false,
    testAuthBusy: false,
  }),

  getters: {
    isQqLoggedIn: (state) => Boolean(state.qqUser?.openid),
  },

  actions: {
    async syncTestSession(sessionOverride) {
      const request = ++testSessionRequest;
      let session = sessionOverride;
      if (session === undefined && supabase) {
        const { data, error } = await supabase.auth.getSession();
        if (error) { this.clearTestSession(); throw error; }
        session = data.session;
      }
      if (request !== testSessionRequest) return false;
      if (this.testUser?.id !== session?.user?.id) this.isTester = false;
      this.testUser = session?.user ?? null;
      if (!this.testUser) this.isTester = false;
      if (!this.testUser) return false;
      try {
        const { data, error } = await supabase.rpc("is_current_user_tester");
        if (error) throw error;
        if (request === testSessionRequest) this.isTester = data === true;
        return request === testSessionRequest && this.isTester;
      } catch (error) {
        if (request === testSessionRequest) this.clearTestSession();
        throw error;
      }
    },

    clearTestSession() {
      testSessionRequest += 1;
      this.testUser = null;
      this.isTester = false;
    },

    async testLogin(email, password) {
      if (!supabase) throw new Error("暂时无法连接登录服务。");
      this.testAuthBusy = true;
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error("登录失败，请检查邮箱和密码，或联系运营人员确认账号。");
        if (!await this.syncTestSession(data.session)) {
          await supabase.auth.signOut({ scope: "local" });
          this.clearTestSession();
          throw new Error("该账号尚未获得测试权限，请联系运营人员授权。");
        }
      } finally {
        this.testAuthBusy = false;
      }
    },

    async testLogout() {
      this.clearTestSession();
      if (supabase) {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw new Error("退出未完成，请重试。");
      }
    },

    // 初始化访客身份（Cookie），标记后端可用
    initIdentity() {
      this.identityError = "";
      this.visitorId = "";
      this.backendReady = hasValidConfig;
      this.configError = !hasValidConfig;
      if (!hasValidConfig) {
        return false;
      }
      try {
        this.visitorId = getOrCreateVisitorId();
        return true;
      } catch {
        this.identityError = "浏览器暂未允许本站 Cookie，仍可浏览歌单和公告。允许本站 Cookie 后，可重新尝试开启投稿和投票。";
        return false;
      }
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
      try { localStorage.setItem(QQ_USER_STORAGE_KEY, JSON.stringify(this.qqUser)); }
      catch { /* Keep the login in memory when browser storage is unavailable. */ }
      return true;
    },

    qqLogout() {
      this.qqUser = null;
      try { localStorage.removeItem(QQ_USER_STORAGE_KEY); }
      catch { /* The in-memory login has already been cleared. */ }
    },
  },
});
