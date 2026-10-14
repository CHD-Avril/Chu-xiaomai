// 后端数据访问层 —— 封装全部 Supabase 查询与 RPC 调用
// 与旧 app.js 的调用参数保持一致；错误统一抛出，由调用方处理。
import { supabase } from "./supabase";
import { normalizeText } from "../utils/format";
import { readPeriodRows } from "../../../shared/periods";
import { readRequest } from "./readRequest";

// ---------- 用户端 ----------

export async function fetchPeriods() {
  return (await readRequest("读取征集期", async (signal) => ({ data: await readPeriodRows(supabase, { signal }) }))).map(normalizePeriod);
}

export async function fetchArchivedPeriods() {
  return (await readRequest("读取往期征集", async (signal) => ({ data: await readPeriodRows(supabase, { archived: true, signal }) }))).map(normalizePeriod);
}

export async function fetchSongs(periodId) {
  const data = await readRequest("读取歌单", (signal) => supabase
    .from("songs")
    .select("id,title,artist,title_lower,artist_lower,playlist_date,likes_count,dislikes_count,is_locked,created_at")
    .eq("playlist_date", periodId)
    .limit(500).abortSignal(signal));
  return mapSongs(data);
}

export async function fetchMyLikes(periodId, voterCookie) {
  const data = await readRequest("读取个人喜欢记录", (signal) => supabase.rpc("get_my_likes", {
    p_playlist_date: periodId,
    p_voter_cookie: voterCookie,
  }).abortSignal(signal));
  return (data ?? []).map((row) => typeof row === "string" ? row : row.song_id).filter(Boolean);
}

export async function fetchMyDislikes(periodId, voterCookie) {
  const data = await readRequest("读取个人点踩记录", (signal) => supabase.rpc("get_my_dislikes", {
    p_playlist_date: periodId,
    p_voter_cookie: voterCookie,
  }).abortSignal(signal));
  return (data ?? []).map((row) => typeof row === "string" ? row : row.song_id).filter(Boolean);
}

export async function submitSong({ title, artist, playlistDate, voterCookie }) {
  const { data, error } = await supabase.rpc("submit_song", {
    p_title: title,
    p_artist: artist,
    p_playlist_date: playlistDate,
    p_voter_cookie: voterCookie,
  });
  if (error) throw error;
  assertMutationResult(data);
  return data?.[0] ?? null;
}

export async function toggleLike({ songId, playlistDate, voterCookie, action }) {
  const { data, error } = await supabase.rpc("toggle_song_like", {
    p_song_id: songId,
    p_playlist_date: playlistDate,
    p_voter_cookie: voterCookie,
    p_action: action === "on" ? "like" : "unlike",
  });
  if (error) throw error;
  assertMutationResult(data);
}

export async function toggleDislike({ songId, playlistDate, voterCookie, action, reason = null }) {
  const { data, error } = await supabase.rpc("toggle_song_dislike", {
    p_song_id: songId,
    p_playlist_date: playlistDate,
    p_voter_cookie: voterCookie,
    p_action: action === "on" ? "dislike" : "undislike",
    p_reason: reason,
  });
  if (error) throw error;
  assertMutationResult(data);
}

// Business rejection is returned as data so the database can commit its request counter.
function assertMutationResult(data) {
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.error_code || result?.error_message) throw new Error(result.error_message || "操作失败，请稍后重试。");
}

export async function fetchAnnouncements() {
  const data = await readRequest("读取公告", (signal) => supabase
    .from("announcements")
    .select("id,title,content,is_active,created_at,updated_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(20).abortSignal(signal));
  return data ?? [];
}

// ---------- 管理端 ----------

export async function isAdminEmailAllowed(email) {
  const { data, error } = await supabase.rpc("is_admin_email_allowed", { p_email: email });
  if (error) throw error;
  return data === true;
}

export async function isCurrentUserAdmin() {
  const { data, error } = await supabase.rpc("is_current_user_admin");
  if (error) throw error;
  return data === true;
}

export async function fetchPendingReports() {
  const { data, error } = await supabase
    .from("song_reports")
    .select("id,song_id,playlist_date,reason,status,created_at,song:songs(title,artist,likes_count,dislikes_count,is_locked)")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function reviewReport(reportId, approve, reason) {
  const { error } = await supabase.rpc("admin_review_song_report", {
    p_report_id: reportId,
    p_approve: approve,
    p_reason: reason.trim(),
  });
  if (error) throw error;
}

export async function upsertPeriod({ id = null, title, startsAt, endsAt }) {
  const payload = {
    p_title: title,
    p_starts_at: new Date(startsAt).toISOString(),
    p_ends_at: new Date(endsAt).toISOString(),
  };
  if (id) payload.p_period_id = id;
  const { error } = await supabase.rpc(id ? "admin_update_playlist_period" : "admin_create_playlist_period", payload);
  if (error) throw error;
}

export async function archivePeriod(periodId) {
  const { error } = await supabase.rpc("admin_archive_playlist_period", { p_period_id: periodId });
  if (error) throw error;
}

export async function insertAnnouncement({ title, content, createdBy }) {
  const { error } = await supabase.from("announcements").insert({
    title,
    content,
    is_active: true,
    created_by: createdBy,
  });
  if (error) throw error;
}

export async function disableAnnouncement(id) {
  const { error } = await supabase
    .from("announcements")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function fetchVoteRows(tableName, periodId) {
  const { data, error } = await supabase
    .from(tableName)
    .select("id,song_id,user_id,voter_cookie,voter_ip,playlist_date,created_at")
    .eq("playlist_date", periodId)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return data ?? [];
}

export async function fetchReportRows(periodId) {
  const { data, error } = await supabase
    .from("song_reports")
    .select("id,song_id,playlist_date,reporter_cookie,reporter_ip,reason,status,reviewed_by,reviewed_at,created_at")
    .eq("playlist_date", periodId)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return data ?? [];
}

// ---------- 数据整形 ----------

export function normalizePeriod(period) {
  return {
    id: period.id,
    title: period.title ?? "未命名歌单",
    startsAt: Date.parse(period.starts_at ?? "") || 0,
    endsAt: Date.parse(period.ends_at ?? "") || 0,
    status: period.status ?? "archived",
    isTest: period.is_test === true,
    createdAtMs: Date.parse(period.created_at ?? "") || 0,
    archivedAtMs: Date.parse(period.archived_at ?? "") || 0,
  };
}

export function mapSongs(data) {
  return (data ?? []).map((song) => ({
    id: song.id,
    title: song.title ?? "",
    artist: song.artist ?? "",
    titleLower: song.title_lower ?? normalizeText(song.title ?? ""),
    artistLower: song.artist_lower ?? normalizeText(song.artist ?? ""),
    likesCount: Number.isFinite(song.likes_count) ? song.likes_count : 0,
    dislikesCount: Number.isFinite(song.dislikes_count) ? song.dislikes_count : 0,
    isLocked: song.is_locked === true,
    createdAtMs: Date.parse(song.created_at ?? "") || 0,
    createdBy: song.created_by ?? "",
  }));
}
