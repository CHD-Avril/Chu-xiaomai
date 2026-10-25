// 运营端数据访问层 —— 封装全部管理查询与 RPC 调用
import { supabase } from "./supabase";
import { readPeriodRows } from "../../../shared/periods";

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

// ---------- 参与规则（数据库按每个账号、每期强制执行） ----------

const participationColumns = "submission_cookie_per_period,max_likes_per_period";
export const MAX_PARTICIPATION_LIMIT = 2147483647;

export function participationLimitsError(limits) {
  return [limits?.submissions, limits?.likes].every(value => Number.isInteger(value) && value >= 1 && value <= MAX_PARTICIPATION_LIMIT)
    ? "" : "投稿上限和喜欢上限都须填写大于 0 的整数。";
}

function normalizeParticipationLimits(row) {
  const limits = { submissions: row?.submission_cookie_per_period, likes: row?.max_likes_per_period };
  if (participationLimitsError(limits)) throw new Error("参与规则尚未配置完整，请联系管理员检查数据库。");
  return limits;
}

export async function fetchParticipationLimits() {
  const { data, error } = await supabase.from("security_settings").select(participationColumns).eq("id", true).single();
  if (error) throw error;
  return normalizeParticipationLimits(data);
}

export async function saveParticipationLimits(limits, expected) {
  const message = participationLimitsError(limits) || participationLimitsError(expected);
  if (message) throw new Error(message);
  // RLS permits only administrators. Compare both previous values so a second
  // operator cannot silently overwrite a change made since opening this form.
  const { data, error } = await supabase.from("security_settings")
    .update({ submission_cookie_per_period: limits.submissions, max_likes_per_period: limits.likes, updated_at: new Date().toISOString() })
    .eq("id", true).eq("submission_cookie_per_period", expected.submissions).eq("max_likes_per_period", expected.likes)
    .select(participationColumns).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("规则已被其他管理员修改，或当前账号没有修改权限。请重新读取后再保存。");
  return normalizeParticipationLimits(data);
}

// ---------- 征集期 ----------

export async function fetchAllPeriods() {
  return (await readPeriodRows(supabase)).map(normalizePeriod);
}

export async function upsertPeriod({ id = null, title, startsAt, endsAt }) {
  if (!id) return createPeriod({ title, startsAt, endsAt });
  const { error } = await supabase.rpc("admin_update_playlist_period", {
    p_period_id: id, p_title: title, p_starts_at: new Date(startsAt).toISOString(), p_ends_at: new Date(endsAt).toISOString(),
  });
  if (error) throwWorkflowError(error);
}

export async function createPeriod({ title, startsAt, endsAt }) {
  const { data, error } = await supabase.rpc("admin_create_playlist_period", {
    p_title: title, p_starts_at: new Date(startsAt).toISOString(), p_ends_at: new Date(endsAt).toISOString(),
  });
  if (error) throwWorkflowError(error);
  return data;
}

export async function archivePeriod(periodId) {
  const { error } = await supabase.rpc("admin_archive_playlist_period", { p_period_id: periodId });
  if (error) throwWorkflowError(error);
}

export async function setPeriodTestMode(periodId, enabled, expected) {
  const { error } = await supabase.rpc("admin_set_period_test_mode", { p_period_id: periodId, p_enabled: enabled, p_expected: expected });
  if (error) throwWorkflowError(error);
}

export async function fetchTestAccounts() {
  const { data, error } = await supabase.rpc("admin_list_test_accounts");
  if (error) throwWorkflowError(error);
  return data ?? [];
}

export async function setTestAccount(email, enabled) {
  const { error } = await supabase.rpc("admin_set_test_account", { p_email: email.trim(), p_enabled: enabled });
  if (error) throwWorkflowError(error);
}

// ---------- 歌曲 ----------

export async function fetchSongs(periodId) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("songs")
      .select("id,title,artist,title_lower,artist_lower,playlist_date,likes_count,dislikes_count,is_locked,created_at")
      .eq("playlist_date", periodId).order("created_at").order("id").range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return mapSongs(rows);
  }
}

// ---------- 公告 ----------

export async function fetchAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select("id,title,content,is_active,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
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

export async function updateAnnouncement(id, { title, content }) {
  const { error } = await supabase.from("announcements").update({ title, content, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function updateSong(song, reason) {
  const { error } = await supabase.rpc("admin_update_song", {
    p_song_id: song.id, p_title: song.title.trim(), p_artist: song.artist.trim(), p_locked: song.isLocked, p_reason: reason.trim(),
  });
  if (error?.code === "23505") throw new Error("本期已有同名、同歌手的歌曲，请检查后再保存。");
  if (error) throwWorkflowError(error);
}

export async function fetchSongLog(songId) {
  const { data, error } = await supabase.from("admin_action_log").select("id,actor_name,action,details,created_at")
    .eq("target_id", songId).order("created_at", { ascending: false }).limit(100);
  if (error) throwWorkflowError(error);
  return data ?? [];
}

export async function setSongLock(songId, locked, reason) {
  const { error } = await supabase.rpc("admin_set_song_lock", { p_song_id: songId, p_locked: locked, p_reason: reason.trim() });
  if (error) throwWorkflowError(error);
}

// ---------- 举报 ----------

export async function fetchPendingReports() {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("song_reports")
      .select("id,song_id,playlist_date,reason,status,created_at,song:songs(title,artist,likes_count,dislikes_count,is_locked)")
      .eq("status", "pending").order("created_at").order("id").range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export async function fetchAllReports(periodId) {
  return fetchEveryPage(() => supabase.from("song_reports")
    .select("id,song_id,playlist_date,reporter_cookie,reporter_ip,reason,status,reviewed_by,reviewed_by_name,review_reason,reviewed_at,created_at")
    .eq("playlist_date", periodId).order("created_at").order("id"));
}

export async function reviewReport(reportId, approve, reason) {
  const { error } = await supabase.rpc("admin_review_song_report", {
    p_report_id: reportId,
    p_approve: approve,
    p_reason: reason.trim(),
  });
  if (error) throwWorkflowError(error);
}

export async function fetchReviewedReports() {
  const { data, error } = await supabase.from("song_reports")
    .select("id,song_id,playlist_date,reason,status,reviewed_by,reviewed_by_name,review_reason,reviewed_at,song:songs(title,artist,is_locked)")
    .neq("status", "pending").order("reviewed_at", { ascending: false }).limit(500);
  if (error) throwWorkflowError(error);
  return data ?? [];
}

export async function fetchBroadcastPlaylist(periodId) {
  const { data, error } = await supabase.from("broadcast_playlists")
    .select("period_id,items,version,updated_by_name,updated_at").eq("period_id", periodId).maybeSingle();
  if (error) throwWorkflowError(error);
  return data ?? { items: [], version: 0 };
}

export async function saveBroadcastPlaylist(periodId, items, version) {
  const { error } = await supabase.rpc("admin_save_broadcast_playlist", { p_period_id: periodId, p_items: items, p_version: version });
  if (error) throwWorkflowError(error);
  // The server owns confirmed snapshots. Read canonical data instead of trusting local draft fields.
  try {
    return await fetchBroadcastPlaylist(periodId);
  } catch {
    throw new Error("歌单已保存，但读取确认快照失败。请重新读取歌单后继续编辑。");
  }
}

function throwWorkflowError(error) {
  if (["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"].includes(error.code)) {
      throw new Error("管理台数据库尚未升级，请依次执行 supabase-admin-workflow.sql、supabase-database-integrity.sql、supabase-test-mode.sql 后重试。");
  }
  throw error;
}

// ---------- 投票明细 / 防作弊 ----------

export async function fetchVoteRows(tableName, periodId) {
  return fetchEveryPage(() => supabase.from(tableName)
    .select("id,song_id,user_id,voter_cookie,voter_ip,playlist_date,created_at")
    .eq("playlist_date", periodId).order("created_at").order("id"));
}

async function fetchEveryPage(query) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query().range(offset, offset + 499);
    if (error) throwWorkflowError(error);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
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
