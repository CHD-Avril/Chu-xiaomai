// Older databases can keep serving normal periods while the test-mode migration is pending.
// Only the missing is_test column permits fallback; other schema or permission errors fail closed.
export async function readPeriodRows(supabase, { archived = false, signal } = {}) {
  const columns = "id,title,starts_at,ends_at,status,created_at,updated_at,archived_at";
  function query(includeTestMode) {
    let request = supabase.from("playlist_periods").select(columns + (includeTestMode ? ",is_test" : ""));
    if (archived) request = request.eq("status", "archived").order("archived_at", { ascending: false, nullsFirst: false });
    request = request.order("created_at", { ascending: false }).limit(100);
    return signal ? request.abortSignal(signal) : request;
  }
  let result = await query(true);
  if (["42703", "PGRST204"].includes(result.error?.code) && /\bis_test\b/.test(result.error.message ?? "")) result = await query(false);
  if (result.error) throw Object.assign(new Error(result.error.message), result.error, { status: result.status });
  return result.data ?? [];
}
