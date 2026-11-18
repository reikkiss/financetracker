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

export function calculateLoanMonthlyQuota(principal: number, annualApr: number, termMonths: number): number {
  const P = Math.max(0, Number(principal) || 0);
  const apr = Math.max(0, Number(annualApr) || 0);
  const n = Math.min(600, Math.max(0, Math.floor(Number(termMonths) || 0)));
  if (P <= 0 || n <= 0) return 0;

  const monthlyRate = apr / 100 / 12;
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
  customMonthlyQuota?: number;
  existingQuotas?: LoanQuota[];
}): { quotas: LoanQuota[]; monthlyQuota: number; totalInterest: number; totalRepayment: number } {
  const P = Math.max(0, Number(params.principal) || 0);
  const apr = Math.max(0, Number(params.annualApr) || 0);
  const n = Math.min(600, Math.max(0, Math.floor(Number(params.termMonths) || 0)));
  const start = (params.startDate || new Date().toISOString().split('T')[0]).slice(0, 20);

  if (P <= 0 || n <= 0) {
    return { quotas: [], monthlyQuota: 0, totalInterest: 0, totalRepayment: 0 };
  }

  const r = apr / 100 / 12;
  const calculatedMonthly = calculateLoanMonthlyQuota(P, apr, n);
  const targetMonthly =
    params.customMonthlyQuota && params.customMonthlyQuota > 0
      ? Number(params.customMonthlyQuota.toFixed(2))
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
    const interestAmount = Number((balance * r).toFixed(2));
    let principalAmount: number;
    let amount: number;

    if (i === n || balance + interestAmount <= targetMonthly) {
      principalAmount = Number(balance.toFixed(2));
      amount = Number((principalAmount + interestAmount).toFixed(2));
    } else {
      principalAmount = Math.max(0, Number((targetMonthly - interestAmount).toFixed(2)));
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
      // Loan paid off early under custom higher quota
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
