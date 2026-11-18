export function getApiUrl(path: string): string {
  const base = ((import.meta as any).env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}
