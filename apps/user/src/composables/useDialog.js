import { nextTick, onBeforeUnmount, ref, watch } from "vue";

export function useDialog(visible, close) {
  const dialog = ref(null);
  let opener;
  let previousOverflow;
  let active = false;
  const focusable = () => [...(dialog.value?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];

  function onKey(event) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const elements = focusable();
    const first = elements[0];
    const last = elements.at(-1);
    if (!first) { event.preventDefault(); dialog.value?.focus(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function cleanup() {
    if (!active) return;
    active = false;
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = previousOverflow;
    if (opener?.isConnected) opener.focus();
  }

  watch(visible, async (open) => {
    if (!open) return cleanup();
    opener = document.activeElement;
    previousOverflow = document.body.style.overflow;
    active = true;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    await nextTick();
    if (active) (focusable()[0] ?? dialog.value)?.focus();
  }, { immediate: true, flush: "post" });
  onBeforeUnmount(cleanup);
  return dialog;
}
