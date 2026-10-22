import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";

const STORAGE_KEY = "chu-song-draft";

export const useDraftStore = defineStore("songDraft", () => {
  let saved = {};
  const storageAvailable = ref(true);
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch { storageAvailable.value = false; }

  const draft = reactive({
    title: typeof saved.title === "string" ? saved.title.slice(0, 80) : "",
    artist: typeof saved.artist === "string" ? saved.artist.slice(0, 80) : "",
  });
  const hasDraft = computed(() => Boolean(draft.title || draft.artist));
  watch(draft, (value) => {
    try {
      if (value.title || value.artist) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(STORAGE_KEY);
      storageAvailable.value = true;
    } catch { storageAvailable.value = false; }
  }, { flush: "sync" });

  function clear() {
    draft.title = "";
    draft.artist = "";
  }
  return { draft, hasDraft, storageAvailable, clear };
});
