export const supabaseConfig = {
  url: "https://aiblivjuhccwcwwrwxsl.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpYmxpdmp1aGNjd2N3d3J3eHNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzE2NzQsImV4cCI6MjA5MDQ0NzY3NH0.PAI9NftGOmbxOACwkwrMm-WDeZuENGhH9FzxiYZ4Qrk",
  tables: {
    songs: "songs",
    likes: "song_likes",
    announcements: "announcements",
  },
};

// 管理员账户配置（客户端验证）
export const adminAccounts = [
  {
    username: "changdaxiaomaijun",
    password: "gbt666",
  },
];

export function hasValidSupabaseConfig() {
  return (
    typeof supabaseConfig.url === "string" &&
    supabaseConfig.url.trim() !== "" &&
    typeof supabaseConfig.anonKey === "string" &&
    supabaseConfig.anonKey.trim() !== ""
  );
}
