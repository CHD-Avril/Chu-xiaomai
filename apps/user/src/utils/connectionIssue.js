export function describeConnectionIssue(error, { offline = typeof navigator !== "undefined" && navigator.onLine === false } = {}) {
  const raw = `${error?.code || ""} ${error?.message || ""}`;
  const status = Number(error?.status) || 0;
  let label = "读取异常";
  let message = "点歌台未能完成数据读取，原因尚未确定。";
  let advice = "请重新连接；若仍失败，请将下方诊断信息截图发给广播台管理员。";
  let fallbackCode = status ? `HTTP_${status}` : "UNKNOWN";
  if (offline) {
    label = "网络未连接";
    message = "浏览器显示当前设备未联网。";
    advice = "请开启移动数据或连接 Wi-Fi，网络恢复后会自动重连。";
    fallbackCode = "OFFLINE";
  } else if (/CLIENT_TIMEOUT|timeout|timed out|AbortError/i.test(raw)) {
    label = "连接超时";
    message = "点歌台服务响应超时，自动重试后仍未完成读取。";
    advice = "请切换 Wi-Fi / 移动数据后重新连接；若使用百度、微信等内置浏览器，也可尝试用系统浏览器打开。";
    fallbackCode = "TIMEOUT";
  } else if (status === 401 || /PGRST30[123]|JWT|token.*expired|Invalid API key/i.test(raw)) {
    label = "验证失败";
    message = "服务未通过访问验证，可能是登录状态过期或站点配置异常。";
    advice = "请刷新页面；测试账号可退出后重新登录。若仍失败，请联系广播台管理员检查服务配置。";
  } else if (status === 403 || /42501|permission denied/i.test(raw)) {
    label = "访问受限";
    message = "服务拒绝读取请求，可能缺少访问权限。";
    advice = "测试期请使用已授权账号登录；正常征集期出现此提示，请联系广播台管理员。";
  } else if (status === 429) {
    label = "请求过多";
    message = "请求较频繁，服务暂时限制了访问。";
    advice = "请稍等片刻后重新连接，避免连续刷新。";
  } else if (status >= 500 || status === 408) {
    label = "服务暂不可用";
    message = "点歌台服务暂时未能正常响应。";
    advice = "请稍后重新连接；若持续出现，请将诊断信息发给广播台管理员。";
  } else if (/^(42|PGRST20)/.test(error?.code || "") || status === 404) {
    message = "点歌台的数据接口或数据库配置异常。";
    advice = "请将下方诊断信息发给广播台管理员检查，刷新或切换网络可能无法解决。";
  } else if (/Failed to fetch|fetch failed|NetworkError|network request failed|Load failed/i.test(raw)) {
    label = "服务连接失败";
    message = "浏览器无法连接点歌台的数据服务。";
    advice = "可能与当前网络或浏览器拦截有关，浏览器未提供确切原因。请切换 Wi-Fi / 移动数据，或用系统浏览器打开后重试。";
    fallbackCode = "NETWORK";
  } else if (error?.code === "CLIENT_CONFIG") {
    message = "点歌台服务地址尚未正确配置。";
    advice = "请联系广播台管理员检查站点配置。";
  }
  // Never expose request headers, tokens, visitor IDs, or raw server responses.
  const code = String(error?.code || fallbackCode).replace(/[^\w-]/g, "").slice(0, 40) || fallbackCode;
  return { label, message, advice, code, status, operation: error?.operation || "读取点歌台", occurredAt: Date.now() };
}
