// 后端数据访问层 —— 封装全部 Supabase 查询与 RPC 调用
// 与旧 app.js 的调用参数保持一致；错误统一抛出，由调用方处理。
import { supabase } from "./supabase";
import { normalizeText } from "../utils/format";

const PERIODS_TABLE = "playlist_periods";

// ---------- 用户端 ----------

export async function fetchPeriods() {
  const { data, error } = await supabase
    .from(PERIODS_TABLE)
    .select("id,title,starts_at,ends_at,status,created_at,updated_at,archived_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map(normalizePeriod);
}

export async function fetchArchivedPeriods() {
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

export async function fetchSongs(periodId) {
  const { data, error } = await supabase
    .from("songs")
    .select("id,title,artist,title_lower,artist_lower,playlist_date,likes_count,dislikes_count,is_locked,created_at")
    .eq("playlist_date", periodId)
    .limit(500);
  if (error) throw error;
  return mapSongs(data);
}

export async function fetchMyLikes(periodId, voterCookie) {
  const { data, error } = await supabase.rpc("get_my_likes", {
    p_playlist_date: periodId,
    p_voter_cookie: voterCookie,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyDislikes(periodId, voterCookie) {
  const { data, error } = await supabase.rpc("get_my_dislikes", {
    p_playlist_date: periodId,
    p_voter_cookie: voterCookie,
  });
  if (error) throw error;
  return data ?? [];
}

export async function submitSong({ title, artist, playlistDate, voterCookie }) {
  const { error } = await supabase.rpc("submit_song", {
    p_title: title,
    p_artist: artist,
    p_playlist_date: playlistDate,
    p_voter_cookie: voterCookie,
  });
  if (error) throw error;
}

export async function toggleLike({ songId, playlistDate, voterCookie, action }) {
  const { error } = await supabase.rpc("toggle_song_like", {
    p_song_id: songId,
    p_playlist_date: playlistDate,
    p_voter_cookie: voterCookie,
    p_action: action,
  });
  if (error) throw error;
}

export async function toggleDislike({ songId, playlistDate, voterCookie, action, reason = null }) {
  const { error } = await supabase.rpc("toggle_song_dislike", {
    p_song_id: songId,
    p_playlist_date: playlistDate,
    p_voter_cookie: voterCookie,
    p_action: action,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function fetchAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select("id,title,content,is_active,created_at,updated_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) throw error;
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

export async function reviewReport(reportId, approve) {
  const { error } = await supabase.rpc("review_song_report", {
    p_report_id: reportId,
    p_approve: approve,
  });
  if (error) throw error;
}

export async function archiveAllActivePeriods() {
  const { error } = await supabase
    .from(PERIODS_TABLE)
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("status", "active");
  if (error) throw error;
}

export async function upsertPeriod({ id = null, title, startsAt, endsAt, createdBy }) {
  const payload = {
    title,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    status: "active",
    updated_at: new Date().toISOString(),
  };
  const { error } = id
    ? await supabase.from(PERIODS_TABLE).update(payload).eq("id", id)
    : await supabase.from(PERIODS_TABLE).insert({ ...payload, created_by: createdBy });
  if (error) throw error;
}

export async function archivePeriod(periodId) {
  const { error } = await supabase
    .from(PERIODS_TABLE)
    .update({ status: "archived", archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", periodId);
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
