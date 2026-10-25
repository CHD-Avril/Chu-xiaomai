import { defineStore } from "pinia";
import { supabase, hasValidConfig } from "../services/supabase";
import { isAdminEmailAllowed, isCurrentUserAdmin } from "../services/api";
import { qqEnabled, QQ_USER_STORAGE_KEY, qqRequest, qqErrorMessages, getQqAuthorizeUrl } from "../services/qq";
import { readRequest } from "../services/readRequest";

let testSessionRequest = 0;
let qqSessionRequest = 0;

export const useAuthStore = defineStore("auth", {
  state: () => ({
    backendReady: false,
    configError: false,
    isAdmin: false,
    adminUser: null,
    qqUser: null,
    qqBusy: false,
    qqMode: "",
    qqError: "",
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
        let data;
        try { data = await readRequest("读取测试登录状态", () => supabase.auth.getSession()); }
        catch (error) { if (request === testSessionRequest) this.clearTestSession(); throw error; }
        session = data.session;
      }
      if (request !== testSessionRequest) return false;
      if (this.testUser?.id !== session?.user?.id) this.isTester = false;
      this.testUser = session?.user ?? null;
      if (!this.testUser) this.isTester = false;
      if (!this.testUser) return false;
      try {
        const data = await readRequest("验证测试账号权限", (signal) => supabase.rpc("is_current_user_tester").abortSignal(signal));
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

    // Browsing needs no writable browser identity; participation uses QQ sessions.
    initBackend() {
      this.backendReady = hasValidConfig;
      this.configError = !hasValidConfig;
      return hasValidConfig;
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

    // ---------- QQ login: server-verified HttpOnly session ----------
    async restoreQqUser() {
      try { localStorage.removeItem(QQ_USER_STORAGE_KEY); } catch { /* Legacy data is never trusted. */ }
      if (!qqEnabled || this.qqBusy) return;
      const request = ++qqSessionRequest;
      try {
        const data = await qqRequest("/session");
        if (request !== qqSessionRequest) return;
        this.qqUser = data.user?.openid ? data.user : null;
        this.qqMode = data.mode;
      } catch (error) {
        if (request !== qqSessionRequest) return;
        this.qqUser = null;
        this.qqError = error.message;
      }
    },

    readQqCallbackError() {
      const url = new URL(location.href);
      const error = url.searchParams.get("qq_error");
      if (!error) return;
      this.qqError = qqErrorMessages[error] || "QQ 登录未完成，请重试。";
      url.searchParams.delete("qq_error");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    },

    qqLogin() {
      if (this.qqBusy) return;
      this.qqError = "";
      ++qqSessionRequest;
      try {
        // Navigate synchronously: authorization must not wait for /session.
        location.assign(getQqAuthorizeUrl(location.href, window.matchMedia("(max-width: 767px)").matches));
      } catch (error) {
        this.qqError = error.message;
      }
    },

    async qqLogout() {
      if (this.qqBusy) return;
      this.qqBusy = true;
      this.qqError = "";
      ++qqSessionRequest;
      try {
        await qqRequest("/logout", { method: "POST" });
        this.qqUser = null;
      } catch (error) {
        this.qqError = `退出未完成。${error.message}`;
      } finally {
        this.qqBusy = false;
      }
    },
  },
});
