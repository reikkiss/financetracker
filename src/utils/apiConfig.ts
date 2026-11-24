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

  if (base && isPrivateAiStudioDevUrl(base) && isCrossOriginUrl(base)) {
    return {
      available: false,
      imapSupported: false,
      reason:
        'AI Studio dev preview URLs (ais-dev-*) require browser session login cookies and block cross-origin CORS requests from static sites like GitHub Pages. Point Server URL to a public Node backend or use Import .eml/.mbox / Gmail Auto-Sync.'
    };
  }

  if (!base && isLikelyStaticHost()) {
    return {
      available: false,
      imapSupported: false,
      reason:
        'Static hosting (GitHub Pages) does not run a Node IMAP server. Connect a public Server URL or use Import .eml/.mbox / Gmail Auto-Sync.'
    };
  }

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
