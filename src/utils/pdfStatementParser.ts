import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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

function inferStatementYearAndMonth(fileName: string, lines: string[]): { year: number; month: number; period: string; accountName: string } {
  const combined = `${fileName}\n${lines.slice(0, 35).join('\n')}`;
  const currentYear = new Date().getFullYear();

  let year = currentYear;
  const yearMatch = combined.match(/\b(20[1-3]\d)\b/);
  if (yearMatch) {
    year = Number(yearMatch[1]);
  }

  let month = new Date().getMonth() + 1;
  const monthTextMatch = combined.match(
    /\b(\d{1,2})\s*(?:de\s+|[-/.\s])\s*(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:t|tiembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?|jan(?:uary)?|apr(?:il)?|aug(?:ust)?|dec(?:ember)?)\b/i
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

  // DD MMM YYYY or DD-MMM-YYYY or DD MMM or DD/MMM
  const dmyText = s.match(/^(\d{1,2})[\s\-\/\.]+([a-záéíóúñ]{3,10})(?:[\s\-\/\.,]+(\d{2,4}))?$/i);
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

  // MMM DD, YYYY or MMM DD
  const mdyText = s.match(/^([a-záéíóúñ]{3,10})[\s\-\/\.]+(\d{1,2})(?:[\s,]+(\d{2,4}))?$/i);
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
    // Prefer DD/MM unless second part > 12
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

  // Handle European/LatAm format like 1.250,50 vs US/RD format 1,250.50
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

function inferCategory(title: string, availableCategories: string[]): string {
  const lower = title.toLowerCase();
  const findCat = (candidates: string[]) => {
    for (const c of candidates) {
      const match = availableCategories.find(ac => ac.toLowerCase() === c.toLowerCase());
      if (match) return match;
    }
    return candidates[0];
  };

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
  /\bstatement\s+balance\b/i,
  /\bminimum\s+payment\b/i,
  /\bcredit\s+limit\b/i,
  /\bavailable\s+credit\b/i,
  /\bpayment\s+due\s+date\b/i,
  /\btotal\s+(?:de\s+)?(?:cargos|consumos|pagos|cr[eé]ditos|d[eé]bitos|purchases|payments|fees|interest)\b/i,
  /^(?:fecha|date)\s+(?:descripci[oó]n|description|concepto|detalle)/i,
  /^(?:p[aá]gina|page)\s+\d+/i
];

export async function extractPdfTextLines(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const allLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    interface PositionedChunk {
      x: number;
      y: number;
      str: string;
    }

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

    // Group chunks into horizontal visual lines sorted top-to-bottom, then left-to-right
    chunks.sort((a, b) => b.y - a.y || a.x - b.x);

    const rows: PositionedChunk[][] = [];
    for (const chunk of chunks) {
      const lastRow = rows[rows.length - 1];
      if (lastRow && Math.abs(lastRow[0].y - chunk.y) <= 3.5) {
        lastRow.push(chunk);
      } else {
        rows.push([chunk]);
      }
    }

    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      const lineText = row.map(c => c.str).join(' ').replace(/\s+/g, ' ').trim();
      if (lineText) {
        allLines.push(lineText);
      }
    }
  }

  return allLines;
}

export async function parsePdfStatementLocally(
  file: File,
  availableCategories: string[],
  preferredCurrency: string
): Promise<ParsedStatementResult> {
  const lines = await extractPdfTextLines(file);
  const meta = inferStatementYearAndMonth(file.name, lines);

  // Date pattern at beginning (or after optional reference token)
  const dateTokenRegex =
    /^(?:[A-Z0-9]{2,8}\s+)?((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})|(?:\d{1,2}[\s\-\/\.]+(?:ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:t|tiembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?|jan(?:uary)?|apr(?:il)?|aug(?:ust)?|dec(?:ember)?)(?:[\s\-\/\.,]+\d{2,4})?)|(?:(?:ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:t|tiembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?|jan(?:uary)?|apr(?:il)?|aug(?:ust)?|dec(?:ember)?)[\s\-\/\.]+\d{1,2}(?:[\s,]+\d{2,4})?)|(?:\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?))\b/i;

  // Amount pattern matching currency amounts like RD$1,250.00, US$ 25.00, -1,200.50, (450.00), 1,250.00 CR
  const amountTokenRegex =
    /(?:(?:RD\$|US\$|DOP|USD|EUR|\$|€|£)\s*)?[+\-\(]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\)?(?:\s*(?:CR|DB|DR))?/gi;

  const transactions: ParsedStatementResult['transactions'] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_SUMMARY_PATTERNS.some(p => p.test(line))) continue;

    const dateMatch = line.match(dateTokenRegex);
    if (!dateMatch) continue;

    const parsedDate = parseFlexibleDate(dateMatch[1], meta.year, meta.month);
    if (!parsedDate) continue;

    let remainder = line.slice(dateMatch[0].length).trim();

    // Strip optional second date (e.g., transaction date + posting date on bank statements)
    const secondDateMatch = remainder.match(dateTokenRegex);
    if (secondDateMatch && parseFlexibleDate(secondDateMatch[1], meta.year, meta.month)) {
      remainder = remainder.slice(secondDateMatch[0].length).trim();
    }

    // Find all formatted monetary amounts with 2 decimals in remainder
    const rawAmountMatches: Array<{ full: string; index: number; currencyHint: string; value: number; isCredit: boolean; isNegative: boolean }> = [];
    const decimalAmountPattern =
      /((?:RD\$|US\$|DOP|USD|EUR|\$|€|£)\s*)?([+\-\(]?\d{1,3}(?:,\d{3})*\.\d{2}|[+\-\(]?\d{1,3}(?:\.\d{3})*,\d{2}|[+\-\(]?\d+\.\d{2})\)?(?:\s*(CR|DB|DR))?/gi;

    let m: RegExpExecArray | null;
    while ((m = decimalAmountPattern.exec(remainder)) !== null) {
      const full = m[0];
      const val = parseFormattedAmount(m[2]);
      if (val <= 0) continue;
      // Avoid matching dates or card numbers as amounts unless it actually has decimals
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

    // Pick primary amount: if multiple amounts exist (e.g., foreign USD amount + local DOP/RD$ total, or amount + running balance),
    // choose matching preferred currency if explicitly labeled, otherwise take the rightmost transaction amount (or first if balance column looks like running total)
    let chosen = rawAmountMatches[rawAmountMatches.length - 1];
    if (rawAmountMatches.length >= 2) {
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
        // Common bank statement layout: [Transaction Amount] [Running Balance] -> take the transaction amount (first)
        chosen = rawAmountMatches[0];
      }
    }

    // Extract description before the first monetary token (or strip amounts cleanly)
    const firstAmtIdx = rawAmountMatches[0].index;
    let titlePart = firstAmtIdx > 2 ? remainder.slice(0, firstAmtIdx) : remainder.replace(amountTokenRegex, ' ');
    titlePart = titlePart
      .replace(/\b(?:RD\$|US\$|DOP|USD)\b/gi, '')
      .replace(/^\s*[-–|•]+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!titlePart || titlePart.length < 2) continue;
    if (SKIP_SUMMARY_PATTERNS.some(p => p.test(titlePart))) continue;

    const lowerTitle = titlePart.toLowerCase();
    const isPaymentKeyword = /\b(?:pago|abono|payment|pay\s+thank\s+you|pago\s+tarjeta|pago\s+tc|pago\s+recibido)\b/i.test(lowerTitle);
    const isIncomeKeyword = /\b(?:cashback|devoluci[oó]n|reembolso|refund|dep[oó]sito|deposit|transferencia\s+recibida|cr[eé]dito\s+a\s+favor|n[oó]mina|salary|payroll)\b/i.test(lowerTitle);

    const isLoanPayment = isPaymentKeyword;
    let type: 'income' | 'expense' = 'expense';
    if (isIncomeKeyword || (chosen.isCredit && !isPaymentKeyword)) {
      type = 'income';
    }

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
