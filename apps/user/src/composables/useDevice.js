// 设备感知 composable —— 模块级单例，一处监听全局共享
// 断点：≤767px 视为移动端（手机），≥768px 视为桌面端（电脑/平板横屏）
import { reactive, toRefs } from "vue";

const MOBILE_QUERY = "(max-width: 767px)";

const mediaState = reactive({ isMobile: false, isDesktop: true });
let mql = null;
let initialized = false;

function update() {
  if (!mql) return;
  mediaState.isMobile = mql.matches;
  mediaState.isDesktop = !mql.matches;
}

function init() {
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined" || !window.matchMedia) return;
  mql = window.matchMedia(MOBILE_QUERY);
  update();
  mql.addEventListener("change", update);
}

export function useDevice() {
  init();
  return toRefs(mediaState);
}
