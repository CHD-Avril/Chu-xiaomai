export function getAdminUrl() {
  if (import.meta.env.VITE_ADMIN_URL) return import.meta.env.VITE_ADMIN_URL;
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:5174/`;
  return new URL("/admin/", location.origin).href;
}
