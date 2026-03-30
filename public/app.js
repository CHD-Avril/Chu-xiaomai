import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { supabaseConfig, hasValidSupabaseConfig } from "./supabase-config.js";

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
};

const supabase = hasValidSupabaseConfig()
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : null;

refs.targetDateLabel.textContent = formatDateLabel(TARGET_DATE);

bindEvents();
render();

if (!hasValidSupabaseConfig()) {
  refs.firebaseNotice.classList.remove("hidden");
  refs.authStatus.textContent = "等待配置";
  refs.authStatus.style.color = "var(--danger)";
  refs.songsList.innerHTML = createEmptyState(
    "还没有连接 Supabase",
    "先填好 supabase-config.js 里的项目参数，再刷新页面，就可以开始投稿和点赞了。"
  );
  syncFormButton();
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
}

async function bootSupabase() {
  try {
    state.userId = getOrCreateVisitorId();
    state.backendReady = true;
    refs.authStatus.textContent = "同步中";
    refs.authStatus.style.color = "var(--blue-deep)";
    syncFormButton();

    await syncAllData();

    refs.authStatus.textContent = "已连接";
    refs.authStatus.style.color = "var(--green)";
  } catch (error) {
    handleSupabaseError(`Supabase 初始化失败：${resolveErrorMessage(error)}`, error);
  }
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
    handleSupabaseError(`投稿失败：${resolveErrorMessage(error)}`, error);
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
    handleSupabaseError(`点赞操作失败：${resolveErrorMessage(error)}`, error);
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

function handleSupabaseError(message, error) {
  console.error(message, error);
  refs.authStatus.textContent = "连接异常";
  refs.authStatus.style.color = "var(--danger)";
  updateFormHint(message, true);
}

function resolveErrorMessage(error) {
  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
    if ("error_description" in error && typeof error.error_description === "string") {
      return error.error_description;
    }
  }

  return "请检查表结构、权限策略或网络";
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
