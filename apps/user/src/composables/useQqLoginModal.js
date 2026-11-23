import { ref } from "vue";

const qqLoginOpen = ref(false);

export function useQqLoginModal() {
  return {
    qqLoginOpen,
    openQqLogin: () => { qqLoginOpen.value = true; },
    closeQqLogin: () => { qqLoginOpen.value = false; },
  };
}