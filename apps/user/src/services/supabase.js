import { createClient } from "@supabase/supabase-js";

// 默认回退到现有云端配置（与旧 public/supabase-config.js 一致），
// 本地 Supabase 启动后通过 .env.development 覆盖。
const DEFAULT_URL = "https://aiblivjuhccwcwwrwxsl.supabase.co";
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpYmxpdmp1aGNjd2N3d3J3eHNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzE2NzQsImV4cCI6MjA5MDQ0NzY3NH0.PAI9NftGOmbxOACwkwrMm-WDeZuENGhH9FzxiYZ4Qrk";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
export const supabaseAnonKey = import.meta.env.VITE_ANON_KEY || DEFAULT_ANON_KEY;

export const hasValidConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasValidConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
