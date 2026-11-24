const API_BASE_STORAGE_KEY = 'finance_api_base_url';

function normalizeBaseUrl(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function isPrivateAiStudioDevUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(normalizeBaseUrl(url));
    return /^ais-dev-/i.test(parsed.hostname);
  } catch {
    return /^https?:\/\/ais-dev-/i.test(url.trim());
  }
}

function isCrossOriginUrl(url: string): boolean {
  if (typeof window === 'undefined' || !url) return false;
  try {
    return new URL(normalizeBaseUrl(url)).hostname !== window.location.hostname;
  } catch {
    return false;
  }
}

export function getEnvApiBaseUrl(): string {
  return normalizeBaseUrl((import.meta as any).env?.VITE_API_BASE_URL || '');
}

export function getSavedApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const saved = normalizeBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY));
    if (saved && isPrivateAiStudioDevUrl(saved) && isCrossOriginUrl(saved)) {
      window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      return '';
    }
    return saved;
  } catch {
    return '';
  }
}

export function setSavedApiBaseUrl(url: string): string {
  const normalized = normalizeBaseUrl(url);
  if (typeof window !== 'undefined') {
    try {
      if (normalized) {
        window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }
  return normalized;
}

export function getApiBaseUrl(): string {
  const saved = getSavedApiBaseUrl();
  if (saved) return saved;
  const env = getEnvApiBaseUrl();
  if (env) return env;
  return '';
}

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}
