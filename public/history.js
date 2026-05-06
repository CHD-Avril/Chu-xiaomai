import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { supabaseConfig, hasValidSupabaseConfig } from "./supabase-config.js";

const SONGS_PER_PAGE = 12;
const PERIODS_TABLE = "playlist_periods";

const refs = {
  status: document.querySelector("#historyStatus"),
  periodSelect: document.querySelector("#historyPeriodSelect"),
  periodMeta: document.querySelector("#periodMeta"),
  songCount: document.querySelector("#historySongCount"),
  likeCount: document.querySelector("#historyLikeCount"),
  songsTable: document.querySelector("#historySongsTable"),
  pagination: document.querySelector("#historyPagination"),
};

const state = {
  periods: [],
  songs: [],
  currentPage: 1,
};

const supabase = hasValidSupabaseConfig()
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : null;

refs.periodSelect.addEventListener("change", () => {
  loadPeriodSongs(refs.periodSelect.value);
});
refs.pagination.addEventListener("click", handlePaginationClick);
refs.pagination.addEventListener("submit", handlePaginationJump);

if (!supabase) {
  setStatus("Supabase 尚未配置", true);
  refs.songsTable.innerHTML = createEmptyState("暂时无法读取往期歌单", "请先检查 supabase-config.js 配置。");
  refs.pagination.innerHTML = "";
} else {
  bootHistoryPage();
}

async function bootHistoryPage() {
  try {
    setStatus("正在读取往期歌单...", false);
    const periods = await fetchArchivedPeriods();
    state.periods = periods;
    renderPeriodOptions();

    if (!periods.length) {
      setStatus("暂无往期歌单", false);
      refs.periodMeta.textContent = "当前还没有已归档的征集歌单。";
      refs.songsTable.innerHTML = createEmptyState("暂无往期歌单", "管理员归档征集期后，这里会显示对应歌单。");
      refs.pagination.innerHTML = "";
      return;
    }

    refs.periodSelect.disabled = false;
    await loadPeriodSongs(periods[0].id);
    setStatus(`已保存 ${periods.length} 期往期歌单`, false);
  } catch (error) {
    console.error("读取往期歌单失败:", error);
    setStatus("读取失败", true);
    refs.periodMeta.textContent = resolveErrorMessage(error);
    refs.songsTable.innerHTML = createEmptyState("读取往期歌单失败", "请稍后刷新页面重试。");
    refs.pagination.innerHTML = "";
  }
}

async function fetchArchivedPeriods() {
  const { data, error } = await supabase
    .from(PERIODS_TABLE)
    .select("id,title,starts_at,ends_at,status,created_at,archived_at")
    .eq("status", "archived")
    .order("archived_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data ?? []).map(normalizePeriod);
}

function renderPeriodOptions() {
  if (!state.periods.length) {
    refs.periodSelect.innerHTML = `<option>暂无已归档歌单</option>`;
    refs.periodSelect.disabled = true;
    return;
  }

  refs.periodSelect.innerHTML = state.periods
    .map((period) => `<option value="${period.id}">${escapeHtml(period.title)} | ${escapeHtml(formatPeriodRange(period))}</option>`)
    .join("");
}

async function loadPeriodSongs(periodId) {
  const period = state.periods.find((item) => item.id === periodId);
  if (!period) return;

  state.currentPage = 1;
  refs.periodSelect.value = periodId;
  refs.periodMeta.textContent = `${period.title} · ${formatPeriodRange(period)}`;
  refs.songsTable.innerHTML = createEmptyState("正在读取歌单", "马上就好。");
  refs.pagination.innerHTML = "";

  const { data, error } = await supabase
    .from(supabaseConfig.tables.songs)
    .select("id,title,artist,playlist_date,likes_count,created_at")
    .eq("playlist_date", periodId)
    .limit(500);

  if (error) throw error;

  state.songs = mapSongs(data).sort(sortByLikes);
  renderSongs(period);
}

function renderSongs(period) {
  refs.songCount.textContent = String(state.songs.length);
  refs.likeCount.textContent = String(state.songs.reduce((sum, song) => sum + (song.likesCount || 0), 0));

  if (!state.songs.length) {
    refs.songsTable.innerHTML = createEmptyState(`${period.title} 暂无投稿`, "这期歌单没有保存到歌曲。");
    refs.pagination.innerHTML = "";
    return;
  }

  const pageCount = Math.max(1, Math.ceil(state.songs.length / SONGS_PER_PAGE));
  if (state.currentPage > pageCount) state.currentPage = pageCount;
  const startIndex = (state.currentPage - 1) * SONGS_PER_PAGE;
  const currentSongs = state.songs.slice(startIndex, startIndex + SONGS_PER_PAGE);

  refs.songsTable.innerHTML = `
    <div class="readonly-table-header" aria-hidden="true">
      <span>序号</span>
      <span>歌曲</span>
      <span>歌手</span>
      <span>喜欢</span>
    </div>
    ${currentSongs.map((song, index) => createReadonlySongRow(song, startIndex + index + 1)).join("")}
  `;
  refs.pagination.innerHTML = createPagination(pageCount);
}

function createReadonlySongRow(song, rank) {
  return `
    <article class="readonly-song-row">
      <div class="song-index">${String(rank).padStart(2, "0")}</div>
      <div class="song-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
      <div class="song-artist" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
      <div class="song-like-count">${song.likesCount || 0}</div>
    </article>
  `;
}

function normalizePeriod(period) {
  return {
    id: period.id,
    title: period.title ?? "未命名歌单",
    startsAt: Date.parse(period.starts_at ?? "") || 0,
    endsAt: Date.parse(period.ends_at ?? "") || 0,
    archivedAtMs: Date.parse(period.archived_at ?? "") || 0,
    createdAtMs: Date.parse(period.created_at ?? "") || 0,
  };
}

function mapSongs(data) {
  return (data ?? []).map((song) => ({
    id: song.id,
    title: song.title ?? "",
    artist: song.artist ?? "",
    likesCount: Number.isFinite(song.likes_count) ? song.likes_count : 0,
    createdAtMs: Date.parse(song.created_at ?? "") || 0,
  }));
}

function sortByLikes(firstSong, secondSong) {
  const likeGap = (secondSong.likesCount || 0) - (firstSong.likesCount || 0);
  return likeGap || (secondSong.createdAtMs || 0) - (firstSong.createdAtMs || 0);
}

function createEmptyState(title, copy) {
  return `
    <div class="empty-state">
      <h3 class="empty-title">${escapeHtml(title)}</h3>
      <p class="empty-copy">${escapeHtml(copy)}</p>
    </div>
  `;
}

function handlePaginationClick(event) {
  const button = event.target.closest("[data-page]");
  if (!button) return;

  const requestedPage = Number(button.dataset.page);
  if (!Number.isInteger(requestedPage) || requestedPage === state.currentPage) return;
  showHistoryPage(requestedPage);
}

function handlePaginationJump(event) {
  const form = event.target.closest("[data-page-jump-form]");
  if (!form) return;

  event.preventDefault();
  const input = form.querySelector("[data-page-jump-input]");
  const requestedPage = Number(input?.value);
  if (!Number.isInteger(requestedPage) || requestedPage === state.currentPage) return;
  showHistoryPage(requestedPage);
}

function showHistoryPage(page) {
  const pageCount = Math.max(1, Math.ceil(state.songs.length / SONGS_PER_PAGE));
  state.currentPage = Math.min(Math.max(page, 1), pageCount);
  const period = state.periods.find((item) => item.id === refs.periodSelect.value);
  if (!period) return;
  renderSongs(period);
  refs.pagination.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      <label class="pagination-jump-label" for="historyPageJumpInput">跳转到</label>
      <input id="historyPageJumpInput" data-page-jump-input type="number" min="1" max="${pageCount}" value="${state.currentPage}" inputmode="numeric" aria-label="输入页码" />
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

function setStatus(message, isError) {
  refs.status.textContent = message;
  refs.status.style.color = isError ? "var(--danger)" : "var(--blue)";
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
