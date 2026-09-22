// 运营端数据访问层 —— 封装全部管理查询与 RPC 调用
import { supabase } from "./supabase";

const PERIODS_TABLE = "playlist_periods";

// ---------- 认证 ----------

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

// ---------- 征集期 ----------

export async function fetchAllPeriods() {
  const { data, error } = await supabase
    .from(PERIODS_TABLE)
    .select("id,title,starts_at,ends_at,status,created_at,updated_at,archived_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map(normalizePeriod);
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

export async function archiveAllActivePeriods() {
  const { error } = await supabase
    .from(PERIODS_TABLE)
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("status", "active");
  if (error) throw error;
}

export async function archivePeriod(periodId) {
  const { error } = await supabase
    .from(PERIODS_TABLE)
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", periodId);
  if (error) throw error;
}

// ---------- 歌曲 ----------

export async function fetchSongs(periodId) {
  const { data, error } = await supabase
    .from("songs")
    .select(
      "id,title,artist,title_lower,artist_lower,playlist_date,likes_count,dislikes_count,is_locked,created_at,created_by",
    )
    .eq("playlist_date", periodId)
    .limit(500);
  if (error) throw error;
  return mapSongs(data);
}

// ---------- 公告 ----------

export async function fetchAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select("id,title,content,is_active,created_at,updated_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
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

// ---------- 举报 ----------

export async function fetchPendingReports() {
  const { data, error } = await supabase
    .from("song_reports")
    .select(
      "id,song_id,playlist_date,reason,status,created_at,song:songs(title,artist,likes_count,dislikes_count,is_locked)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function fetchAllReports(periodId) {
  const { data, error } = await supabase
    .from("song_reports")
    .select("id,song_id,playlist_date,reporter_cookie,reporter_ip,reason,status,reviewed_by,reviewed_at,created_at")
    .eq("playlist_date", periodId)
    .order("created_at", { ascending: true })
    .limit(5000);
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

// ---------- 投票明细 / 防作弊 ----------

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
    titleLower: song.title_lower ?? String(song.title ?? "").trim().toLowerCase(),
    artistLower: song.artist_lower ?? String(song.artist ?? "").trim().toLowerCase(),
    likesCount: Number.isFinite(song.likes_count) ? song.likes_count : 0,
    dislikesCount: Number.isFinite(song.dislikes_count) ? song.dislikes_count : 0,
    isLocked: song.is_locked === true,
    createdAtMs: Date.parse(song.created_at ?? "") || 0,
    createdBy: song.created_by ?? "",
  }));
}

// 反作弊聚合（阈值与旧版一致）
export function buildAntiCheatReport(period, songs, likes, dislikes, reports) {
  const songMap = new Map(
    songs.map((song) => [
      song.id,
      {
        id: song.id,
        title: song.title,
        artist: song.artist,
        likes_count: song.likesCount,
        dislikes_count: song.dislikesCount,
        is_locked: song.isLocked,
      },
    ]),
  );

  const cookieLikeCount = {};
  const ipLikeCount = {};
  const cookieDislikeCount = {};
  const ipDislikeCount = {};

  likes.forEach((row) => {
    cookieLikeCount[row.voter_cookie] = (cookieLikeCount[row.voter_cookie] || 0) + 1;
    ipLikeCount[row.voter_ip] = (ipLikeCount[row.voter_ip] || 0) + 1;
  });
  dislikes.forEach((row) => {
    cookieDislikeCount[row.voter_cookie] = (cookieDislikeCount[row.voter_cookie] || 0) + 1;
    ipDislikeCount[row.voter_ip] = (ipDislikeCount[row.voter_ip] || 0) + 1;
  });

  const flaggedCookies = new Set();
  Object.entries(cookieLikeCount).forEach(([cookie, n]) => {
    if (n >= 5) flaggedCookies.add(cookie);
  });
  Object.entries(cookieDislikeCount).forEach(([cookie, n]) => {
    if (n >= 3) flaggedCookies.add(cookie);
  });

  const flaggedIps = new Set();
  Object.entries(ipLikeCount).forEach(([ip, n]) => {
    if (n >= 10) flaggedIps.add(ip);
  });
  Object.entries(ipDislikeCount).forEach(([ip, n]) => {
    if (n >= 8) flaggedIps.add(ip);
  });

  const flaggedCookieRows = [...flaggedCookies].map((cookie) => ({
    cookie,
    like_count: cookieLikeCount[cookie] || 0,
    dislike_count: cookieDislikeCount[cookie] || 0,
  }));
  const flaggedIpRows = [...flaggedIps].map((ip) => ({
    ip,
    like_count: ipLikeCount[ip] || 0,
    dislike_count: ipDislikeCount[ip] || 0,
  }));

  return {
    exported_at: new Date().toISOString(),
    period: {
      id: period.id,
      title: period.title,
      starts_at: new Date(period.startsAt).toISOString(),
      ends_at: new Date(period.endsAt).toISOString(),
    },
    thresholds: { like_cookie: 5, like_ip: 10, dislike_cookie: 3, dislike_ip: 8 },
    songs: [...songMap.values()],
    song_likes: likes,
    song_dislikes: dislikes,
    song_reports: reports,
    flagged_cookies: flaggedCookieRows,
    flagged_ips: flaggedIpRows,
  };
}
