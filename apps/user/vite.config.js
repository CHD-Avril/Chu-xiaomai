import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    allowedHosts: ["chuxiaomai.cyou"],
    proxy: {
      "/qq": "http://127.0.0.1:3000",
      // 本地 Edge Functions（supabase functions serve 默认端口 54321）
      "/functions": "http://localhost:54321",
    },
  },
});
