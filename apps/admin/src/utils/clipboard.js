// 统一的复制方法：优先用现代剪贴板 API，被微信等内置浏览器拒绝时自动降级。
// 现代 API 要求 HTTPS 安全上下文和用户点击手势，否则会抛 NotAllowedError。
export async function copyToClipboard(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      // 权限被拒（常见于微信/QQ 内置浏览器）时走下面的兜底方案；其他错误直接抛出。
      if (error?.name !== "NotAllowedError") throw error;
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  const previousActive = document.activeElement;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  // 兼容 iOS Safari：select() 在部分版本不生效，需要手动设置选区。
  textarea.setSelectionRange(0, text.length);

  let succeeded = false;
  try {
    succeeded = document.execCommand("copy");
  } finally {
    textarea.remove();
    if (previousActive && typeof previousActive.focus === "function") previousActive.focus();
  }
  if (!succeeded) throw new Error("当前浏览器不允许自动复制，请改用「下载播出 TXT」。");
}
