import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { supabaseConfig, hasValidSupabaseConfig } from "./supabase-config.js";

const SONGS_PER_PAGE = 12;
const TARGET_DATE = getTomorrowDateKey();
const ADMIN_USERNAME = "CHU_CBS_XIAOMAI";
const ADMIN_PASSWORD = "GBT666";
const ANNOUNCEMENT_SEEN_KEY = "chu_xiaomai_seen_announcement_id";

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
  isAdminAuthenticated: false,
  currentAnnouncement: null,
  announcementReady: false,
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
  settingsOpenBtn: document.querySelector("#settingsOpenBtn"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsCloseBtn: document.querySelector("#settingsCloseBtn"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminUsername: document.querySelector("#adminUsername"),
  adminPassword: document.querySelector("#adminPassword"),
  adminLoginHint: document.querySelector("#adminLoginHint"),
  adminPanel: document.querySelector("#adminPanel"),
  adminLogoutBtn: document.querySelector("#adminLogoutBtn"),
  announcementForm: document.querySelector("#announcementForm"),
  announcementTitle: document.querySelector("#announcementTitle"),
  announcementContent: document.querySelector("#announcementContent"),
  saveAnnouncementBtn: document.querySelector("#saveAnnouncementBtn"),
  disableAnnouncementBtn: document.querySelector("#disableAnnouncementBtn"),
  announcementHint: document.querySelector("#announcementHint"),
  exportOrderSelect: document.querySelector("#exportOrderSelect"),
  exportCountInput: document.querySelector("#exportCountInput"),
  copyExportBtn: document.querySelector("#copyExportBtn"),
  downloadExportBtn: document.querySelector("#downloadExportBtn"),
  exportHint: document.querySelector("#exportHint"),
  announcementModal: document.querySelector("#announcementModal"),
  announcementModalTitle: document.querySelector("#announcementModalTitle"),
  announcementModalContent: document.querySelector("#announcementModalContent"),
  announcementCloseBtn: document.querySelector("#announcementCloseBtn"),
  announcementAckBtn: document.querySelector("#announcementAckBtn"),
};

const supabase = hasValidSupabaseConfig()
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : null;

refs.targetDateLabel.textContent = formatDateLabel(TARGET_DATE);
bindEvents();
render();
syncFormButton();

if (!supabase) {
  showBackendConfigError();
} else {
  bootSupabase();
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
  refs.settingsOpenBtn.addEventListener("click", openSettingsModal);
  refs.settingsCloseBtn.addEventListener("click", closeSettingsModal);
  refs.settingsModal.addEventListener("click", (event) => {
    if (event.target === refs.settingsModal) {
      closeSettingsModal();
    }
  });
  refs.adminLoginForm.addEventListener("submit", handleAdminLogin);
  refs.adminLogoutBtn.addEventListener("click", handleAdminLogout);
  refs.announcementForm.addEventListener("submit", handleAnnouncementSubmit);
  refs.disableAnnouncementBtn.addEventListener("click", handleDisableAnnouncement);
  refs.copyExportBtn.addEventListener("click", handleCopyExport);
  refs.downloadExportBtn.addEventListener("click", handleDownloadExport);
  refs.announcementCloseBtn.addEventListener("click", closeAnnouncementModal);
  refs.announcementAckBtn.addEventListener("click", closeAnnouncementModal);
  refs.announcementModal.addEventListener("click", (event) => {
    if (event.target === refs.announcementModal) {
      closeAnnouncementModal();
    }
  });
}

async function bootSupabase() {
  try {
    state.userId = getOrCreateVisitorId();
    state.backendReady = true;
    refs.authStatus.textContent = "同步中";
    refs.authStatus.style.color = "var(--blue-deep)";
    syncFormButton();

    await syncAllData();
    await fetchAnnouncement();
    checkAndShowAnnouncement();

    refs.authStatus.textContent = "已连接";
    refs.authStatus.style.color = "var(--green)";
  } catch (error) {
    console.error("Supabase 同步失败:", error);
    refs.authStatus.textContent = "连接失败";
    refs.authStatus.style.color = "var(--danger)";
    updateFormHint(`连接失败：${resolveErrorMessage(error)}`, true);
    refs.songsList.innerHTML = createEmptyState(
      "数据库连接失败",
      "请检查网络或 Supabase 表配置后刷新页面。"
    );
  }
}

function showBackendConfigError() {
  refs.firebaseNotice.classList.remove("hidden");
  refs.authStatus.textContent = "配置不可用";
  refs.authStatus.style.color = "var(--danger)";
  refs.songsList.innerHTML = createEmptyState(
    "Supabase 配置不可用",
    "请检查 supabase-config.js 后刷新页面。"
  );
}

async function syncAllData() {
  if (!state.backendReady) {
    return;
  }

  const [songs, likes] = await Promise.all([fetchSongs(), fetchLikes()]);
  state.songs = songs;
  state.likedSongIds = new Set(likes.map((item) => item.song_id));
  render();
}

async function fetchSongs() {
  const { data, error } = await supabase
    .from(supabaseConfig.tables.songs)
    .select("*")
    .eq("playlist_date", TARGET_DATE)
    .limit(500);

  if (error) {
    throw error;
  }

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
  const { data, error } = await supabase
    .from(supabaseConfig.tables.likes)
    .select("song_id")
    .eq("playlist_date", TARGET_DATE)
    .eq("user_id", state.userId)
    .limit(500);

  if (error) {
    throw error;
  }

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
    updateFormHint("请先完整填写歌曲名字和歌手。", true);
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
    updateFormHint(`投稿失败：${resolveErrorMessage(error)}`, true);
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
    alert(`点赞失败：${resolveErrorMessage(error)}`);
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
        : "成为第一个投稿的人吧。"
    );
  } else {
    refs.songsList.innerHTML = currentSongs
      .map((song) => createSongCard(song))
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

function createSongCard(song) {
  const isLiked = state.likedSongIds.has(song.id);
  const isBusy = state.likingSongId === song.id;
  const likeLabel = isBusy
    ? "处理中"
    : isLiked
      ? `已赞 ${song.likesCount}`
      : `点赞 ${song.likesCount}`;

  return `
    <article class="song-card">
      <p class="song-line" title="${escapeHtml(`${song.title} ${song.artist}`)}">
        <span class="song-title">${escapeHtml(song.title)}</span>
        <span class="song-artist">${escapeHtml(song.artist)}</span>
      </p>
      <button
        class="like-button ${isLiked ? "is-liked" : ""}"
        type="button"
        data-like-song="${song.id}"
        ${isBusy ? "disabled" : ""}
      >
        ${likeLabel}
      </button>
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
  refs.submitButton.disabled = state.isSubmitting || !state.userId || !state.backendReady;
  refs.submitButton.textContent = state.isSubmitting ? "提交中..." : "提交到明日歌单";
}

function updateFormHint(message, isError) {
  refs.formHint.textContent = message;
  refs.formHint.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function openSettingsModal() {
  refs.settingsModal.classList.remove("hidden");
  refs.adminLoginHint.textContent = state.isAdminAuthenticated
    ? "管理员已登录，可在页面上方发布公告。"
    : "";
  refs.adminLoginHint.style.color = state.isAdminAuthenticated ? "var(--green)" : "";

  if (!state.isAdminAuthenticated) {
    refs.adminUsername.focus();
  }
}

function closeSettingsModal() {
  refs.settingsModal.classList.add("hidden");
  refs.adminLoginForm.reset();
}

function handleAdminLogin(event) {
  event.preventDefault();

  const username = refs.adminUsername.value.trim();
  const password = refs.adminPassword.value;

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    refs.adminLoginHint.textContent = "账号或密码不正确。";
    refs.adminLoginHint.style.color = "var(--danger)";
    refs.adminPassword.value = "";
    refs.adminPassword.focus();
    return;
  }

  state.isAdminAuthenticated = true;
  refs.adminPanel.classList.remove("hidden");
  refs.settingsOpenBtn.textContent = "管理员已登录";
  refs.adminLoginHint.textContent = "登录成功。";
  refs.adminLoginHint.style.color = "var(--green)";
  loadCurrentAnnouncementToForm();
  closeSettingsModal();
  refs.adminPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleAdminLogout() {
  state.isAdminAuthenticated = false;
  refs.adminPanel.classList.add("hidden");
  refs.settingsOpenBtn.textContent = "设置";
  refs.announcementForm.reset();
  updateAnnouncementHint("发布后，未看过这条公告的同学进入网站时会先看到它。", false);
  updateExportHint("会导出当前征集日期下的歌曲。", false);
}

async function fetchAnnouncement() {
  const tableName = supabaseConfig.tables?.announcements || "announcements";

  try {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    state.currentAnnouncement = data?.[0] ?? null;
    state.announcementReady = true;

    if (state.isAdminAuthenticated) {
      loadCurrentAnnouncementToForm();
    }
  } catch (error) {
    state.currentAnnouncement = null;
    state.announcementReady = false;
    console.warn("公告读取失败，点歌功能不受影响:", error);

    if (state.isAdminAuthenticated) {
      updateAnnouncementHint(`公告功能暂不可用：${resolveErrorMessage(error)}`, true);
    }
  }
}

function checkAndShowAnnouncement() {
  if (!state.currentAnnouncement) {
    return;
  }

  const seenAnnouncementId = localStorage.getItem(ANNOUNCEMENT_SEEN_KEY);
  if (seenAnnouncementId !== state.currentAnnouncement.id) {
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

  if (state.currentAnnouncement?.id) {
    localStorage.setItem(ANNOUNCEMENT_SEEN_KEY, state.currentAnnouncement.id);
  }
}

function loadCurrentAnnouncementToForm() {
  if (!state.currentAnnouncement) {
    refs.announcementForm.reset();
    return;
  }

  refs.announcementTitle.value = state.currentAnnouncement.title || "";
  refs.announcementContent.value = state.currentAnnouncement.content || "";
}

async function handleAnnouncementSubmit(event) {
  event.preventDefault();

  if (!state.isAdminAuthenticated) {
    alert("请先进行管理员登录。");
    return;
  }

  if (!state.backendReady) {
    updateAnnouncementHint("数据库未连接，暂时不能发布公告。", true);
    return;
  }

  const title = refs.announcementTitle.value.trim();
  const content = refs.announcementContent.value.trim();

  if (!title || !content) {
    updateAnnouncementHint("请填写完整的公告标题和内容。", true);
    return;
  }

  const tableName = supabaseConfig.tables?.announcements || "announcements";
  state.isSavingAnnouncement = true;
  refs.saveAnnouncementBtn.disabled = true;
  refs.disableAnnouncementBtn.disabled = true;
  refs.saveAnnouncementBtn.textContent = "发布中...";
  updateAnnouncementHint("正在发布公告...", false);

  try {
    const { error: disableError } = await supabase
      .from(tableName)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("is_active", true);

    if (disableError) {
      throw disableError;
    }

    const { error: insertError } = await supabase
      .from(tableName)
      .insert({
        title,
        content,
        is_active: true,
        created_by: state.userId,
      });

    if (insertError) {
      throw insertError;
    }

    await fetchAnnouncement();
    updateAnnouncementHint("公告已发布。", false);
    checkAndShowAnnouncement();
  } catch (error) {
    console.error("发布公告失败:", error);
    updateAnnouncementHint(`发布失败：${resolveErrorMessage(error)}`, true);
  } finally {
    state.isSavingAnnouncement = false;
    refs.saveAnnouncementBtn.disabled = false;
    refs.disableAnnouncementBtn.disabled = false;
    refs.saveAnnouncementBtn.textContent = "发布公告";
  }
}

async function handleDisableAnnouncement() {
  if (!state.isAdminAuthenticated) {
    alert("请先进行管理员登录。");
    return;
  }

  if (!state.backendReady) {
    updateAnnouncementHint("数据库未连接，暂时不能关闭公告。", true);
    return;
  }

  if (!confirm("确定要关闭当前公告吗？")) {
    return;
  }

  const tableName = supabaseConfig.tables?.announcements || "announcements";

  try {
    refs.disableAnnouncementBtn.disabled = true;
    const { error } = await supabase
      .from(tableName)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("is_active", true);

    if (error) {
      throw error;
    }

    state.currentAnnouncement = null;
    refs.announcementForm.reset();
    updateAnnouncementHint("当前公告已关闭。", false);
  } catch (error) {
    console.error("关闭公告失败:", error);
    updateAnnouncementHint(`关闭失败：${resolveErrorMessage(error)}`, true);
  } finally {
    refs.disableAnnouncementBtn.disabled = false;
  }
}

function updateAnnouncementHint(message, isError) {
  refs.announcementHint.textContent = message;
  refs.announcementHint.style.color = isError ? "var(--danger)" : "var(--muted)";
}

async function handleCopyExport() {
  if (!state.isAdminAuthenticated) {
    alert("请先进行管理员登录。");
    return;
  }

  const exportText = buildExportText();
  if (!exportText) {
    return;
  }

  try {
    await copyTextToClipboard(exportText);
    updateExportHint("已复制到剪贴板。", false);
  } catch (error) {
    console.error("复制导出文本失败:", error);
    updateExportHint("复制失败，请改用导出 TXT。", true);
  }
}

function handleDownloadExport() {
  if (!state.isAdminAuthenticated) {
    alert("请先进行管理员登录。");
    return;
  }

  const exportText = buildExportText();
  if (!exportText) {
    return;
  }

  const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chu_xiaomai_${TARGET_DATE}_songs.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  updateExportHint("TXT 已开始导出。", false);
}

function buildExportText() {
  const exportSongs = getExportSongs();

  if (!exportSongs.length) {
    updateExportHint("当前没有可以导出的歌曲。", true);
    return "";
  }

  const orderLabel = refs.exportOrderSelect.value === "likes-asc"
    ? "点赞从低到高"
    : "点赞从高到低";

  const lines = exportSongs.map((song, index) => {
    return `${index + 1}. ${song.title} - ${song.artist}（点赞：${song.likesCount || 0}）`;
  });

  return [
    `广播台明日歌单导出`,
    `征集日期：${formatDateLabel(TARGET_DATE)}`,
    `导出顺序：${orderLabel}`,
    `导出数量：${exportSongs.length}`,
    "",
    ...lines,
  ].join("\n");
}

function getExportSongs() {
  const requestedCount = Number.parseInt(refs.exportCountInput.value, 10);
  const exportCount = Number.isInteger(requestedCount)
    ? Math.min(Math.max(requestedCount, 1), 500)
    : 10;

  refs.exportCountInput.value = String(exportCount);

  return [...state.songs]
    .sort((firstSong, secondSong) => {
      const likeGap = refs.exportOrderSelect.value === "likes-asc"
        ? (firstSong.likesCount || 0) - (secondSong.likesCount || 0)
        : (secondSong.likesCount || 0) - (firstSong.likesCount || 0);

      if (likeGap !== 0) {
        return likeGap;
      }

      return sortByTime(firstSong, secondSong);
    })
    .slice(0, exportCount);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function updateExportHint(message, isError) {
  refs.exportHint.textContent = message;
  refs.exportHint.style.color = isError ? "var(--danger)" : "var(--muted)";
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveErrorMessage(error) {
  return error?.message || error?.details || "未知错误";
}
