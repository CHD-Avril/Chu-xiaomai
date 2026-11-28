import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "vite";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { renderToString } from "@vue/server-renderer";

test("production configuration renders a direct QQ link, preserves route and needs no session preflight", async () => {
  const saved = Object.fromEntries(["fetch", "location", "window", "localStorage", "history"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let server;
  try {
    let assigned;
    let requests = 0;
    globalThis.location = { origin: "https://chuxiaomai.cyou", href: "https://chuxiaomai.cyou/?keep=yes#/old", assign: (value) => { assigned = value; } };
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    globalThis.localStorage = { removeItem() {} };
    globalThis.history = { state: {}, replaceState() {} };
    globalThis.fetch = async () => { requests++; return new Promise(() => {}); };
    server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), mode: "production", server: { middlewareMode: true, hmr: { server: createHttpServer() } }, appType: "custom" });
    const { qqEnabled, qqAuthBase, getQqAuthorizeUrl, qqRequest } = await server.ssrLoadModule("/src/services/qq.js");
    assert.equal(qqEnabled, true);
    assert.equal(qqAuthBase, "/qq");
    const { useAuthStore } = await server.ssrLoadModule("/src/stores/auth.js");
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.qqLogin();
    assert.equal(requests, 0);
    const target = new URL(assigned);
    assert.equal(target.pathname, "/qq/authorize");
    assert.equal(target.searchParams.get("return_to"), location.href);
    assert.equal(target.searchParams.get("display"), "mobile");
    assert(!new URL(getQqAuthorizeUrl(location.href)).searchParams.has("display"));

    const { default: Header } = await server.ssrLoadModule("/src/components/AppHeader.vue");
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
    await router.push("/playlist?song=kept");
    await router.isReady();
    const html = await renderToString(createSSRApp(Header).use(createPinia()).use(router));
    const href = /<a[^>]+class="qq-login-button"[^>]+href="([^"]+)"/.exec(html)?.[1];
    assert(href, "QQ login must render a native link, not just a click handler");
    const rendered = new URL(href.replaceAll("&amp;", "&"));
    assert.equal(rendered.pathname, "/qq/authorize");
    assert.equal(new URL(rendered.searchParams.get("return_to")).hash, "#/playlist?song=kept");
    assert.equal(requests, 0);

    globalThis.fetch = async () => new Response("<html>nginx fallback</html>", { headers: { "Content-Type": "text/html" } });
    await assert.rejects(() => qqRequest("/session"), /QQ 登录服务/);
    globalThis.fetch = async () => { throw new Error("access_token=must-not-show"); };
    await assert.rejects(() => qqRequest("/session"), (error) => !error.message.includes("must-not-show"));
  } finally {
    await server?.close();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("demo login uses a same-origin bearer session and logout clears it", async () => {
  const saved = Object.fromEntries(["fetch", "location", "window", "localStorage", "history"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const savedEnv = Object.fromEntries(["VITE_QQ_AUTH_BASE", "VITE_DEMO_LOGIN", "VITE_SUPABASE_URL", "VITE_ANON_KEY"].map((key) => [key, process.env[key]]));
  let server;
  try {
    Object.assign(process.env, {
      VITE_QQ_AUTH_BASE: "/qq",
      VITE_DEMO_LOGIN: "1",
      VITE_SUPABASE_URL: "https://demo.supabase.co",
      VITE_ANON_KEY: "demo-anon-key",
    });
    globalThis.location = { origin: "https://chuxiaomai.cyou", href: "https://chuxiaomai.cyou/#/playlist", assign() { throw new Error("demo login must not navigate to QQ"); } };
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    globalThis.localStorage = { removeItem() {} };
    globalThis.history = { state: {}, replaceState() {} };
    server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), mode: "production", server: { middlewareMode: true, hmr: { server: createHttpServer() } }, appType: "custom" });
    const { supabase } = await server.ssrLoadModule("/src/services/supabase.js");
    let session = { access_token: "demo-access-token" };
    let signOutCalls = 0;
    supabase.auth.getSession = async () => ({ data: { session } });
    supabase.auth.signInWithPassword = async ({ email }) => ({ data: { session: { user: { id: "demo-user", email } } }, error: null });
    supabase.auth.signOut = async () => { signOutCalls++; session = null; return { error: null }; };
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url === "/qq/session") return Response.json({ user: { openid: "DEMO_demo-user" }, mode: "demo" });
      if (url === "/qq/participate") return Response.json({ account: "ready" });
      if (url === "/qq/logout") return Response.json({ ok: true });
      throw new Error(`unexpected request: ${url}`);
    };

    const { useAuthStore } = await server.ssrLoadModule("/src/stores/auth.js");
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.qqLogin();
    assert.equal(auth.demoDialogOpen, true);
    assert.equal(calls.length, 0);
    await auth.demoLogin("judge@chu.demo", "demo-password");
    assert.equal(auth.isQqLoggedIn, true);
    assert.equal(auth.qqUser.openid, "DEMO_demo-user");
    assert.equal(auth.qqAccount.account, "ready");
    assert(calls.some(({ url, options }) => url === "/qq/session" && options.headers.Authorization === "Bearer demo-access-token"));
    assert(calls.some(({ url, options }) => url === "/qq/participate" && options.headers.Authorization === "Bearer demo-access-token"));
    assert(calls.every(({ url, options }) => !url.includes("demo-access-token") && options.credentials === "same-origin"));

    await auth.qqLogout();
    assert.equal(signOutCalls, 1);
    assert.equal(auth.isQqLoggedIn, false);
    assert.equal(auth.qqAccount, null);
    assert.equal(calls.at(-1).url, "/qq/logout");
    assert.equal(calls.at(-1).options.headers.Authorization, "Bearer demo-access-token");
  } finally {
    await server?.close();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
