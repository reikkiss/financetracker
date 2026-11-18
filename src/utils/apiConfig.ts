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

export function getEnvApiBaseUrl(): string {
  return normalizeBaseUrl((import.meta as any).env?.VITE_API_BASE_URL || '');
}

export function getSavedApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    return normalizeBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY));
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
  return getSavedApiBaseUrl() || getEnvApiBaseUrl();
}

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function isLikelyStaticHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host.endsWith('.github.io') ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.netlify.app')
  );
}

export async function checkBackendHealth(overrideBaseUrl?: string): Promise<{
  available: boolean;
  imapSupported: boolean;
  reason?: string;
}> {
  const base = overrideBaseUrl !== undefined ? normalizeBaseUrl(overrideBaseUrl) : getApiBaseUrl();
  const healthUrl = base ? `${base}/api/health` : '/api/health';

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal
    });
    window.clearTimeout(timer);

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    if (!res.ok || text.trim().startsWith('<') || !contentType.includes('application/json')) {
      return {
        available: false,
        imapSupported: false,
        reason: `Backend returned HTTP ${res.status || 405} (static host or non-API response).`
      };
    }

    const data = JSON.parse(text);
    return {
      available: Boolean(data?.ok),
      imapSupported: Boolean(data?.imapSupported ?? data?.ok)
    };
  } catch (err: any) {
    return {
      available: false,
      imapSupported: false,
      reason: err?.name === 'AbortError' ? 'Backend health check timed out.' : err?.message || 'Backend unreachable.'
    };
  }
}
