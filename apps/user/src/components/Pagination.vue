<script setup>
import { computed } from "vue";

const props = defineProps({
  currentPage: { type: Number, required: true },
  pageCount: { type: Number, required: true },
  compact: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  label: { type: String, default: "歌单分页" },
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
  if (props.disabled || page < 1 || page > props.pageCount || page === props.currentPage) return;
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
  <nav v-if="pageCount > 1" class="pagination" :class="{ 'is-compact': compact }" :aria-label="label">
    <template v-if="compact">
      <button class="pagination-button" type="button" aria-label="上一页" :disabled="disabled || currentPage === 1" @click="goTo(currentPage - 1)">‹</button>
      <span class="pagination-position" aria-live="polite">{{ currentPage }} / {{ pageCount }}</span>
      <button class="pagination-button" type="button" aria-label="下一页" :disabled="disabled || currentPage === pageCount" @click="goTo(currentPage + 1)">›</button>
    </template>
    <div v-else class="pagination-pages">
      <template v-for="(item, index) in items" :key="index">
        <span v-if="item === 'ellipsis'" class="pagination-ellipsis" aria-hidden="true">...</span>
        <button
          v-else
          class="pagination-button"
          :class="{ 'is-active': item === currentPage }"
          type="button"
          :aria-current="item === currentPage ? 'page' : undefined"
          :aria-label="`第 ${item} 页`"
          :disabled="disabled"
          @click="goTo(item)"
        >
          {{ item }}
        </button>
      </template>
    </div>
    <details v-if="!compact && pageCount > 5" class="pagination-more">
      <summary>跳转页码</summary>
      <form class="pagination-jump" @submit.prevent="onJump">
      <label class="pagination-jump-label">跳转到
      <input
        data-page-jump-input
        type="number"
        min="1"
        :max="pageCount"
        :value="currentPage"
        inputmode="numeric"
        aria-label="输入页码"
        :disabled="disabled"
      />
      </label>
      <span class="pagination-jump-total">/ {{ pageCount }} 页</span>
      <button class="pagination-button pagination-jump-button" type="submit" :disabled="disabled">前往</button>
      </form>
    </details>
  </nav>
</template>
