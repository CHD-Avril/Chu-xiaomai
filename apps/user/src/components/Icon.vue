<script setup>
import { computed } from "vue";

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 20 },
  strokeWidth: { type: [Number, String], default: 1.8 },
});

const paths = {
  home: ["M3.5 10.6 12 3.5l8.5 7.1V20a1 1 0 0 1-1 1h-5v-6.5h-5V21h-5a1 1 0 0 1-1-1z"],
  chart: ["M4.5 20.5v-7", "M10 20.5V4.5", "M15.5 20.5v-4.5", "M21 20.5V8.5"],
  history: ["M3.4 12a8.6 8.6 0 1 0 2.6-6.2L3.4 8.4", "M3.2 3.6v5h5", "M12 7.6V12l3.1 1.9"],
  user: ["M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4z", "M4.5 20.6a7.5 7.5 0 0 1 15 0"],
  wave: ["M3.5 10v4", "M7.5 6.5v11", "M12 3.5v17", "M16.5 6.5v11", "M20.5 10v4"],
  search: ["M10.8 18.1a7.3 7.3 0 1 0 0-14.6 7.3 7.3 0 0 0 0 14.6z", "m16.2 16.2 4.3 4.3"],
  "chevron-down": ["m6.5 9.5 5.5 5.5 5.5-5.5"],
  "chevron-right": ["m9.5 6.5 5.5 5.5-5.5 5.5"],
  "arrow-right": ["M4.5 12h15", "m13.5 6 6 6-6 6"],
  "arrow-left": ["M19.5 12h-15", "m10.5 6-6 6 6 6"],
  "arrow-up-right": ["M7 17 17 7", "M8.5 7H17v8.5"],
  refresh: ["M20.2 11.3a8.2 8.2 0 1 0-2.1 5.5", "M20.4 4.2v7.2h-7.2"],
  heart: ["M20.8 5.1a5.2 5.2 0 0 0-7.4 0L12 6.5l-1.4-1.4a5.2 5.2 0 1 0-7.4 7.4L12 21l8.8-8.5a5.2 5.2 0 0 0 0-7.4z"],
  "thumbs-down": ["M17 14V2.5", "M9 18.4l1-4.4H4.2a2 2 0 0 1-1.9-2.6l2.2-7.9A2 2 0 0 1 6.4 2H19a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-2.5a2 2 0 0 0-1.8 1.1L12.1 22a3.1 3.1 0 0 1-3.1-3.6z"],
  plus: ["M12 5v14", "M5 12h14"],
  check: ["m20 6.5-10.5 11L4 12"],
  close: ["M18 6 6 18", "M6 6l12 12"],
  logout: ["M9.5 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16.5 16.5 21 12l-4.5-4.5", "M21 12H9.5"],
  login: ["M14.5 3H19a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4.5", "M9.5 16.5 14 12 9.5 7.5", "M14 12H3"],
  megaphone: ["m3.3 11.2 17.2-5.4v12.4L3.3 14.4v-3.2z", "M11.7 17.2a3.1 3.1 0 0 1-5.9-1.7"],
  sparkles: ["m12 3 1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8z", "M19 3.5v3.2", "M20.6 5.1h-3.2"],
  music: ["M9.2 18V5.3L20.5 3v12.7", "M9.2 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z", "M20.5 15.7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"],
  calendar: ["M5.5 5h13a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-13A1.5 1.5 0 0 1 5.5 5z", "M8 2.5v5", "M16 2.5v5", "M4 9.5h16"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5.2l3.4 2"],
  shield: ["M12 3 4.8 6v5.2c0 4.6 3.1 8 7.2 9.8 4.1-1.8 7.2-5.2 7.2-9.8V6z", "m9 12 2.1 2.1L15.3 10"],
  headphone: ["M4 15.5v-3a8 8 0 0 1 16 0v3", "M4 15.5A2.5 2.5 0 0 1 6.5 13H8v8H6.5A2.5 2.5 0 0 1 4 18.5z", "M20 15.5a2.5 2.5 0 0 0-2.5-2.5H16v8h1.5a2.5 2.5 0 0 0 2.5-2.5z"],
};

const iconPaths = computed(() => paths[props.name] || paths.wave);
</script>

<template>
  <svg
    class="icon"
    :class="`icon-${name}`"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, index) in iconPaths" :key="index" :d="d" />
  </svg>
</template>