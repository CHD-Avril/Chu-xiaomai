import { bmobConfig, hasValidBmobConfig } from "./bmob-config.js";

const SONGS_PER_PAGE = 6;
const POLL_INTERVAL_MS = 20000;
const TARGET_DATE = getTomorrowDateKey();

const state = {
  userId: "",
  songs: [],
  likedSongIds: new Set(),
  likeObjectIdsBySongId: new Map(),
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

let syncTimerId = 0;

refs.targetDateLabel.textContent = formatDateLabel(TARGET_DATE);

bindEvents();
render();

if (!hasValidBmobConfig()) {
  refs.firebaseNotice.classList.remove("hidden");
  refs.authStatus.textContent = "等待配置";
  refs.authStatus.style.color = "var(--danger)";
  refs.songsList.innerHTML = createEmptyState(
    "还没有连接 Bmob",
    "先填好 bmob-config.js 里的项目参数，再刷新页面，就可以开始投稿和点赞了。"
  );
  syncFormButton();
} else {
  bootBmob();
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

async function bootBmob() {
  try {
    state.userId = getOrCreateVisitorId();
    state.backendReady = true;
    refs.authStatus.textContent = "同步中";
    refs.authStatus.style.color = "var(--blue-deep)";
    syncFormButton();

    await syncAllData();

    refs.authStatus.textContent = "已连接";
    refs.authStatus.style.color = "var(--green)";

    syncTimerId = window.setInterval(() => {
      syncAllData({ silent: true });
    }, POLL_INTERVAL_MS);
  } catch (error) {
    handleBmobError("Bmob 初始化失败，请检查配置或网络。", error);
  }
}

async function syncAllData(options = {}) {
  if (!state.backendReady) {
    return;
  }

  try {
    const [songs, likes] = await Promise.all([fetchSongs(), fetchLikes()]);
    state.songs = songs;
    state.likedSongIds = new Set(likes.map((item) => item.songId));
    state.likeObjectIdsBySongId = new Map(likes.map((item) => [item.songId, item.objectId]));
    render();
  } catch (error) {
    if (!options.silent) {
      handleBmobError(`数据同步失败：${resolveErrorMessage(error)}`, error);
    } else {
      console.error("静默同步失败", error);
    }
  }
}

async function fetchSongs() {
  const response = await bmobRequest(`/classes/${bmobConfig.tables.songs}`, {
    query: {
      where: JSON.stringify({
        playlistDate: TARGET_DATE,
      }),
      limit: "500",
    },
  });

  return (response.results ?? []).map((song) => ({
    id: song.objectId,
    title: song.title ?? "",
    artist: song.artist ?? "",
    titleLower: song.titleLower ?? "",
    artistLower: song.artistLower ?? "",
    likesCount: Number.isFinite(song.likesCount) ? song.likesCount : 0,
    createdAtMs: Date.parse(song.createdAt ?? "") || 0,
    createdBy: song.createdBy ?? "",
  }));
}

async function fetchLikes() {
  const response = await bmobRequest(`/classes/${bmobConfig.tables.likes}`, {
    query: {
      where: JSON.stringify({
        playlistDate: TARGET_DATE,
        userId: state.userId,
      }),
      limit: "500",
    },
  });

  return (response.results ?? []).map((like) => ({
    objectId: like.objectId,
    songId: like.songId,
  }));
}

async function handleSongSubmit(event) {
  event.preventDefault();

  if (!state.backendReady) {
    updateFormHint("请先完成 Bmob 配置。", true);
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
    await bmobRequest(`/classes/${bmobConfig.tables.songs}`, {
      method: "POST",
      body: {
        title,
        artist,
        titleLower,
        artistLower,
        playlistDate: TARGET_DATE,
        likesCount: 0,
        createdBy: state.userId,
      },
    });

    refs.form.reset();
    updateFormHint("投稿成功，这首歌已经进入明日歌单池。", false);
    await syncAllData();
  } catch (error) {
    handleBmobError(`投稿失败：${resolveErrorMessage(error)}`, error);
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

    await syncAllData({ silent: true });
  } catch (error) {
    handleBmobError(`点赞操作失败：${resolveErrorMessage(error)}`, error);
  } finally {
    state.likingSongId = "";
    render();
  }
}

async function likeSong(songId) {
  await bmobRequest("/batch", {
    method: "POST",
    body: {
      requests: [
        {
          method: "POST",
          path: `/1/classes/${bmobConfig.tables.likes}`,
          body: {
            songId,
            userId: state.userId,
            playlistDate: TARGET_DATE,
          },
        },
        {
          method: "PUT",
          path: `/1/classes/${bmobConfig.tables.songs}/${songId}`,
          body: {
            likesCount: {
              __op: "Increment",
              amount: 1,
            },
          },
        },
      ],
    },
  });
}

async function unlikeSong(songId) {
  const likeObjectId = state.likeObjectIdsBySongId.get(songId);

  if (!likeObjectId) {
    throw new Error("未找到对应的点赞记录。");
  }

  await bmobRequest("/batch", {
    method: "POST",
    body: {
      requests: [
        {
          method: "DELETE",
          path: `/1/classes/${bmobConfig.tables.likes}/${likeObjectId}`,
        },
        {
          method: "PUT",
          path: `/1/classes/${bmobConfig.tables.songs}/${songId}`,
          body: {
            likesCount: {
              __op: "Increment",
              amount: -1,
            },
          },
        },
      ],
    },
  });
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

async function bmobRequest(path, options = {}) {
  const url = new URL(`${trimTrailingSlash(bmobConfig.baseUrl)}${path}`);
  const requestHeaders = new Headers({
    "Content-Type": "application/json",
    "X-Bmob-Application-Id": bmobConfig.applicationId,
    "X-Bmob-REST-API-Key": bmobConfig.restApiKey,
  });

  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: requestHeaders,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const message = data.error || `Bmob 请求失败（${response.status}）`;
    throw new Error(message);
  }

  return data;
}

function syncFormButton() {
  refs.submitButton.disabled = state.isSubmitting || !state.userId;
  refs.submitButton.textContent = state.isSubmitting ? "提交中..." : "提交到明日歌单";
}

function updateFormHint(message, isError) {
  refs.formHint.textContent = message;
  refs.formHint.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function handleBmobError(message, error) {
  console.error(message, error);
  refs.authStatus.textContent = "连接异常";
  refs.authStatus.style.color = "var(--danger)";
  updateFormHint(message, true);
}

function resolveErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "请检查网络、表名或密钥配置";
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

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
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
