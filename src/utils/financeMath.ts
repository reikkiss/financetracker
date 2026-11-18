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

