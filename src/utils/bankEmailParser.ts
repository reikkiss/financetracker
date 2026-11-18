export interface ParsedEmailTransaction {
  title: string;
  amount: number;
  currency: 'RD$' | 'USD' | '$';
  type: 'expense' | 'income' | 'transfer';
  category: string;
  date: string;
  cardNumber?: string;
  bankName: string;
  notes: string;
  status: 'pending';
  rawSender?: string;
  rawSubject?: string;
  emailId?: string;
}

/**
 * Decodes quoted-printable MIME encoding (=3D, =\r\n, UTF-8 hex sequences) and strips HTML tags/styles
 * so real iCloud & Gmail raw emails parse cleanly without picking up CSS font-sizes or color hex numbers.
 */
export function cleanEmailContent(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // If raw MIME source contains Content-Transfer-Encoding: base64 blocks, decode UTF-8 text blocks when safe
  const base64BlockRegex =
    /Content-Type:\s*text\/(?:plain|html)[^\r\n]*[\r\n]+(?:[^\r\n]+[\r\n]+)*?Content-Transfer-Encoding:\s*base64[\r\n]{2,4}([A-Za-z0-9+/=\r\n]+)/gi;
  const decodedBlocks: string[] = [];
  let b64Match: RegExpExecArray | null;
  while ((b64Match = base64BlockRegex.exec(raw)) !== null) {
    try {
      const cleanedB64 = b64Match[1].replace(/\s+/g, '');
      const decoded =
        typeof Buffer !== 'undefined'
          ? Buffer.from(cleanedB64, 'base64').toString('utf8')
          : atob(cleanedB64);
      if (decoded && decoded.trim()) {
        decodedBlocks.push(decoded);
      }
    } catch {
      // Ignore malformed base64 segments
    }
  }
  if (decodedBlocks.length > 0) {
    text = decodedBlocks.join('\n');
  }

  // Strip raw MIME header lines at top if full .eml source was passed
  const headerBodySplit = text.indexOf('\r\n\r\n');
  if (headerBodySplit > 0 && /^(?:Return-Path|Delivered-To|Received|DKIM-Signature|MIME-Version):/im.test(text.slice(0, headerBodySplit))) {
    text = text.slice(headerBodySplit + 4);
  }

  // Decode quoted-printable soft line breaks
  text = text.replace(/=\r?\n/g, '');

  // Decode quoted-printable UTF-8 byte sequences (e.g. =C3=B3 -> ó, =3D -> =)
  text = text.replace(/(?:=[0-9A-F]{2})+/gi, match => {
    try {
      const bytes = match
        .slice(1)
        .split('=')
        .map(hex => parseInt(hex, 16));
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch {
      return match;
    }
  });

  // Remove <style>, <script>, and <head> blocks completely
  text = text
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');

  // Replace block-level HTML tags with newlines to preserve structure (Merchant / Monto / Fecha lines)
  text = text.replace(/<\/?(?:br|p|div|tr|td|th|li|h[1-6]|table)[^>]*>/gi, '\n');
  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  const entityMap: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&aacute;': 'á',
    '&eacute;': 'é',
    '&iacute;': 'í',
    '&oacute;': 'ó',
    '&uacute;': 'ú',
    '&ntilde;': 'ñ',
    '&Aacute;': 'Á',
    '&Eacute;': 'É',
    '&Iacute;': 'Í',
    '&Oacute;': 'Ó',
    '&Uacute;': 'Ú',
    '&Ntilde;': 'Ñ'
  };
  text = text.replace(/&[a-zA-Z0-9#]+;/g, entity => entityMap[entity] || ' ');

  // Normalize horizontal whitespace while keeping newlines
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const KNOWN_BANKS = [
  { keywords: ['popular', 'bpd.com.do', 'popularenlinea'], name: 'Banco Popular' },
  { keywords: ['banreservas', 'reservas', 'banreservas.com'], name: 'Banreservas' },
  { keywords: ['bhd', 'bhdleon', 'bhd.com.do'], name: 'Banco BHD' },
  { keywords: ['qik', 'qik.do', 'qik.com.do'], name: 'Qik Banco Digital' },
  { keywords: ['santa cruz', 'bsc.com.do'], name: 'Banco Santa Cruz' },
  { keywords: ['scotiabank', 'scotia'], name: 'Scotiabank' },
  { keywords: ['promerica'], name: 'Banco Promerica' },
  { keywords: ['apap', 'asociacion popular', 'asociación popular'], name: 'APAP' },
  { keywords: ['banesco'], name: 'Banesco' },
  { keywords: ['lafise'], name: 'Banco Lafise' },
  { keywords: ['vimenca'], name: 'Banco Vimenca' }
];

const TRANSACTION_ALERT_KEYWORDS = [
  'consumo',
  'transacción',
  'transaccion',
  'compra aprobada',
  'compra realizada',
  'alerta de',
  'notificación',
  'notificacion',
  'pago realizado',
  'pago recibido',
  'pago al instante',
  'transferencia',
  'retiro',
  'depósito',
  'deposito',
  'abono',
  'tarjeta de crédito',
  'tarjeta de credito',
  'tarjeta de débito',
  'tarjeta de debito',
  'cargo',
  'authorization',
  'purchase alert',
  'transaction alert',
  'monto:',
  'importe:'
];

/**
 * Robust parser for Dominican bank alert emails (Banco Popular, Banreservas, BHD, Qik, Santa Cruz, etc.)
 * Works with raw MIME/HTML email bodies, Gmail full messages, and plain text alerts.
 */
export function parseBankEmailAlert(
  rawText: string,
  rawSubject: string = '',
  rawSender: string = '',
  fallbackDate?: string
): ParsedEmailTransaction | null {
  const cleanedBody = cleanEmailContent(rawText);
  const combined = `${rawSender}\n${rawSubject}\n${cleanedBody}`.trim();
  if (!combined || combined.length < 10) return null;

  const lower = combined.toLowerCase();

  // 1. Detect Bank Name & validate that this email is genuinely a bank/financial transaction alert
  let bankName = '';
  for (const bank of KNOWN_BANKS) {
    if (bank.keywords.some(kw => lower.includes(kw))) {
      bankName = bank.name;
      break;
    }
  }

  const hasTxKeyword = TRANSACTION_ALERT_KEYWORDS.some(kw => lower.includes(kw));
  const hasExplicitCurrency = /(?:rd\$|us\$|dop|usd)/i.test(combined);

  // Reject non-bank / marketing / unrelated inbox messages
  if (!bankName && !(hasTxKeyword && hasExplicitCurrency)) {
    return null;
  }
  if (!hasTxKeyword && !hasExplicitCurrency) {
    return null;
  }
  if (!bankName) {
    bankName = 'Dominican Bank';
  }

  // 2. Detect Currency
  let currency: 'RD$' | 'USD' | '$' = 'RD$';
  if (
    lower.includes('us$') ||
    lower.includes('usd') ||
    lower.includes('u.s. dollar') ||
    lower.includes('dolares') ||
    lower.includes('dólares')
  ) {
    currency = 'USD';
  } else if (
    lower.includes('rd$') ||
    lower.includes('dop') ||
    lower.includes('pesos') ||
    lower.includes('pesos dominicanos')
  ) {
    currency = 'RD$';
  }

  // 3. Extract Amount (prioritize explicitly currency-tagged or keyword-tagged amounts)
  const currencyRegex = /(?:rd\$|us\$|\$|dop|usd)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)/gi;
  const labelRegex =
    /(?:monto|valor|importe|consumo\s+por|compra\s+por|pago\s+por|total|cantidad)(?:\s*(?:de|por|:|\s))\s*(?:rd\$|us\$|\$|dop|usd)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)/gi;

  let amount = 0;
  for (const pattern of [currencyRegex, labelRegex]) {
    const matches = Array.from(combined.matchAll(pattern));
    for (const m of matches) {
      const numStr = m[1].replace(/,/g, '');
      const parsedNum = parseFloat(numStr);
      if (!isNaN(parsedNum) && parsedNum > 0 && parsedNum < 25000000) {
        amount = parsedNum;
        break;
      }
    }
    if (amount > 0) break;
  }

  // Fallback for formatted numbers with comma separators and 2 decimals (e.g. 2,450.00)
  if (amount <= 0) {
    const commaAmtMatches = Array.from(combined.matchAll(/\b([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2})\b/g));
    for (const fm of commaAmtMatches) {
      const p = parseFloat(fm[1].replace(/,/g, ''));
      if (!isNaN(p) && p > 0 && p < 25000000) {
        amount = p;
        break;
      }
    }
  }

  if (amount <= 0) return null;

  // 4. Detect Card / Account Last 4 Digits
  const cardPatterns = [
    /(?:tarjeta|cuenta|tc|td|terminad[ao] en|finaliza en|ending in|\*{2,4}|#)\s*(?:no\.?|num\.?|número)?\s*([0-9]{4})\b/i,
    /\*{2,4}\s*([0-9]{4})\b/,
    /\b([0-9]{4})\s*(?:ha realizado|se realizo|se realizó|aprobada)/i
  ];
  let cardNumber: string | undefined;
  for (const cp of cardPatterns) {
    const match = combined.match(cp);
    if (match && match[1]) {
      cardNumber = match[1];
      break;
    }
  }

  // 5. Detect Date (DD/MM/YYYY, YYYY-MM-DD, DD-MMM-YYYY)
  let dateStr = '';
  const isoMatch = combined.match(/\b(20[0-9]{2})[\/\-](0[1-9]|1[0-2])[\/\-](0[1-9]|[12][0-9]|3[01])\b/);
  if (isoMatch) {
    dateStr = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  } else {
    const dmyMatch = combined.match(/\b([0-9]{1,2})[\/\-]([0-9]{1,2}|[a-zA-Z]{3,9})[\/\-]([0-9]{2,4})\b/);
    if (dmyMatch) {
      const dayNum = parseInt(dmyMatch[1], 10);
      const monthPart = dmyMatch[2];
      const yearRaw = dmyMatch[3];
      const yearPart = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
      let month = '';
      if (/^\d+$/.test(monthPart)) {
        const mNum = parseInt(monthPart, 10);
        if (mNum >= 1 && mNum <= 12 && dayNum >= 1 && dayNum <= 31) {
          month = String(mNum).padStart(2, '0');
        }
      } else {
        const monthsMap: Record<string, string> = {
          ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
          jul: '07', ago: '08', sep: '09', set: '09', oct: '10', nov: '11', dic: '12',
          jan: '01', apr: '04', aug: '08', dec: '12'
        };
        month = monthsMap[monthPart.toLowerCase().slice(0, 3)] || '';
      }
      if (month && dayNum >= 1 && dayNum <= 31) {
        dateStr = `${yearPart}-${month}-${String(dayNum).padStart(2, '0')}`;
      }
    }
  }

  if (!dateStr && fallbackDate) {
    const parsedFallback = new Date(fallbackDate);
    if (!isNaN(parsedFallback.getTime())) {
      dateStr = parsedFallback.toISOString().split('T')[0];
    }
  }
  if (!dateStr) {
    dateStr = new Date().toISOString().split('T')[0];
  }

  // 6. Detect Type & Merchant / Title
  let title = `${bankName} Alert`;
  let category = 'Shopping';
  let type: 'expense' | 'income' | 'transfer' = 'expense';

  if (
    lower.includes('transferencia enviada') ||
    lower.includes('transferencia saliente') ||
    lower.includes('pago al instante') ||
    lower.includes('transferencia entre cuentas') ||
    lower.includes('transferencia ach')
  ) {
    type = 'transfer';
    category = 'Transfer';
    title = `Transfer (${bankName})`;
  } else if (
    lower.includes('deposito') ||
    lower.includes('depósito') ||
    lower.includes('credito recibido') ||
    lower.includes('crédito recibido') ||
    lower.includes('transferencia recibida') ||
    lower.includes('abono recibido') ||
    lower.includes('nómina') ||
    lower.includes('nomina')
  ) {
    type = 'income';
    category = 'Income';
    title = `Deposit (${bankName})`;
  } else {
    const merchantPatterns = [
      /(?:comercio|establecimiento|lugar|merchant)\s*:\s*([^\n\r]{3,45})/i,
      /(?:consumo en|compra en|pago en|realizado en|transacción en|transaccion en)\s+([A-Z0-9\*\.\-\&\'\s]{3,42})/i
    ];
    let detectedMerchant = '';
    for (const mp of merchantPatterns) {
      const match = combined.match(mp);
      if (match && match[1]) {
        detectedMerchant = match[1]
          .split(/\s+(?:por|el|fecha|monto|rd\$|us\$|con|tarjeta)/i)[0]
          .trim();
        if (detectedMerchant.length >= 3) break;
      }
    }

    if (
      detectedMerchant &&
      detectedMerchant.length >= 3 &&
      !detectedMerchant.toLowerCase().includes('su tarjeta') &&
      !detectedMerchant.toLowerCase().includes('su cuenta')
    ) {
      title = detectedMerchant;
      const lowerM = detectedMerchant.toLowerCase();
      if (
        lowerM.includes('supermercado') ||
        lowerM.includes('sirena') ||
        lowerM.includes('bravo') ||
        lowerM.includes('nacional') ||
        lowerM.includes('jumbo') ||
        lowerM.includes('ole') ||
        lowerM.includes('pricesmart')
      ) {
        category = 'Groceries';
      } else if (
        lowerM.includes('uber') ||
        lowerM.includes('didi') ||
        lowerM.includes('gasolina') ||
        lowerM.includes('combustible') ||
        lowerM.includes('total') ||
        lowerM.includes('texaco') ||
        lowerM.includes('shell') ||
        lowerM.includes('sigma') ||
        lowerM.includes('sunix')
      ) {
        category = 'Transport';
      } else if (
        lowerM.includes('restaurante') ||
        lowerM.includes('pedidosya') ||
        lowerM.includes('ubereats') ||
        lowerM.includes('cafe') ||
        lowerM.includes('mcdonald') ||
        lowerM.includes('pizza') ||
        lowerM.includes('burger') ||
        lowerM.includes('starbucks')
      ) {
        category = 'Dining';
      } else if (
        lowerM.includes('netflix') ||
        lowerM.includes('spotify') ||
        lowerM.includes('apple') ||
        lowerM.includes('google') ||
        lowerM.includes('prime') ||
        lowerM.includes('icloud')
      ) {
        category = 'Subscriptions';
      } else if (
        lowerM.includes('farmacia') ||
        lowerM.includes('carol') ||
        lowerM.includes('clinica') ||
        lowerM.includes('claro') ||
        lowerM.includes('altice') ||
        lowerM.includes('edesur') ||
        lowerM.includes('edenorte') ||
        lowerM.includes('edeeste')
      ) {
        category = 'Utilities';
      }
    } else {
      title = rawSubject ? rawSubject.slice(0, 80) : `${bankName} Consumption`;
    }
  }

  return {
    title: title.slice(0, 180),
    amount,
    currency,
    type,
    category: category.slice(0, 45),
    date: dateStr,
    cardNumber,
    bankName,
    notes: `Email alert from ${bankName}${cardNumber ? ` (Card *${cardNumber})` : ''}`,
    status: 'pending',
    rawSender,
    rawSubject
  };
}

/**
 * Fuzzy deduplication / reconciliation helper:
 * Matches statement line items against pending email alerts.
 * Criteria: Account matches, within ±15% amount tolerance (restaurant tips/holds), within ±4 days.
 */
export function findFuzzyPendingMatch(
  pendingTxs: any[],
  incoming: { budgetId?: string; amount: number; date: string; currency?: string }
): any | undefined {
  const incomingDate = new Date(incoming.date || Date.now()).getTime();
  const incomingAmt = Math.abs(incoming.amount);

  return pendingTxs.find(pt => {
    if ((pt.status || 'pending') !== 'pending') return false;
    if (incoming.budgetId && pt.budgetId && incoming.budgetId !== pt.budgetId) return false;

    const ptAmt = Math.abs(pt.amount);
    const amountDiff = Math.abs(ptAmt - incomingAmt);
    const amountTolerance = Math.max(0.5, ptAmt * 0.15); // ~15% tolerance for tips/holds
    if (amountDiff > amountTolerance) return false;

    const ptDate = new Date(pt.date || Date.now()).getTime();
    const dayDiff = Math.abs(ptDate - incomingDate) / (1000 * 60 * 60 * 24);
    if (dayDiff > 4) return false; // Within ±4 days

    return true;
  });
}
