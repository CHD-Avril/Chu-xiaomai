import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // 本地 Edge Functions（supabase functions serve 默认端口 54321）
      "/functions": "http://localhost:54321",
    },
  },
});
