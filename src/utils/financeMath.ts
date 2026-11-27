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

/**
 * Checks whether a transaction represents a debt or credit card payment (either a transfer to a credit card/loan,
 * or an explicit loan/card payment).
 */
export function isDebtPaymentTransfer(
  tx: {
    isTransfer?: boolean;
    isLoanPayment?: boolean;
    budgetId?: string;
    transferToBudgetId?: string;
    type?: string;
    category?: string;
  },
  budgets: Array<{ id: string; accountType?: string; name?: string; category?: string }>
): boolean {
  if (Boolean(tx.isLoanPayment)) return true;
  if (!tx.isTransfer) return false;
  if (!tx.transferToBudgetId) return false;
  const target = budgets.find(b => b.id === tx.transferToBudgetId);
  return target?.accountType === 'credit_card' || target?.accountType === 'loan';
}

/**
 * Checks whether a transfer is a pure internal move between liquid bank/debit accounts (neither side is a debt account).
 */
export function isPureInternalTransfer(
  tx: {
    isTransfer?: boolean;
    isLoanPayment?: boolean;
    budgetId?: string;
    transferToBudgetId?: string;
    type?: string;
    category?: string;
  },
  budgets: Array<{ id: string; accountType?: string; name?: string; category?: string }>
): boolean {
  if (!tx.isTransfer) return false;
  return !isDebtPaymentTransfer(tx, budgets);
}

/**
 * Returns true if the transaction is a real financial expense / cash outflow:
 * - Direct expenses (type === 'expense' and not an internal transfer)
 * - Transfers to pay loans or credit cards (debt service outflow)
 * - Direct loan or card payments (isLoanPayment === true)
 * Excludes declined transactions and pure internal self-transfers between liquid bank accounts.
 */
export function isRealExpenseTransaction(
  tx: {
    type?: string;
    isTransfer?: boolean;
    isLoanPayment?: boolean;
    emailOutcome?: string;
    budgetId?: string;
    transferToBudgetId?: string;
    category?: string;
  },
  budgets: Array<{ id: string; accountType?: string; name?: string; category?: string }>
): boolean {
  if (tx.emailOutcome === 'declined') return false;
  if (isDebtPaymentTransfer(tx, budgets)) return true;
  if (tx.isTransfer) return false;
  return tx.type === 'expense';
}

/**
 * Returns the effective spending category for an expense or debt payment.
 */
export function getTransactionExpenseCategory(
  tx: {
    category?: string;
    isTransfer?: boolean;
    isLoanPayment?: boolean;
    budgetId?: string;
    transferToBudgetId?: string;
  },
  budgets: Array<{ id: string; accountType?: string; name?: string; category?: string }>
): string {
  if (isDebtPaymentTransfer(tx, budgets)) {
    const target = budgets.find(b => b.id === tx.transferToBudgetId);
    if (target) {
      if (target.accountType === 'loan') {
        return target.name || target.category || 'Loan Payment';
      }
      if (target.accountType === 'credit_card') {
        return target.name || target.category || 'Card Payment';
      }
    }
    const source = budgets.find(b => b.id === tx.budgetId);
    if (source && (source.accountType === 'loan' || source.accountType === 'credit_card')) {
      return source.name || source.category || 'Debt Payment';
    }
    return tx.category && tx.category !== 'Transfer' ? tx.category : 'Debt Payment';
  }
  return tx.category || 'Other';
}


export interface CardInstallment {
  id: string;
  title: string;
  totalAmount: number;
  termMonths: number;
  monthsPaid: number;
  monthlyQuota: number;
  startDate: string; // YYYY-MM-DD
  chargeDay?: number; // 1..31
  isActive: boolean;
  notes?: string;
}

// ============================================================================
// Layer 2: Credit Card Soft Caps, Golden Cutoff Rule & Installments/Diferidos
// ============================================================================

export type SoftCapLevel = 'none' | 'safe' | 'warning' | 'critical';

export interface SoftCapEvaluation {
  hasSoftCap: boolean;
  softCap: number;
  cycleSpent: number;
  pct: number;
  level: SoftCapLevel;
  remainingToCap: number;
  label: string;
}

export function evaluateCreditCardSoftCap(cycleSpent: number, softCap?: number): SoftCapEvaluation {
  const cap = Math.max(0, Number(softCap) || 0);
  const spent = Math.max(0, Number(cycleSpent) || 0);
  if (cap <= 0) {
    return {
      hasSoftCap: false,
      softCap: 0,
      cycleSpent: spent,
      pct: 0,
      level: 'none',
      remainingToCap: 0,
      label: ''
    };
  }
  const pct = Math.round((spent / cap) * 100);
  const remainingToCap = Number((cap - spent).toFixed(2));
  let level: SoftCapLevel = 'safe';
  let label = `${pct}% de tope personal`;
  if (pct >= 90) {
    level = 'critical';
    label = pct >= 100 ? `Tope excedido (${pct}%)` : `Alerta crítica (${pct}% ≥ 90%)`;
  } else if (pct >= 75) {
    level = 'warning';
    label = `Precaución (${pct}% ≥ 75%)`;
  }
  return {
    hasSoftCap: true,
    softCap: cap,
    cycleSpent: spent,
    pct,
    level,
    remainingToCap,
    label
  };
}

export interface GoldenRuleAdvisory {
  status: 'good' | 'neutral' | 'avoid';
  daysUntilCutoff: number;
  headline: string;
  detail: string;
}

export function getCreditCardGoldenRuleStatus(
  cutoffDay: number,
  dueDay: number | null,
  referenceDate: Date = new Date()
): GoldenRuleAdvisory {
  const activeKey = getActiveCreditCardCycleKey(cutoffDay, referenceDate);
  const info = getCreditCardCycleForMonth(cutoffDay, dueDay, activeKey, referenceDate);
  const days = Math.max(0, info.daysUntilCutoff);

  if (days >= 15) {
    return {
      status: 'good',
      daysUntilCutoff: days,
      headline: `Hoy es buen momento para usarla (corta en ${days} días)`,
      detail: 'Obtendrás el máximo financiamiento sin intereses hasta el próximo mes.'
    };
  }
  if (days <= 5) {
    return {
      status: 'avoid',
      daysUntilCutoff: days,
      headline:
        days === 0
          ? 'Evita usarla hoy (corta hoy — el pago te tocará este mismo ciclo)'
          : `Evita usarla hoy (corta en ${days} ${days === 1 ? 'día' : 'días'} — el pago te tocará este mismo mes)`,
      detail: 'Espera pasar la fecha de corte para ganar ~30 días adicionales de financiamiento.'
    };
  }
  return {
    status: 'neutral',
    daysUntilCutoff: days,
    headline: `Corta en ${days} días`,
    detail: `Fecha de corte: ${formatShortIsoDate(info.cutoffDate)}${info.dueDate ? ` • Pago ${formatShortIsoDate(info.dueDate)}` : ''}`
  };
}

export function calculateCardInstallmentsSummary(installments?: CardInstallment[]): {
  activeCount: number;
  monthlyQuotaTotal: number;
  remainingCommittedTotal: number;
} {
  if (!installments || installments.length === 0) {
    return { activeCount: 0, monthlyQuotaTotal: 0, remainingCommittedTotal: 0 };
  }
  let activeCount = 0;
  let monthlyQuotaTotal = 0;
  let remainingCommittedTotal = 0;

  for (const inst of installments) {
    if (!inst.isActive) continue;
    const remMonths = Math.max(0, (Number(inst.termMonths) || 0) - (Number(inst.monthsPaid) || 0));
    if (remMonths <= 0) continue;
    const quota = Math.max(0, Number(inst.monthlyQuota) || 0);
    activeCount += 1;
    monthlyQuotaTotal += quota;
    remainingCommittedTotal += quota * remMonths;
  }

  return {
    activeCount,
    monthlyQuotaTotal: Number(monthlyQuotaTotal.toFixed(2)),
    remainingCommittedTotal: Number(remainingCommittedTotal.toFixed(2))
  };
}

/**
 * Fuzzy deduplication / reconciliation helper:
 * Matches statement line items against pending flotante transactions.
 * Criteria: Account matches, within ±15% amount tolerance, within ±4 days.
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
    const amountTolerance = Math.max(0.5, ptAmt * 0.15);
    if (amountDiff > amountTolerance) return false;

    const ptDate = new Date(pt.date || Date.now()).getTime();
    const dayDiff = Math.abs(ptDate - incomingDate) / (1000 * 60 * 60 * 24);
    if (dayDiff > 4) return false;

    return true;
  });
}

// ============================================================================
// Smart Bank Transfer Similarity & Auto-Pairing Engine
// ============================================================================

const TRANSFER_KEYWORD_RE =
  /\b(?:transfer(?:encia)?|transf|traspaso|ach|lbtr|wire|interbanc|enviad[ao]|recibid[ao]|pago\s*(?:de\s*)?(?:tarjeta|tc|pr[eé]stamo|cuota|m[ií]nimo|contado)?|abono|payment|pay\s+thank\s+you)\b/i;

function daysBetweenIsoDates(d1?: string, d2?: string): number {
  const t1 = Date.parse((d1 || '').slice(0, 10));
  const t2 = Date.parse((d2 || '').slice(0, 10));
  if (isNaN(t1) || isNaN(t2)) return 999;
  return Math.abs(t1 - t2) / (1000 * 60 * 60 * 24);
}

function isLiquidAccountType(accountType?: string): boolean {
  return accountType === 'bank_account' || accountType === 'debit_account';
}

function isDebtAccountType(accountType?: string): boolean {
  return accountType === 'credit_card' || accountType === 'loan';
}

function titleMentionsAccount(
  title: string | undefined,
  account?: { name?: string; category?: string } | null
): boolean {
  if (!title || !account) return false;
  const hay = title.toLowerCase();
  const candidates = [account.name, account.category]
    .filter(Boolean)
    .map(s => String(s).trim().toLowerCase())
    .filter(s => s.length >= 3);
  for (const label of candidates) {
    if (hay.includes(label)) return true;
    const words = label.split(/\s+/).filter(w => w.length >= 4);
    if (words.some(w => hay.includes(w))) return true;
  }
  return false;
}

export interface SimilarCandidateResult<T = any> {
  tx: T;
  isSuggested: boolean;
  score: number;
  days: number;
  diff: number;
  reasons: string[];
}

/**
 * Ranks potential counterpart transactions for a selected primary transaction
 * (works both for unlinked entries and existing transfers that may have a duplicate mirror entry).
 */
export function findSimilarCandidatesForTransaction<
  T extends {
    id: string;
    title?: string;
    amount: number;
    type?: string;
    category?: string;
    date?: string;
    budgetId?: string;
    transferToBudgetId?: string;
    isTransfer?: boolean;
    isLoanPayment?: boolean;
    emailOutcome?: string;
  },
  B extends { id: string; name?: string; category?: string; accountType?: string }
>(primaryTx: T, transactions: T[], budgets: B[]): SimilarCandidateResult<T>[] {
  const primaryAmt = Math.abs(Number(primaryTx.amount) || 0);
  const primaryDate = primaryTx.date || '';
  const budgetById: Record<string, B> = {};
  budgets.forEach(b => {
    budgetById[b.id] = b;
  });

  const primaryAcc = primaryTx.budgetId ? budgetById[primaryTx.budgetId] : undefined;
  const primaryDestAcc = primaryTx.transferToBudgetId ? budgetById[primaryTx.transferToBudgetId] : undefined;

  return transactions
    .filter(t => {
      if (t.id === primaryTx.id) return false;
      if (t.emailOutcome === 'declined') return false;

      if (primaryTx.isTransfer) {
        // When primary is already a transfer, allow pairing with an unlinked mirror entry
        // in the destination or source account (or a partial transfer), but skip unrelated transfers
        if (t.isTransfer && t.budgetId && t.transferToBudgetId) {
          const isSameOrMirrorPair =
            (t.budgetId === primaryTx.budgetId && t.transferToBudgetId === primaryTx.transferToBudgetId) ||
            (t.budgetId === primaryTx.transferToBudgetId && t.transferToBudgetId === primaryTx.budgetId);
          if (!isSameOrMirrorPair) return false;
        }
        return true;
      }

      // If primary is unlinked: skip complete transfers unless it connects to primary's account
      if (t.isTransfer && t.budgetId && t.transferToBudgetId) {
        if (
          primaryTx.budgetId &&
          t.budgetId !== primaryTx.budgetId &&
          t.transferToBudgetId !== primaryTx.budgetId
        ) {
          return false;
        }
      }

      // Usually counterparty is in a different account
      if (primaryTx.budgetId && t.budgetId && t.budgetId === primaryTx.budgetId && !t.isTransfer) {
        return false;
      }
      return true;
    })
    .map(t => {
      const amt = Math.abs(Number(t.amount) || 0);
      const diff = Math.abs(amt - primaryAmt);
      const days = daysBetweenIsoDates(t.date, primaryDate);
      const oppositeType = t.type !== primaryTx.type;
      const exactAmount = diff <= 0.01 && primaryAmt > 0;
      const closeAmount = diff <= Math.max(1, primaryAmt * 0.02);
      const closeDate = days <= 5;
      const candAcc = t.budgetId ? budgetById[t.budgetId] : undefined;

      const liquidDebtPair =
        (isLiquidAccountType(primaryAcc?.accountType) && isDebtAccountType(candAcc?.accountType)) ||
        (isLiquidAccountType(candAcc?.accountType) && isDebtAccountType(primaryAcc?.accountType));

      const mirrorOfExistingTransfer = Boolean(
        primaryTx.isTransfer &&
          ((primaryTx.transferToBudgetId && t.budgetId === primaryTx.transferToBudgetId) ||
            (primaryTx.budgetId && t.budgetId === primaryTx.budgetId && t.type === 'expense'))
      );

      const keywordSignal =
        TRANSFER_KEYWORD_RE.test(primaryTx.title || '') ||
        TRANSFER_KEYWORD_RE.test(t.title || '') ||
        Boolean(primaryTx.isLoanPayment) ||
        Boolean(t.isLoanPayment);

      const crossMention =
        titleMentionsAccount(primaryTx.title, candAcc) ||
        titleMentionsAccount(t.title, primaryAcc) ||
        titleMentionsAccount(t.title, primaryDestAcc);

      const isSuggested =
        closeAmount &&
        closeDate &&
        (oppositeType || mirrorOfExistingTransfer || liquidDebtPair || Boolean(t.isTransfer));

      const reasons: string[] = [];
      if (exactAmount) reasons.push('Exact amount');
      else if (closeAmount) reasons.push('~Amount');
      if (days <= 0.5) reasons.push('Same day');
      else if (days <= 5) reasons.push(`${Math.round(days)}d apart`);
      if (mirrorOfExistingTransfer) reasons.push('Mirror entry');
      if (liquidDebtPair) reasons.push('Bank → Card/Loan');
      if (crossMention) reasons.push('Mentions bank');

      const score =
        (isSuggested ? 100 : 0) +
        (exactAmount ? 50 : closeAmount ? 30 : 0) +
        (oppositeType ? 25 : 0) +
        (mirrorOfExistingTransfer ? 35 : 0) +
        (liquidDebtPair ? 20 : 0) +
        (crossMention ? 20 : 0) +
        (keywordSignal ? 10 : 0) +
        (days <= 7 ? Math.max(0, 25 - days * 3) : 0);

      return { tx: t, isSuggested, score, days, diff, reasons };
    })
    .sort((a, b) => b.score - a.score || (b.tx.date || '').localeCompare(a.tx.date || ''));
}

export interface TransferMatchCandidate<T = any> {
  id: string;
  primaryTx: T;
  partnerTx: T;
  fromBudgetId: string;
  toBudgetId: string;
  amount: number;
  date: string;
  title: string;
  confidence: 'exact' | 'high' | 'possible';
  score: number;
  reasons: string[];
}

/**
 * Scans the entire transaction ledger and finds best 1-to-1 similar transfer pairs
 * across accounts (both existing transfers with unattached mirror entries and
 * unlinked opposing transfer pairs) so they can be attached & merged cleanly.
 */
export function findSimilarTransferPairs<
  T extends {
    id: string;
    title?: string;
    amount: number;
    type?: string;
    category?: string;
    date?: string;
    budgetId?: string;
    transferToBudgetId?: string;
    isTransfer?: boolean;
    isLoanPayment?: boolean;
    emailOutcome?: string;
  },
  B extends { id: string; name?: string; category?: string; accountType?: string }
>(transactions: T[], budgets: B[]): TransferMatchCandidate<T>[] {
  if (budgets.length < 2 || transactions.length < 2) return [];

  const budgetById: Record<string, B> = {};
  budgets.forEach(b => {
    budgetById[b.id] = b;
  });

  const activeTxs = transactions.filter(
    t => t.emailOutcome !== 'declined' && Math.abs(Number(t.amount) || 0) > 0
  );

  const candidates: TransferMatchCandidate<T>[] = [];

  const inferBudgetFromTitle = (title?: string, excludeId?: string): string => {
    if (!title) return '';
    const match = budgets.find(b => b.id !== excludeId && titleMentionsAccount(title, b));
    return match?.id || '';
  };

  for (let i = 0; i < activeTxs.length; i++) {
    const a = activeTxs[i];
    const amtA = Math.abs(Number(a.amount) || 0);

    for (let j = i + 1; j < activeTxs.length; j++) {
      const b = activeTxs[j];
      const amtB = Math.abs(Number(b.amount) || 0);

      // Must be within 1% or $0.50
      const diff = Math.abs(amtA - amtB);
      const maxTol = Math.max(0.5, Math.max(amtA, amtB) * 0.01);
      if (diff > maxTol) continue;

      // Must be within 5 days
      const days = daysBetweenIsoDates(a.date, b.date);
      if (days > 5) continue;

      const aCompleteTransfer = Boolean(a.isTransfer && a.budgetId && a.transferToBudgetId);
      const bCompleteTransfer = Boolean(b.isTransfer && b.budgetId && b.transferToBudgetId);

      // Avoid merging two separate complete transfers unless they are true duplicates/mirrors within 2 days & exact amount
      if (aCompleteTransfer && bCompleteTransfer) {
        const isExactDuplicateOrMirror =
          diff <= 0.01 &&
          days <= 2 &&
          ((a.budgetId === b.budgetId && a.transferToBudgetId === b.transferToBudgetId) ||
            (a.budgetId === b.transferToBudgetId && a.transferToBudgetId === b.budgetId));
        if (!isExactDuplicateOrMirror) continue;
      }

      const accA = a.budgetId ? budgetById[a.budgetId] : undefined;
      const accB = b.budgetId ? budgetById[b.budgetId] : undefined;

      let primaryTx: T = a;
      let partnerTx: T = b;
      let fromBudgetId = '';
      let toBudgetId = '';

      if (a.isTransfer || b.isTransfer) {
        const tr = a.isTransfer ? a : b;
        const other = a.isTransfer ? b : a;
        primaryTx = tr;
        partnerTx = other;

        if (tr.budgetId && tr.transferToBudgetId && tr.budgetId !== tr.transferToBudgetId) {
          // Verify `other` relates to either endpoint of `tr`
          const relatesToEndpoint =
            !other.budgetId ||
            other.budgetId === tr.transferToBudgetId ||
            (other.budgetId === tr.budgetId && other.type === 'expense') ||
            (other.isTransfer &&
              ((other.budgetId === tr.budgetId && other.transferToBudgetId === tr.transferToBudgetId) ||
                (other.budgetId === tr.transferToBudgetId && other.transferToBudgetId === tr.budgetId)));
          if (!relatesToEndpoint) continue;
          fromBudgetId = tr.budgetId;
          toBudgetId = tr.transferToBudgetId;
        } else {
          // Partial transfer without full endpoints
          if (other.type === 'income' && other.budgetId && tr.budgetId !== other.budgetId) {
            fromBudgetId = tr.budgetId || inferBudgetFromTitle(tr.title, other.budgetId);
            toBudgetId = other.budgetId;
          } else if (other.type === 'expense' && other.budgetId && tr.budgetId !== other.budgetId) {
            fromBudgetId = other.budgetId;
            toBudgetId = tr.budgetId || inferBudgetFromTitle(other.title, other.budgetId);
          }
        }
      } else {
        // Neither is marked as transfer yet
        if (a.budgetId && b.budgetId && a.budgetId === b.budgetId) continue;

        const oppositeType = a.type !== b.type;
        const oneLiquidOneDebt =
          (isLiquidAccountType(accA?.accountType) && isDebtAccountType(accB?.accountType)) ||
          (isLiquidAccountType(accB?.accountType) && isDebtAccountType(accA?.accountType));
        const hasKeyword =
          TRANSFER_KEYWORD_RE.test(a.title || '') ||
          TRANSFER_KEYWORD_RE.test(b.title || '') ||
          TRANSFER_KEYWORD_RE.test(a.category || '') ||
          TRANSFER_KEYWORD_RE.test(b.category || '') ||
          Boolean(a.isLoanPayment) ||
          Boolean(b.isLoanPayment);
        const crossMention = titleMentionsAccount(a.title, accB) || titleMentionsAccount(b.title, accA);

        const validSignal =
          (oppositeType && Boolean(a.budgetId && b.budgetId)) ||
          (oneLiquidOneDebt && (oppositeType || hasKeyword)) ||
          (hasKeyword && Boolean(a.budgetId && b.budgetId)) ||
          crossMention;

        if (!validSignal) continue;

        if (a.type === 'expense' && b.type === 'income') {
          primaryTx = a;
          partnerTx = b;
          fromBudgetId = a.budgetId || inferBudgetFromTitle(a.title, b.budgetId);
          toBudgetId = b.budgetId || inferBudgetFromTitle(b.title, a.budgetId);
        } else if (b.type === 'expense' && a.type === 'income') {
          primaryTx = b;
          partnerTx = a;
          fromBudgetId = b.budgetId || inferBudgetFromTitle(b.title, a.budgetId);
          toBudgetId = a.budgetId || inferBudgetFromTitle(a.title, b.budgetId);
        } else if (isLiquidAccountType(accA?.accountType) && isDebtAccountType(accB?.accountType)) {
          primaryTx = a;
          partnerTx = b;
          fromBudgetId = a.budgetId || '';
          toBudgetId = b.budgetId || '';
        } else if (isLiquidAccountType(accB?.accountType) && isDebtAccountType(accA?.accountType)) {
          primaryTx = b;
          partnerTx = a;
          fromBudgetId = b.budgetId || '';
          toBudgetId = a.budgetId || '';
        } else {
          // Both same type & liquid: use keyword hints like "enviado" vs "recibido" or title mention
          const aLooksOutgoing = /\b(?:enviad[ao]|sent|out|hacia|to\b|pago|payment)\b/i.test(a.title || '');
          const bLooksOutgoing = /\b(?:enviad[ao]|sent|out|hacia|to\b|pago|payment)\b/i.test(b.title || '');
          if (bLooksOutgoing && !aLooksOutgoing) {
            primaryTx = b;
            partnerTx = a;
            fromBudgetId = b.budgetId || '';
            toBudgetId = a.budgetId || '';
          } else {
            primaryTx = a;
            partnerTx = b;
            fromBudgetId = a.budgetId || '';
            toBudgetId = b.budgetId || '';
          }
        }
      }

      if (!fromBudgetId || !toBudgetId || fromBudgetId === toBudgetId) continue;

      const fromAcc = budgetById[fromBudgetId];
      const toAcc = budgetById[toBudgetId];
      const exactAmt = diff <= 0.01;
      const oppositeTypes = primaryTx.type !== partnerTx.type;
      const isDebtPair = isDebtAccountType(toAcc?.accountType);
      const hasKeyword =
        TRANSFER_KEYWORD_RE.test(primaryTx.title || '') ||
        TRANSFER_KEYWORD_RE.test(partnerTx.title || '') ||
        Boolean(primaryTx.isLoanPayment) ||
        Boolean(partnerTx.isLoanPayment);
      const crossMention =
        titleMentionsAccount(primaryTx.title, toAcc) || titleMentionsAccount(partnerTx.title, fromAcc);

      const reasons: string[] = [];
      if (exactAmt) reasons.push('Exact amount');
      else reasons.push('~Amount');
      if (days <= 0.5) reasons.push('Same day');
      else reasons.push(`${Math.round(days)}d apart`);
      if (primaryTx.isTransfer) reasons.push('Mirror of transfer');
      if (isDebtPair) reasons.push(toAcc?.accountType === 'loan' ? 'Bank → Loan' : 'Bank → Card');
      else reasons.push('Bank ↔ Bank');
      if (crossMention) reasons.push('Account name match');

      let score = 0;
      score += exactAmt ? 50 : 25;
      score += days <= 0.5 ? 40 : days <= 2 ? 28 : 14;
      score += primaryTx.isTransfer ? 30 : 0;
      score += oppositeTypes ? 25 : 0;
      score += isDebtPair ? 15 : 0;
      score += hasKeyword ? 15 : 0;
      score += crossMention ? 20 : 0;

      const confidence: TransferMatchCandidate['confidence'] =
        exactAmt && days <= 2 && (oppositeTypes || Boolean(primaryTx.isTransfer) || isDebtPair)
          ? 'exact'
          : score >= 105
          ? 'high'
          : 'possible';

      candidates.push({
        id: `${primaryTx.id}__${partnerTx.id}`,
        primaryTx,
        partnerTx,
        fromBudgetId,
        toBudgetId,
        amount: Math.abs(Number(primaryTx.amount) || amtA),
        date: primaryTx.date || partnerTx.date || '',
        title: primaryTx.title || partnerTx.title || (isDebtPair ? 'Debt Payment' : 'Bank Transfer'),
        confidence,
        score,
        reasons
      });
    }
  }

  // Greedy 1-to-1 optimal pairing so no transaction is used twice
  candidates.sort((x, y) => y.score - x.score || (y.date || '').localeCompare(x.date || ''));
  const usedIds = new Set<string>();
  const matched: TransferMatchCandidate<T>[] = [];

  for (const cand of candidates) {
    if (usedIds.has(cand.primaryTx.id) || usedIds.has(cand.partnerTx.id)) continue;
    usedIds.add(cand.primaryTx.id);
    usedIds.add(cand.partnerTx.id);
    matched.push(cand);
  }

  return matched;
}

