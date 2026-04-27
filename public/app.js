import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { supabaseConfig, hasValidSupabaseConfig } from "./supabase-config.js";

const SONGS_PER_PAGE = 12;
const HISTORY_PREVIEW_LIMIT = 6;
const ADMIN_USERNAME = "CHU_CBS_XIAOMAI";
const ADMIN_PASSWORD = "GBT666";
const PERIODS_TABLE = "playlist_periods";
const VISITOR_COOKIE_NAME = "chu_xiaomai_voter_id";
const LEGACY_VISITOR_STORAGE_KEY = "chu_xiaomai_visitor_id";

const state = {
  userId: "",
  songs: [],
  likedSongIds: new Set(),
  periods: [],
  currentPeriod: null,
  historyPeriodId: "",
  historySongs: [],
  sortMode: "likes",
  searchTerm: "",
  currentPage: 1,
  isSubmitting: false,
  likingSongId: "",
  backendReady: false,
  isAdminAuthenticated: false,
  currentAnnouncement: null,
  announcements: [],
};

const refs = {
  targetDateLabel: document.querySelector("#targetDateLabel"),
  targetPeriodTitle: document.querySelector("#targetPeriodTitle"),
  targetPeriodTime: document.querySelector("#targetPeriodTime"),
  songCount: document.querySelector("#songCount"),
  likeCount: document.querySelector("#likeCount"),
  authStatus: document.querySelector("#authStatus"),
  firebaseNotice: document.querySelector("#firebaseNotice"),
  form: document.querySelector("#songForm"),
  submitButton: document.querySelector("#submitButton"),
  formHint: document.querySelector("#formHint"),
  submissionPeriodCard: document.querySelector("#submissionPeriodCard"),
  submissionPeriodState: document.querySelector("#submissionPeriodState"),
  submissionPeriodTitle: document.querySelector("#submissionPeriodTitle"),
  submissionPeriodTime: document.querySelector("#submissionPeriodTime"),
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
  periodForm: document.querySelector("#periodForm"),
  periodTitle: document.querySelector("#periodTitle"),
  periodStart: document.querySelector("#periodStart"),
  periodEnd: document.querySelector("#periodEnd"),
  savePeriodBtn: document.querySelector("#savePeriodBtn"),
  archivePeriodBtn: document.querySelector("#archivePeriodBtn"),
  periodHint: document.querySelector("#periodHint"),
  announcementForm: document.querySelector("#announcementForm"),
  announcementTitle: document.querySelector("#announcementTitle"),
  announcementContent: document.querySelector("#announcementContent"),
  saveAnnouncementBtn: document.querySelector("#saveAnnouncementBtn"),
  disableAnnouncementBtn: document.querySelector("#disableAnnouncementBtn"),
  announcementHint: document.querySelector("#announcementHint"),
  noticeBoardList: document.querySelector("#noticeBoardList"),
  periodHistoryList: document.querySelector("#periodHistoryList"),
  historySongsList: document.querySelector("#historySongsList"),
  historyHint: document.querySelector("#historyHint"),
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

updateHeroPeriodLabel("正在读取征集期", "");
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
  refs.pagination.addEventListener("submit", handlePaginationJump);
  refs.noticeBoardList.addEventListener("click", handleNoticeBoardClick);
  refs.settingsOpenBtn.addEventListener("click", openSettingsModal);
  refs.settingsCloseBtn.addEventListener("click", closeSettingsModal);
  refs.settingsModal.addEventListener("click", (event) => {
    if (event.target === refs.settingsModal) closeSettingsModal();
  });
  refs.adminLoginForm.addEventListener("submit", handleAdminLogin);
  refs.adminLogoutBtn.addEventListener("click", handleAdminLogout);
  refs.periodForm.addEventListener("submit", handlePeriodSubmit);
  refs.archivePeriodBtn.addEventListener("click", handleArchiveCurrentPeriod);
  refs.periodHistoryList.addEventListener("click", handlePeriodHistoryClick);
  refs.announcementForm.addEventListener("submit", handleAnnouncementSubmit);
  refs.disableAnnouncementBtn.addEventListener("click", handleDisableAnnouncement);
  refs.copyExportBtn.addEventListener("click", handleCopyExport);
  refs.downloadExportBtn.addEventListener("click", handleDownloadExport);
  refs.announcementCloseBtn.addEventListener("click", closeAnnouncementModal);
  refs.announcementAckBtn.addEventListener("click", closeAnnouncementModal);
  refs.announcementModal.addEventListener("click", (event) => {
    if (event.target === refs.announcementModal) closeAnnouncementModal();
  });
}

async function bootSupabase() {
  try {
    state.userId = getOrCreateVisitorId();
    state.backendReady = true;
    refs.authStatus.textContent = "已连接";
    refs.authStatus.style.color = "var(--blue)";
    syncFormButton();
    await syncPeriods();
    await syncAllData();
    await fetchAnnouncement();
    checkAndShowAnnouncement();
    render();
  } catch (error) {
    console.error("Supabase 启动失败:", error);
    state.backendReady = false;
    refs.authStatus.textContent = "连接失败";
    refs.authStatus.style.color = "var(--danger)";
    updateFormHint(`连接失败：${resolveErrorMessage(error)}`, true);
    refs.songsList.innerHTML = createEmptyState("暂时无法读取歌单", "请检查 Supabase 表结构和网络连接。");
    syncFormButton();
  }
}

function showBackendConfigError() {
  refs.firebaseNotice.classList.remove("hidden");
  refs.authStatus.textContent = "未配置";
  refs.authStatus.style.color = "var(--danger)";
  refs.songsList.innerHTML = createEmptyState("Supabase 尚未配置", "请先在 supabase-config.js 中填写项目配置。");
  refs.noticeBoardList.innerHTML = `<div class="empty-inline">Supabase 尚未配置，暂时无法读取公告。</div>`;
}

async function syncPeriods() {
  const { data, error } = await supabase
    .from(PERIODS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  state.periods = (data ?? []).map(normalizePeriod);
  state.currentPeriod = state.periods.find((period) => period.status === "active") ?? null;
  if (!state.currentPeriod) {
    state.songs = [];
    state.likedSongIds = new Set();
  }
  renderPeriodAdminState();
  renderHistoryList();
}

async function syncAllData() {
  if (!state.backendReady || !state.currentPeriod) {
    state.songs = [];
    state.likedSongIds = new Set();
    render();
    return;
  }

  const [songs, likes] = await Promise.all([fetchSongs(state.currentPeriod.id), fetchLikes()]);
  state.songs = songs;
  state.likedSongIds = new Set(likes.map((item) => item.song_id));
  render();
}

async function fetchSongs(periodId) {
  const { data, error } = await supabase
    .from(supabaseConfig.tables.songs)
    .select("*")
    .eq("playlist_date", periodId)
    .limit(500);
  if (error) throw error;
  return mapSongs(data);
}

async function fetchLikes() {
  if (!state.currentPeriod) return [];
  const { data, error } = await supabase
    .from(supabaseConfig.tables.likes)
    .select("song_id")
    .eq("playlist_date", state.currentPeriod.id)
    .eq("voter_cookie", state.userId)
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

async function handleSongSubmit(event) {
  event.preventDefault();
  if (!canMutateCurrentPeriod()) {
    updateFormHint(getReadOnlyMessage(), true);
    syncFormButton();
    return;
  }

  const title = refs.titleInput.value.trim();
  const artist = refs.artistInput.value.trim();
  const titleLower = normalizeText(title);
  const artistLower = normalizeText(artist);

  if (!title || !artist) {
    updateFormHint("请填写歌曲标题和歌手名称。", true);
    return;
  }

  const duplicateSong = state.songs.find(
    (song) => song.titleLower === titleLower && song.artistLower === artistLower
  );
  if (duplicateSong) {
    updateFormHint("这首歌已经在本期歌单里啦，可以去给它点喜欢。", true);
    return;
  }

  state.isSubmitting = true;
  syncFormButton();
  updateFormHint("正在提交你的歌单...", false);

  try {
    const { error } = await supabase.from(supabaseConfig.tables.songs).insert({
      title,
      artist,
      title_lower: titleLower,
      artist_lower: artistLower,
      playlist_date: state.currentPeriod.id,
      likes_count: 0,
      created_by: state.userId,
    });
    if (error) throw error;
    refs.form.reset();
    updateFormHint("投稿成功，愿这首歌被更多人听见。", false);
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
  if (!button || state.likingSongId || !state.backendReady) return;
  if (!canMutateCurrentPeriod()) {
    updateFormHint(getReadOnlyMessage(), true);
    render();
    return;
  }

  const songId = button.dataset.likeSong;
  const song = state.songs.find((item) => item.id === songId);
  if (!song) return;

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
    console.error("点赞失败:", error);
    alert(`操作失败：${resolveErrorMessage(error)}`);
  } finally {
    state.likingSongId = "";
    render();
  }
}

async function likeSong(songId) {
  const { error } = await supabase.rpc("toggle_song_like", {
    p_song_id: songId,
    p_playlist_date: state.currentPeriod.id,
    p_voter_cookie: state.userId,
    p_action: "like",
  });
  if (error) throw error;
}

async function unlikeSong(songId) {
  const { error } = await supabase.rpc("toggle_song_like", {
    p_song_id: songId,
    p_playlist_date: state.currentPeriod.id,
    p_voter_cookie: state.userId,
    p_action: "unlike",
  });
  if (error) throw error;
}

function handlePaginationClick(event) {
  const button = event.target.closest("[data-page]");
  if (!button) return;
  const nextPage = Number(button.dataset.page);
  if (!Number.isInteger(nextPage) || nextPage < 1) return;
  state.currentPage = nextPage;
  render();
  refs.pagination.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function handlePaginationJump(event) {
  const form = event.target.closest("[data-page-jump-form]");
  if (!form) return;
  event.preventDefault();

  const input = form.querySelector("[data-page-jump-input]");
  const pageCount = Number(input?.max);
  const requestedPage = Number(input?.value);
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > pageCount) {
    input?.focus();
    return;
  }

  state.currentPage = requestedPage;
  render();
  refs.pagination.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function render() {
  const filteredSongs = getVisibleSongs();
  const pageCount = Math.max(1, Math.ceil(filteredSongs.length / SONGS_PER_PAGE));
  if (state.currentPage > pageCount) state.currentPage = pageCount;

  const startIndex = (state.currentPage - 1) * SONGS_PER_PAGE;
  const currentSongs = filteredSongs.slice(startIndex, startIndex + SONGS_PER_PAGE);

  refs.songCount.textContent = String(state.songs.length);
  refs.likeCount.textContent = String(state.songs.reduce((sum, song) => sum + (song.likesCount || 0), 0));
  renderPeriodStatus();
  syncFormButton();

  if (!currentSongs.length) {
    refs.songsList.innerHTML = createEmptyState(
      state.songs.length ? "没有找到匹配的歌曲" : "本期还没有投稿",
      state.songs.length
        ? "换个关键词试试，也许那首歌藏在另一个名字里。"
        : state.currentPeriod
          ? "成为第一个把歌声放进本期歌单的人吧。"
          : "管理员开启征集期后，同学们就可以投稿。"
    );
  } else {
    refs.songsList.innerHTML = `
      <div class="songs-table-header" aria-hidden="true">
        <span>序号</span>
        <span>歌曲</span>
        <span>歌手</span>
        <span>喜欢</span>
        <span>操作</span>
      </div>
      ${currentSongs.map((song, index) => createSongCard(song, startIndex + index + 1)).join("")}
    `;
  }

  refs.pagination.innerHTML = createPagination(pageCount);
}

function renderPeriodStatus() {
  if (!state.backendReady) return;

  if (!state.currentPeriod) {
    updateHeroPeriodLabel("暂无开放征集期", "");
    refs.authStatus.textContent = "未开放";
    refs.authStatus.style.color = "var(--danger)";
    refs.submissionPeriodCard.classList.remove("is-active", "is-public");
    refs.submissionPeriodState.textContent = "未开放";
    refs.submissionPeriodTitle.textContent = "暂无开放征集期";
    refs.submissionPeriodTime.textContent = "管理员开启征集期后即可投稿。";
    updateFormHint("当前没有开放的征集期，暂时不能投稿或点赞。", true);
    return;
  }

  updateHeroPeriodLabel(state.currentPeriod.title, formatPeriodRange(state.currentPeriod));
  refs.submissionPeriodTitle.textContent = state.currentPeriod.title;
  refs.submissionPeriodTime.textContent = `征集时间：${formatPeriodRange(state.currentPeriod)}`;

  if (isWithinPeriod(state.currentPeriod)) {
    refs.authStatus.textContent = "征集中";
    refs.authStatus.style.color = "var(--green)";
    refs.submissionPeriodCard.classList.add("is-active");
    refs.submissionPeriodCard.classList.remove("is-public");
    refs.submissionPeriodState.textContent = "征集中";
    updateFormHint("本期正在征集中，欢迎提交歌曲或给喜欢的歌点赞。", false);
  } else {
    refs.authStatus.textContent = "已公示";
    refs.authStatus.style.color = "var(--blue)";
    refs.submissionPeriodCard.classList.add("is-public");
    refs.submissionPeriodCard.classList.remove("is-active");
    refs.submissionPeriodState.textContent = "已公示";
    updateFormHint("本期已停止投稿和点赞，可以继续浏览歌单结果。", false);
  }
}

function updateHeroPeriodLabel(title, time) {
  refs.targetPeriodTitle.textContent = title;
  refs.targetPeriodTime.textContent = time;
  refs.targetDateLabel.classList.toggle("has-time", Boolean(time));
}

function getVisibleSongs() {
  const keyword = normalizeText(state.searchTerm);
  const searchedSongs = keyword
    ? state.songs.filter((song) => {
        const source = `${song.titleLower} ${song.artistLower}`;
        return keyword.split(/\s+/).filter(Boolean).every((part) => source.includes(part));
      })
    : [...state.songs];

  return searchedSongs.sort((firstSong, secondSong) => {
    if (state.sortMode === "time") return sortByTime(firstSong, secondSong);
    return sortByLikes(firstSong, secondSong);
  });
}

function sortByLikes(firstSong, secondSong) {
  const likeGap = (secondSong.likesCount || 0) - (firstSong.likesCount || 0);
  return likeGap || sortByTime(firstSong, secondSong);
}

function sortByTime(firstSong, secondSong) {
  const timeGap = (secondSong.createdAtMs || 0) - (firstSong.createdAtMs || 0);
  return timeGap || firstSong.title.localeCompare(secondSong.title, "zh-CN");
}

function createSongCard(song, rank) {
  const isLiked = state.likedSongIds.has(song.id);
  const isBusy = state.likingSongId === song.id;
  const canLike = canMutateCurrentPeriod();
  const likeLabel = isBusy ? "处理中" : isLiked ? `已喜欢 ${song.likesCount}` : `喜欢 ${song.likesCount}`;

  return `
    <article class="song-card">
      <div class="song-index">${String(rank).padStart(2, "0")}</div>
      <div class="song-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
      <div class="song-artist" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
      <div class="song-like-count">${song.likesCount || 0}</div>
      <button
        class="like-button ${isLiked ? "is-liked" : ""}"
        type="button"
        data-like-song="${song.id}"
        ${isBusy || !canLike ? "disabled" : ""}
      >
        ${likeLabel}
      </button>
    </article>
  `;
}

function createEmptyState(title, copy) {
  return `
    <div class="empty-state">
      <h3 class="empty-title">${escapeHtml(title)}</h3>
      <p class="empty-copy">${escapeHtml(copy)}</p>
    </div>
  `;
}

function createPagination(pageCount) {
  if (pageCount <= 1) return "";
  const pageItems = getPaginationItems(pageCount, state.currentPage);
  const buttons = pageItems.map((item) => {
    if (item === "ellipsis") {
      return `<span class="pagination-ellipsis" aria-hidden="true">...</span>`;
    }
    return `
      <button class="pagination-button ${item === state.currentPage ? "is-active" : ""}" type="button" data-page="${item}">
        ${item}
      </button>
    `;
  });

  return `
    <div class="pagination-pages" aria-label="分页">
      ${buttons.join("")}
    </div>
    <form class="pagination-jump" data-page-jump-form>
      <label class="pagination-jump-label" for="pageJumpInput">跳转到</label>
      <input id="pageJumpInput" data-page-jump-input type="number" min="1" max="${pageCount}" value="${state.currentPage}" inputmode="numeric" aria-label="输入页码" />
      <span class="pagination-jump-total">/ ${pageCount} 页</span>
      <button class="pagination-button pagination-jump-button" type="submit">前往</button>
    </form>
  `;
}

function getPaginationItems(pageCount, currentPage) {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set([1, pageCount, currentPage]);
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
  } else if (currentPage >= pageCount - 2) {
    pages.add(pageCount - 2);
    pages.add(pageCount - 1);
  } else {
    pages.add(currentPage - 1);
    pages.add(currentPage + 1);
  }

  const sortedPages = [...pages].filter((page) => page >= 1 && page <= pageCount).sort((first, second) => first - second);
  return sortedPages.flatMap((page, index) => {
    const previousPage = sortedPages[index - 1];
    return index > 0 && page - previousPage > 1 ? ["ellipsis", page] : [page];
  });
}

function updateFormHint(message, isError) {
  refs.formHint.textContent = message;
  refs.formHint.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function syncFormButton() {
  const disabled = state.isSubmitting || !canMutateCurrentPeriod();
  refs.submitButton.disabled = disabled;
  refs.submitButton.textContent = state.isSubmitting ? "正在提交..." : "✈ 提交歌单";
}

function openSettingsModal() {
  refs.settingsModal.classList.remove("hidden");
  refs.adminUsername.focus();
}

function closeSettingsModal() {
  refs.settingsModal.classList.add("hidden");
  refs.adminLoginHint.textContent = "";
}

function handleAdminLogin(event) {
  event.preventDefault();
  const username = refs.adminUsername.value.trim();
  const password = refs.adminPassword.value;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    state.isAdminAuthenticated = true;
    refs.adminPanel.classList.remove("hidden");
    refs.adminLoginForm.reset();
    refs.adminLoginHint.textContent = "";
    closeSettingsModal();
    renderPeriodAdminState();
    renderHistoryList();
    loadCurrentAnnouncementToForm();
    refs.adminPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  refs.adminLoginHint.textContent = "账号或密码不正确。";
  refs.adminLoginHint.style.color = "var(--danger)";
}

function handleAdminLogout() {
  state.isAdminAuthenticated = false;
  refs.adminPanel.classList.add("hidden");
  refs.adminLoginForm.reset();
}

async function handlePeriodSubmit(event) {
  event.preventDefault();
  if (!state.isAdminAuthenticated) {
    alert("请先登录管理员账号。");
    return;
  }
  if (!state.backendReady) {
    updatePeriodHint("后端尚未连接，无法保存征集期。", true);
    return;
  }

  const title = refs.periodTitle.value.trim();
  const startsAt = parseDateTimeLocal(refs.periodStart.value);
  const endsAt = parseDateTimeLocal(refs.periodEnd.value);
  if (!title || !startsAt || !endsAt || startsAt >= endsAt) {
    updatePeriodHint("请填写有效的标题、开始时间和结束时间。", true);
    return;
  }

  refs.savePeriodBtn.disabled = true;
  updatePeriodHint("正在保存征集期...", false);
  try {
    await supabase.from(PERIODS_TABLE).update({ status: "archived", updated_at: new Date().toISOString() }).eq("status", "active");
    const payload = {
      title,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "active",
      updated_at: new Date().toISOString(),
    };
    const { error } = state.currentPeriod
      ? await supabase.from(PERIODS_TABLE).update(payload).eq("id", state.currentPeriod.id)
      : await supabase.from(PERIODS_TABLE).insert({
          ...payload,
          created_by: state.userId || ADMIN_USERNAME,
        });
    if (error) throw error;
    await syncPeriods();
    await syncAllData();
    updatePeriodHint("征集期已保存。", false);
  } catch (error) {
    console.error("保存征集期失败:", error);
    updatePeriodHint(`保存失败：${resolveErrorMessage(error)}`, true);
  } finally {
    refs.savePeriodBtn.disabled = false;
  }
}

async function handleArchiveCurrentPeriod() {
  if (!state.isAdminAuthenticated) {
    alert("请先登录管理员账号。");
    return;
  }
  if (!state.currentPeriod) {
    updatePeriodHint("当前没有可归档的歌单。", true);
    return;
  }
  if (!confirm("确定要归档当前歌单吗？归档后本期将不再允许投稿和点赞。")) return;

  refs.archivePeriodBtn.disabled = true;
  updatePeriodHint("正在归档当前歌单...", false);
  try {
    const { error } = await supabase
      .from(PERIODS_TABLE)
      .update({ status: "archived", archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", state.currentPeriod.id);
    if (error) throw error;
    const archivedId = state.currentPeriod.id;
    state.currentPeriod = null;
    state.songs = [];
    state.likedSongIds = new Set();
    await syncPeriods();
    await syncAllData();
    await loadHistoryPeriod(archivedId);
    updatePeriodHint("当前歌单已归档。", false);
  } catch (error) {
    console.error("归档失败:", error);
    updatePeriodHint(`归档失败：${resolveErrorMessage(error)}`, true);
  } finally {
    refs.archivePeriodBtn.disabled = false;
  }
}

function renderPeriodAdminState() {
  if (!state.currentPeriod) {
    refs.periodHint.textContent = "当前没有开放的征集期。";
    refs.archivePeriodBtn.disabled = true;
    return;
  }
  refs.periodTitle.value = state.currentPeriod.title;
  refs.periodStart.value = formatDateTimeLocalInput(state.currentPeriod.startsAt);
  refs.periodEnd.value = formatDateTimeLocalInput(state.currentPeriod.endsAt);
  refs.archivePeriodBtn.disabled = false;
  refs.periodHint.textContent = isWithinPeriod(state.currentPeriod)
    ? `当前征集中：${formatPeriodRange(state.currentPeriod)}`
    : `当前歌单已进入公示：${formatPeriodRange(state.currentPeriod)}`;
}

function updatePeriodHint(message, isError) {
  refs.periodHint.textContent = message;
  refs.periodHint.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function renderHistoryList() {
  if (!state.periods.length) {
    refs.periodHistoryList.innerHTML = `<div class="empty-inline">暂无历史征集期。</div>`;
    refs.historySongsList.innerHTML = "";
    return;
  }
  refs.periodHistoryList.innerHTML = state.periods
    .map((period) => `
      <button class="history-period-button ${period.id === state.historyPeriodId ? "is-active" : ""}" type="button" data-history-period="${period.id}">
        <span>${escapeHtml(period.title)}</span>
        <small>${period.status === "active" ? "当前" : "归档"} · ${escapeHtml(formatPeriodRange(period))}</small>
      </button>
    `)
    .join("");
}

async function handlePeriodHistoryClick(event) {
  const button = event.target.closest("[data-history-period]");
  if (button) await loadHistoryPeriod(button.dataset.historyPeriod);
}

async function loadHistoryPeriod(periodId) {
  const period = state.periods.find((item) => item.id === periodId);
  if (!period) return;
  state.historyPeriodId = periodId;
  updateHistoryHint("正在读取历史歌单...", false);
  renderHistoryList();
  try {
    state.historySongs = await fetchSongs(periodId);
    renderHistorySongs(period);
    updateHistoryHint("历史歌单已读取。", false);
  } catch (error) {
    console.error("读取历史歌单失败:", error);
    updateHistoryHint(`读取失败：${resolveErrorMessage(error)}`, true);
  }
}

function renderHistorySongs(period) {
  if (!state.historySongs.length) {
    refs.historySongsList.innerHTML = `<div class="empty-inline">${escapeHtml(period.title)} 暂无投稿。</div>`;
    return;
  }
  const songs = [...state.historySongs].sort(sortByLikes);
  const previewSongs = songs.slice(0, HISTORY_PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, songs.length - previewSongs.length);
  refs.historySongsList.innerHTML = `
    <div class="history-readonly-label">只读歌单 · ${escapeHtml(period.title)}</div>
    ${previewSongs.map((song, index) => `
      <div class="history-song-row">
        <span>${index + 1}. ${escapeHtml(song.title)} - ${escapeHtml(song.artist)}</span>
        <strong>${song.likesCount || 0} 喜欢</strong>
      </div>
    `).join("")}
    ${hiddenCount ? `<div class="history-song-ellipsis">... 还有 ${hiddenCount} 首已收起，可在导出区获取完整歌单</div>` : ""}
  `;
}

function updateHistoryHint(message, isError) {
  refs.historyHint.textContent = message;
  refs.historyHint.style.color = isError ? "var(--danger)" : "var(--muted)";
}

async function fetchAnnouncement() {
  const tableName = supabaseConfig.tables?.announcements || "announcements";
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(3);
    if (error) throw error;
    state.announcements = data ?? [];
    state.currentAnnouncement = state.announcements[0] ?? null;
    renderNoticeBoard();
    if (state.isAdminAuthenticated) loadCurrentAnnouncementToForm();
  } catch (error) {
    state.announcements = [];
    state.currentAnnouncement = null;
    renderNoticeBoard("公告读取失败，请稍后刷新。");
    console.warn("公告读取失败:", error);
    if (state.isAdminAuthenticated) updateAnnouncementHint(`公告读取失败：${resolveErrorMessage(error)}`, true);
  }
}

function checkAndShowAnnouncement() {
  if (!state.currentAnnouncement) return;
  showAnnouncementModal(state.currentAnnouncement);
}

function showAnnouncementModal(announcement) {
  refs.announcementModalTitle.textContent = announcement.title || "公告";
  refs.announcementModalContent.textContent = announcement.content || "";
  refs.announcementModal.classList.remove("hidden");
}

function closeAnnouncementModal() {
  refs.announcementModal.classList.add("hidden");
}

function handleNoticeBoardClick(event) {
  const button = event.target.closest("[data-notice-index]");
  if (!button) return;

  const noticeIndex = Number(button.dataset.noticeIndex);
  const announcement = Number.isInteger(noticeIndex) ? state.announcements[noticeIndex] : null;
  if (announcement) showAnnouncementModal(announcement);
}

function renderNoticeBoard(fallbackMessage = "暂无公告。") {
  if (!state.announcements.length) {
    refs.noticeBoardList.innerHTML = `<div class="empty-inline">${escapeHtml(fallbackMessage)}</div>`;
    return;
  }

  refs.noticeBoardList.innerHTML = state.announcements
    .map((announcement, index) => `
      <button class="notice-board-item" type="button" data-notice-index="${index}" aria-label="查看公告：${escapeHtml(announcement.title || "公告")}">
        <div>
          <strong>${escapeHtml(announcement.title || "公告")}</strong>
          <time>${escapeHtml(formatDateTime(Date.parse(announcement.created_at ?? "") || 0))}</time>
        </div>
        <p>${escapeHtml(announcement.content || "")}</p>
      </button>
    `)
    .join("");
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
    alert("请先登录管理员账号。");
    return;
  }
  if (!state.backendReady) {
    updateAnnouncementHint("后端尚未连接，无法发布公告。", true);
    return;
  }

  const title = refs.announcementTitle.value.trim();
  const content = refs.announcementContent.value.trim();
  if (!title || !content) {
    updateAnnouncementHint("请填写公告标题和内容。", true);
    return;
  }

  const tableName = supabaseConfig.tables?.announcements || "announcements";
  refs.saveAnnouncementBtn.disabled = true;
  refs.disableAnnouncementBtn.disabled = true;
  refs.saveAnnouncementBtn.textContent = "发布中...";
  updateAnnouncementHint("正在发布公告...", false);
  try {
    const { error } = await supabase.from(tableName).insert({
      title,
      content,
      is_active: true,
      created_by: state.userId,
    });
    if (error) throw error;
    await fetchAnnouncement();
    updateAnnouncementHint("公告已发布，并已加入告示栏。", false);
    checkAndShowAnnouncement();
  } catch (error) {
    console.error("发布公告失败:", error);
    updateAnnouncementHint(`发布失败：${resolveErrorMessage(error)}`, true);
  } finally {
    refs.saveAnnouncementBtn.disabled = false;
    refs.disableAnnouncementBtn.disabled = false;
    refs.saveAnnouncementBtn.textContent = "发布公告";
  }
}

async function handleDisableAnnouncement() {
  if (!state.isAdminAuthenticated) {
    alert("请先登录管理员账号。");
    return;
  }
  if (!state.backendReady) {
    updateAnnouncementHint("后端尚未连接，无法关闭公告。", true);
    return;
  }
  if (!state.currentAnnouncement?.id) {
    updateAnnouncementHint("当前没有可关闭的公告。", true);
    return;
  }
  if (!confirm("确定要关闭最新公告吗？关闭后它不会继续弹窗或显示在告示栏。")) return;

  const tableName = supabaseConfig.tables?.announcements || "announcements";
  try {
    refs.disableAnnouncementBtn.disabled = true;
    const { error } = await supabase
      .from(tableName)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", state.currentAnnouncement.id);
    if (error) throw error;
    await fetchAnnouncement();
    refs.announcementForm.reset();
    updateAnnouncementHint("最新公告已关闭。", false);
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
    alert("请先登录管理员账号。");
    return;
  }
  const exportText = buildExportText();
  if (!exportText) return;
  try {
    await copyTextToClipboard(exportText);
    updateExportHint("歌单已复制到剪贴板。", false);
  } catch (error) {
    console.error("复制失败:", error);
    updateExportHint("复制失败，可以尝试下载 TXT。", true);
  }
}

function handleDownloadExport() {
  if (!state.isAdminAuthenticated) {
    alert("请先登录管理员账号。");
    return;
  }
  const exportText = buildExportText();
  if (!exportText) return;

  const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const period = getExportPeriod();
  link.href = url;
  link.download = `chu_xiaomai_${period?.title || "songs"}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  updateExportHint("TXT 已开始下载。", false);
}

function buildExportText() {
  const exportSongs = getExportSongs();
  if (!exportSongs.length) {
    updateExportHint("当前没有可导出的歌曲。", true);
    return "";
  }

  const period = getExportPeriod();
  const orderLabel = refs.exportOrderSelect.value === "likes-asc" ? "喜欢数从低到高" : "喜欢数从高到低";
  const lines = exportSongs.map((song, index) => `${index + 1}. ${song.title} - ${song.artist}（喜欢 ${song.likesCount || 0}）`);

  return [
    "长大小麦君歌单导出",
    `征集期：${period?.title || "未选择征集期"}`,
    `时间：${period ? formatPeriodRange(period) : "无"}`,
    `排序：${orderLabel}`,
    `数量：${exportSongs.length}`,
    "",
    ...lines,
  ].join("\n");
}

function getExportPeriod() {
  if (state.historyPeriodId) return state.periods.find((period) => period.id === state.historyPeriodId) ?? state.currentPeriod;
  return state.currentPeriod;
}

function getExportSongs() {
  const requestedCount = Number.parseInt(refs.exportCountInput.value, 10);
  const exportCount = Number.isInteger(requestedCount) ? Math.min(Math.max(requestedCount, 1), 500) : 10;
  refs.exportCountInput.value = String(exportCount);
  const sourceSongs = state.historyPeriodId ? state.historySongs : state.songs;
  return [...sourceSongs]
    .sort((firstSong, secondSong) => {
      const likeGap = refs.exportOrderSelect.value === "likes-asc"
        ? (firstSong.likesCount || 0) - (secondSong.likesCount || 0)
        : (secondSong.likesCount || 0) - (firstSong.likesCount || 0);
      return likeGap || sortByTime(firstSong, secondSong);
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

function canMutateCurrentPeriod() {
  return Boolean(
    state.backendReady &&
      state.userId &&
      state.currentPeriod &&
      state.currentPeriod.status === "active" &&
      isWithinPeriod(state.currentPeriod)
  );
}

function getReadOnlyMessage() {
  if (!state.currentPeriod) return "当前没有开放的征集期。";
  if (state.currentPeriod.status !== "active") return "这期歌单已经归档，不能继续操作。";
  return "当前不在征集时间内，暂时不能投稿或点赞。";
}

function isWithinPeriod(period) {
  if (!period) return false;
  const now = Date.now();
  return period.startsAt <= now && now <= period.endsAt;
}

function normalizePeriod(period) {
  return {
    id: period.id,
    title: period.title ?? "未命名歌单",
    startsAt: Date.parse(period.starts_at ?? "") || 0,
    endsAt: Date.parse(period.ends_at ?? "") || 0,
    status: period.status ?? "archived",
    createdAtMs: Date.parse(period.created_at ?? "") || 0,
    archivedAtMs: Date.parse(period.archived_at ?? "") || 0,
  };
}

function mapSongs(data) {
  return (data ?? []).map((song) => ({
    id: song.id,
    title: song.title ?? "",
    artist: song.artist ?? "",
    titleLower: song.title_lower ?? normalizeText(song.title ?? ""),
    artistLower: song.artist_lower ?? normalizeText(song.artist ?? ""),
    likesCount: Number.isFinite(song.likes_count) ? song.likes_count : 0,
    createdAtMs: Date.parse(song.created_at ?? "") || 0,
    createdBy: song.created_by ?? "",
  }));
}

function getOrCreateVisitorId() {
  const existingId = getCookieValue(VISITOR_COOKIE_NAME);
  if (existingId) return existingId;

  const legacyId = localStorage.getItem(LEGACY_VISITOR_STORAGE_KEY);
  const nextId =
    legacyId ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `visitor_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  setVoterCookie(nextId);
  if (getCookieValue(VISITOR_COOKIE_NAME) !== nextId) {
    throw new Error("浏览器必须允许本站 Cookie 后才能投票，请关闭无痕/禁用 Cookie 模式后重试。");
  }
  localStorage.setItem(LEGACY_VISITOR_STORAGE_KEY, nextId);
  return nextId;
}

function getCookieValue(name) {
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function setVoterCookie(value) {
  const maxAge = 60 * 60 * 24 * 365;
  const secureFlag = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${VISITOR_COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secureFlag}`;
}

function normalizeText(value) {
  return String(value).trim().toLocaleLowerCase("zh-CN");
}

function formatPeriodRange(period) {
  return `${formatDateTime(period.startsAt)} - ${formatDateTime(period.endsAt)}`;
}

function formatDateTime(milliseconds) {
  if (!milliseconds) return "无时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(milliseconds));
}

function parseDateTimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTimeLocalInput(milliseconds) {
  if (!milliseconds) return "";
  const date = new Date(milliseconds);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
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
