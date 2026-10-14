import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createPinia, setActivePinia } from "pinia";

test("real API/store flow reports the failing read, recovers, preserves stale data and isolates test periods", async () => {
  const originalFetch = globalThis.fetch;
  let failure = "get_my_likes";
  let isTest = false;
  let testerAllowed = false;
  const requests = [];
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    requests.push(path);
    const name = path.split("/").at(-1);
    if (name === failure) return new Response(JSON.stringify({ code: "42501", message: "permission denied" }), { status: 403 });
    let data;
    if (name === "playlist_periods") data = [{ id: "period", title: "本期", status: "active", starts_at: "2020-01-01", ends_at: "2099-01-01", is_test: isTest }];
    else if (name === "songs") data = [{ id: "song", title: "晴天", artist: "周杰伦" }];
    else if (["get_my_likes", "get_my_dislikes"].includes(name)) data = [];
    else if (name === "is_current_user_tester") data = testerAllowed;
    else throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  let server;
  try {
    server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), mode: "test", server: { middlewareMode: true }, appType: "custom" });
    const { useSongsStore } = await server.ssrLoadModule("/src/stores/songs.js");
    const { useAuthStore } = await server.ssrLoadModule("/src/stores/auth.js");
    const { useDraftStore } = await server.ssrLoadModule("/src/stores/draft.js");
    const { supabase } = await server.ssrLoadModule("/src/services/supabase.js");
    setActivePinia(createPinia());
    const songs = useSongsStore(), auth = useAuthStore(), draft = useDraftStore();
    auth.backendReady = true;
    auth.visitorId = "visitor";
    draft.draft.title = "草稿";

    await songs.refresh();
    assert.equal(songs.connectionIssue.operation, "读取个人喜欢记录");
    assert.equal(songs.connectionIssue.label, "访问受限");
    assert.equal(songs.canMutate, false);
    assert.equal(songs.songs.length, 0);
    assert.equal(draft.draft.title, "草稿");

    failure = "";
    await songs.refresh();
    assert.equal(songs.connectionIssue, null);
    assert.equal(songs.errorMessage, "");
    assert.equal(songs.songs.length, 1);
    assert.equal(songs.canMutate, true);

    failure = "songs";
    await songs.refresh({ background: true });
    assert.equal(songs.connectionIssue.operation, "读取歌单");
    assert(songs.refreshError);
    assert.equal(songs.songs.length, 1);
    assert.equal(songs.canMutate, false);
    assert.equal(draft.draft.title, "草稿");

    failure = "";
    isTest = true;
    supabase.auth.getSession = async () => ({ data: { session: { user: { id: "tester" } } }, error: null });
    requests.length = 0;
    await songs.refresh();
    assert.equal(auth.isTester, false);
    assert.equal(songs.songs.length, 0);
    assert.equal(songs.canMutate, false);
    assert(!requests.some((path) => path.endsWith("/songs")));
    testerAllowed = true;
    await songs.refresh();
    assert.equal(auth.isTester, true);
    assert.equal(songs.songs.length, 1);
    assert.equal(songs.canMutate, true);
    testerAllowed = false;
    await songs.refresh({ background: true });
    assert.equal(songs.songs.length, 0);
    assert.equal(songs.canMutate, false);
    assert(!requests.some((path) => /submit_song|toggle_song/.test(path)));
  } finally {
    globalThis.fetch = originalFetch;
    await server?.close();
  }
});
