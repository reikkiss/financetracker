export type EmailTransactionOutcome = 'approved' | 'declined' | 'reversed';

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
  emailOutcome: EmailTransactionOutcome;
  outcomeLabel: 'Went Through' | 'Declined' | 'Reversed';
  rawSender?: string;
  rawSubject?: string;
  emailId?: string;
}

function decodeQuotedPrintable(input: string): string {
  // Join soft line breaks first
  const joined = input.replace(/=\r?\n/g, '');
  // Decode byte runs (=XX or =C3=B3), trying strict UTF-8 first and falling back to Windows-1252 / Latin-1
  return joined.replace(/(?:=[0-9A-F]{2})+/gi, match => {
    try {
      const bytes = new Uint8Array(
        match
          .slice(1)
          .split('=')
          .map(hex => parseInt(hex, 16))
      );
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return new TextDecoder('windows-1252').decode(bytes);
      }
    } catch {
      return match;
    }
  });
}

function decodeBase64Text(b64: string, charset: string = 'utf-8'): string {
  const cleanedB64 = b64.replace(/\s+/g, '');
  if (!cleanedB64) return '';
  try {
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(cleanedB64, 'base64');
      const lowerCharset = charset.toLowerCase();
      if (lowerCharset.includes('iso-8859') || lowerCharset.includes('latin1') || lowerCharset.includes('1252')) {
        return new TextDecoder('windows-1252').decode(buf);
      }
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        return new TextDecoder('windows-1252').decode(buf);
      }
    }
    const binary = atob(cleanedB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
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

function decodeHtmlEntities(input: string): string {
  const entityMap: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&aacute;': 'á',
    '&eacute;': 'é',
    '&iacute;': 'í',
    '&oacute;': 'ó',
    '&uacute;': 'ú',
    '&ntilde;': 'ñ',
    '&uuml;': 'ü',
    '&Aacute;': 'Á',
    '&Eacute;': 'É',
    '&Iacute;': 'Í',
    '&Oacute;': 'Ó',
    '&Uacute;': 'Ú',
    '&Ntilde;': 'Ñ',
    '&Uuml;': 'Ü'
  };

  return input.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z0-9]+));/gi, (full, hex, dec, named) => {
    if (hex) {
      const code = parseInt(hex, 16);
      return !isNaN(code) ? String.fromCodePoint(code) : ' ';
    }
    if (dec) {
      const code = parseInt(dec, 10);
      return !isNaN(code) ? String.fromCodePoint(code) : ' ';
    }
    if (named) {
      return entityMap[full] || entityMap[full.toLowerCase()] || ' ';
    }
    return ' ';
  });
}

function cleanHtmlToStructuredText(htmlOrPlain: string): string {
  let text = htmlOrPlain;

  // Remove HTML comments, head, style, script blocks completely
  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');

  // Keep table cells (<td>, <th>) on the SAME line separated by a tab marker so "Comercio | SUPERMERCADO" stays paired
  // even after collapsing spaces! Row/block boundaries preserve line breaks.
  text = text
    .replace(/<\/?(?:td|th)[^>]*>/gi, '\t')
    .replace(/<\/?(?:br|p|div|tr|li|h[1-6]|table|section|article|header|footer|hr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text);

  // Strip invisible zero-width & non-breaking whitespace chars
  text = text.replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ');

  // Collapse runs of regular spaces/form-feeds first, then convert tab cell separators into double spaces
  return text
    .replace(/\r/g, '')
    .replace(/[ \f\v]+/g, ' ')
    .replace(/[ \t]*\t+[ \t]*/g, '  ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts and decodes MIME text/plain & text/html parts (handling base64 & quoted-printable regardless
 * of header order) and converts HTML tables/tags into clean structured lines.
 */
export function cleanEmailContent(raw: string): string {
  if (!raw) return '';

  // Check if raw input is a MIME email or raw .eml source
  const hasMimeHeaders =
    /^(?:Return-Path|Delivered-To|Received|MIME-Version|Content-Type|Content-Transfer-Encoding):/im.test(
      raw.slice(0, 4000)
    );

  const decodedTextSegments: string[] = [];

  if (hasMimeHeaders) {
    // Split on any MIME boundary line (starts with "--")
    const boundaryChunks = raw.split(/\r?\n--[^\r\n]+(?:--)?\r?\n/);

    for (const chunk of boundaryChunks) {
      const sepMatch = chunk.match(/\r?\n\r?\n/);
      if (!sepMatch || sepMatch.index === undefined) continue;

      const headers = chunk.slice(0, sepMatch.index);
      const body = chunk.slice(sepMatch.index + sepMatch[0].length);
      if (!body.trim()) continue;

      const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n;]+)/i);
      const contentType = contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : '';

      // Skip multipart container preambles and non-text attachments (images/PDFs)
      if (contentType && !contentType.startsWith('text/plain') && !contentType.startsWith('text/html')) {
        continue;
      }
      // If top-level single-part email had no text/* content-type and looks like multipart preamble
      if (!contentType && /^This is a multi-part message in MIME format/i.test(body.trim())) {
        continue;
      }

      const encodingMatch = headers.match(/Content-Transfer-Encoding:\s*([^\r\n;]+)/i);
      const encoding = encodingMatch ? encodingMatch[1].trim().toLowerCase() : '';

      const charsetMatch = headers.match(/charset=["']?([^"'\r\n;]+)["']?/i);
      const charset = charsetMatch ? charsetMatch[1].trim() : 'utf-8';

      let decoded = body;
      if (encoding === 'base64') {
        decoded = decodeBase64Text(body, charset);
      } else if (encoding === 'quoted-printable') {
        decoded = decodeQuotedPrintable(body);
      }

      if (decoded && decoded.trim()) {
        decodedTextSegments.push(cleanHtmlToStructuredText(decoded));
      }
    }
  }

  if (decodedTextSegments.length > 0) {
    return decodedTextSegments
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Fallback for non-MIME input, Gmail decoded bodies, or direct pasted text
  let text = raw;
  const headerBodySplit = text.indexOf('\r\n\r\n');
  if (
    headerBodySplit > 0 &&
    /^(?:Return-Path|Delivered-To|Received|DKIM-Signature|MIME-Version):/im.test(text.slice(0, headerBodySplit))
  ) {
    text = text.slice(headerBodySplit + 4);
  }

  if (/=[0-9A-F]{2}/i.test(text) || /=\r?\n/.test(text)) {
    text = decodeQuotedPrintable(text);
  }

  return cleanHtmlToStructuredText(text);
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
  'compraste',
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
  'declinada',
  'declinado',
  'declined',
  'rechazada',
  'rechazado',
  'denegada',
  'denegado',
  'reversada',
  'reversado',
  'reverso',
  'reversed',
  'reembolso',
  'refund',
  'anulada',
  'anulado',
  'monto:',
  'importe:',
  'comercio:',
  'establecimiento:'
];

const NEXT_FIELD_LABEL_STOP =
  /^(?:monto|importe|valor|total|fecha|hora|tarjeta|cuenta|moneda|referencia|autorizaci[oó]n|no\.?\s*autorizaci[oó]n|c[oó]digo|estado|estatus|saldo|balance|disponible|banco|estimad[oa]|hola|saludos|atentamente|si\s+no\s+reconoce|para\s+m[aá]s\s+informaci[oó]n|http|www\.)\b/i;

function isNoiseMerchant(rawCandidate: string, rawSubject: string): boolean {
  const c = rawCandidate.trim();
  if (c.length < 2 || c.length > 65) return true;

  const lowerC = c.toLowerCase();

  // Reject pure numbers, card numbers, dates, or currency amounts
  if (/^(?:rd\$|us\$|dop|usd|\$|no\.?|num\.?)?\s*[\d,.\-\/\*#:x\s]+$/i.test(c)) return true;

  // Reject next-field headers accidentally captured across table cells
  if (NEXT_FIELD_LABEL_STOP.test(lowerC)) return true;

  // Reject URLs and email addresses
  if (/https?:\/\/|www\.|@/i.test(c)) return true;

  // Reject standalone Spanish/English pronouns, prepositions, articles & generic nouns
  const stopWords = new Set([
    'su', 'tu', 'mi', 'la', 'el', 'lo', 'los', 'las', 'un', 'una', 'unos', 'unas',
    'este', 'esta', 'ese', 'esa', 'de', 'del', 'en', 'por', 'con', 'para', 'al', 'a',
    'y', 'o', 'your', 'the', 'this', 'that', 'with', 'from', 'for', 'card', 'account',
    'tarjeta', 'cuenta', 'consumo', 'compra', 'pago', 'transaccion', 'transacción', 'autorizacion', 'autorización'
  ]);
  if (stopWords.has(lowerC)) return true;

  // Reject generic card/account/phrase words
  const noisePhrases = [
    'su tarjeta',
    'tu tarjeta',
    'la tarjeta',
    'esta tarjeta',
    'tarjeta de crédito',
    'tarjeta de credito',
    'tarjeta de débito',
    'tarjeta de debito',
    'terminada en',
    'finaliza en',
    'su cuenta',
    'tu cuenta',
    'esta cuenta',
    'cuenta de ahorros',
    'cuenta corriente',
    'su préstamo',
    'su prestamo',
    'en línea',
    'en linea',
    'línea',
    'linea',
    'sucursal',
    'banca móvil',
    'banca movil',
    'internet banking',
    'app banreservas',
    'app popular',
    'app bhd',
    'app qik',
    'pesos dominicanos',
    'dólares estadounidenses',
    'dolares estadounidenses',
    'el día',
    'el dia',
    'la fecha',
    'república dominicana',
    'republica dominicana'
  ];
  if (noisePhrases.some(np => lowerC === np || lowerC.startsWith(`${np} `) || lowerC.includes('su tarjeta') || lowerC.includes('tu tarjeta'))) {
    return true;
  }

  // Reject if candidate simply repeats the email notification subject (e.g. "Notificación de Consumo")
  const normSubj = rawSubject.trim().toLowerCase();
  if (normSubj && (lowerC === normSubj || (lowerC.length > 12 && normSubj.startsWith(lowerC)))) {
    if (/(?:notificaci[oó]n|alerta|aviso|comprobante|informaci[oó]n)/i.test(lowerC)) {
      return true;
    }
  }

  return false;
}

function cleanMerchantCandidate(raw: string): string {
  let s = raw
    // Trim trailing clause connectors
    .split(/\s+(?:por(?:\s+(?:un|el)\s+monto|\s+valor|\s+rd\$|\s+us\$|\s+\$|\s+dop|\s+usd)?|el\s+d[ií]a|en\s+fecha|fecha\b|hora\b|monto\b|importe\b|valor\b|con\s+(?:su|tu|la)\s+tarjeta|con\s+tarjeta|tarjeta\b|terminad[ao]\b|rd\$|us\$|dop\b|usd\b|\$[0-9])/i)[0]
    .trim();

  // Strip leading article/noun wrappers like "el establecimiento " or "el comercio "
  s = s.replace(/^(?:el\s+establecimiento|el\s+comercio|la\s+tienda|el\s+negocio|el\s+local)\s+/i, '').trim();

  // Strip leading/trailing punctuation junk
  s = s.replace(/^[:\-\|•\s]+|[:\-\|•,;\.\s]+$/g, '').trim();

  // Truncate if two table columns got joined by 2+ spaces with a trailing label word
  s = s.replace(/\s{2,}(?:monto|fecha|hora|tarjeta|cuenta|moneda|estado|autorizaci[oó]n).*$/i, '').trim();

  return s;
}

function extractMerchantFromText(text: string, rawSubject: string): string {
  if (!text) return '';

  // Priority 1: Explicit Field / Table Labels (same line, ": ", "  ", OR next line)
  const labelNames =
    '(?:nombre\\s+del\\s+comercio|localidad\\s*\\/\\s*comercio|comercio\\s*\\/\\s*descripci[oó]n|lugar\\s+de\\s+consumo|comercio|establecimiento|localidad|negocio|afiliado|merchant|store|tienda|beneficiario|descripci[oó]n|descripcion|concepto)';

  const sameLineLabelRegex = new RegExp(
    `(?:^|\\n)\\s*${labelNames}(?:\\s*:\\s*|\\s{2,})([^\\n\\r]{2,65})`,
    'gi'
  );
  for (const m of text.matchAll(sameLineLabelRegex)) {
    if (m[1]) {
      const cleaned = cleanMerchantCandidate(m[1]);
      if (!isNoiseMerchant(cleaned, rawSubject)) {
        return cleaned;
      }
    }
  }

  const nextLineLabelRegex = new RegExp(
    `(?:^|\\n)\\s*${labelNames}\\s*:?\\s*\\n\\s*([^\\n\\r]{2,65})`,
    'gi'
  );
  for (const m of text.matchAll(nextLineLabelRegex)) {
    if (m[1]) {
      const cleaned = cleanMerchantCandidate(m[1]);
      if (!isNoiseMerchant(cleaned, rawSubject)) {
        return cleaned;
      }
    }
  }

  // Priority 2: Sentence Patterns (supports "...consumo en su tarjeta *1234 en MERCHANT por RD$...")
  const sentencePatterns = [
    /(?:compraste|gastaste|pagaste|consumiste|consumo|compra|transacci[oó]n|transaccion|pago|cargo|autorizaci[oó]n|autorizacion)[^\n\r]{0,140}?\ben\s+(?:el\s+(?:comercio|establecimiento)\s+)?(?!su\s+tarjeta|tu\s+tarjeta|la\s+tarjeta|su\s+cuenta|tu\s+cuenta|\d{4}\b)([A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/][A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/\s]{1,55})/gi,
    /(?:consumo\s+en|compra\s+en|pago\s+en|pago\s+a|realizado\s+en|realizada\s+en|aprobado\s+en|aprobada\s+en|efectuado\s+en|efectuada\s+en|transacci[oó]n\s+en|transaccion\s+en)\s+(?!su\s+tarjeta|tu\s+tarjeta|la\s+tarjeta|su\s+cuenta|tu\s+cuenta|\d{4}\b)([A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/][A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/\s]{1,55})/gi,
    /(?<!terminad[ao]\s)(?<!finaliza\s)\ben\s+([A-Z0-9][A-Z0-9\*\.\-\&\'\/\s]{2,45})(?=\s+(?:por|el\s+d[ií]a|el\s+\d|con\s+(?:su|tu)|rd\$|us\$|dop|usd|\$)|[,\r\n])/g
  ];

  for (const pattern of sentencePatterns) {
    for (const m of text.matchAll(pattern)) {
      if (m[1]) {
        const cleaned = cleanMerchantCandidate(m[1]);
        if (!isNoiseMerchant(cleaned, rawSubject)) {
          return cleaned;
        }
      }
    }
  }

  return '';
}

function classifyMerchantCategory(merchantName: string): string {
  const lowerM = merchantName.toLowerCase();
  if (
    lowerM.includes('supermercado') ||
    lowerM.includes('sirena') ||
    lowerM.includes('bravo') ||
    lowerM.includes('nacional') ||
    lowerM.includes('jumbo') ||
    lowerM.includes('ole') ||
    lowerM.includes('pricesmart') ||
    lowerM.includes('carrefour') ||
    lowerM.includes('cadena')
  ) {
    return 'Groceries';
  }
  if (
    lowerM.includes('uber') ||
    lowerM.includes('didi') ||
    lowerM.includes('indriver') ||
    lowerM.includes('gasolina') ||
    lowerM.includes('combustible') ||
    lowerM.includes('total') ||
    lowerM.includes('texaco') ||
    lowerM.includes('shell') ||
    lowerM.includes('sigma') ||
    lowerM.includes('sunix') ||
    lowerM.includes('peaje') ||
    lowerM.includes('paso rapido')
  ) {
    return 'Transport';
  }
  if (
    lowerM.includes('restaurante') ||
    lowerM.includes('pedidosya') ||
    lowerM.includes('ubereats') ||
    lowerM.includes('cafe') ||
    lowerM.includes('mcdonald') ||
    lowerM.includes('pizza') ||
    lowerM.includes('burger') ||
    lowerM.includes('starbucks') ||
    lowerM.includes('kfc') ||
    lowerM.includes('wendy') ||
    lowerM.includes('domino') ||
    lowerM.includes('sushi') ||
    lowerM.includes('grill')
  ) {
    return 'Dining';
  }
  if (
    lowerM.includes('netflix') ||
    lowerM.includes('spotify') ||
    lowerM.includes('apple') ||
    lowerM.includes('google') ||
    lowerM.includes('prime') ||
    lowerM.includes('icloud') ||
    lowerM.includes('disney') ||
    lowerM.includes('openai') ||
    lowerM.includes('chatgpt') ||
    lowerM.includes('adobe')
  ) {
    return 'Subscriptions';
  }
  if (
    lowerM.includes('farmacia') ||
    lowerM.includes('carol') ||
    lowerM.includes('clinica') ||
    lowerM.includes('claro') ||
    lowerM.includes('altice') ||
    lowerM.includes('viva') ||
    lowerM.includes('edesur') ||
    lowerM.includes('edenorte') ||
    lowerM.includes('edeeste') ||
    lowerM.includes('caasd')
  ) {
    return 'Utilities';
  }
  return 'Shopping';
}

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
    /(?:monto|valor|importe|consumo\s+por|compra\s+por|compraste|pago\s+por|total|cantidad)(?:\s*(?:de|por|:|\s))\s*(?:rd\$|us\$|\$|dop|usd)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)/gi;

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
    /(?:tarjeta|cuenta|tc|td|terminad[ao]\s+en|finaliza\s+en|ending\s+in|#)\s*(?:no\.?|num\.?|número|:|\s)*[\*xX]*\s*([0-9]{4})\b/i,
    /\*{1,4}\s*([0-9]{4})\b/,
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

  // 6. Detect Email Transaction Outcome (Declined / Reversed / Went Through)
  function detectOutcome(textToCheck: string): {
    emailOutcome: EmailTransactionOutcome;
    outcomeLabel: 'Went Through' | 'Declined' | 'Reversed';
  } {
    // Check negated approvals & explicit decline terms FIRST so "no fue aprobada" doesn't match "aprobada"
    const declinedPattern =
      /(?:\bno\s+(?:fue\s+|ha\s+sido\s+|pudo\s+ser\s+)?(?:aprobada|aprobado|procesada|procesado|completada|completado|autorizada|autorizado)|declinad[ao]|rechazad[ao]|denegad[ao]|fallid[ao]|fondos\s+insuficientes|saldo\s+insuficiente|l[ií]mite\s+excedido|tarjeta\s+bloqueada|pin\s+incorrecto|\bdeclined\b|\brejected\b|\bdenied\b|\bunsuccessful\b|\bfailed\s+(?:transaction|payment|charge)|insufficient\s+funds)/i;
    if (declinedPattern.test(textToCheck)) {
      return { emailOutcome: 'declined', outcomeLabel: 'Declined' };
    }

    // Check reversal / refund / void terms
    const reversedPattern =
      /(?:reversad[ao]|\breverso\b|reembols[ao]|reembolsad[ao]|devoluci[oó]n|anulad[ao]|anulaci[oó]n|\bextorno\b|(?:transacci[oó]n|compra|consumo|cargo|pago)\s+cancelad[ao]|\breversed\b|\breversal\b|\brefunded\b|\brefund\b|\bvoided\b|\bchargeback\b)/i;
    if (reversedPattern.test(textToCheck)) {
      return { emailOutcome: 'reversed', outcomeLabel: 'Reversed' };
    }

    return { emailOutcome: 'approved', outcomeLabel: 'Went Through' };
  }

  const { emailOutcome, outcomeLabel } = detectOutcome(`${rawSubject}\n${cleanedBody}`);

  // 7. Detect Type & Merchant / Title
  let title = `${bankName} Alert`;
  let category = 'Shopping';
  let type: 'expense' | 'income' | 'transfer' = 'expense';

  const detectedMerchant =
    extractMerchantFromText(cleanedBody, rawSubject) ||
    extractMerchantFromText(rawSubject, rawSubject);

  if (emailOutcome === 'reversed') {
    type = 'income';
    category = 'Refund / Reversal';
    title = detectedMerchant ? `Reversal - ${detectedMerchant}` : `Reversal (${bankName})`;
  } else if (
    lower.includes('transferencia enviada') ||
    lower.includes('transferencia saliente') ||
    lower.includes('pago al instante') ||
    lower.includes('transferencia entre cuentas') ||
    lower.includes('transferencia ach')
  ) {
    type = 'transfer';
    category = 'Transfer';
    title = detectedMerchant ? `Transfer - ${detectedMerchant}` : `Transfer (${bankName})`;
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
    title = detectedMerchant ? `Deposit - ${detectedMerchant}` : `Deposit (${bankName})`;
  } else if (detectedMerchant) {
    title = detectedMerchant;
    category = classifyMerchantCategory(detectedMerchant);
  } else {
    title = rawSubject ? rawSubject.slice(0, 80) : `${bankName} Consumption`;
  }

  const statusNote =
    emailOutcome === 'declined'
      ? ' • Declined (did not go through)'
      : emailOutcome === 'reversed'
      ? ' • Reversed / Refunded'
      : '';

  return {
    title: title.slice(0, 180),
    amount,
    currency,
    type,
    category: category.slice(0, 45),
    date: dateStr,
    cardNumber,
    bankName,
    notes: `Email alert from ${bankName}${cardNumber ? ` (Card *${cardNumber})` : ''}${statusNote}`,
    status: 'pending',
    emailOutcome,
    outcomeLabel,
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

const GENERIC_MERCHANT_TOKENS = new Set([
  'pago', 'compra', 'consumo', 'transferencia', 'transfer', 'deposit', 'deposito',
  'retiro', 'abono', 'cargo', 'bank', 'banco', 'card', 'tarjeta', 'cuenta',
  'alert', 'alerta', 'com', 'net', 'org', 'inc', 'llc', 'srl', 'sa', 'rd', 'do',
  'dop', 'usd', 'santo', 'domingo', 'store', 'tienda', 'sucursal', 'linea', 'online'
]);

function normalizeMerchantTokens(raw: string): string[] {
  if (!raw) return [];
  const norm = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!norm) return [];
  return norm
    .split(/\s+/)
    .filter(tok => tok.length >= 3 && !GENERIC_MERCHANT_TOKENS.has(tok) && !/^\d+$/.test(tok));
}

function merchantsLookSimilar(titleA: string, titleB: string): boolean {
  const normA = (titleA || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const normB = (titleB || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (normA.length >= 4 && normB.length >= 4 && (normA.includes(normB) || normB.includes(normA))) {
    return true;
  }

  const tokensA = normalizeMerchantTokens(titleA);
  const tokensB = normalizeMerchantTokens(titleB);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  for (const a of tokensA) {
    for (const b of tokensB) {
      if (a === b) return true;
      if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
    }
  }
  return false;
}

function getDayDifference(dateA?: string, dateB?: string): number {
  const parseYmd = (d?: string): number => {
    if (!d) return NaN;
    const clean = d.slice(0, 10);
    const m = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    const ts = new Date(d).getTime();
    return isNaN(ts) ? NaN : ts;
  };
  const tsA = parseYmd(dateA);
  const tsB = parseYmd(dateB);
  if (isNaN(tsA) || isNaN(tsB)) return 999;
  return Math.abs(tsA - tsB) / (1000 * 60 * 60 * 24);
}

/**
 * Matches an incoming bank email alert against already-registered transactions in the user's ledger
 * (whether manually entered, imported from a bank statement, or previously synced via email).
 * Supports date posting drift (±4 days), normalized merchant token overlap, tip/hold tolerances, and USD→DOP dual-currency ratios.
 */
export function findExistingTransactionForEmailAlert(
  existingTxs: any[],
  alert: ParsedEmailTransaction & { budgetId?: string },
  claimedTxIds?: Set<string>
): any | undefined {
  const alertAmt = Math.abs(Number(alert.amount) || 0);
  if (alertAmt <= 0) return undefined;

  const expectedTxType = alert.type === 'income' ? 'income' : 'expense';
  let bestMatch: { tx: any; score: number } | null = null;

  for (const tx of existingTxs) {
    if (!tx || (claimedTxIds && tx.id && claimedTxIds.has(tx.id))) continue;

    // 1. Exact emailId link
    if (alert.emailId && tx.emailId && tx.emailId === alert.emailId) {
      return tx;
    }

    // Compatible transaction direction (transfer alerts are stored as expense with isTransfer)
    if (tx.type && tx.type !== expectedTxType) continue;

    const txAmt = Math.abs(Number(tx.amount) || 0);
    if (txAmt <= 0) continue;

    const dayDiff = getDayDifference(tx.date, alert.date);
    if (dayDiff > 4) continue;

    const sameBudget = Boolean(alert.budgetId && tx.budgetId && alert.budgetId === tx.budgetId);
    const conflictingBudget = Boolean(alert.budgetId && tx.budgetId && alert.budgetId !== tx.budgetId);
    if (conflictingBudget) continue;

    const similarMerchant = merchantsLookSimilar(tx.title || '', alert.title || '');
    const notesMentionMatch = Boolean(
      (alert.cardNumber && (tx.notes || '').includes(alert.cardNumber)) ||
      (tx.notes && merchantsLookSimilar(tx.notes, alert.title || ''))
    );

    const amountDiff = Math.abs(txAmt - alertAmt);
    const exactOrCloseAmount = amountDiff <= Math.max(0.05, alertAmt * 0.01);
    const tipOrHoldAmount = amountDiff <= Math.max(1.0, alertAmt * 0.15);

    // USD email vs DOP (RD$) registered transaction check (50x..68x FX range)
    const fxRatio = txAmt > alertAmt ? txAmt / alertAmt : alertAmt / txAmt;
    const isUsdToDopMatch =
      (alert.currency === 'USD' || alert.currency === '$') &&
      fxRatio >= 50 &&
      fxRatio <= 68 &&
      similarMerchant;

    let score = 0;
    if (exactOrCloseAmount) {
      if (similarMerchant || notesMentionMatch) {
        score = 100 - dayDiff * 5 + (sameBudget ? 10 : 0);
      } else if (dayDiff === 0) {
        // Same calendar day + exact amount even if user wrote a custom description
        score = 80 + (sameBudget ? 10 : 0);
      } else if (sameBudget && dayDiff <= 2) {
        // Same account/card + exact amount within 2-day posting window
        score = 70 - dayDiff * 5;
      }
    } else if (tipOrHoldAmount && similarMerchant && (dayDiff <= 2 || sameBudget)) {
      score = 65 - dayDiff * 5;
    } else if (isUsdToDopMatch) {
      score = 60 - dayDiff * 5 + (sameBudget ? 10 : 0);
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { tx, score };
    }
  }

  return bestMatch?.tx;
}
