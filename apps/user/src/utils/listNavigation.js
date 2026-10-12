import { nextTick } from "vue";

export async function revealListElement(element) {
  await nextTick();
  const node = typeof element === "function" ? element() : element;
  if (!node?.isConnected) return;
  node.scrollIntoView({ block: "start", behavior: "instant" });
  node.focus({ preventScroll: true });
}
