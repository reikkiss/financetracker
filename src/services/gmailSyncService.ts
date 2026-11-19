import {
  getAuth,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup
} from 'firebase/auth';
import { parseBankEmailAlert, ParsedEmailTransaction } from '../utils/bankEmailParser';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export const BANK_GMAIL_SEARCH_QUERY =
  'from:(banreservas.com OR notificacionestubancoapp@banreservas.com OR bpd.com.do OR popularenlinea.com OR notificaciones@popularenlinea.com OR bhd.com.do OR alertas@bhd.com.do OR qik.do OR notificaciones@qik.do OR azul.com.do OR notificaciones@azul.com.do OR bsc.com.do OR scotiabank OR promerica OR apap OR banesco OR lafise OR bancocaribe OR vimenca OR bdi.com.do OR blh.com.do OR paypal.com OR popular OR reservas OR bhd OR qik OR azul OR bpd) OR subject:(consumo OR transaccion OR transacción OR notificacion OR notificación OR alerta OR compra OR compraste OR "pago realizado" OR retiro OR transferencia OR deposito OR depósito OR abono OR pago OR debito OR débito)';

// Strictly in-memory OAuth token cache (per Google Workspace integration policy — never stored in localStorage/sessionStorage)
let cachedGmailAccessToken: string | null = null;
let cachedGmailTokenExpiresAt = 0;
let cachedGmailEmail: string | null = null;

export function setMemoryGmailToken(token: string, email?: string | null, expiresInSec = 3500) {
  const clean = token.trim();
  if (!clean) return;
  cachedGmailAccessToken = clean;
  cachedGmailTokenExpiresAt = Date.now() + expiresInSec * 1000;
  if (email) {
    cachedGmailEmail = email;
  }
}

export function getMemoryGmailToken(): string | null {
  if (!cachedGmailAccessToken) return null;
  if (cachedGmailTokenExpiresAt > 0 && Date.now() > cachedGmailTokenExpiresAt) {
    return null;
  }
  return cachedGmailAccessToken;
}

export function getMemoryGmailEmail(): string | null {
  return cachedGmailEmail;
}

export function clearMemoryGmailSession() {
  cachedGmailAccessToken = null;
  cachedGmailTokenExpiresAt = 0;
  cachedGmailEmail = null;
}

export class GmailAuthError extends Error {
  code: 'GMAIL_TOKEN_EXPIRED' | 'GMAIL_API_ERROR';
  constructor(message: string, code: 'GMAIL_TOKEN_EXPIRED' | 'GMAIL_API_ERROR' = 'GMAIL_API_ERROR') {
    super(message);
    this.name = 'GmailAuthError';
    this.code = code;
  }
}

async function safeParseJsonResponse(res: Response): Promise<any> {
  const rawText = await res.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    if (!res.ok) {
      throw new GmailAuthError(
        `Gmail request failed with HTTP ${res.status}.`,
        res.status === 401 ? 'GMAIL_TOKEN_EXPIRED' : 'GMAIL_API_ERROR'
      );
    }
    return {};
  }

  if (trimmed.startsWith('<')) {
    throw new GmailAuthError(
      `Received unexpected HTML error (HTTP ${res.status}) instead of JSON. Please check your connection and try again.`,
      res.status === 401 ? 'GMAIL_TOKEN_EXPIRED' : 'GMAIL_API_ERROR'
    );
  }

  let data: any;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new GmailAuthError(
      `Invalid JSON response from Gmail API (HTTP ${res.status}).`,
      res.status === 401 ? 'GMAIL_TOKEN_EXPIRED' : 'GMAIL_API_ERROR'
    );
  }

  if (!res.ok) {
    const apiMsg = String(data?.error?.message || data?.error || `Gmail API error (HTTP ${res.status})`);
    if (res.status === 401) {
      cachedGmailAccessToken = null;
      cachedGmailTokenExpiresAt = 0;
      throw new GmailAuthError(
        'Gmail authorization expired. Click "Reconnect Gmail" to refresh access.',
        'GMAIL_TOKEN_EXPIRED'
      );
    }
    if (res.status === 403 && /gmail api has not been used|is disabled/i.test(apiMsg)) {
      throw new GmailAuthError(
        'Gmail API is not enabled on Firebase project 965612621346 (seashore-be233). Enable Gmail API in Google Cloud Console for project 965612621346, wait 1–2 minutes, and click "Reconnect Gmail".',
        'GMAIL_API_ERROR'
      );
    }
    throw new GmailAuthError(apiMsg, 'GMAIL_API_ERROR');
  }

  return data;
}

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
  messagesTotal: number;
}

export async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await safeParseJsonResponse(res);
  if (data.emailAddress) {
    cachedGmailEmail = data.emailAddress;
  }
  return {
    emailAddress: data.emailAddress || '',
    historyId: String(data.historyId || ''),
    messagesTotal: Number(data.messagesTotal || 0)
  };
}

/**
 * Authorizes read-only Gmail access using Firebase Auth's GoogleAuthProvider popup flow
 * (bound to seashore-be233 / 965612621346 Authorized Domains — no standalone GIS origin_mismatch).
 */
export async function authorizeGmailAccess(hintEmail?: string): Promise<{
  accessToken: string;
  emailAddress: string;
  historyId: string;
}> {
  const auth = getAuth();
  const hint = hintEmail || cachedGmailEmail || auth.currentUser?.email || undefined;

  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_READONLY_SCOPE);
  provider.setCustomParameters({
    prompt: 'consent',
    ...(hint ? { login_hint: hint } : {})
  });

  let token = '';
  let signedInEmail = '';

  try {
    const result = auth.currentUser
      ? await reauthenticateWithPopup(auth.currentUser, provider)
      : await signInWithPopup(auth, provider);

    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google did not return a Gmail read-only OAuth token.');
    }
    token = credential.accessToken;
    signedInEmail = result.user?.email || '';
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'auth/unauthorized-domain') {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      throw new Error(
        `Domain "${host}" is not authorized in Firebase Auth. Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains (project seashore-be233).`
      );
    }
    if (code === 'auth/user-mismatch') {
      throw new Error(
        `Please select your signed-in Google account (${auth.currentUser?.email || 'current account'}) in the popup to grant Gmail read-only access.`
      );
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('The Google sign-in popup was blocked by your browser. Please allow popups for this site and try again.');
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google authorization popup was closed before completing.');
    }
    throw err;
  }

  setMemoryGmailToken(token, signedInEmail || hint || null, 3500);
  const profile = await fetchGmailProfile(token);
  setMemoryGmailToken(token, profile.emailAddress || signedInEmail || hint || null, 3500);

  return {
    accessToken: token,
    emailAddress: profile.emailAddress || signedInEmail || hint || '',
    historyId: profile.historyId
  };
}

export async function trySilentRefreshGmailToken(_hintEmail?: string): Promise<string | null> {
  // Firebase Auth popup tokens cannot be refreshed silently in background without a popup click.
  // Return any still-valid in-memory token cleanly so the UI prompts Reconnect Gmail on 1h expiry.
  return getMemoryGmailToken();
}

function decodeBase64UrlToText(base64Url: string, charset = 'utf-8'): string {
  if (!base64Url) return '';
  try {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLength);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const lowerCharset = charset.toLowerCase();
    if (lowerCharset.includes('iso-8859') || lowerCharset.includes('latin1') || lowerCharset.includes('1252')) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  } catch {
    return '';
  }
}

function extractGmailMessageBody(payload: any, fallbackSnippet = ''): string {
  const plainParts: string[] = [];
  const htmlParts: string[] = [];

  function walk(part: any) {
    if (!part) return;
    const mimeType = String(part.mimeType || '').toLowerCase();

    // Skip attachments and non-text binary parts
    if (part.body?.attachmentId) return;

    if (part.body?.data && (!mimeType || mimeType.startsWith('text/plain') || mimeType.startsWith('text/html'))) {
      const headers: any[] = part.headers || [];
      const ctHeader = headers.find((h: any) => h.name?.toLowerCase() === 'content-type')?.value || '';
      const charsetMatch = ctHeader.match(/charset=["']?([^"'\r\n;]+)["']?/i);
      const charset = charsetMatch ? charsetMatch[1].trim() : 'utf-8';
      const decoded = decodeBase64UrlToText(part.body.data, charset);
      if (decoded.trim()) {
        if (mimeType.includes('text/html')) {
          htmlParts.push(decoded);
        } else {
          plainParts.push(decoded);
        }
      }
    }

    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  }

  walk(payload);

  const collected = [...htmlParts, ...plainParts].filter(Boolean);
  return collected.length > 0 ? collected.join('\n') : fallbackSnippet;
}

async function fetchAndParseGmailMessages(
  accessToken: string,
  messageIds: string[]
): Promise<ParsedEmailTransaction[]> {
  if (messageIds.length === 0) return [];

  const uniqueIds = Array.from(new Set(messageIds));
  const alerts: ParsedEmailTransaction[] = [];
  const chunkSize = 8;

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async id => {
        try {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!msgRes.ok) return null;
          const msgData = await safeParseJsonResponse(msgRes);
          const headers = msgData.payload?.headers || [];
          const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '';
          const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
          const dateHeader = headers.find((h: any) => h.name?.toLowerCase() === 'date')?.value || '';

          const bodyText = extractGmailMessageBody(msgData.payload, msgData.snippet || '');
          const parsed = parseBankEmailAlert(bodyText, subject, from, dateHeader);
          if (!parsed) return null;
          return {
            ...parsed,
            emailId: `gmail_${id}`,
            rawSubject: subject,
            rawSender: from
          } as ParsedEmailTransaction;
        } catch {
          return null;
        }
      })
    );

    results.forEach(item => {
      if (item) alerts.push(item);
    });
  }

  return alerts;
}

export interface GmailScanResult {
  alerts: ParsedEmailTransaction[];
  totalScanned: number;
  historyId: string;
  emailAddress: string;
}

export async function scanGmailBankAlerts(
  accessToken: string,
  maxResults = 25
): Promise<GmailScanResult> {
  const cleanToken = accessToken.trim();
  const query = encodeURIComponent(BANK_GMAIL_SEARCH_QUERY);
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${maxResults}`;

  const [profile, listData] = await Promise.all([
    fetchGmailProfile(cleanToken),
    fetch(listUrl, { headers: { Authorization: `Bearer ${cleanToken}` } }).then(safeParseJsonResponse)
  ]);

  const messageRefs: Array<{ id: string }> = listData.messages || [];
  const messageIds = messageRefs.map(m => m.id).filter(Boolean);
  const alerts = await fetchAndParseGmailMessages(cleanToken, messageIds);

  return {
    alerts,
    totalScanned: messageIds.length,
    historyId: profile.historyId,
    emailAddress: profile.emailAddress
  };
}

export async function checkNewGmailAlertsSinceHistory(
  accessToken: string,
  startHistoryId?: string
): Promise<GmailScanResult> {
  const cleanToken = accessToken.trim();

  if (!startHistoryId) {
    return scanGmailBankAlerts(cleanToken, 15);
  }

  const historyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(
    startHistoryId
  )}&historyTypes=messageAdded&maxResults=50`;

  const res = await fetch(historyUrl, {
    headers: { Authorization: `Bearer ${cleanToken}` }
  });

  if (res.status === 404) {
    return scanGmailBankAlerts(cleanToken, 15);
  }

  const data = await safeParseJsonResponse(res);
  const nextHistoryId = String(data.historyId || startHistoryId);
  const historyRecords: any[] = Array.isArray(data.history) ? data.history : [];

  const addedIds: string[] = [];
  for (const record of historyRecords) {
    if (Array.isArray(record.messagesAdded)) {
      for (const added of record.messagesAdded) {
        const msgId = added?.message?.id;
        if (msgId) addedIds.push(String(msgId));
      }
    }
  }

  if (addedIds.length === 0) {
    return {
      alerts: [],
      totalScanned: 0,
      historyId: nextHistoryId,
      emailAddress: cachedGmailEmail || ''
    };
  }

  const alerts = await fetchAndParseGmailMessages(cleanToken, addedIds);
  return {
    alerts,
    totalScanned: addedIds.length,
    historyId: nextHistoryId,
    emailAddress: cachedGmailEmail || ''
  };
}
