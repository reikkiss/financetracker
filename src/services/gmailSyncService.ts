import {
  getAuth,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { parseBankEmailAlert, ParsedEmailTransaction } from '../utils/bankEmailParser';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// Dedicated OAuth Client ID on project gen-lang-client-0740809000 where Gmail API is enabled,
// keeping Firebase Auth & Firestore DB cleanly on seashore-be233 (seashore).
const GMAIL_OAUTH_CLIENT_ID =
  (import.meta as any).env?.VITE_GMAIL_OAUTH_CLIENT_ID ||
  '951922406642-uhdin2qhvmo0oono0f4796elils4j37h.apps.googleusercontent.com';

export const BANK_GMAIL_SEARCH_QUERY =
  'from:(banreservas.com OR bpd.com.do OR popularenlinea.com OR bhd.com.do OR qik.do OR qik.com.do OR bsc.com.do OR scotiabank OR promerica OR apap OR banesco OR lafise OR bancocaribe OR vimenca OR bdi.com.do OR blh.com.do OR paypal.com OR popular OR reservas OR bhd OR qik) OR subject:(consumo OR transaccion OR transacción OR notificacion OR notificación OR alerta OR compra OR compraste OR "pago realizado" OR retiro OR transferencia OR deposito OR depósito OR abono)';

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
    const apiMsg = data?.error?.message || data?.error || `Gmail API error (HTTP ${res.status})`;
    if (res.status === 401) {
      cachedGmailAccessToken = null;
      cachedGmailTokenExpiresAt = 0;
      throw new GmailAuthError(
        'Gmail authorization expired. Click "Reconnect Gmail" to refresh access.',
        'GMAIL_TOKEN_EXPIRED'
      );
    }
    throw new GmailAuthError(String(apiMsg), 'GMAIL_API_ERROR');
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

async function ensureGsiLoaded(timeoutMs = 5000): Promise<any> {
  const win = window as any;
  if (win.google?.accounts?.oauth2) return win.google.accounts.oauth2;

  // Inject script dynamically if not already present
  if (!document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (win.google?.accounts?.oauth2) return win.google.accounts.oauth2;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

async function requestGisToken(
  clientId: string,
  options: { prompt?: string; hint?: string } = {}
): Promise<{ accessToken: string; expiresIn: number }> {
  const oauth2 = await ensureGsiLoaded();
  if (!oauth2) {
    throw new Error('Google Identity Services could not be loaded.');
  }

  return new Promise((resolve, reject) => {
    try {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: GMAIL_READONLY_SCOPE,
        ...(options.hint ? { hint: options.hint } : {}),
        callback: (resp: any) => {
          if (resp?.error) {
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          if (!resp?.access_token) {
            reject(new Error('Google did not return a Gmail access token.'));
            return;
          }
          resolve({
            accessToken: resp.access_token,
            expiresIn: Number(resp.expires_in) || 3500
          });
        },
        error_callback: (err: any) => {
          reject(new Error(err?.message || err?.type || 'Google authorization popup was closed or blocked.'));
        }
      });

      client.requestAccessToken({
        prompt: options.prompt ?? 'consent'
      });
    } catch (err: any) {
      reject(err);
    }
  });
}

export async function authorizeGmailAccess(hintEmail?: string): Promise<{
  accessToken: string;
  emailAddress: string;
  historyId: string;
}> {
  const auth = getAuth();
  const hint = hintEmail || cachedGmailEmail || auth.currentUser?.email || undefined;
  const targetClientId = GMAIL_OAUTH_CLIENT_ID || (firebaseConfig as any).oAuthClientId;

  let token = '';
  let expiresIn = 3500;

  if (targetClientId) {
    try {
      const gisRes = await requestGisToken(targetClientId, {
        prompt: hint ? '' : 'select_account',
        hint
      });
      token = gisRes.accessToken;
      expiresIn = gisRes.expiresIn;
    } catch {
      // Retry explicitly with select_account if silent/hinted prompt needed consent
      const gisRes = await requestGisToken(targetClientId, {
        prompt: 'select_account',
        hint
      });
      token = gisRes.accessToken;
      expiresIn = gisRes.expiresIn;
    }
  } else {
    // Fallback to Firebase Auth popup if no dedicated OAuth client ID is present
    const provider = new GoogleAuthProvider();
    provider.addScope(GMAIL_READONLY_SCOPE);
    provider.setCustomParameters({
      prompt: 'consent',
      ...(hint ? { login_hint: hint } : {})
    });
    const result = auth.currentUser
      ? await reauthenticateWithPopup(auth.currentUser, provider)
      : await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google did not return a Gmail read-only OAuth token.');
    }
    token = credential.accessToken;
  }

  setMemoryGmailToken(token, hint || null, expiresIn);
  const profile = await fetchGmailProfile(token);
  setMemoryGmailToken(token, profile.emailAddress || hint || null, expiresIn);

  return {
    accessToken: token,
    emailAddress: profile.emailAddress || hint || '',
    historyId: profile.historyId
  };
}

export async function trySilentRefreshGmailToken(hintEmail?: string): Promise<string | null> {
  const targetClientId = GMAIL_OAUTH_CLIENT_ID || (firebaseConfig as any).oAuthClientId;
  if (!targetClientId) return null;
  try {
    const gisRes = await requestGisToken(targetClientId, {
      prompt: '',
      hint: hintEmail || cachedGmailEmail || getAuth().currentUser?.email || undefined
    });
    setMemoryGmailToken(gisRes.accessToken, hintEmail || cachedGmailEmail || null, gisRes.expiresIn);
    return gisRes.accessToken;
  } catch {
    return null;
  }
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
