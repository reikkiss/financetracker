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
  contextSnippet: string;
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

interface BankRule {
  name: string;
  senderPatterns: RegExp[];
  subjectPatterns: RegExp[];
  bodyPatterns: RegExp[];
}

const BANK_RULES: BankRule[] = [
  {
    name: 'Banreservas',
    senderPatterns: [/banreservas\.com/i, /notificacionestubancoapp@banreservas\.com/i, /\bbanreservas\b/i, /\breservas\b/i],
    subjectPatterns: [/\bbanreservas\b/i],
    bodyPatterns: [/\bbanreservas\b/i, /banreservas\.com/i, /\bbanco de reservas\b/i]
  },
  {
    name: 'Banco Popular',
    senderPatterns: [/bpd\.com\.do/i, /popularenlinea/i, /notificaciones@popularenlinea\.com/i, /\bbanco\s+popular\b/i, /\bpopular\b/i],
    subjectPatterns: [/\bbanco\s+popular\b/i, /\bpopularenlinea\b/i, /\bbpd\b/i],
    bodyPatterns: [/\bbanco\s+popular(?:\s+dominicano)?\b/i, /\bpopularenlinea(?:\.com)?\b/i, /\bbpd\.com\.do\b/i]
  },
  {
    name: 'Banco BHD',
    senderPatterns: [/bhd\.com\.do/i, /alertas@bhd\.com\.do/i, /bhdleon/i, /\bbhd\b/i],
    subjectPatterns: [/\bbanco\s+bhd\b/i, /\bbhd\s*le[oó]n\b/i, /\bbhd\b/i],
    bodyPatterns: [/\bbanco\s+bhd(?:\s*le[oó]n)?\b/i, /\bbhd\.com\.do\b/i, /\bbhdleon\b/i]
  },
  {
    name: 'Qik Banco Digital',
    senderPatterns: [/qik\.do/i, /notificaciones@qik\.do/i, /qik\.com\.do/i, /\bqik\b/i],
    subjectPatterns: [/\bqik\b/i],
    bodyPatterns: [/\bqik\s+banco\s+digital\b/i, /\bqik\.(?:com\.)?do\b/i, /\bapp\s+qik\b/i]
  },
  {
    name: 'Azul',
    senderPatterns: [/azul\.com\.do/i, /notificaciones@azul\.com\.do/i, /\bazul\b/i],
    subjectPatterns: [/\bazul\b/i],
    bodyPatterns: [/\bazul\b/i, /azul\.com\.do/i]
  },
  {
    name: 'Banco Santa Cruz',
    senderPatterns: [/bsc\.com\.do/i, /santa\s+cruz/i],
    subjectPatterns: [/\bbanco\s+santa\s+cruz\b/i, /\bsanta\s+cruz\b/i, /\bbsc\b/i],
    bodyPatterns: [/\bbanco\s+santa\s+cruz\b/i, /\bbsc\.com\.do\b/i]
  },
  {
    name: 'Scotiabank',
    senderPatterns: [/scotiabank/i, /\bscotia\b/i],
    subjectPatterns: [/\bscotiabank\b/i],
    bodyPatterns: [/\bscotiabank\b/i]
  },
  {
    name: 'Banco Promerica',
    senderPatterns: [/promerica/i],
    subjectPatterns: [/\bpromerica\b/i],
    bodyPatterns: [/\bbanco\s+promerica\b/i, /\bpromerica\.com\.do\b/i]
  },
  {
    name: 'APAP',
    senderPatterns: [/apap\.com\.do/i, /\bapap\b/i, /asociaci[oó]n\s+popular/i],
    subjectPatterns: [/\bapap\b/i, /asociaci[oó]n\s+popular/i],
    bodyPatterns: [/\bapap\b/i, /apap\.com\.do/i, /asociaci[oó]n\s+popular\s+de\s+ahorros/i]
  },
  {
    name: 'Banesco',
    senderPatterns: [/banesco/i],
    subjectPatterns: [/\bbanesco\b/i],
    bodyPatterns: [/\bbanesco\b/i]
  },
  {
    name: 'Banco Lafise',
    senderPatterns: [/lafise/i],
    subjectPatterns: [/\blafise\b/i],
    bodyPatterns: [/\bbanco\s+lafise\b/i, /\blafise\.com\b/i]
  },
  {
    name: 'Banco Vimenca',
    senderPatterns: [/vimenca/i],
    subjectPatterns: [/\bvimenca\b/i],
    bodyPatterns: [/\bbanco\s+vimenca\b/i, /\bvimenca\.com\b/i]
  },
  {
    name: 'Banco Caribe',
    senderPatterns: [/bancocaribe/i, /banco\s+caribe/i],
    subjectPatterns: [/\bbanco\s+caribe\b/i],
    bodyPatterns: [/\bbanco\s+caribe\b/i, /bancocaribe\.com\.do/i]
  },
  {
    name: 'Banco BDI',
    senderPatterns: [/bdi\.com\.do/i, /banco\s+bdi/i],
    subjectPatterns: [/\bbanco\s+bdi\b/i],
    bodyPatterns: [/\bbanco\s+bdi\b/i, /bdi\.com\.do/i]
  },
  {
    name: 'Banco López de Haro',
    senderPatterns: [/blh\.com\.do/i, /l[oó]pez\s+de\s+haro/i],
    subjectPatterns: [/\bl[oó]pez\s+de\s+haro\b/i],
    bodyPatterns: [/\bbanco\s+l[oó]pez\s+de\s+haro\b/i, /blh\.com\.do/i]
  },
  {
    name: 'Banco Adopem',
    senderPatterns: [/adopem/i],
    subjectPatterns: [/\badopem\b/i],
    bodyPatterns: [/\bbanco\s+adopem\b/i, /adopem\.com\.do/i]
  },
  {
    name: 'PayPal',
    senderPatterns: [/paypal\.com/i, /\bpaypal\b/i],
    subjectPatterns: [/\bpaypal\b/i],
    bodyPatterns: [/\bpaypal\b/i]
  },
  {
    name: 'Apple Card',
    senderPatterns: [/applecard/i, /goldmansachs.*apple/i],
    subjectPatterns: [/\bapple\s+card\b/i],
    bodyPatterns: [/\bapple\s+card\b/i]
  },
  {
    name: 'American Express',
    senderPatterns: [/americanexpress\.com/i, /\bamex\b/i],
    subjectPatterns: [/\bamerican\s+express\b/i, /\bamex\b/i],
    bodyPatterns: [/\bamerican\s+express\b/i]
  },
  {
    name: 'Chase',
    senderPatterns: [/chase\.com/i],
    subjectPatterns: [/\bchase\b/i],
    bodyPatterns: [/\bjpmorgan\s+chase\b/i, /\bchase\s+card\b/i]
  },
  {
    name: 'Capital One',
    senderPatterns: [/capitalone\.com/i],
    subjectPatterns: [/\bcapital\s+one\b/i],
    bodyPatterns: [/\bcapital\s+one\b/i]
  },
  {
    name: 'Citibank',
    senderPatterns: [/citi\.com/i, /citibank/i],
    subjectPatterns: [/\bcitibank\b/i],
    bodyPatterns: [/\bcitibank\b/i]
  },
  {
    name: 'Bank of America',
    senderPatterns: [/bankofamerica\.com/i],
    subjectPatterns: [/\bbank\s+of\s+america\b/i],
    bodyPatterns: [/\bbank\s+of\s+america\b/i]
  },
  {
    name: 'Wise',
    senderPatterns: [/wise\.com/i, /transferwise\.com/i],
    subjectPatterns: [/\bwise\b/i],
    bodyPatterns: [/\bwise\s+(?:card|transfer|account)\b/i]
  }
];

function detectBankName(rawSender: string, rawSubject: string, cleanedBody: string): string {
  // Tier 1: Sender address & display name (most authoritative — avoids body cross-mentions)
  if (rawSender) {
    for (const rule of BANK_RULES) {
      if (rule.senderPatterns.some(p => p.test(rawSender))) {
        return rule.name;
      }
    }
  }

  // Tier 2: Subject line
  if (rawSubject) {
    for (const rule of BANK_RULES) {
      if (rule.subjectPatterns.some(p => p.test(rawSubject))) {
        return rule.name;
      }
    }
  }

  // Tier 3: Top of body first (header/branding), then full body with strict unambiguous patterns
  const topBody = cleanedBody.slice(0, 1200);
  for (const rule of BANK_RULES) {
    if (rule.bodyPatterns.some(p => p.test(topBody))) {
      return rule.name;
    }
  }
  for (const rule of BANK_RULES) {
    if (rule.bodyPatterns.some(p => p.test(cleanedBody))) {
      return rule.name;
    }
  }

  return '';
}

// Explicit executed/attempted transaction confirmation phrases (no generic "tarjeta de crédito" or "notificación" alone)
const EXECUTED_TRANSACTION_PHRASES = [
  'consumo realizado',
  'consumo aprobado',
  'consumo efectuado',
  'consumo declinado',
  'consumo rechazado',
  'consumo con tarjeta',
  'consumo en',
  'notificación de consumo',
  'notificacion de consumo',
  'notificación de transacción',
  'notificacion de transaccion',
  'alerta de consumo',
  'alerta de transacción',
  'alerta de transaccion',
  'aviso de consumo',
  'aviso de transacción',
  'aviso de transaccion',
  'compra aprobada',
  'compra realizada',
  'compra efectuada',
  'compra declinada',
  'compra rechazada',
  'compraste',
  'gastaste',
  'pagaste',
  'pago realizado',
  'pago recibido',
  'pago al instante',
  'pago procesado',
  'pago aprobado',
  'pago declinado',
  'pago rechazado',
  'comprobante de pago',
  'comprobante de transferencia',
  'transferencia realizada',
  'transferencia enviada',
  'transferencia recibida',
  'transferencia aprobada',
  'transferencia exitosa',
  'transferencia completada',
  'transferencia ach',
  'transferencia lbtr',
  'retiro realizado',
  'retiro en cajero',
  'retiro de efectivo',
  'depósito realizado',
  'deposito realizado',
  'depósito recibido',
  'deposito recibido',
  'crédito recibido',
  'credito recibido',
  'abono recibido',
  'cargo realizado',
  'cargo a su tarjeta',
  'cargo a tu tarjeta',
  'cargo a su cuenta',
  'débito realizado',
  'debito realizado',
  'transacción aprobada',
  'transaccion aprobada',
  'transacción realizada',
  'transaccion realizada',
  'transacción declinada',
  'transaccion declinada',
  'transacción rechazada',
  'transaccion rechazada',
  'transacción reversada',
  'transaccion reversada',
  'reverso de consumo',
  'reverso de transacción',
  'reembolso procesado',
  'purchase alert',
  'transaction alert',
  'card purchase',
  'payment sent',
  'payment received',
  'you spent',
  'you paid',
  'charge was declined',
  'transaction was declined'
];

const PROMO_SUBJECT_REGEX =
  /\b(?:aprovecha|descuento|cashback|rebaja|ahorra\s+hasta|gana\s+(?:hasta|doble|triple)|sorteo|concurso|premio|feria|black\s+friday|cyber\s+monday|cyberweek|promoci[oó]n|promo\b|oferta\s+(?:especial|exclusiva|de)|preaprobado|pre-aprobado|solicita\s+(?:tu|la|hoy)|aumenta\s+tu\s+l[ií]mite|cuotas?\s+sin\s+inter[eé]s|meses\s+sin\s+inter[eé]s|millas?\s+(?:extra|dobles|popular)|puntos?\s+(?:extra|dobles|triples)|nuevo\s+producto|invierte\s+en|abre\s+tu\s+cuenta|beneficios?\s+exclusivos?|disfruta\s+de\s+(?:un|hasta)|fin\s+de\s+semana\s+de|temporada\s+de|tasas?\s+especiales?|tasa\s+fija)\b/i;

const PROMO_PERCENT_REGEX =
  /(?:\bhasta\s+(?:un\s+)?\d{1,2}\s*%|\b\d{1,2}\s*%\s*(?:de\s+)?(?:descuento|cashback|devoluci[oó]n|bonificaci[oó]n|off|menos)\b)/i;

const OTP_OR_SECURITY_REGEX =
  /\b(?:c[oó]digo\s+de\s+(?:verificaci[oó]n|seguridad|acceso|confirmaci[oó]n)|c[oó]digo\s+otp|\botp\b|clave\s+din[aá]mica|token\s+digital|verification\s+code|security\s+code|one[- ]time\s+password|inicio\s+de\s+sesi[oó]n\s+exitoso|nuevo\s+inicio\s+de\s+sesi[oó]n|cambio\s+de\s+(?:clave|contrase[nñ]a)|recuperaci[oó]n\s+de\s+clave|actualizaci[oó]n\s+de\s+datos)\b/i;

const STATEMENT_OR_REMINDER_REGEX =
  /\b(?:tu\s+estado\s+de\s+cuenta\s+(?:est[aá]\s+disponible|ya\s+(?:est[aá]|lleg[oó]))|estado\s+de\s+cuenta\s+(?:disponible|mensual)|resumen\s+de\s+(?:tu\s+)?estado\s+de\s+cuenta|recordatorio\s+de\s+pago|pr[oó]ximo\s+vencimiento|fecha\s+l[ií]mite\s+de\s+pago|pago\s+m[ií]nimo\s+requerido|evita\s+recargos\s+pagando)\b/i;

const PROMO_BODY_REGEX =
  /\b(?:aprovecha(?:\s+esta|\s+el|\s+los|\s+hoy)?|cashback\s+de|devoluci[oó]n\s+de\s+hasta|descuento\s+(?:en|del|de\s+hasta)|preaprobado|pre-aprobado|solicita\s+(?:tu|la)\s+(?:tarjeta|pr[eé]stamo)|aumenta\s+tu\s+l[ií]mite|sorteo|concurso|feria\s+de|black\s+friday|cyber\s+monday|cuotas?\s+sin\s+inter[eé]s|meses\s+sin\s+inter[eé]s|beneficios?\s+exclusivos?|ver\s+t[eé]rminos\s+y\s+condiciones|aplican\s+restricciones|desuscr[ií]bete|darse\s+de\s+baja|cancelar\s+suscripci[oó]n|\bunsubscribe\b|ver\s+en\s+(?:tu\s+)?navegador)\b/i;

function hasStructuredReceiptFields(text: string): boolean {
  const hasAmountField = /\b(?:monto|importe|valor\s+de\s+transacci[oó]n|amount)\s*:/i.test(text);
  const hasContextField =
    /\b(?:comercio|establecimiento|localidad|beneficiario|autorizaci[oó]n|referencia|no\.?\s*referencia|tarjeta|producto)\s*:/i.test(
      text
    );
  return hasAmountField && hasContextField;
}

function hasExecutedTransactionSignal(rawSubject: string, cleanedBody: string): boolean {
  const combinedLower = `${rawSubject}\n${cleanedBody}`.toLowerCase();
  if (EXECUTED_TRANSACTION_PHRASES.some(phrase => combinedLower.includes(phrase))) {
    return true;
  }
  // Narrative verbs like "se ha realizado un consumo/compra/pago/transferencia/cargo/retiro/depósito"
  if (
    /\b(?:se\s+(?:ha\s+)?(?:realizado|efectuado|registrado|procesado|aprobado|debitado|acreditado|declinado|rechazado|reversado|anulado)|acabamos\s+de\s+procesar|realizaste)\b[^\n]{0,60}\b(?:consumo|compra|pago|transacci[oó]n|cargo|transferencia|retiro|dep[oó]sito|abono|reverso)\b/i.test(
      combinedLower
    )
  ) {
    return true;
  }
  if (hasStructuredReceiptFields(cleanedBody)) {
    return true;
  }
  return false;
}

function isPromotionalOrNonTransactionEmail(rawSubject: string, cleanedBody: string, rawSender: string = ''): boolean {
  const subject = (rawSubject || '').trim();
  const topBody = (cleanedBody || '').slice(0, 1200);
  const structured = hasStructuredReceiptFields(cleanedBody);
  const hasExecSignal = hasExecutedTransactionSignal(subject, cleanedBody);
  const isKnownBankSender = /qik\.do|bhd\.com\.do|popularenlinea\.com|azul\.com\.do|banreservas\.com|bpd\.com\.do|scotiabank|promerica|apap|banesco|lafise|bancocaribe|vimenca|bdi\.com\.do|blh\.com\.do|paypal\.com/i.test(rawSender);

  // 1. Subject explicitly reveals promo / OTP / statement reminder
  if (PROMO_SUBJECT_REGEX.test(subject) || PROMO_PERCENT_REGEX.test(subject)) {
    if (!isKnownBankSender) return true;
  }
  if (OTP_OR_SECURITY_REGEX.test(subject)) {
    return true;
  }
  if (STATEMENT_OR_REMINDER_REGEX.test(subject) && !structured) {
    if (!isKnownBankSender) return true;
  }

  // 2. OTP or statement-only email in body without executed transaction confirmation
  if (OTP_OR_SECURITY_REGEX.test(topBody.slice(0, 600)) && !structured) {
    return true;
  }
  if (STATEMENT_OR_REMINDER_REGEX.test(topBody) && !hasExecSignal) {
    if (!isKnownBankSender) return true;
  }

  // If it's a known bank sender and has a monetary amount, treat as valid transaction alert
  if (isKnownBankSender && (/(?:rd\$|us\$|\$|dop|usd)\s*[0-9]/i.test(cleanedBody) || hasExecSignal)) {
    return false;
  }

  // 3. Marketing / promo campaigns in top body unless clearly overridden by a real structured transaction alert
  if ((PROMO_BODY_REGEX.test(topBody) || PROMO_PERCENT_REGEX.test(topBody)) && !structured) {
    const top400 = topBody.slice(0, 400).toLowerCase();
    const strongHeaderTx =
      EXECUTED_TRANSACTION_PHRASES.some(p => subject.toLowerCase().includes(p) || top400.includes(p));
    if (!strongHeaderTx && !isKnownBankSender) {
      return true;
    }
  }

  // 4. Final requirement: must prove a real transaction occurred or be from a known bank sender with an amount
  if (isKnownBankSender && /(?:rd\$|us\$|\$|dop|usd)\s*[0-9]/i.test(cleanedBody)) {
    return false;
  }

  return !hasExecSignal;
}

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
    'tarjeta', 'cuenta', 'consumo', 'compra', 'pago', 'transaccion', 'transacción', 'autorizacion', 'autorización',
    'aprobada', 'aprobado', 'declinada', 'declinado', 'rechazada', 'rechazado', 'notificacion', 'notificación'
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
  if (
    noisePhrases.some(
      np => lowerC === np || lowerC.startsWith(`${np} `) || lowerC.includes('su tarjeta') || lowerC.includes('tu tarjeta')
    )
  ) {
    return true;
  }

  // Reject if candidate simply repeats the email notification subject (e.g. "Notificación de Consumo")
  const normSubj = rawSubject.trim().toLowerCase();
  if (normSubj && (lowerC === normSubj || (lowerC.length > 10 && normSubj.startsWith(lowerC)))) {
    if (/(?:notificaci[oó]n|alerta|aviso|comprobante|informaci[oó]n|alerta\s+de|aviso\s+de)/i.test(lowerC)) {
      return true;
    }
  }

  return false;
}

function cleanMerchantCandidate(raw: string): string {
  let s = raw
    // Trim trailing clause connectors (Spanish & English)
    .split(
      /\s+(?:por(?:\s+(?:un|el)\s+monto|\s+valor|\s+rd\$|\s+us\$|\s+\$|\s+dop|\s+usd)?|for(?:\s+(?:the\s+amount\s+of|rd\$|us\$|\$|dop|usd|[0-9]))|el\s+d[ií]a|en\s+fecha|on\s+\d{2,4}|fecha\b|hora\b|monto\b|importe\b|valor\b|con\s+(?:su|tu|la)\s+tarjeta|with\s+(?:your\s+)?card|con\s+tarjeta|tarjeta\b|terminad[ao]\b|rd\$|us\$|dop\b|usd\b|\$[0-9])/i
    )[0]
    .trim();

  // Strip leading article/noun wrappers like "el establecimiento " or "el comercio "
  s = s.replace(/^(?:el\s+establecimiento|el\s+comercio|la\s+tienda|el\s+negocio|el\s+local)\s+/i, '').trim();

  // Strip leading/trailing punctuation junk
  s = s.replace(/^[:\-\|•\s]+|[:\-\|•,;\.\s]+$/g, '').trim();

  // Truncate if two table columns got joined by 2+ spaces with a trailing label word
  s = s.replace(/\s{2,}(?:monto|fecha|hora|tarjeta|cuenta|moneda|estado|autorizaci[oó]n).*$/i, '').trim();

  return s;
}

const UPPERCASE_ACRONYMS = new Set([
  'BHD', 'APAP', 'ATM', 'KFC', 'VIP', 'SRL', 'EIRL', 'SA', 'RD', 'DR', 'US', 'USA',
  'TV', 'HD', 'LBTR', 'ACH', 'POS', 'BPD', 'BSC', 'BDI', 'BLH', 'DHL', 'UPS', 'IKEA', 'BBQ'
]);

const LOWERCASE_CONNECTORS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'al', 'por', 'con', 'para',
  'of', 'the', 'and', 'at', 'by', 'for', 'in', 'on', 'to'
]);

const CANONICAL_BRAND_CASING: Record<string, string> = {
  pedidosya: 'PedidosYa',
  pricesmart: 'PriceSmart',
  mcdonald: "McDonald's",
  "mcdonald's": "McDonald's",
  mcdonalds: "McDonald's",
  chatgpt: 'ChatGPT',
  openai: 'OpenAI',
  youtube: 'YouTube',
  icloud: 'iCloud',
  paypal: 'PayPal',
  iphone: 'iPhone',
  itunes: 'iTunes',
  ebay: 'eBay',
  airbnb: 'Airbnb',
  banreservas: 'Banreservas',
  scotiabank: 'Scotiabank',
  promerica: 'Promerica',
  banesco: 'Banesco',
  popularenlinea: 'Popular en Línea'
};

function toCleanTitleCase(input: string): string {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  return tokens
    .map((token, idx) => {
      const stripped = token.replace(/^[^A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü]+|[^A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü]+$/g, '');
      const upper = stripped.toUpperCase();
      const lower = stripped.toLowerCase();

      if (CANONICAL_BRAND_CASING[lower]) {
        return CANONICAL_BRAND_CASING[lower];
      }
      if (UPPERCASE_ACRONYMS.has(upper)) {
        return upper;
      }
      if (idx > 0 && LOWERCASE_CONNECTORS.has(lower)) {
        return lower;
      }
      // Preserve intentional camelCase / mixed case if input wasn't all-caps or all-lowercase
      const isAllUpper = token === token.toUpperCase();
      const isAllLower = token === token.toLowerCase();
      if (!isAllUpper && !isAllLower) {
        return token;
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ');
}

export function refineMerchantName(rawTitle: string): string {
  let s = (rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // 1. Canonicalize common payment processor / marketplace descriptors first
  if (/^(?:uber\s*\*?\s*(?:uber\s+)?eats|ubereats)\b/i.test(s)) {
    return 'Uber Eats';
  }
  if (/^uber\s*\*?\s*(?:trip|viaje)?\b/i.test(s)) {
    return /\btrip\b|\bviaje\b/i.test(s) ? 'Uber Trip' : 'Uber';
  }
  if (/^(?:amzn\s*mktp|amazon(?:\.com)?)\b/i.test(s)) {
    return 'Amazon';
  }
  if (/^apple\.com\/bill\b/i.test(s)) {
    return 'Apple';
  }
  if (/^google\s*\*\s*(.+)/i.test(s)) {
    const rest = s.replace(/^google\s*\*\s*/i, '').trim();
    if (/youtube/i.test(rest)) return 'YouTube';
    if (/one|drive|storage/i.test(rest)) return 'Google One';
    if (/play/i.test(rest)) return 'Google Play';
    return rest ? `Google ${toCleanTitleCase(rest.split(/\s+\d/)[0])}` : 'Google';
  }
  if (/^netflix(?:\.com)?\b/i.test(s)) {
    return 'Netflix';
  }
  if (/^spotify\b/i.test(s)) {
    return 'Spotify';
  }

  const pyMatch = s.match(/^(?:py\s*\*|pedidos\s*ya\s*\*|dlo\s*\*pedidos\s*ya)\s*(.*)$/i);
  if (pyMatch) {
    const tail = (pyMatch[1] || '')
      .replace(/^pedidos\s*ya\b[\*\-\s]*/i, '')
      .replace(/(?:^|\s+)(?:santo\s+domingo(?:\s+(?:este|oeste|norte|dn))?|distrito\s+nacional|dist\.?\s*nacional|rep\.?\s*dom\.?|do|rd)\b.*$/i, '')
      .trim();
    if (!tail || /^(?:propina|delivery|envio|envío)$/i.test(tail)) {
      return tail ? `PedidosYa ${toCleanTitleCase(tail)}` : 'PedidosYa';
    }
    return `PedidosYa - ${toCleanTitleCase(tail)}`;
  }

  const paypalMatch = s.match(/^paypal\s*\*\s*(.+)$/i);
  if (paypalMatch && paypalMatch[1]) {
    s = paypalMatch[1].trim();
  }

  // Strip raw gateway / card-acquirer prefixes (Cardnet, Azul, Square, Toast, dLocal, etc.)
  s = s.replace(/^(?:sq\s*\*|tst\s*\*|sp\s+|dlo\s*\*|pag\s*\*|cardnet\s*\*|azul\s*\*|visanet\s*\*|mp\s*\*|merpago\s*\*)\s*/i, '').trim();

  // 2. Strip trailing store/terminal IDs, URLs, and Dominican/US city/country tags iteratively from end
  s = s.replace(/\s+(?:help\.uber\.com|amzn\.com\/bill|g\.co\/helppay#?)\b.*$/i, '').trim();
  s = s.replace(/\s*\*+[A-Z0-9]{4,}$/i, '').trim();
  s = s.replace(/\s+#?\d{4,}$/, '').trim();

  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s
      .replace(
        /,?\s+(?:santo\s+domingo(?:\s+(?:este|oeste|norte|dn))?|distrito\s+nacional|dist\.?\s*nacional|d\.n\.|rep\.?\s*dom\.?|rep[uú]blica\s+dominicana|santiago(?:\s+de\s+los\s+caballeros)?|punta\s+cana|b[aá]varo|la\s+romana|san\s+crist[oó]bal|puerto\s+plata|la\s+vega|hig[uü]ey|do|rd|usa?|ca)\.?$/i,
        ''
      )
      .replace(/,?\s+\b(?:s\.?r\.?l\.?|e\.?i\.?r\.?l\.?|s\.?a\.?|inc\.?|llc\.?)\.?$/i, '')
      .replace(/[\*\-\/,;:\s]+$/, '')
      .trim();
  }

  // Collapse leftover asterisks inside names into clean spaces
  s = s.replace(/\s*\*+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();

  if (!s) return rawTitle.trim();
  return toCleanTitleCase(s);
}

function extractMerchantFromText(text: string, rawSubject: string): string {
  if (!text) return '';

  // Priority 1: Explicit Field / Table Labels (same line, ": ", "  ", OR next line)
  const labelNames =
    '(?:nombre\\s+del\\s+comercio|localidad\\s*\\/\\s*comercio|comercio\\s*\\/\\s*descripci[oó]n|lugar\\s+de\\s+consumo|comercio|establecimiento|localidad|negocio|afiliado|merchant|store|tienda|beneficiario|nombre\\s+del\\s+beneficiario|destinatario|remitente|descripci[oó]n|descripcion|concepto)';

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

  // Priority 2: Sentence Patterns (Spanish & English: "...en MERCHANT por..." or "...at MERCHANT for...")
  const sentencePatterns = [
    /(?:compraste|gastaste|pagaste|consumiste|consumo|compra|transacci[oó]n|transaccion|pago|cargo|autorizaci[oó]n|autorizacion)[^\n\r]{0,140}?\ben\s+(?:el\s+(?:comercio|establecimiento)\s+)?(?!su\s+tarjeta|tu\s+tarjeta|la\s+tarjeta|su\s+cuenta|tu\s+cuenta|\d{4}\b)([A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/][A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/\s]{1,55})/gi,
    /(?:purchase(?:\s+alert)?|transaction(?:\s+alert)?|spent|paid|charged?|authorization|payment)[^\n\r]{0,140}?\bat\s+(?!your\s+card|card\s+\*|\d{4}\b)([A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/][A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/\s]{1,55})/gi,
    /(?:consumo\s+en|compra\s+en|pago\s+en|pago\s+a|realizado\s+en|realizada\s+en|aprobado\s+en|aprobada\s+en|efectuado\s+en|efectuada\s+en|transacci[oó]n\s+en|transaccion\s+en|transferencia\s+(?:a|hacia|para)|enviado\s+a|recibido\s+de)\s+(?!su\s+tarjeta|tu\s+tarjeta|la\s+tarjeta|su\s+cuenta|tu\s+cuenta|\d{4}\b)([A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/][A-Za-z0-9ÁÉÍÓÚáéíóúÑñÜü\*\.\-\&\'\/\s]{1,55})/gi,
    /(?<!terminad[ao]\s)(?<!finaliza\s)\b(?:en|at)\s+([A-Z0-9][A-Z0-9\*\.\-\&\'\/\s]{2,45})(?=\s+(?:por|for|el\s+d[ií]a|el\s+\d|on\s+\d|con\s+(?:su|tu)|rd\$|us\$|dop|usd|\$)|[,\r\n])/g
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

function buildContextSnippet(
  cleanedBody: string,
  rawSubject: string,
  meta: {
    bankName: string;
    cardNumber?: string;
    outcomeLabel: string;
  }
): string {
  const boilerplateLine =
    /^(?:estimad[oa]|apreciad[oa]|hola\b|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|recib[ae]\s+un\s+cordial|atentamente|saludos|si\s+no\s+reconoces|si\s+desconoces|comun[ií]cate|centro\s+de\s+contacto|nunca\s+(?:te\s+)?(?:pediremos|compartas)|este\s+correo\s+(?:es\s+informativo|fue\s+generado)|aviso\s+legal|confidencial|todos\s+los\s+derechos|copyright|©|http|www\.|desuscribir|unsubscribe|ver\s+en\s+navegador)/i;

  const lines = cleanedBody
    .split('\n')
    .map(l => l.replace(/\s{2,}/g, ' • ').trim())
    .filter(l => l.length >= 12 && !boilerplateLine.test(l) && !/https?:\/\/|www\./i.test(l));

  // Extract structured fields if present (Concepto / Descripción / Referencia / Autorización)
  const conceptMatch = cleanedBody.match(/(?:^|\n)\s*(?:concepto|descripci[oó]n|descripcion|motivo|detalle)(?:\s*:\s*|\s{2,})([^\n\r]{3,75})/i);
  const authMatch = cleanedBody.match(/(?:autorizaci[oó]n|referencia|no\.?\s*referencia)(?:\s*:\s*|\s{2,}|#\s*)([A-Z0-9\-]{4,20})/i);

  // Look for a rich single narrative sentence describing the transaction
  const txSentenceRegex =
    /(?:consumo|compra|compraste|transacci[oó]n|transferencia|pago|retiro|dep[oó]sito|cargo|reverso|reembolso|declinad|rechazad|aprobada|purchase|charged|declined|reversed)/i;

  const bestNarrativeLine = lines.find(
    l =>
      l.length >= 25 &&
      l.length <= 220 &&
      txSentenceRegex.test(l) &&
      (/(?:rd\$|us\$|dop|usd|\$\s*\d)/i.test(l) || /\*{1,4}\d{4}/.test(l) || /terminad[ao]\s+en\s+\d{4}/i.test(l))
  );

  const parts: string[] = [];
  if (conceptMatch && conceptMatch[1]) {
    const cleanConcept = conceptMatch[1].trim();
    if (!isNoiseMerchant(cleanConcept, rawSubject)) {
      parts.push(cleanConcept);
    }
  }

  let baseSnippet = '';
  if (bestNarrativeLine) {
    baseSnippet = bestNarrativeLine.replace(/^[\-\•\*:\s]+/, '').trim();
    if (parts.length > 0 && !baseSnippet.toLowerCase().includes(parts[0].toLowerCase())) {
      baseSnippet = `${baseSnippet} (${parts[0]})`;
    }
  } else {
    const fallbackParts: string[] = [];
    if (rawSubject && !/^(?:notificaci[oó]n|alerta|aviso)$/i.test(rawSubject.trim())) {
      fallbackParts.push(rawSubject.trim());
    }
    if (parts[0]) fallbackParts.push(`Concepto: ${parts[0]}`);
    if (meta.cardNumber) fallbackParts.push(`Card *${meta.cardNumber}`);
    if (authMatch?.[1]) fallbackParts.push(`Ref ${authMatch[1].trim()}`);
    if (fallbackParts.length === 0 && lines.length > 0) {
      fallbackParts.push(lines.slice(0, 2).join(' • '));
    }
    baseSnippet = fallbackParts.join(' • ');
  }

  if (!baseSnippet) {
    baseSnippet = `${meta.bankName} ${meta.outcomeLabel}${meta.cardNumber ? ` • Card *${meta.cardNumber}` : ''}`;
  }

  if (baseSnippet.length > 155) {
    const sliced = baseSnippet.slice(0, 152);
    const lastSpace = sliced.lastIndexOf(' ');
    return `${(lastSpace > 90 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
  }
  return baseSnippet;
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
    lowerM.includes('uber trip') ||
    lowerM === 'uber' ||
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
    lowerM.includes('uber eats') ||
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
    lowerM.includes('youtube') ||
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
 * Strictly filters out marketing promotions, OTP verification codes, and statement-only reminders.
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

  // 1. Strict gate: Reject promotional offers, marketing newsletters, OTPs & statement reminders
  if (isPromotionalOrNonTransactionEmail(rawSubject, cleanedBody, rawSender)) {
    return null;
  }

  const lower = combined.toLowerCase();

  // 2. Detect Bank Name prioritizing Sender -> Subject -> Strict Body Matches
  let bankName = detectBankName(rawSender, rawSubject, cleanedBody);
  const hasExplicitCurrency = /(?:rd\$|us\$|dop|usd)/i.test(combined);

  if (!bankName && !hasExplicitCurrency) {
    return null;
  }
  if (!bankName) {
    bankName = 'Bank Alert';
  }

  // 3. Detect Currency
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

  // 4. Extract Amount (prioritize explicitly currency-tagged or keyword-tagged amounts)
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

  // 5. Detect Card / Account Last 4 Digits
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

  // 6. Detect Date (DD/MM/YYYY, YYYY-MM-DD, DD-MMM-YYYY)
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

  // 7. Detect Email Transaction Outcome (Declined / Reversed / Went Through)
  function detectOutcome(textToCheck: string): {
    emailOutcome: EmailTransactionOutcome;
    outcomeLabel: 'Went Through' | 'Declined' | 'Reversed';
  } {
    const declinedPattern =
      /(?:\bno\s+(?:fue\s+|ha\s+sido\s+|pudo\s+ser\s+)?(?:aprobada|aprobado|procesada|procesado|completada|completado|autorizada|autorizado)|declinad[ao]|rechazad[ao]|denegad[ao]|fallid[ao]|fondos\s+insuficientes|saldo\s+insuficiente|l[ií]mite\s+excedido|tarjeta\s+bloqueada|pin\s+incorrecto|\bdeclined\b|\brejected\b|\bdenied\b|\bunsuccessful\b|\bfailed\s+(?:transaction|payment|charge)|insufficient\s+funds)/i;
    if (declinedPattern.test(textToCheck)) {
      return { emailOutcome: 'declined', outcomeLabel: 'Declined' };
    }

    const reversedPattern =
      /(?:reversad[ao]|\breverso\b|reembols[ao]|reembolsad[ao]|devoluci[oó]n|anulad[ao]|anulaci[oó]n|\bextorno\b|(?:transacci[oó]n|compra|consumo|cargo|pago)\s+cancelad[ao]|\breversed\b|\breversal\b|\brefunded\b|\brefund\b|\bvoided\b|\bchargeback\b)/i;
    if (reversedPattern.test(textToCheck)) {
      return { emailOutcome: 'reversed', outcomeLabel: 'Reversed' };
    }

    return { emailOutcome: 'approved', outcomeLabel: 'Went Through' };
  }

  const { emailOutcome, outcomeLabel } = detectOutcome(`${rawSubject}\n${cleanedBody}`);

  // 8. Detect Type, Refined Merchant Title & Category
  let title = `${bankName} Purchase`;
  let category = 'Shopping';
  let type: 'expense' | 'income' | 'transfer' = 'expense';

  const rawDetectedMerchant =
    extractMerchantFromText(cleanedBody, rawSubject) ||
    extractMerchantFromText(rawSubject, rawSubject);
  const refinedMerchant = rawDetectedMerchant ? refineMerchantName(rawDetectedMerchant) : '';

  const isAtmWithdrawal = /\b(?:retiro\s+(?:en\s+)?(?:cajero|atm|efectivo)|cash\s+withdrawal|atm\s+withdrawal)\b/i.test(lower);
  const isOutgoingTransfer =
    lower.includes('transferencia enviada') ||
    lower.includes('transferencia saliente') ||
    lower.includes('transferencia realizada') ||
    lower.includes('pago al instante') ||
    lower.includes('transferencia entre cuentas') ||
    lower.includes('transferencia ach') ||
    lower.includes('transferencia lbtr');
  const isIncomingDeposit =
    lower.includes('deposito') ||
    lower.includes('depósito') ||
    lower.includes('credito recibido') ||
    lower.includes('crédito recibido') ||
    lower.includes('transferencia recibida') ||
    lower.includes('abono recibido') ||
    lower.includes('nómina') ||
    lower.includes('nomina') ||
    lower.includes('payment received');

  if (emailOutcome === 'reversed') {
    type = 'income';
    category = 'Refund / Reversal';
    title = refinedMerchant ? `Reversal - ${refinedMerchant}` : `Reversal (${bankName})`;
  } else if (isOutgoingTransfer) {
    type = 'transfer';
    category = 'Transfer';
    title = refinedMerchant ? `Transfer - ${refinedMerchant}` : `Transfer (${bankName})`;
  } else if (isIncomingDeposit) {
    type = 'income';
    category = 'Income';
    title = refinedMerchant ? `Deposit - ${refinedMerchant}` : `Deposit (${bankName})`;
  } else if (isAtmWithdrawal && !refinedMerchant) {
    type = 'expense';
    category = 'Cash & ATM';
    title = `ATM Withdrawal (${bankName})`;
  } else if (refinedMerchant) {
    title = refinedMerchant;
    category = classifyMerchantCategory(refinedMerchant);
  } else {
    // Never fall back to raw email notification title (e.g. "Notificación de Consumo")
    title = `${bankName} Purchase`;
  }

  const contextSnippet = buildContextSnippet(cleanedBody, rawSubject, {
    bankName,
    cardNumber,
    outcomeLabel
  });

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
    notes: `${bankName}${cardNumber ? ` • Card *${cardNumber}` : ''}${statusNote}`,
    contextSnippet,
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

    const txAmt = Math.abs(Number(tx.amount) || 0);
    if (txAmt <= 0) continue;

    const dayDiff = getDayDifference(tx.date, alert.date);
    if (dayDiff > 4) continue;

    // 2. Match against an already-recorded self-account transfer (either source or destination account)
    if (tx.isTransfer) {
      const amountDiff = Math.abs(txAmt - alertAmt);
      const closeAmt = amountDiff <= Math.max(0.05, alertAmt * 0.01);
      if (closeAmt) {
        const matchesSource = Boolean(
          alert.budgetId &&
            tx.budgetId === alert.budgetId &&
            (alert.type === 'expense' || alert.type === 'transfer')
        );
        const matchesDest = Boolean(
          alert.budgetId &&
            tx.transferToBudgetId === alert.budgetId &&
            (alert.type === 'income' || alert.type === 'transfer' || tx.isLoanPayment)
        );
        const matchesUnassignedTransfer = Boolean(!alert.budgetId && alert.type === 'transfer');
        if (matchesSource || matchesDest || matchesUnassignedTransfer) {
          const transferScore = 95 - dayDiff * 5;
          if (!bestMatch || transferScore > bestMatch.score) {
            bestMatch = { tx, score: transferScore };
          }
          continue;
        }
      }
    }

    // 2b. Match against already-recorded card/loan payments (manual payments are saved as expense with isLoanPayment=true, while card confirmation emails may arrive as income)
    const paymentKeywordRegex = /\b(?:pago\s*(?:de\s*)?tarjeta|pago\s*tc|card\s*payment|pago\s*(?:de\s*)?pr[eé]stamo|pago\s*recibido|abono|cuota)\b/i;
    const alertLooksLikePayment = paymentKeywordRegex.test(`${alert.title || ''} ${alert.category || ''} ${alert.notes || ''}`);
    if (tx.isLoanPayment && !tx.isTransfer) {
      const amountDiff = Math.abs(txAmt - alertAmt);
      const closeAmt = amountDiff <= Math.max(0.05, alertAmt * 0.01);
      const sameAccount = Boolean(alert.budgetId && tx.budgetId && alert.budgetId === tx.budgetId);
      if (closeAmt && (sameAccount || (alertLooksLikePayment && !alert.budgetId))) {
        const payScore = 92 - dayDiff * 5 + (sameAccount ? 5 : 0);
        if (!bestMatch || payScore > bestMatch.score) {
          bestMatch = { tx, score: payScore };
        }
        continue;
      }
    }

    // Compatible transaction direction (transfer alerts are stored as expense with isTransfer)
    if (tx.type && tx.type !== expectedTxType) continue;

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

/**
 * Finds an unlinked opposite-side transaction on a DIFFERENT user account with the same amount within ±3 days,
 * so a self-account transfer or credit-card/loan payment detected on both sides merges into one record without duplication.
 */
export function findOppositeTransferCandidate(
  existingTxs: any[],
  incoming: { budgetId?: string; amount: number; date: string; type: 'income' | 'expense' | 'transfer'; title?: string; category?: string },
  budgets?: Array<{ id: string; accountType?: string }>
): any | undefined {
  if (!incoming.budgetId) return undefined;
  const amt = Math.abs(Number(incoming.amount) || 0);
  if (amt <= 0) return undefined;

  const isIncomingCredit = incoming.type === 'income';
  const isIncomingDebitOrTransfer = incoming.type === 'expense' || incoming.type === 'transfer';
  const transferKeywords = /\b(?:transfer|transferencia|ach|lbtr|pago\s+al\s+instante|pago\s*(?:de\s*)?tarjeta|pago\s*tc|card\s*payment|pago\s*(?:de\s*)?pr[eé]stamo|pago\s*recibido|pago\s*m[ií]nimo|pago\s*total|cuota|abono|deposit|dep[oó]sito|cr[eé]dito\s+recibido)\b/i;
  const incomingText = `${incoming.title || ''} ${incoming.category || ''}`;
  const incomingLooksTransfer = incoming.type === 'transfer' || transferKeywords.test(incomingText);
  const incomingAccType = budgets?.find(b => b.id === incoming.budgetId)?.accountType;
  const incomingIsDebtAcc = incomingAccType === 'credit_card' || incomingAccType === 'loan';

  return existingTxs.find(tx => {
    if (!tx || tx.emailOutcome === 'declined') return false;
    if (!tx.budgetId || tx.budgetId === incoming.budgetId) return false;
    if (tx.isTransfer && tx.transferToBudgetId) return false;

    const txAmt = Math.abs(Number(tx.amount) || 0);
    if (Math.abs(txAmt - amt) > Math.max(0.05, amt * 0.005)) return false;

    const dayDiff = getDayDifference(tx.date, incoming.date);
    if (dayDiff > 3) return false;

    const txText = `${tx.title || ''} ${tx.category || ''} ${tx.notes || ''}`;
    const txLooksTransfer = Boolean(tx.isTransfer) || Boolean(tx.isLoanPayment) || transferKeywords.test(txText);
    if (!incomingLooksTransfer && !txLooksTransfer) return false;

    const txAccType = budgets?.find(b => b.id === tx.budgetId)?.accountType;
    const txIsDebtAcc = txAccType === 'credit_card' || txAccType === 'loan';

    // Cross-account payment pairing: one side on liquid account, other side recorded as debt payment on card/loan
    if ((tx.isLoanPayment || txIsDebtAcc || incomingIsDebtAcc) && (txIsDebtAcc !== incomingIsDebtAcc)) {
      if (txIsDebtAcc && !incomingIsDebtAcc && isIncomingDebitOrTransfer) return true;
      if (incomingIsDebtAcc && !txIsDebtAcc && tx.type === 'expense') return true;
    }

    if (isIncomingCredit && tx.type === 'expense') return true;
    if (isIncomingDebitOrTransfer && tx.type === 'income') return true;
    return false;
  });
}
