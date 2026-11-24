export type LoanCalcMethod = 'amortized' | 'flat';
export type LoanRatePeriod = 'annual' | 'monthly';

export interface LoanQuota {
  id: string;
  quotaNumber: number;
  dueDate: string;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  remainingBalance: number;
  isPaid: boolean;
  paidDate?: string;
  paymentTxId?: string;
}

export function calculateCreditCardMonthlyLimit(creditLimit: number, overdraftPercentage: number) {
  const baseCreditLimit = Math.max(0, Number(creditLimit) || 0);
  const overdraftPct = Math.max(0, Number(overdraftPercentage) || 0);
  const overdraftBuffer = Number((baseCreditLimit * (overdraftPct / 100)).toFixed(2));
  const monthlyLimit = Number((baseCreditLimit + overdraftBuffer).toFixed(2));
  return {
    baseCreditLimit,
    overdraftPct,
    overdraftBuffer,
    monthlyLimit
  };
}

export function getMonthlyInterestRate(rate: number, ratePeriod: LoanRatePeriod = 'annual'): number {
  const cleanRate = Math.max(0, Number(rate) || 0);
  return ratePeriod === 'monthly' ? cleanRate / 100 : cleanRate / 100 / 12;
}

export function calculateLoanMonthlyQuota(
  principal: number,
  interestRate: number,
  termMonths: number,
  options?: { ratePeriod?: LoanRatePeriod; calcMethod?: LoanCalcMethod }
): number {
  const P = Math.max(0, Number(principal) || 0);
  const n = Math.min(600, Math.max(0, Math.floor(Number(termMonths) || 0)));
  if (P <= 0 || n <= 0) return 0;

  const ratePeriod = options?.ratePeriod || 'annual';
  const calcMethod = options?.calcMethod || 'amortized';
  const monthlyRate = getMonthlyInterestRate(interestRate, ratePeriod);

  if (calcMethod === 'flat') {
    const monthlyPrincipal = P / n;
    const monthlyInterest = P * monthlyRate;
    return Number((monthlyPrincipal + monthlyInterest).toFixed(2));
  }

  if (monthlyRate === 0) {
    return Number((P / n).toFixed(2));
  }

  const factor = Math.pow(1 + monthlyRate, n);
  const payment = (P * monthlyRate * factor) / (factor - 1);
  return Number(payment.toFixed(2));
}

export function addMonthsToIsoDate(isoDate: string, monthsToAdd: number): string {
  const cleaned = (isoDate || '').trim().slice(0, 10);
  const parts = cleaned.split('-').map(Number);
  const now = new Date();
  const baseYear = parts.length === 3 && !isNaN(parts[0]) ? parts[0] : now.getFullYear();
  const baseMonth = parts.length === 3 && !isNaN(parts[1]) ? parts[1] - 1 : now.getMonth();
  const baseDay = parts.length === 3 && !isNaN(parts[2]) ? parts[2] : now.getDate();

  const targetMonthTotal = baseYear * 12 + baseMonth + monthsToAdd;
  const targetYear = Math.floor(targetMonthTotal / 12);
  const targetMonth = ((targetMonthTotal % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(baseDay, daysInTargetMonth);

  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

export function generateLoanQuotasSchedule(params: {
  principal: number;
  annualApr: number;
  termMonths: number;
  startDate: string;
  ratePeriod?: LoanRatePeriod;
  calcMethod?: LoanCalcMethod;
  customMonthlyQuota?: number;
  existingQuotas?: LoanQuota[];
}): { quotas: LoanQuota[]; monthlyQuota: number; totalInterest: number; totalRepayment: number } {
  const P = Math.max(0, Number(params.principal) || 0);
  const rate = Math.max(0, Number(params.annualApr) || 0);
  const n = Math.min(600, Math.max(0, Math.floor(Number(params.termMonths) || 0)));
  const start = (params.startDate || new Date().toISOString().split('T')[0]).slice(0, 20);
  const ratePeriod = params.ratePeriod || 'annual';
  const calcMethod = params.calcMethod || 'amortized';

  if (P <= 0 || n <= 0) {
    return { quotas: [], monthlyQuota: 0, totalInterest: 0, totalRepayment: 0 };
  }

  const r = getMonthlyInterestRate(rate, ratePeriod);
  const calculatedMonthly = calculateLoanMonthlyQuota(P, rate, n, { ratePeriod, calcMethod });
  const hasCustomQuota = Boolean(params.customMonthlyQuota && params.customMonthlyQuota > 0);
  const targetMonthly = hasCustomQuota
    ? Number(params.customMonthlyQuota!.toFixed(2))
    : calculatedMonthly;

  const existingByNumber = new Map<number, LoanQuota>();
  (params.existingQuotas || []).forEach(q => existingByNumber.set(q.quotaNumber, q));

  const quotas: LoanQuota[] = [];
  let balance = P;
  let totalInterest = 0;
  let totalRepayment = 0;
  const baseTs = Date.now();

  for (let i = 1; i <= n; i++) {
    const dueDate = addMonthsToIsoDate(start, i - 1);
    const interestAmount =
      calcMethod === 'flat'
        ? Number((P * r).toFixed(2))
        : Number((balance * r).toFixed(2));

    let principalAmount: number;
    let amount: number;

    if (i === n || balance + interestAmount <= targetMonthly) {
      principalAmount = Number(balance.toFixed(2));
      amount = Number((principalAmount + interestAmount).toFixed(2));
    } else if (calcMethod === 'flat' && !hasCustomQuota) {
      principalAmount = Number((P / n).toFixed(2));
      if (principalAmount > balance) principalAmount = Number(balance.toFixed(2));
      amount = Number((principalAmount + interestAmount).toFixed(2));
    } else {
      principalAmount = Math.max(0, Number((targetMonthly - interestAmount).toFixed(2)));
      if (principalAmount > balance) principalAmount = Number(balance.toFixed(2));
      amount = Number((principalAmount + interestAmount).toFixed(2));
    }

    balance = Math.max(0, Number((balance - principalAmount).toFixed(2)));
    totalInterest = Number((totalInterest + interestAmount).toFixed(2));
    totalRepayment = Number((totalRepayment + amount).toFixed(2));

    const prev = existingByNumber.get(i);
    quotas.push({
      id: prev?.id || `q_${baseTs}_${i}`,
      quotaNumber: i,
      dueDate,
      amount,
      principalAmount,
      interestAmount,
      remainingBalance: balance,
      isPaid: Boolean(prev?.isPaid),
      ...(prev?.paidDate ? { paidDate: prev.paidDate } : {}),
      ...(prev?.paymentTxId ? { paymentTxId: prev.paymentTxId } : {})
    });

    if (balance <= 0 && i < n) {
      break;
    }
  }

  return {
    quotas,
    monthlyQuota: targetMonthly,
    totalInterest,
    totalRepayment
  };
}

export function allocateLoanPayment(params: {
  amount: number;
  principal: number;
  remainingPrincipal: number;
  apr: number;
  ratePeriod?: LoanRatePeriod;
  calcMethod?: LoanCalcMethod;
  quotas?: LoanQuota[];
  paymentDate?: string;
  paymentTxId?: string;
}): {
  principalPaid: number;
  interestPaid: number;
  paidQuotaIds: string[];
  updatedQuotas?: LoanQuota[];
} {
  const amt = Math.max(0, Number(params.amount) || 0);
  const remPrin = Math.max(0, Number(params.remainingPrincipal) || 0);
  if (amt <= 0) {
    return { principalPaid: 0, interestPaid: 0, paidQuotaIds: [], updatedQuotas: params.quotas };
  }

  const ratePeriod = params.ratePeriod || 'annual';
  const calcMethod = params.calcMethod || 'amortized';
  const quotas = params.quotas ? [...params.quotas] : [];
  const unpaidQuotas = quotas.filter(q => !q.isPaid);
  const today = (params.paymentDate || new Date().toISOString().split('T')[0]).slice(0, 20);

  if (unpaidQuotas.length > 0) {
    const first = unpaidQuotas[0];
    // 1) Payment closely matches a single quota (or multiple consecutive quotas)
    let cumulativeAmt = 0;
    let cumulativePrin = 0;
    let cumulativeInt = 0;
    const matchedIds: string[] = [];

    for (const q of unpaidQuotas) {
      cumulativeAmt = Number((cumulativeAmt + (Number(q.amount) || 0)).toFixed(2));
      cumulativePrin = Number((cumulativePrin + (Number(q.principalAmount) || 0)).toFixed(2));
      cumulativeInt = Number((cumulativeInt + (Number(q.interestAmount) || 0)).toFixed(2));
      matchedIds.push(q.id);

      if (Math.abs(amt - cumulativeAmt) <= 1.0) {
        const finalPrin = Math.min(remPrin, cumulativePrin);
        const updatedQuotas = quotas.map(item =>
          matchedIds.includes(item.id)
            ? {
                ...item,
                isPaid: true,
                paidDate: today,
                ...(params.paymentTxId ? { paymentTxId: params.paymentTxId } : {})
              }
            : item
        );
        return {
          principalPaid: Number(finalPrin.toFixed(2)),
          interestPaid: Number(cumulativeInt.toFixed(2)),
          paidQuotaIds: matchedIds,
          updatedQuotas
        };
      }
      if (cumulativeAmt > amt + 1.0) break;
    }

    // 2) Payment is larger than first quota (extra principal / abono a capital)
    if (amt >= first.amount - 1.0) {
      const interestPaid = Math.min(amt, Math.max(0, Number(first.interestAmount) || 0));
      const principalPaid = Math.min(remPrin, Math.max(0, Number((amt - interestPaid).toFixed(2))));
      const updatedQuotas = quotas.map(item =>
        item.id === first.id
          ? {
              ...item,
              isPaid: true,
              paidDate: today,
              ...(params.paymentTxId ? { paymentTxId: params.paymentTxId } : {})
            }
          : item
      );
      return {
        principalPaid: Number(principalPaid.toFixed(2)),
        interestPaid: Number(interestPaid.toFixed(2)),
        paidQuotaIds: [first.id],
        updatedQuotas
      };
    }

    // 3) Partial payment (< next quota amount): applies to interest first, remainder to principal
    const interestPaid = Math.min(amt, Math.max(0, Number(first.interestAmount) || 0));
    const principalPaid = Math.min(remPrin, Math.max(0, Number((amt - interestPaid).toFixed(2))));
    return {
      principalPaid: Number(principalPaid.toFixed(2)),
      interestPaid: Number(interestPaid.toFixed(2)),
      paidQuotaIds: [],
      updatedQuotas: quotas
    };
  }

  // Fallback when loan has no generated quotas schedule yet: compute 1 period's interest from rate
  const monthlyRate = getMonthlyInterestRate(params.apr, ratePeriod);
  const interestBase = calcMethod === 'flat' ? Math.max(0, Number(params.principal) || remPrin) : remPrin;
  const periodInterest = Number((interestBase * monthlyRate).toFixed(2));
  const interestPaid = Math.min(amt, periodInterest);
  const principalPaid = Math.min(remPrin, Math.max(0, Number((amt - interestPaid).toFixed(2))));

  return {
    principalPaid: Number(principalPaid.toFixed(2)),
    interestPaid: Number(interestPaid.toFixed(2)),
    paidQuotaIds: [],
    updatedQuotas: quotas
  };
}

export function reverseLoanPaymentOnQuotas(
  quotas: LoanQuota[],
  paidQuotaIds?: string[],
  paymentTxId?: string
): LoanQuota[] {
  const idSet = new Set(paidQuotaIds || []);
  return quotas.map(q => {
    const matched = idSet.has(q.id) || (Boolean(paymentTxId) && q.paymentTxId === paymentTxId);
    if (!matched) return q;
    const reset: LoanQuota = {
      id: q.id,
      quotaNumber: q.quotaNumber,
      dueDate: q.dueDate,
      amount: q.amount,
      principalAmount: q.principalAmount,
      interestAmount: q.interestAmount,
      remainingBalance: q.remainingBalance,
      isPaid: false
    };
    return reset;
  });
}

// ============================================================================
// Credit Card Billing Cycle Engine
// ============================================================================

export interface CreditCardCycleInfo {
  cycleKey: string; // YYYY-MM (cutoff month)
  startDate: string; // YYYY-MM-DD
  cutoffDate: string; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  cutoffDay: number;
  dueDay: number | null;
  label: string; // e.g. "Nov 2026"
  periodLabel: string; // e.g. "Oct 16 – Nov 15"
  daysUntilCutoff: number;
  daysUntilDue: number | null;
  status: 'open' | 'closed' | 'upcoming';
  isPastDue: boolean;
}

export function getTodayIsoLocal(referenceDate: Date = new Date()): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const d = String(referenceDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDayOfMonth(value?: string | number | null): number | null {
  if (typeof value === 'number') {
    const n = Math.floor(value);
    return n >= 1 && n <= 31 ? n : null;
  }
  const raw = String(value || '').trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const day = Number(isoMatch[3]);
    return day >= 1 && day <= 31 ? day : null;
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    const day = p1 > 12 ? p1 : p2 > 12 ? p2 : p1;
    return day >= 1 && day <= 31 ? day : null;
  }

  const numMatch = raw.match(/\b([1-9]|[12]\d|3[01])\b/);
  if (numMatch) {
    const day = Number(numMatch[1]);
    return day >= 1 && day <= 31 ? day : null;
  }

  return null;
}

export function buildClampedIsoDate(year: number, monthIndex0: number, day: number): string {
  const anchor = new Date(year, monthIndex0, 1);
  const y = anchor.getFullYear();
  const m0 = anchor.getMonth();
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const clampedDay = Math.min(Math.max(1, Math.floor(day)), daysInMonth);
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const parts = (isoDate || '').slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return getTodayIsoLocal();
  }
  const d = new Date(parts[0], parts[1] - 1, parts[2] + days);
  return getTodayIsoLocal(d);
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const parts = (monthKey || '').slice(0, 7).split('-').map(Number);
  const now = new Date();
  const y = parts.length === 2 && !isNaN(parts[0]) ? parts[0] : now.getFullYear();
  const m0 = parts.length === 2 && !isNaN(parts[1]) ? parts[1] - 1 : now.getMonth();
  const shifted = new Date(y, m0 + deltaMonths, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}

export function diffDaysIso(fromIso: string, toIso: string): number {
  const p1 = (fromIso || '').slice(0, 10).split('-').map(Number);
  const p2 = (toIso || '').slice(0, 10).split('-').map(Number);
  if (p1.length !== 3 || p2.length !== 3 || p1.some(isNaN) || p2.some(isNaN)) return 0;
  const t1 = Date.UTC(p1[0], p1[1] - 1, p1[2]);
  const t2 = Date.UTC(p2[0], p2[1] - 1, p2[2]);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

export function formatShortIsoDate(isoDate?: string | null): string {
  if (!isoDate) return '';
  const parts = isoDate.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return isoDate;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatMonthKeyLabel(monthKey: string): string {
  const parts = (monthKey || '').slice(0, 7).split('-').map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) return monthKey;
  const d = new Date(parts[0], parts[1] - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function getCreditCardCycleForMonth(
  cutoffDay: number,
  dueDay: number | null,
  cycleMonthKey: string,
  referenceDate: Date = new Date()
): CreditCardCycleInfo {
  const cleanCutoffDay = Math.min(31, Math.max(1, Math.floor(cutoffDay)));
  const cleanDueDay = dueDay !== null ? Math.min(31, Math.max(1, Math.floor(dueDay))) : null;

  const parts = (cycleMonthKey || '').slice(0, 7).split('-').map(Number);
  const y = parts.length === 2 && !isNaN(parts[0]) ? parts[0] : referenceDate.getFullYear();
  const m0 = parts.length === 2 && !isNaN(parts[1]) ? parts[1] - 1 : referenceDate.getMonth();
  const normalizedKey = `${y}-${String(m0 + 1).padStart(2, '0')}`;

  const cutoffDate = buildClampedIsoDate(y, m0, cleanCutoffDay);
  const prevCutoffDate = buildClampedIsoDate(y, m0 - 1, cleanCutoffDay);
  const startDate = addDaysToIsoDate(prevCutoffDate, 1);

  let dueDate: string | null = null;
  if (cleanDueDay !== null) {
    // If due day is on or before cutoff day (e.g. cutoff 15, due 5), payment is due the month AFTER cutoff.
    // If due day is strictly after cutoff day (e.g. cutoff 5, due 25), payment is due the SAME month as cutoff.
    dueDate =
      cleanDueDay <= cleanCutoffDay
        ? buildClampedIsoDate(y, m0 + 1, cleanDueDay)
        : buildClampedIsoDate(y, m0, cleanDueDay);
  }

  const todayIso = getTodayIsoLocal(referenceDate);
  const daysUntilCutoff = diffDaysIso(todayIso, cutoffDate);
  const daysUntilDue = dueDate ? diffDaysIso(todayIso, dueDate) : null;

  let status: CreditCardCycleInfo['status'] = 'open';
  if (todayIso < startDate) {
    status = 'upcoming';
  } else if (todayIso > cutoffDate) {
    status = 'closed';
  }

  return {
    cycleKey: normalizedKey,
    startDate,
    cutoffDate,
    dueDate,
    cutoffDay: cleanCutoffDay,
    dueDay: cleanDueDay,
    label: formatMonthKeyLabel(normalizedKey),
    periodLabel: `${formatShortIsoDate(startDate)} – ${formatShortIsoDate(cutoffDate)}`,
    daysUntilCutoff,
    daysUntilDue,
    status,
    isPastDue: Boolean(dueDate && todayIso > dueDate)
  };
}

export function getActiveCreditCardCycleKey(cutoffDay: number, referenceDate: Date = new Date()): string {
  const cleanCutoffDay = Math.min(31, Math.max(1, Math.floor(cutoffDay)));
  const y = referenceDate.getFullYear();
  const m0 = referenceDate.getMonth();
  const todayIso = getTodayIsoLocal(referenceDate);
  const thisMonthKey = `${y}-${String(m0 + 1).padStart(2, '0')}`;
  const cutoffThisMonth = buildClampedIsoDate(y, m0, cleanCutoffDay);

  return todayIso <= cutoffThisMonth ? thisMonthKey : shiftMonthKey(thisMonthKey, 1);
}

export function getTransactionCreditCardCycleKey(
  txDate: string,
  cutoffDay: number | null,
  explicitCycle?: string | null
): string {
  if (explicitCycle && /^\d{4}-\d{2}$/.test(explicitCycle.trim())) {
    return explicitCycle.trim();
  }
  const cleanDate = (txDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return getTodayIsoLocal().slice(0, 7);
  }
  if (!cutoffDay || cutoffDay < 1 || cutoffDay > 31) {
    return cleanDate.slice(0, 7);
  }

  const [y, m] = cleanDate.split('-').map(Number);
  const monthKey = `${y}-${String(m).padStart(2, '0')}`;
  const cutoffInTxMonth = buildClampedIsoDate(y, m - 1, cutoffDay);

  return cleanDate <= cutoffInTxMonth ? monthKey : shiftMonthKey(monthKey, 1);
}

export function getRecentCreditCardCycles(
  cutoffDay: number,
  dueDay: number | null,
  centerMonthKey?: string,
  pastCount = 8,
  futureCount = 2,
  referenceDate: Date = new Date()
): CreditCardCycleInfo[] {
  const baseKey =
    centerMonthKey && /^\d{4}-\d{2}$/.test(centerMonthKey)
      ? centerMonthKey
      : getActiveCreditCardCycleKey(cutoffDay, referenceDate);

  const list: CreditCardCycleInfo[] = [];
  for (let offset = futureCount; offset >= -pastCount; offset--) {
    const key = shiftMonthKey(baseKey, offset);
    list.push(getCreditCardCycleForMonth(cutoffDay, dueDay, key, referenceDate));
  }
  return list;
}

export interface CleanTransactionDisplay {
  displayTitle: string;
  displayNotes: string;
  isDebtPayment: boolean;
}

/**
 * Strips auto-generated redundant phrasing (e.g. "Transfer: A -> B", "Payment: Card",
 * "Internal transfer from A to B") when account badges already show From -> To.
 */
export function getCleanTransactionDisplay(
  tx: {
    title?: string;
    notes?: string;
    emailContext?: string;
    isTransfer?: boolean;
    isLoanPayment?: boolean;
  },
  fromAccount?: { accountType?: string; name?: string; category?: string } | null,
  toAccount?: { accountType?: string; name?: string; category?: string } | null
): CleanTransactionDisplay {
  const rawTitle = (tx.title || '').trim();
  const rawNotes = (tx.notes || '').trim();
  const isDebtPayment = Boolean(
    tx.isLoanPayment || toAccount?.accountType === 'credit_card' || toAccount?.accountType === 'loan'
  );
  const debtLabel =
    toAccount?.accountType === 'loan' || fromAccount?.accountType === 'loan'
      ? 'Loan Payment'
      : 'Card Payment';

  const redundantTransferTitle = /^(?:transfer\s*:|payment\s*[:-]|pago\s*(?:de\s*)?(?:tarjeta|pr[eé]stamo)\s*[:-]|internal\s+transfer\b|self\s+transfer$)/i;
  const redundantPaymentTitle = /^(?:payment\s*[:-]|pago\s*(?:de\s*)?(?:tarjeta|pr[eé]stamo)\s*[:-])/i;

  let displayTitle = rawTitle;
  if (tx.isTransfer) {
    if (!rawTitle || redundantTransferTitle.test(rawTitle)) {
      displayTitle = isDebtPayment ? debtLabel : 'Self Transfer';
    }
  } else if (tx.isLoanPayment) {
    if (!rawTitle || redundantPaymentTitle.test(rawTitle)) {
      displayTitle = debtLabel;
    }
  }

  const normalizedNotes = rawNotes.toLowerCase();
  const isRedundantNote =
    !rawNotes ||
    /^internal\s+transfer\s+from\s+/i.test(rawNotes) ||
    normalizedNotes === rawTitle.toLowerCase() ||
    normalizedNotes === displayTitle.toLowerCase() ||
    (tx.emailContext ? normalizedNotes === tx.emailContext.trim().toLowerCase() : false);

  return {
    displayTitle: displayTitle || 'Transaction',
    displayNotes: isRedundantNote ? '' : rawNotes,
    isDebtPayment
  };
}


