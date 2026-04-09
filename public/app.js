import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { supabaseConfig, hasValidSupabaseConfig, adminAccounts } from "./supabase-config.js";

const SONGS_PER_PAGE = 6;
const TARGET_DATE = getTomorrowDateKey();

const state = {
  userId: "",
  songs: [],
  likedSongIds: new Set(),
  sortMode: "likes",
  searchTerm: "",
  currentPage: 1,
  isSubmitting: false,
  likingSongId: "",
  backendReady: false,
  isAdmin: false,
  isAdminAuthenticated: false,
  currentAnnouncement: null,
  isSavingAnnouncement: false,
};

const refs = {
  targetDateLabel: document.querySelector("#targetDateLabel"),
  songCount: document.querySelector("#songCount"),
  likeCount: document.querySelector("#likeCount"),
  authStatus: document.querySelector("#authStatus"),
  firebaseNotice: document.querySelector("#firebaseNotice"),
  form: document.querySelector("#songForm"),
  submitButton: document.querySelector("#submitButton"),
  formHint: document.querySelector("#formHint"),
  titleInput: document.querySelector("#songTitle"),
  artistInput: document.querySelector("#artistName"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  songsList: document.querySelector("#songsList"),
  pagination: document.querySelector("#pagination"),
  adminToggleBtn: document.querySelector("#adminToggleBtn"),
  adminPanel: document.querySelector("#adminPanel"),
  adminCloseBtn: document.querySelector("#adminCloseBtn"),
  announcementForm: document.querySelector("#announcementForm"),
  announcementTitle: document.querySelector("#announcementTitle"),
  announcementContent: document.querySelector("#announcementContent"),
  saveAnnouncementBtn: document.querySelector("#saveAnnouncementBtn"),
  disableAnnouncementBtn: document.querySelector("#disableAnnouncementBtn"),
  announcementHint: document.querySelector("#announcementHint"),
  announcementModal: document.querySelector("#announcementModal"),
  announcementModalTitle: document.querySelector("#announcementModalTitle"),
  announcementModalContent: document.querySelector("#announcementModalContent"),
  announcementCloseBtn: document.querySelector("#announcementCloseBtn"),
  announcementAckBtn: document.querySelector("#announcementAckBtn"),
};

const supabase = hasValidSupabaseConfig()
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : null;

console.log("========== Supabase 配置信息 ==========");
console.log("1. 配置有效性:", hasValidSupabaseConfig());
console.log("2. 项目 URL:", supabaseConfig?.url || "未配置");
console.log("3. Anon Key 前缀:", supabaseConfig?.anonKey ? supabaseConfig.anonKey.substring(0, 30) + "..." : "未配置");
console.log("4. Supabase 客户端:", supabase ? "已创建" : "未创建");
console.log("========================================");

refs.targetDateLabel.textContent = formatDateLabel(TARGET_DATE);

bindEvents();
render();

if (!hasValidSupabaseConfig()) {
  console.error("❌ 错误: Supabase 配置无效");
  console.error("请检查 public/supabase-config.js 文件");
  refs.firebaseNotice.classList.remove("hidden");
  refs.authStatus.textContent = "配置无效";
  refs.authStatus.style.color = "var(--danger)";
  refs.songsList.innerHTML = createEmptyState(
    "数据库配置无效",
    "请检查配置文件后刷新页面。"
  );
  syncFormButton();
} else {
  console.log("✅ 配置有效，开始连接数据库...");
  console.log("\n🔍 测试 Supabase 连接...");
  
  // 先测试连接
  supabase
    .from(supabaseConfig.tables.songs)
    .select("count", { count: 'exact', head: true })
    .then(({ data, error }) => {
      if (error) {
        console.error("❌ 连接测试失败:", error);
        console.error("错误详情:", error.message);
        console.error("\n可能原因：");
        console.error("1. 数据库表未创建 - 请执行 supabase-rls-setup.sql");
        console.error("2. 网络连接问题 - 请检查网络");
        console.error("3. Supabase 服务停机 - 请等待服务恢复");
        console.error("4. 权限配置错误 - 请检查 RLS 策略");
        refs.authStatus.textContent = "连接失败";
        refs.authStatus.style.color = "var(--danger)";
        refs.songsList.innerHTML = createEmptyState(
          "数据库连接失败",
          `错误: ${error.message}\n\n请:\n1. 按 F12 查看控制台详细错误\n2. 确认已执行 supabase-rls-setup.sql\n3. 检查网络连接\n4. 刷新页面重试`
        );
      } else {
        console.log("✅ 连接测试成功！");
        console.log("开始加载数据...\n");
        refs.authStatus.textContent = "连接中...";
        refs.authStatus.style.color = "var(--blue)";
        bootSupabase();
      }
    })
    .catch((err) => {
      console.error("❌ 连接测试异常:", err);
      refs.authStatus.textContent = "连接异常";
      refs.authStatus.style.color = "var(--danger)";
    });
}

function bindEvents() {
  refs.form.addEventListener("submit", handleSongSubmit);
  refs.searchInput.addEventListener("input", (event) => {
    state.searchTerm = event.target.value.trim();
    state.currentPage = 1;
    render();
  });
  refs.sortSelect.addEventListener("change", (event) => {
    state.sortMode = event.target.value;
    state.currentPage = 1;
    render();
  });
  refs.songsList.addEventListener("click", handleSongListClick);
  refs.pagination.addEventListener("click", handlePaginationClick);
  
  // 管理员相关事件（检查元素是否存在）
  if (refs.adminToggleBtn) {
    refs.adminToggleBtn.addEventListener("click", handleAdminToggle);
  } else {
    console.warn("⚠️ adminToggleBtn 元素未找到");
  }
  
  if (refs.adminCloseBtn) {
    refs.adminCloseBtn.addEventListener("click", handleAdminClose);
  }
  
  if (refs.announcementForm) {
    refs.announcementForm.addEventListener("submit", handleAnnouncementSubmit);
  }
  
  if (refs.disableAnnouncementBtn) {
    refs.disableAnnouncementBtn.addEventListener("click", handleDisableAnnouncement);
  }
  
  if (refs.announcementCloseBtn) {
    refs.announcementCloseBtn.addEventListener("click", closeAnnouncementModal);
  }
  
  if (refs.announcementAckBtn) {
    refs.announcementAckBtn.addEventListener("click", closeAnnouncementModal);
  }
  
  // 点击模态框背景关闭
  if (refs.announcementModal) {
    refs.announcementModal.addEventListener("click", (event) => {
      if (event.target === refs.announcementModal) {
        closeAnnouncementModal();
      }
    });
  }
}

async function bootSupabase() {
  console.log("\n========== 数据库连接调试 ==========");
  try {
    console.log("步骤 1: 生成用户 ID...");
    state.userId = getOrCreateVisitorId();
    console.log("   用户 ID:", state.userId);
    
    console.log("步骤 2: 设置后端状态...");
    state.backendReady = true;
    refs.authStatus.textContent = "同步中";
    refs.authStatus.style.color = "var(--blue-deep)";
    syncFormButton();

    console.log("步骤 3: 同步歌曲和点赞数据...");
    console.log("   开始请求数据，请稍候...");
    
    // 添加超时检测
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("请求超时（10秒）- 请检查网络连接或 Supabase 服务状态")), 10000);
    });
    
    await Promise.race([syncAllData(), timeoutPromise]);
    
    console.log("   歌曲数量:", state.songs.length);
    console.log("   点赞数量:", state.likedSongIds.size);
    
    console.log("步骤 4: 获取公告...");
    await fetchAnnouncement();
    console.log("   当前公告:", state.currentAnnouncement ? state.currentAnnouncement.title : "无");
    
    console.log("步骤 5: 检查公告显示...");
    checkAndShowAnnouncement();

    refs.authStatus.textContent = "已连接";
    refs.authStatus.style.color = "var(--green)";
    console.log("\n✅ 数据库连接成功！");
    console.log("========================================\n");
  } catch (error) {
    console.error("\n❌ 数据库连接失败！");
    console.error("错误类型:", error.name || "Unknown");
    console.error("错误消息:", error.message);
    console.error("错误详情:", error);
    console.error("========================================\n");
    
    refs.authStatus.textContent = "连接失败";
    refs.authStatus.style.color = "var(--danger)";
    updateFormHint("数据库连接失败，请查看控制台 (F12) 获取详细信息。", true);
    
    // 在页面上显示错误信息
    refs.songsList.innerHTML = createEmptyState(
      "数据库连接失败",
      `错误: ${error.message || "未知错误"}\n\n请:\n1. 按 F12 打开控制台查看详细错误\n2. 检查网络连接\n3. 确认 Supabase 项目正常运行\n4. 刷新页面重试`
    );
  }
}

async function syncAllData() {
  if (!state.backendReady) {
    console.warn("后端未就绪，跳过数据同步");
    return;
  }

  console.log("   3.1 获取歌曲列表...");
  const [songs, likes] = await Promise.all([fetchSongs(), fetchLikes()]);
  console.log("   3.2 获取点赞列表...");
  
  state.songs = songs;
  state.likedSongIds = new Set(likes.map((item) => item.song_id));
  
  console.log("   3.3 更新界面...");
  render();
  console.log("   3.4 数据同步完成");
}

async function fetchSongs() {
  console.log("      查询歌曲表...");
  const { data, error } = await supabase
    .from(supabaseConfig.tables.songs)
    .select("*")
    .eq("playlist_date", TARGET_DATE)
    .limit(500);

  if (error) {
    console.error("      ❌ 查询歌曲失败:", error);
    throw error;
  }
  
  console.log("      ✅ 查询成功，获取到", data?.length || 0, "首歌曲");

  return (data ?? []).map((song) => ({
    id: song.id,
    title: song.title ?? "",
    artist: song.artist ?? "",
    titleLower: song.title_lower ?? "",
    artistLower: song.artist_lower ?? "",
    likesCount: Number.isFinite(song.likes_count) ? song.likes_count : 0,
    createdAtMs: Date.parse(song.created_at ?? "") || 0,
    createdBy: song.created_by ?? "",
  }));
}

async function fetchLikes() {
  console.log("      查询点赞表...");
  const { data, error } = await supabase
    .from(supabaseConfig.tables.likes)
    .select("song_id")
    .eq("playlist_date", TARGET_DATE)
    .eq("user_id", state.userId)
    .limit(500);

  if (error) {
    console.error("      ❌ 查询点赞失败:", error);
    throw error;
  }
  
  console.log("      ✅ 查询成功，获取到", data?.length || 0, "个点赞");
  return data ?? [];
}

async function handleSongSubmit(event) {
  event.preventDefault();

  if (!state.backendReady) {
    updateFormHint("请先完成 Supabase 配置。", true);
    return;
  }

  const title = refs.titleInput.value.trim();
  const artist = refs.artistInput.value.trim();
  const titleLower = normalizeText(title);
  const artistLower = normalizeText(artist);

  if (!title || !artist) {
    updateFormHint("请先完整填写歌曲名字和作者。", true);
    return;
  }

  const duplicateSong = state.songs.find(
    (song) => song.titleLower === titleLower && song.artistLower === artistLower
  );

  if (duplicateSong) {
    updateFormHint("这首歌已经有人投过啦，直接给它点赞就好。", true);
    return;
  }

  state.isSubmitting = true;
  syncFormButton();
  updateFormHint("正在提交到明日歌单池...", false);

  try {
    const { error } = await supabase.from(supabaseConfig.tables.songs).insert({
      title,
      artist,
      title_lower: titleLower,
      artist_lower: artistLower,
      playlist_date: TARGET_DATE,
      likes_count: 0,
      created_by: state.userId,
    });

    if (error) {
      throw error;
    }

    refs.form.reset();
    updateFormHint("投稿成功，这首歌已经进入明日歌单池。", false);
    await syncAllData();
  } catch (error) {
    console.error("投稿失败:", error);
    updateFormHint("投稿失败，请检查网络后重试。", true);
  } finally {
    state.isSubmitting = false;
    syncFormButton();
  }
}

async function handleSongListClick(event) {
  const button = event.target.closest("[data-like-song]");
  if (!button || state.likingSongId || !state.backendReady) {
    return;
  }

  const songId = button.dataset.likeSong;
  const song = state.songs.find((item) => item.id === songId);

  if (!song) {
    return;
  }

  state.likingSongId = songId;
  render();

  try {
    if (state.likedSongIds.has(songId)) {
      await unlikeSong(songId);
    } else {
      await likeSong(songId);
    }

    await syncAllData();
  } catch (error) {
    console.error("点赞操作失败:", error);
    alert("点赞失败，请检查网络后重试");
  } finally {
    state.likingSongId = "";
    render();
  }
}

async function likeSong(songId) {
  const { error: insertError } = await supabase.from(supabaseConfig.tables.likes).insert({
    song_id: songId,
    user_id: state.userId,
    playlist_date: TARGET_DATE,
  });

  if (insertError) {
    throw insertError;
  }

  const { data: song, error: songError } = await supabase
    .from(supabaseConfig.tables.songs)
    .select("likes_count")
    .eq("id", songId)
    .single();

  if (songError) {
    throw songError;
  }

  const { error: updateError } = await supabase
    .from(supabaseConfig.tables.songs)
    .update({
      likes_count: Math.max(0, Number(song.likes_count ?? 0) + 1),
    })
    .eq("id", songId);

  if (updateError) {
    throw updateError;
  }
}

async function unlikeSong(songId) {
  const { error: deleteError } = await supabase
    .from(supabaseConfig.tables.likes)
    .delete()
    .eq("song_id", songId)
    .eq("user_id", state.userId)
    .eq("playlist_date", TARGET_DATE);

  if (deleteError) {
    throw deleteError;
  }

  const { data: song, error: songError } = await supabase
    .from(supabaseConfig.tables.songs)
    .select("likes_count")
    .eq("id", songId)
    .single();

  if (songError) {
    throw songError;
  }

  const { error: updateError } = await supabase
    .from(supabaseConfig.tables.songs)
    .update({
      likes_count: Math.max(0, Number(song.likes_count ?? 0) - 1),
    })
    .eq("id", songId);

  if (updateError) {
    throw updateError;
  }
}

function handlePaginationClick(event) {
  const button = event.target.closest("[data-page]");
  if (!button) {
    return;
  }

  const nextPage = Number(button.dataset.page);
  if (!Number.isInteger(nextPage) || nextPage < 1) {
    return;
  }

  state.currentPage = nextPage;
  render();
  refs.pagination.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function render() {
  const filteredSongs = getVisibleSongs();
  const pageCount = Math.max(1, Math.ceil(filteredSongs.length / SONGS_PER_PAGE));

  if (state.currentPage > pageCount) {
    state.currentPage = pageCount;
  }

  const startIndex = (state.currentPage - 1) * SONGS_PER_PAGE;
  const currentSongs = filteredSongs.slice(startIndex, startIndex + SONGS_PER_PAGE);

  refs.songCount.textContent = String(state.songs.length);
  refs.likeCount.textContent = String(
    state.songs.reduce((sum, song) => sum + (song.likesCount || 0), 0)
  );

  if (!currentSongs.length) {
    refs.songsList.innerHTML = createEmptyState(
      state.songs.length ? "没有匹配的歌曲" : "歌单池还空着",
      state.songs.length
        ? "换一个关键词试试，或者切换排序方式看看。"
        : "成为第一个投稿的人吧，大家会马上看到你的推荐。"
    );
  } else {
    refs.songsList.innerHTML = currentSongs
      .map((song, index) => createSongCard(song, startIndex + index + 1))
      .join("");
  }

  refs.pagination.innerHTML = createPagination(pageCount);
}

function getVisibleSongs() {
  const keyword = normalizeText(state.searchTerm);
  const searchedSongs = keyword
    ? state.songs.filter((song) => {
        const source = `${song.titleLower} ${song.artistLower}`;
        return keyword
          .split(/\s+/)
          .filter(Boolean)
          .every((part) => source.includes(part));
      })
    : [...state.songs];

  return searchedSongs.sort((firstSong, secondSong) => {
    if (state.sortMode === "time") {
      return sortByTime(firstSong, secondSong);
    }

    return sortByLikes(firstSong, secondSong);
  });
}

function sortByLikes(firstSong, secondSong) {
  const likeGap = (secondSong.likesCount || 0) - (firstSong.likesCount || 0);
  if (likeGap !== 0) {
    return likeGap;
  }
  return sortByTime(firstSong, secondSong);
}

function sortByTime(firstSong, secondSong) {
  const timeGap = (secondSong.createdAtMs || 0) - (firstSong.createdAtMs || 0);
  if (timeGap !== 0) {
    return timeGap;
  }
  return firstSong.title.localeCompare(secondSong.title, "zh-CN");
}

function createSongCard(song, rank) {
  const isLiked = state.likedSongIds.has(song.id);
  const isBusy = state.likingSongId === song.id;
  const likeLabel = isBusy
    ? "处理中..."
    : isLiked
      ? `已点赞 ${song.likesCount}`
      : `点赞 ${song.likesCount}`;

  return `
    <article class="song-card">
      <div class="song-topline">
        <div class="song-title-wrap">
          <h3 class="song-title">${escapeHtml(song.title)}</h3>
          <p class="song-artist">${escapeHtml(song.artist)}</p>
        </div>
        <div class="song-rank">#${rank}</div>
      </div>

      <div class="song-footer">
        <div class="song-meta">
          <span class="song-badge">明日歌单</span>
          <span class="song-badge">投稿时间 ${formatTime(song.createdAtMs)}</span>
        </div>
        <button
          class="like-button ${isLiked ? "is-liked" : ""}"
          type="button"
          data-like-song="${song.id}"
          ${isBusy ? "disabled" : ""}
        >
          ${likeLabel}
        </button>
      </div>
    </article>
  `;
}

function createPagination(pageCount) {
  if (pageCount <= 1) {
    return "";
  }

  const pages = buildPageNumbers(pageCount, state.currentPage);
  return pages
    .map((page) => {
      if (page === "...") {
        return `<span class="pagination-button is-ghost" aria-hidden="true">...</span>`;
      }

      const isActive = page === state.currentPage;
      return `
        <button
          class="pagination-button ${isActive ? "is-active" : ""}"
          type="button"
          data-page="${page}"
          ${isActive ? 'aria-current="page"' : ""}
        >
          ${page}
        </button>
      `;
    })
    .join("");
}

function createEmptyState(title, copy) {
  return `
    <div class="empty-state">
      <h3 class="empty-title">${escapeHtml(title)}</h3>
      <p class="empty-copy">${escapeHtml(copy)}</p>
    </div>
  `;
}

function buildPageNumbers(pageCount, currentPage) {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, "...", pageCount];
  }

  if (currentPage >= pageCount - 2) {
    return [1, "...", pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  }

  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", pageCount];
}

function syncFormButton() {
  refs.submitButton.disabled = state.isSubmitting || !state.userId;
  refs.submitButton.textContent = state.isSubmitting ? "提交中..." : "提交到明日歌单";
}

function updateFormHint(message, isError) {
  refs.formHint.textContent = message;
  refs.formHint.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function getOrCreateVisitorId() {
  const storageKey = "chu_xiaomai_visitor_id";
  const existingId = localStorage.getItem(storageKey);

  if (existingId) {
    return existingId;
  }

  const nextId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `visitor_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  localStorage.setItem(storageKey, nextId);
  return nextId;
}

function normalizeText(value) {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function getTomorrowDateKey() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDateLabel(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

function formatTime(milliseconds) {
  if (!milliseconds) {
    return "刚刚";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(milliseconds));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ==================== 管理员功能 ====================

function handleAdminToggle() {
  if (state.isAdmin) {
    // 已经是管理员模式，关闭
    handleAdminClose();
    return;
  }
  
  // 显示登录表单
  showAdminLoginForm();
}

function showAdminLoginForm() {
  // 创建登录对话框
  const overlay = document.createElement('div');
  overlay.className = 'admin-login-overlay';
  overlay.innerHTML = `
    <div class="admin-login-modal">
      <div class="admin-login-header">
        <h3>管理员登录</h3>
        <button class="admin-login-close" type="button">&times;</button>
      </div>
      <form class="admin-login-form">
        <label class="field">
          <span>管理员账号</span>
          <input
            type="text"
            class="admin-username-input"
            placeholder="请输入管理员账号"
            required
            autocomplete="username"
          />
        </label>
        <label class="field">
          <span>密码</span>
          <input
            type="password"
            class="admin-password-input"
            placeholder="请输入密码"
            required
            autocomplete="current-password"
          />
        </label>
        <button type="submit" class="primary-button admin-login-btn">登录</button>
        <p class="admin-login-hint"></p>
      </form>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // 绑定事件
  const closeBtn = overlay.querySelector('.admin-login-close');
  const form = overlay.querySelector('.admin-login-form');
  const usernameInput = overlay.querySelector('.admin-username-input');
  const passwordInput = overlay.querySelector('.admin-password-input');
  const hint = overlay.querySelector('.admin-login-hint');
  
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
  });
  
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      document.body.removeChild(overlay);
    }
  });
  
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    
    if (!username || !password) {
      hint.textContent = '请填写账号和密码';
      hint.style.color = 'var(--danger)';
      return;
    }
    
    // 验证管理员账户
    const adminAccount = adminAccounts.find(
      account => account.username === username && account.password === password
    );
    
    if (adminAccount) {
      // 登录成功
      document.body.removeChild(overlay);
      state.isAdmin = true;
      state.isAdminAuthenticated = true;
      state.adminUsername = username;
      refs.adminPanel.classList.remove('hidden');
      refs.adminToggleBtn.textContent = '管理已开启';
      refs.adminToggleBtn.style.background = 'linear-gradient(135deg, var(--green), #2ea043)';
      
      // 加载当前公告
      loadCurrentAnnouncementToForm();
    } else {
      hint.textContent = '账号或密码错误';
      hint.style.color = 'var(--danger)';
      passwordInput.value = '';
    }
  });
  
  // 自动聚焦到用户名输入框
  usernameInput.focus();
}

function handleAdminClose() {
  state.isAdmin = false;
  refs.adminPanel.classList.add("hidden");
  refs.adminToggleBtn.textContent = "管理员模式";
  refs.adminToggleBtn.style.background = "";
}

async function fetchAnnouncement() {
  try {
    console.log("      查询公告表...");
    const { data, error } = await supabase
      .from(supabaseConfig.tables.announcements)
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1);
    
    if (error) {
      console.error("      ❌ 查询公告失败:", error);
      console.warn("      公告表可能不存在或未创建");
      return;
    }
    
    if (data && data.length > 0) {
      state.currentAnnouncement = data[0];
      console.log("      ✅ 获取到公告:", data[0].title);
    } else {
      state.currentAnnouncement = null;
      console.log("      ℹ️ 没有启用的公告");
    }
  } catch (error) {
    console.error("      ❌ 获取公告异常:", error);
  }
}

function checkAndShowAnnouncement() {
  // 检查用户是否已经看过公告
  const hasSeenAnnouncement = localStorage.getItem("chu_xiaomai_seen_announcement");
  
  if (state.currentAnnouncement && !hasSeenAnnouncement) {
    showAnnouncementModal(state.currentAnnouncement);
  }
}

function showAnnouncementModal(announcement) {
  refs.announcementModalTitle.textContent = announcement.title || "公告";
  refs.announcementModalContent.textContent = announcement.content || "";
  refs.announcementModal.classList.remove("hidden");
}

function closeAnnouncementModal() {
  refs.announcementModal.classList.add("hidden");
  // 记录用户已看过公告
  localStorage.setItem("chu_xiaomai_seen_announcement", "true");
}

function loadCurrentAnnouncementToForm() {
  if (state.currentAnnouncement) {
    refs.announcementTitle.value = state.currentAnnouncement.title || "";
    refs.announcementContent.value = state.currentAnnouncement.content || "";
  } else {
    refs.announcementForm.reset();
  }
}

async function handleAnnouncementSubmit(event) {
  event.preventDefault();
  
  if (!state.isAdminAuthenticated) {
    alert("请先进行管理员认证！");
    return;
  }
  
  const title = refs.announcementTitle.value.trim();
  const content = refs.announcementContent.value.trim();
  
  if (!title || !content) {
    updateAnnouncementHint("请填写完整的标题和内容", true);
    return;
  }
  
  state.isSavingAnnouncement = true;
  refs.saveAnnouncementBtn.disabled = true;
  refs.saveAnnouncementBtn.textContent = "保存中...";
  updateAnnouncementHint("正在保存公告...", false);
  
  try {
    // 先禁用所有旧公告
    await supabase
      .from(supabaseConfig.tables.announcements)
      .update({ is_active: false })
      .eq("is_active", true);
    
    // 插入新公告
    const { error } = await supabase
      .from(supabaseConfig.tables.announcements)
      .insert({
        title,
        content,
        is_active: true,
        created_by: state.userId,
      });
    
    if (error) {
      throw error;
    }
    
    updateAnnouncementHint("公告保存成功！", false);
    
    // 更新本地状态
    await fetchAnnouncement();
    
    // 清空表单
    refs.announcementForm.reset();
  } catch (error) {
    console.error("保存公告失败:", error);
    updateAnnouncementHint(`保存失败：${resolveErrorMessage(error)}`, true);
  } finally {
    state.isSavingAnnouncement = false;
    refs.saveAnnouncementBtn.disabled = false;
    refs.saveAnnouncementBtn.textContent = "保存公告";
  }
}

async function handleDisableAnnouncement() {
  if (!state.isAdminAuthenticated) {
    alert("请先进行管理员认证！");
    return;
  }
  
  if (!confirm("确定要禁用当前公告吗？用户将不再看到公告弹窗。")) {
    return;
  }
  
  try {
    const { error } = await supabase
      .from(supabaseConfig.tables.announcements)
      .update({ is_active: false })
      .eq("is_active", true);
    
    if (error) {
      throw error;
    }
    
    updateAnnouncementHint("公告已禁用", false);
    
    // 更新本地状态
    state.currentAnnouncement = null;
    refs.announcementForm.reset();
  } catch (error) {
    console.error("禁用公告失败:", error);
    updateAnnouncementHint(`禁用失败：${resolveErrorMessage(error)}`, true);
  }
}

function updateAnnouncementHint(message, isError) {
  refs.announcementHint.textContent = message;
  refs.announcementHint.style.color = isError ? "var(--danger)" : "var(--muted)";
}
