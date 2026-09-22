<script setup>
import { computed } from "vue";

const props = defineProps({
  currentPage: { type: Number, required: true },
  pageCount: { type: Number, required: true },
});
const emit = defineEmits(["change"]);

function getPaginationItems(pageCount, currentPage) {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const pages = new Set([1, pageCount, currentPage]);
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
  } else if (currentPage >= pageCount - 2) {
    pages.add(pageCount - 2);
    pages.add(pageCount - 1);
  } else {
    pages.add(currentPage - 1);
    pages.add(currentPage + 1);
  }
  const sortedPages = [...pages].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b);
  return sortedPages.flatMap((page, index) => {
    const previous = sortedPages[index - 1];
    return index > 0 && page - previous > 1 ? ["ellipsis", page] : [page];
  });
}

const items = computed(() => getPaginationItems(props.pageCount, props.currentPage));

function goTo(page) {
  if (page < 1 || page > props.pageCount || page === props.currentPage) return;
  emit("change", page);
}

function onJump(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector("[data-page-jump-input]");
  const page = Number(input?.value);
  if (!Number.isInteger(page)) return;
  goTo(page);
}
</script>

<template>
  <div v-if="pageCount > 1" class="pagination">
    <div class="pagination-pages" aria-label="分页">
      <template v-for="(item, index) in items" :key="index">
        <span v-if="item === 'ellipsis'" class="pagination-ellipsis" aria-hidden="true">...</span>
        <button
          v-else
          class="pagination-button"
          :class="{ 'is-active': item === currentPage }"
          type="button"
          @click="goTo(item)"
        >
          {{ item }}
        </button>
      </template>
    </div>
    <form class="pagination-jump" @submit.prevent="onJump">
      <label class="pagination-jump-label" for="pageJumpInput">跳转到</label>
      <input
        id="pageJumpInput"
        data-page-jump-input
        type="number"
        min="1"
        :max="pageCount"
        :value="currentPage"
        inputmode="numeric"
        aria-label="输入页码"
      />
      <span class="pagination-jump-total">/ {{ pageCount }} 页</span>
      <button class="pagination-button pagination-jump-button" type="submit">前往</button>
    </form>
  </div>
</template>
