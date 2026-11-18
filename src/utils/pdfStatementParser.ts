import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfPasswordReason = 'NEED_PASSWORD' | 'INCORRECT_PASSWORD';

export class PdfPasswordError extends Error {
  reason: PdfPasswordReason;
  constructor(reason: PdfPasswordReason, message?: string) {
    super(
      message ||
        (reason === 'INCORRECT_PASSWORD'
          ? 'Incorrect PDF password. Please double-check and try again.'
          : 'This PDF statement is password-protected. Please enter its password to unlock.')
    );
    this.name = 'PdfPasswordError';
    this.reason = reason;
  }
}

export interface ParsedStatementResult {
  detectedAccountName: string;
  statementPeriod: string;
  transactions: Array<{
    title: string;
    amount: number;
    type: 'income' | 'expense';
    category: string;
    date: string;
    notes: string;
    isLoanPayment: boolean;
  }>;
}

interface PositionedChunk {
  x: number;
  y: number;
  str: string;
}

interface PdfRowMeta {
  text: string;
  chunks: PositionedChunk[];
}

interface ColumnLayoutHints {
  debitX: number | null;
  creditX: number | null;
  balanceX: number | null;
  hasRunningBalanceTable: boolean;
  openingBalance: number | null;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, set: 9, septiembre: 9, setiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12
};

const MONTH_TEXT_PATTERN =
  '(?:ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:t|tiembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?|jan(?:uary)?|apr(?:il)?|aug(?:ust)?|dec(?:ember)?)';

function inferStatementYearAndMonth(fileName: string, lines: string[]): { year: number; month: number; period: string; accountName: string } {
  const combined = `${fileName}\n${lines.slice(0, 40).join('\n')}`;
  const currentYear = new Date().getFullYear();

  let year = currentYear;
  const yearMatch = combined.match(/\b(20[1-3]\d)\b/);
  if (yearMatch) {
    year = Number(yearMatch[1]);
  }

  let month = new Date().getMonth() + 1;
  const monthTextMatch = combined.match(
    new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+|[-/.\\s])*\\s*(${MONTH_TEXT_PATTERN})\\b`, 'i')
  );
  if (monthTextMatch) {
    const key = monthTextMatch[2].toLowerCase();
    if (MONTH_MAP[key]) month = MONTH_MAP[key];
  } else {
    const slashPeriod = combined.match(/\b(\d{1,2})[\/\-](20[1-3]\d)\b/);
    if (slashPeriod) {
      const m = Number(slashPeriod[1]);
      if (m >= 1 && m <= 12) month = m;
    }
  }

  let accountName = fileName.replace(/\.[^/.]+$/, '').trim();
  const knownBanks = ['QIK', 'Popular', 'Banco Popular', 'BHD', 'Banreservas', 'Scotiabank', 'Santa Cruz', 'APAP', 'Chase', 'Amex', 'Citi', 'Bank of America', 'Capital One'];
  for (const bank of knownBanks) {
    if (combined.toLowerCase().includes(bank.toLowerCase())) {
      accountName = bank;
      break;
    }
  }

  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short' });
  return {
    year,
    month,
    period: `${monthName} ${year}`,
    accountName
  };
}

function parseFlexibleDate(raw: string, fallbackYear: number, fallbackMonth: number): string | null {
  const s = raw.trim();

  // YYYY-MM-DD or YYYY/MM/DD
  const iso = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // DD MMM YYYY, DD-MMM-YYYY, DD MMM, DD/MMM, or compact DDMmm like 08OCT / 03NOV
  const dmyText = s.match(/^(\d{1,2})[\s\-\/\.]*([a-záéíóúñ]{3,10})(?:[\s\-\/\.,]*(\d{2,4}))?$/i);
  if (dmyText) {
    const d = Number(dmyText[1]);
    const mKey = dmyText[2].toLowerCase().replace('.', '');
    const m = MONTH_MAP[mKey];
    if (m && d >= 1 && d <= 31) {
      let y = dmyText[3] ? Number(dmyText[3]) : fallbackYear;
      if (y < 100) y += 2000;
      if (!dmyText[3] && fallbackMonth <= 2 && m >= 11) {
        y = fallbackYear - 1;
      }
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // MMM DD, YYYY or MMM DD or compact OCT08
  const mdyText = s.match(/^([a-záéíóúñ]{3,10})[\s\-\/\.]*(\d{1,2})(?:[\s,]+(\d{2,4}))?$/i);
  if (mdyText) {
    const mKey = mdyText[1].toLowerCase().replace('.', '');
    const m = MONTH_MAP[mKey];
    const d = Number(mdyText[2]);
    if (m && d >= 1 && d <= 31) {
      let y = mdyText[3] ? Number(mdyText[3]) : fallbackYear;
      if (y < 100) y += 2000;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or MM/DD/YYYY
  const numericFull = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (numericFull) {
    const p1 = Number(numericFull[1]);
    const p2 = Number(numericFull[2]);
    let y = Number(numericFull[3]);
    if (y < 100) y += 2000;
    let day = p1;
    let month = p2;
    if (p2 > 12 && p1 <= 12) {
      month = p1;
      day = p2;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // DD/MM or DD-MM (without year)
  const numericShort = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (numericShort) {
    const p1 = Number(numericShort[1]);
    const p2 = Number(numericShort[2]);
    let day = p1;
    let month = p2;
    if (p2 > 12 && p1 <= 12) {
      month = p1;
      day = p2;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let y = fallbackYear;
      if (fallbackMonth <= 2 && month >= 11) {
        y = fallbackYear - 1;
      }
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseFormattedAmount(raw: string): number {
  let cleaned = raw.trim().replace(/[^0-9.,-]/g, '');
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot && lastComma >= cleaned.length - 3) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.abs(num);
}

function parseSignedAmount(raw: string): number {
  const val = parseFormattedAmount(raw);
  const isNeg = raw.includes('-') || (raw.includes('(') && raw.includes(')'));
  return isNeg ? -val : val;
}

function inferCategory(title: string, availableCategories: string[]): string {
  const lower = title.toLowerCase();
  const findCat = (candidates: string[]) => {
    for (const c of candidates) {
      const match = availableCategories.find(ac => ac.toLowerCase() === c.toLowerCase());
      if (match) return match;
    }
    return candidates[0];
  };

  if (/impuesto|dgii|itbis|comisi[oó]n|bank fee|tax/i.test(lower)) {
    return findCat(['Utilities', 'Bills', 'Fees', 'Other']);
  }
  if (/uber|didi|indrive|taxi|cabify|gas|shell|texaco|total|sunix|isla|peaje|rd vial|metro|fuel|parking|estacionamiento/i.test(lower)) {
    return findCat(['Transport', 'Transporte']);
  }
  if (/supermercado|sirena|la sirena|jumbo|bravo|nacional|ole|hiper|pricesmart|carrefour|grocery|walmart|market|colmado/i.test(lower)) {
    return findCat(['Groceries', 'Supermarket', 'Food']);
  }
  if (/netflix|spotify|apple\.com|itunes|disney|hbo|max|youtube|amazon prime|claude|openai|chatgpt|google one|icloud|adobe|microsoft|playstation|xbox|steam/i.test(lower)) {
    return findCat(['Subscriptions', 'Entertainment']);
  }
  if (/restaurante|restaurant|mcdonald|burger|pizza|domino|kfc|wendy|subway|starbucks|cafe|coffee|bistro|grill|sushi|taco|bar|bakery|heladeria/i.test(lower)) {
    return findCat(['Dining', 'Restaurants', 'Food']);
  }
  if (/claro|altice|viva|edesur|edenorte|edeeste|caasd|coraasan|electric|agua|internet|telecom|utility|utilities/i.test(lower)) {
    return findCat(['Utilities', 'Bills']);
  }
  if (/amazon|temu|shein|ebay|zara|ikea|store|tienda|mall|plaza|ferreteria|ochoa|americana/i.test(lower)) {
    return findCat(['Shopping']);
  }
  if (/cine|cinema|caribbean|concert|ticket|hotel|airbnb|booking|vuelo|airline|copa|jetblue|delta|american air/i.test(lower)) {
    return findCat(['Entertainment', 'Travel']);
  }
  if (/alquiler|rent|hipoteca|mortgage|mantenimiento|condominio/i.test(lower)) {
    return findCat(['Housing']);
  }
  if (/nomina|salary|payroll|sueldo|freelance|honorario/i.test(lower)) {
    return findCat(['Salary', 'Freelance']);
  }
  return findCat(['Other']);
}

const SKIP_SUMMARY_PATTERNS = [
  /\bsaldo\s+anterior\b/i,
  /\bbalance\s+anterior\b/i,
  /\bsaldo\s+al\s+corte\b/i,
  /\bbalance\s+al\s+corte\b/i,
  /\bsaldo\s+final\b/i,
  /\bbalance\s+final\b/i,
  /\bsaldo\s+total\b/i,
  /\btotal\s+a\s+pagar\b/i,
  /\bpago\s+m[ií]nimo\b/i,
  /\bpago\s+de\s+contado\b/i,
  /\bl[ií]mite\s+de\s+cr[eé]dito\b/i,
  /\bcr[eé]dito\s+disponible\b/i,
  /\bfecha\s+l[ií]mite\b/i,
  /\bfecha\s+de\s+corte\b/i,
  /\bprevious\s+balance\b/i,
  /\bnew\s+balance\b/i,
  /\bending\s+balance\b/i,
  /\bstatement\s+balance\b/i,
  /\bminimum\s+payment\b/i,
  /\bcredit\s+limit\b/i,
  /\bavailable\s+credit\b/i,
  /\bpayment\s+due\s+date\b/i,
  /\btotal\s+(?:de\s+)?(?:cargos|consumos|pagos|cr[eé]ditos|d[eé]bitos|purchases|payments|fees|interest)\b/i,
  /^(?:fecha|fechas|date)\s+(?:de\s+)?(?:entrada|transac|descripci[oó]n|description|concepto|detalle)/i,
  /^(?:p[aá]gina|page|pag)\s+\d+/i
];

async function extractPdfRowsWithPositions(file: File, password?: string): Promise<PdfRowMeta[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    ...(password ? { password } : {})
  });

  let pdf: pdfjsLib.PDFDocumentProxy;
  try {
    pdf = await loadingTask.promise;
  } catch (err: any) {
    const isPasswordErr =
      err?.name === 'PasswordException' ||
      err?.code === pdfjsLib.PasswordResponses.NEED_PASSWORD ||
      err?.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ||
      /password/i.test(String(err?.message || ''));
    if (isPasswordErr) {
      const reason: PdfPasswordReason =
        err?.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD || Boolean(password)
          ? 'INCORRECT_PASSWORD'
          : 'NEED_PASSWORD';
      throw new PdfPasswordError(reason);
    }
    throw err;
  }

  const allRows: PdfRowMeta[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const chunks: PositionedChunk[] = [];
    for (const item of textContent.items as any[]) {
      const str = String(item?.str || '').trim();
      if (!str) continue;
      const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
      chunks.push({
        x: Number(transform[4]) || 0,
        y: Number(transform[5]) || 0,
        str
      });
    }

    chunks.sort((a, b) => b.y - a.y || a.x - b.x);

    const groupedRows: PositionedChunk[][] = [];
    for (const chunk of chunks) {
      const lastRow = groupedRows[groupedRows.length - 1];
      if (lastRow && Math.abs(lastRow[0].y - chunk.y) <= 3.5) {
        lastRow.push(chunk);
      } else {
        groupedRows.push([chunk]);
      }
    }

    for (const row of groupedRows) {
      row.sort((a, b) => a.x - b.x);
      const text = row.map(c => c.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) {
        allRows.push({ text, chunks: row });
      }
    }
  }

  return allRows;
}

export async function extractPdfTextLines(file: File, password?: string): Promise<string[]> {
  const rows = await extractPdfRowsWithPositions(file, password);
  return rows.map(r => r.text);
}

function detectColumnLayout(rows: PdfRowMeta[]): ColumnLayoutHints {
  let debitX: number | null = null;
  let creditX: number | null = null;
  let balanceX: number | null = null;
  let hasRunningBalanceTable = false;
  let openingBalance: number | null = null;

  for (const row of rows) {
    const upper = row.text.toUpperCase();

    if (
      openingBalance === null &&
      /(?:BALANCE|SALDO)\s+(?:ANTERIOR|INICIAL)|PREVIOUS\s+BALANCE/i.test(upper)
    ) {
      const amtMatch = row.text.match(/([+\-\(]?\d{1,3}(?:,\d{3})*\.\d{2}|[+\-\(]?\d{1,3}(?:\.\d{3})*,\d{2}|[+\-\(]?\d+[.,]\d{2})\)?/);
      if (amtMatch) {
        openingBalance = parseSignedAmount(amtMatch[0]);
      }
    }

    const looksLikeTableHeader =
      /(?:D[EÉ]BITO|RETIROS|CARGOS)/.test(upper) &&
      /(?:CR[EÉ]DITO|DEP[OÓ]SITOS|ABONOS)/.test(upper) &&
      /(?:BALANCE|SALDO)/.test(upper);

    if (looksLikeTableHeader || (/(?:DETALLE|DESCRIPCI[OÓ]N)/.test(upper) && /(?:BALANCE|SALDO)\s*(?:RD\$|US\$|$)/.test(upper))) {
      hasRunningBalanceTable = true;
      for (const ch of row.chunks) {
        const cUpper = ch.str.toUpperCase();
        if (debitX === null && /^(?:D[EÉ]BITO|RETIROS)/.test(cUpper)) debitX = ch.x;
        if (creditX === null && /^(?:CR[EÉ]DITO|DEP[OÓ]SITOS)/.test(cUpper)) creditX = ch.x;
        if (balanceX === null && /^(?:BALANCE|SALDO)/.test(cUpper)) balanceX = ch.x;
      }
    }
  }

  return {
    debitX,
    creditX,
    balanceX,
    hasRunningBalanceTable,
    openingBalance
  };
}

function stripLeadingRefTokens(text: string): string {
  // Remove leading long bank reference/authorization numbers like "85130076282640957207059" (6 to 35 chars)
  // while preserving short merchant numbers like "7 Eleven" or dates like "08OCT" or "05/10/2026".
  let result = text.trim();
  for (let pass = 0; pass < 3; pass++) {
    const next = result
      .replace(/^(?:#?\d{6,35})\s*[-–|•:]?\s+/i, '')
      .replace(/^(?:[A-Z]{1,4}\d{6,30})\s*[-–|•:]?\s+/i, '')
      .trim();
    if (next === result) break;
    result = next;
  }
  return result;
}

export async function parsePdfStatementLocally(
  file: File,
  availableCategories: string[],
  preferredCurrency: string,
  password?: string
): Promise<ParsedStatementResult> {
  const rows = await extractPdfRowsWithPositions(file, password);
  const lines = rows.map(r => r.text);
  const meta = inferStatementYearAndMonth(file.name, lines);
  const layout = detectColumnLayout(rows);

  const dateTokenRegex = new RegExp(
    `^((?:\\d{4}[\\/\\-]\\d{1,2}[\\/\\-]\\d{1,2})|(?:\\d{1,2}[\\s\\-\\/\\.]*${MONTH_TEXT_PATTERN}(?:[\\s\\-\\/\\.,]*\\d{2,4})?)|(?:${MONTH_TEXT_PATTERN}[\\s\\-\\/\\.]*\\d{1,2}(?:[\\s,]+\\d{2,4})?)|(?:\\d{1,2}[\\/\\-]\\d{1,2}(?:[\\/\\-]\\d{2,4})?))\\b`,
    'i'
  );

  const amountTokenRegex =
    /(?:(?:RD\$|US\$|DOP|USD|EUR|\$|€|£)\s*)?[+\-\(]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\)?(?:\s*(?:CR|DB|DR))?/gi;

  const transactions: ParsedStatementResult['transactions'] = [];
  let runningBalance: number | null = layout.openingBalance;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawLine = row.text;
    if (SKIP_SUMMARY_PATTERNS.some(p => p.test(rawLine))) continue;

    // Strip any leading reference number (e.g., 85130076282640957207059) before matching the date
    const preCleaned = stripLeadingRefTokens(rawLine);
    let dateMatch = preCleaned.match(dateTokenRegex);
    let workingAfterDate = preCleaned;

    if (!dateMatch) {
      // Also allow a single short alphanumeric ref token (2-16 chars) before date
      const shortPrefix = preCleaned.match(/^[A-Z0-9\-]{2,16}\s+(.+)$/i);
      if (shortPrefix) {
        const innerMatch = shortPrefix[1].match(dateTokenRegex);
        if (innerMatch) {
          dateMatch = innerMatch;
          workingAfterDate = shortPrefix[1];
        }
      }
    }

    if (!dateMatch) continue;

    const parsedDate = parseFlexibleDate(dateMatch[1], meta.year, meta.month);
    if (!parsedDate) continue;

    let remainder = stripLeadingRefTokens(workingAfterDate.slice(dateMatch[0].length));

    // Strip optional second date (e.g., ENTRADA + TRANSAC. on Popular bank statements, or posting date on CC)
    const secondDateMatch = remainder.match(dateTokenRegex);
    if (secondDateMatch && parseFlexibleDate(secondDateMatch[1], meta.year, meta.month)) {
      remainder = stripLeadingRefTokens(remainder.slice(secondDateMatch[0].length));
    }

    // Find all formatted monetary amounts with 2 decimals in remainder
    const rawAmountMatches: Array<{
      full: string;
      index: number;
      currencyHint: string;
      value: number;
      isCredit: boolean;
      isNegative: boolean;
    }> = [];
    const decimalAmountPattern =
      /((?:RD\$|US\$|DOP|USD|EUR|\$|€|£)\s*)?([+\-\(]?\d{1,3}(?:,\d{3})*\.\d{2}|[+\-\(]?\d{1,3}(?:\.\d{3})*,\d{2}|[+\-\(]?\d+[.,]\d{2})\)?(?:\s*(CR|DB|DR))?/gi;

    let m: RegExpExecArray | null;
    while ((m = decimalAmountPattern.exec(remainder)) !== null) {
      const full = m[0];
      const val = parseFormattedAmount(m[2]);
      if (val <= 0) continue;
      if (!/[.,]\d{2}$/.test(m[2].replace(/[+\-\(\)]/g, ''))) continue;
      const currencyHint = (m[1] || '').toUpperCase();
      const suffix = (m[3] || '').toUpperCase();
      const isNeg = full.includes('-') || (full.includes('(') && full.includes(')'));
      const isCredit = suffix === 'CR' || full.trim().startsWith('+');
      rawAmountMatches.push({
        full,
        index: m.index,
        currencyHint,
        value: val,
        isCredit,
        isNegative: isNeg
      });
    }

    if (rawAmountMatches.length === 0) continue;

    let chosen = rawAmountMatches[rawAmountMatches.length - 1];
    let inferredTypeFromBalance: 'income' | 'expense' | null = null;
    let sliceTitleAtIndex = rawAmountMatches[0].index;

    const looksLikeRunningBalanceRow =
      rawAmountMatches.length >= 2 &&
      (layout.hasRunningBalanceTable ||
        (runningBalance !== null &&
          (Math.abs(runningBalance + rawAmountMatches[rawAmountMatches.length - 2].value - rawAmountMatches[rawAmountMatches.length - 1].value) <= 0.05 ||
            Math.abs(runningBalance - rawAmountMatches[rawAmountMatches.length - 2].value - rawAmountMatches[rawAmountMatches.length - 1].value) <= 0.05)));

    if (looksLikeRunningBalanceRow) {
      const balMatch = rawAmountMatches[rawAmountMatches.length - 1];
      const txMatch = rawAmountMatches[rawAmountMatches.length - 2];
      chosen = txMatch;
      sliceTitleAtIndex = txMatch.index;

      if (runningBalance !== null) {
        if (Math.abs(runningBalance + txMatch.value - balMatch.value) <= 0.05) {
          inferredTypeFromBalance = 'income';
        } else if (Math.abs(runningBalance - txMatch.value - balMatch.value) <= 0.05) {
          inferredTypeFromBalance = 'expense';
        }
      }
      runningBalance = balMatch.isNegative ? -balMatch.value : balMatch.value;

      // Fallback to geometric X-coordinate check if running balance math wasn't available on the first row
      if (!inferredTypeFromBalance && layout.debitX !== null && layout.creditX !== null) {
        const amountNumericStr = txMatch.full.replace(/[^0-9.,-]/g, '');
        const matchingChunk = row.chunks.find(c => c.str.includes(amountNumericStr));
        if (matchingChunk) {
          const distCredit = Math.abs(matchingChunk.x - layout.creditX);
          const distDebit = Math.abs(matchingChunk.x - layout.debitX);
          inferredTypeFromBalance = distCredit < distDebit ? 'income' : 'expense';
        }
      }
    } else if (rawAmountMatches.length >= 2) {
      const prefUpper = preferredCurrency.toUpperCase();
      const matchedPref = rawAmountMatches.find(a =>
        prefUpper === 'DOP'
          ? a.currencyHint.includes('RD') || a.currencyHint.includes('DOP')
          : prefUpper === 'USD'
          ? a.currencyHint.includes('US')
          : false
      );
      if (matchedPref) {
        chosen = matchedPref;
      } else if (rawAmountMatches.length === 2 && !rawAmountMatches[0].currencyHint && !rawAmountMatches[1].currencyHint) {
        chosen = rawAmountMatches[0];
      }
    }

    let titlePart = sliceTitleAtIndex > 2 ? remainder.slice(0, sliceTitleAtIndex) : remainder.replace(amountTokenRegex, ' ');
    titlePart = stripLeadingRefTokens(titlePart)
      .replace(/\b(?:RD\$|US\$|DOP|USD)\s*\.00\b/gi, '')
      .replace(/\b(?:RD\$|US\$|DOP|USD)\b/gi, '')
      .replace(/\s+\.00\b/g, '')
      .replace(/^\s*[-–|•]+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!titlePart || titlePart.length < 2) continue;
    if (SKIP_SUMMARY_PATTERNS.some(p => p.test(titlePart))) continue;

    const lowerTitle = titlePart.toLowerCase();
    const isTaxOrFee = /\b(?:impuesto|dgii|itbis|comisi[oó]n|cargo\s+por|fee|tax)\b/i.test(lowerTitle);
    const isPaymentKeyword =
      !isTaxOrFee &&
      /\b(?:pago|abono|payment|pay\s+thank\s+you|pago\s+tarjeta|pago\s+tc|pago\s+recibido)\b/i.test(lowerTitle);
    const isIncomeKeyword =
      /\b(?:cashback|devoluci[oó]n|reembolso|refund|dep[oó]sito|deposit|transf(?:erencia)?\s+rec(?:ibida)?|cr[eé]dito(?:\s+a\s+favor)?|intereses?\s+ganados?|n[oó]mina|salary|payroll)\b/i.test(
        lowerTitle
      );

    let type: 'income' | 'expense' = 'expense';
    if (inferredTypeFromBalance) {
      type = inferredTypeFromBalance;
    } else if (chosen.isNegative) {
      type = 'expense';
    } else if (isIncomeKeyword || (chosen.isCredit && !isPaymentKeyword)) {
      type = 'income';
    } else if (layout.hasRunningBalanceTable && !chosen.isNegative) {
      // On running-balance checking/savings statements where debits are signed negative (-600.00), unsigned entries are credits
      type = 'income';
    }

    const isLoanPayment = isPaymentKeyword && type === 'expense';
    const otherAmounts = rawAmountMatches.filter(a => a !== chosen).map(a => a.full.trim());
    const notes = otherAmounts.length > 0 ? `Statement ref amounts: ${otherAmounts.join(', ')}` : '';

    transactions.push({
      title: titlePart.slice(0, 180),
      amount: chosen.value,
      type,
      category: inferCategory(titlePart, availableCategories).slice(0, 45),
      date: parsedDate,
      notes: notes.slice(0, 400),
      isLoanPayment
    });
  }

  return {
    detectedAccountName: meta.accountName,
    statementPeriod: meta.period,
    transactions
  };
}
