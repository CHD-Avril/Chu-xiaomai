import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "vite";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { renderToString } from "@vue/server-renderer";

test("guests only browse; QQ votes use the session gateway; expired sessions and account switches clear personal state", async () => {
  const saved = Object.fromEntries(["fetch", "location", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)]));
  const periodId = "11111111-1111-4111-8111-111111111111";
  const songId = "22222222-2222-4222-8222-222222222222";
  const requests = [];
  let expired = false, failVotes = false, deferVotes, pendingVotes;
  globalThis.location = { origin: "https://chuxiaomai.cyou", href: "https://chuxiaomai.cyou/#/playlist" };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.fetch = async (input, options = {}) => {
    const path = new URL(String(input),location.origin).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({path,body,options});
    if (path.endsWith("/playlist_periods")) return Response.json([{ id: periodId, title:"本期", status:"active", starts_at:"2020-01-01", ends_at:"2099-01-01", is_test:false }]);
    if (path.endsWith("/songs")) return Response.json([{ id:songId, title:"晴天", artist:"周杰伦", likes_count:2, dislikes_count:0 }]);
    assert.equal(path,"/qq/participate","No browser may call the legacy mutation RPCs");
    assert.equal(options.credentials,"same-origin");
    for (const key of ["openid","userId","voterCookie","p_openid","p_voter_cookie"]) assert.equal(body[key],undefined);
    if (expired) return Response.json({error:"qq_login_required"},{status:401});
    if (failVotes && body.operation === "votes") return Response.json({error:"participation_unavailable"},{status:503});
    if (body.operation === "votes") {
      if (deferVotes) { pendingVotes?.(); return deferVotes; }
      return Response.json({likes:[songId],dislikes:[]});
    }
    if (body.operation === "submit") return Response.json({id:songId});
    return Response.json({error_code:null,error_message:null});
  };
  let server;
  try {
    server = await createServer({ root:fileURLToPath(new URL("..",import.meta.url)), mode:"production",
      server:{ middlewareMode:true, hmr:{server:createHttpServer()} }, appType:"custom" });
    const {useAuthStore} = await server.ssrLoadModule("/src/stores/auth.js");
    const {useSongsStore} = await server.ssrLoadModule("/src/stores/songs.js");
    const pinia=createPinia();setActivePinia(pinia);
    const auth=useAuthStore(), songs=useSongsStore();auth.backendReady=true;
    const router=createRouter({history:createMemoryHistory(),routes:[{path:"/",name:"home",component:{template:"<div />"}},{path:"/playlist",name:"playlist",component:{template:"<div />"}}]});
    await router.push("/playlist");await router.isReady();
    const render = async (path,props={}) => {
      const {default:component}=await server.ssrLoadModule(path);
      return renderToString(createSSRApp(component,props).use(pinia).use(router));
    };
    await songs.refresh();
    assert.equal(songs.songs.length,1);assert.equal(songs.canMutate,false);
    assert(!requests.some(r=>r.path==="/qq/participate"));
    const count=requests.length;
    await songs.toggleLikeSong(songs.songs[0]);await songs.toggleDislikeSong(songs.songs[0],"理由");await songs.submitSong("新歌","歌手");
    assert.equal(requests.length,count,"Store-level calls must also block guests");
    let html=await render("/src/components/SongCard.vue",{song:songs.songs[0],rank:1});
    assert.equal((html.match(/<button[^>]*disabled/g)||[]).length,2);
    assert(html.includes("请先 QQ 登录"));
    html=await render("/src/components/SubmissionForm.vue");
    assert.equal((html.match(/<input[^>]*disabled/g)||[]).length,2);assert(html.includes("QQ 登录后可投稿"));
    assert((await render("/src/components/IdentityNotice.vue")).includes("游客模式"));

    auth.qqUser={openid:"QQ_A",nickname:"同学A"};songs.clearPersonalState();
    assert.equal(songs.canMutate,false,"Wait for current account vote state before enabling toggles");
    await songs.refresh();
    assert.equal(songs.canMutate,true);assert(songs.likedSongIds.has(songId));
    html=await render("/src/components/SongCard.vue",{song:songs.songs[0],rank:1});assert(!/<button[^>]*disabled/.test(html));
    await songs.toggleLikeSong(songs.songs[0]);
    assert.deepEqual(requests.at(-1).body,{operation:"like",songId,periodId,action:"off"});
    assert.equal(songs.likedSongIds.has(songId),false);
    await songs.toggleDislikeSong(songs.songs[0],"不适合播出");
    assert.equal(requests.at(-1).body.operation,"dislike");assert(songs.dislikedSongIds.has(songId));
    expired=true;await songs.toggleLikeSong(songs.songs[0]);
    assert.equal(auth.qqUser,null);assert.equal(songs.canMutate,false);
    assert.equal(songs.likedSongIds.size,0);assert.equal(songs.dislikedSongIds.size,0);
    assert(songs.voteError.includes("请先 QQ 登录"));
    assert.equal(songs.songs.length,1,"Expired login must not remove public songs");

    expired=false;failVotes=true;auth.qqUser={openid:"QQ_A"};
    await songs.refresh();
    assert.equal(songs.errorMessage,"");assert.equal(songs.songs.length,1);assert.equal(songs.canMutate,false);
    assert(songs.voteError.includes("暂不可用"));
    failVotes=false;
    let resolveVotes;
    deferVotes=new Promise(resolve=>{resolveVotes=resolve;});
    const started=new Promise(resolve=>{pendingVotes=resolve;});
    const refreshing=songs.refresh();await started;
    auth.qqUser={openid:"QQ_B"};songs.clearPersonalState();
    resolveVotes(Response.json({likes:[songId],dislikes:[]}));await refreshing;
    assert.equal(songs.likedSongIds.size,0,"An old account's pending read must not appear for a new account");
    assert.equal(songs.personalVotesAccount,"");
    auth.qqAccountLoading=true; // Status below represents a verified backend result.
    auth.qqAccount={id:periodId,moderation:{banned:true,ban_until:null,vote_restricted:false,submission_restricted:false},
      unread_count:1,notices:[{id:songId,action:"ban",reason:"<script>unsafe()</script>",expires_at:null,created_at:"2026-10-25T00:00:00Z",is_read:false}]};
    html=await render("/src/views/ProfileView.vue");
    assert(html.includes("账号参与权限受限"));assert(html.includes("长期，直至管理员解除"));
    assert(html.includes("&lt;script&gt;unsafe()&lt;/script&gt;"));assert(!html.includes("<script>unsafe()"));
    assert(html.includes("站内通知"));assert(html.includes("标为已读"));
  } finally {
    await server?.close();
    for (const [key,descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    }
  }
});
