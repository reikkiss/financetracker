import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  CreditCard,
  Landmark,
  Wallet,
  Building2,
  ArrowRightLeft,
  CheckSquare,
  Square,
  Calendar,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react';
import {
  LoanQuota,
  LoanCalcMethod,
  LoanRatePeriod,
  addMonthsToIsoDate,
  calculateCreditCardMonthlyLimit,
  calculateLoanMonthlyQuota,
  getMonthlyInterestRate
} from '../utils/financeMath';

export type { LoanQuota, LoanCalcMethod, LoanRatePeriod };

export interface BudgetItem {
  id: string;
  name: string;
  amount: number;
  isPaid: boolean;
}

export interface Budget {
  id: string;
  userId: string;
  name: string;
  category: string;
  description?: string;
  limit: number;
  color: string;
  accountType?: 'standard' | 'credit_card' | 'loan' | 'bank_account' | 'debit_account';
  apr?: number;
  creditLimit?: number;
  overdraftPercentage?: number;
  actualUsedAmount?: number;
  accountBalance?: number;
  extraExpenses?: number;
  items?: BudgetItem[];
  loanTermMonths?: number;
  loanStartDate?: string;
  loanCalcMethod?: LoanCalcMethod;
  loanRatePeriod?: LoanRatePeriod;
  monthlyQuota?: number;
  loanQuotas?: LoanQuota[];
}

interface BudgetsPageProps {
  budgets: Budget[];
  transactions: any[];
  currencySymbol?: string;
  selectedMonth?: string;
  onOpenAddBudget: () => void;
  onOpenEditBudget: (budget: Budget) => void;
  onDeleteBudget: (id: string) => void;
  onToggleItemPaid: (budgetId: string, itemId: string) => void;
  onOpenRecordPayment?: (budget: Budget) => void;
  onOpenTransfer?: (fromBudget?: Budget) => void;
  onToggleLoanQuotaPaid?: (budgetId: string, quotaId: string) => void;
  onReconcileLoanPayments?: (budgetId: string) => Promise<void>;
  onAddLoanQuota?: (
    budgetId: string,
    quota: { dueDate: string; amount: number; principalAmount: number; interestAmount: number }
  ) => Promise<void>;
  onDeleteLoanQuota?: (budgetId: string, quotaId: string) => Promise<void>;
  onGenerateLoanQuotas?: (budgetId: string) => Promise<void>;
}

export default function BudgetsPage({
  budgets,
  transactions,
  currencySymbol = '$',
  selectedMonth,
  onOpenAddBudget,
  onOpenEditBudget,
  onDeleteBudget,
  onToggleItemPaid,
  onOpenRecordPayment,
  onOpenTransfer,
  onToggleLoanQuotaPaid,
  onReconcileLoanPayments,
  onAddLoanQuota,
  onDeleteLoanQuota,
  onGenerateLoanQuotas
}: BudgetsPageProps) {
  const [expandedLoans, setExpandedLoans] = useState<Record<string, boolean>>({});
  const [addingQuotaLoanId, setAddingQuotaLoanId] = useState<string | null>(null);
  const [newQuotaDueDate, setNewQuotaDueDate] = useState('');
  const [newQuotaAmount, setNewQuotaAmount] = useState('');
  const [newQuotaPrincipal, setNewQuotaPrincipal] = useState('');
  const [newQuotaInterest, setNewQuotaInterest] = useState('');

  // Aggregate debt metrics
  const debtAccounts = budgets.filter(b => b.accountType === 'credit_card' || b.accountType === 'loan');
  const totalDebtBalance = debtAccounts.reduce((s, b) => s + (b.actualUsedAmount || 0), 0);
  const totalDebtLimit = debtAccounts.reduce((s, b) => {
    if (b.accountType === 'credit_card') {
      const { monthlyLimit } = calculateCreditCardMonthlyLimit(b.creditLimit || b.limit || 0, b.overdraftPercentage || 0);
      return s + monthlyLimit;
    }
    return s + (b.creditLimit || b.limit || 0);
  }, 0);

  // Aggregate liquid (bank & debit) account metrics
  const bankAccounts = budgets.filter(b => b.accountType === 'bank_account');
  const debitAccounts = budgets.filter(b => b.accountType === 'debit_account');
  const liquidAccounts = [...bankAccounts, ...debitAccounts];
  const totalBankBalance = bankAccounts.reduce((s, b) => s + (Number(b.accountBalance) || 0), 0);
  const totalDebitBalance = debitAccounts.reduce((s, b) => s + (Number(b.accountBalance) || 0), 0);
  const totalLiquidBalance = totalBankBalance + totalDebitBalance;

  const openInlineAddQuota = (b: Budget) => {
    const existing = b.loanQuotas || [];
    const lastDueDate =
      existing.length > 0
        ? addMonthsToIsoDate(existing[existing.length - 1].dueDate, 1)
        : b.loanStartDate || new Date().toISOString().split('T')[0];

    const ratePeriod: LoanRatePeriod = b.loanRatePeriod || 'annual';
    const calcMethod: LoanCalcMethod = b.loanCalcMethod || 'amortized';
    const basePrincipal = Number(b.creditLimit || b.limit || 0);
    const remBal = Number(b.actualUsedAmount ?? basePrincipal);
    const monthlyRate = getMonthlyInterestRate(Number(b.apr) || 0, ratePeriod);
    const interestBase = calcMethod === 'flat' ? basePrincipal : remBal;
    const estInterest = Number((interestBase * monthlyRate).toFixed(2));
    const estTotal =
      Number(b.monthlyQuota) ||
      calculateLoanMonthlyQuota(basePrincipal, Number(b.apr || 0), Number(b.loanTermMonths || 12), {
        ratePeriod,
        calcMethod
      }) ||
      0;
    const estPrincipal = estTotal > 0 ? Math.max(0, Number((estTotal - estInterest).toFixed(2))) : 0;

    setAddingQuotaLoanId(b.id);
    setNewQuotaDueDate(lastDueDate);
    setNewQuotaInterest(estInterest > 0 ? estInterest.toString() : '0');
    setNewQuotaPrincipal(estPrincipal > 0 ? estPrincipal.toString() : '');
    setNewQuotaAmount(estTotal > 0 ? estTotal.toString() : '');
    setExpandedLoans(prev => ({ ...prev, [b.id]: true }));
  };

  const handleSaveInlineQuota = async (e: React.FormEvent, budgetId: string) => {
    e.preventDefault();
    if (!onAddLoanQuota) return;
    const principalVal = Math.max(0, parseFloat(newQuotaPrincipal) || 0);
    const interestVal = Math.max(0, parseFloat(newQuotaInterest) || 0);
    const parsedAmount = parseFloat(newQuotaAmount);
    const amountVal = !isNaN(parsedAmount) && parsedAmount > 0 ? parsedAmount : Number((principalVal + interestVal).toFixed(2));
    if (amountVal <= 0) return;

    const finalPrincipal = principalVal > 0 ? principalVal : Math.max(0, Number((amountVal - interestVal).toFixed(2)));
    await onAddLoanQuota(budgetId, {
      dueDate: newQuotaDueDate || new Date().toISOString().split('T')[0],
      amount: Number(amountVal.toFixed(2)),
      principalAmount: Number(finalPrincipal.toFixed(2)),
      interestAmount: Number(interestVal.toFixed(2))
    });
    setAddingQuotaLoanId(null);
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-7xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[12px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block">
            ACCOUNTS & OBLIGATIONS
          </span>
          <h2 className="text-2xl font-bold text-[#1D1D1F] dark:text-white tracking-[-0.03em]">Budgets, Bank & Debt Accounts</h2>
          <p className="text-xs text-[#86868B] mt-0.5">
            Manage bank & debit accounts, standard budgets, credit cards with overdraft limits, loans, and transfers.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onOpenTransfer && budgets.length >= 2 && (
            <button
              onClick={() => onOpenTransfer()}
              className="bg-[#0071E3]/10 hover:bg-[#0071E3]/20 text-[#0071E3] dark:text-[#5AC8FA] border border-[#0071E3]/25 px-4 py-2 rounded-full text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
            </button>
          )}
          <button
            onClick={onOpenAddBudget}
            className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-4 py-2 rounded-full text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Set New Budget / Account
          </button>
        </div>
      </div>

      {/* Liquid Accounts Overview Cards */}
      {liquidAccounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 p-5 rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl">
            <span className="text-[11px] uppercase tracking-wider text-[#86868B] font-semibold block">Total Bank & Debit Balance</span>
            <span className={`text-xl font-bold tabular-nums block mt-1 ${totalLiquidBalance >= 0 ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#D70015] dark:text-[#FF3B30]'}`}>
              {currencySymbol}{totalLiquidBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#86868B]">Across {liquidAccounts.length} cash & checking accounts</span>
          </div>
          <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 p-5 rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl">
            <span className="text-[11px] uppercase tracking-wider text-[#86868B] font-semibold block">Bank Accounts ({bankAccounts.length})</span>
            <span className="text-xl font-bold tabular-nums text-[#0071E3] dark:text-[#5AC8FA] block mt-1">
              {currencySymbol}{totalBankBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#86868B]">Checking & savings balances</span>
          </div>
          <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 p-5 rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl">
            <span className="text-[11px] uppercase tracking-wider text-[#86868B] font-semibold block">Debit Accounts ({debitAccounts.length})</span>
            <span className="text-xl font-bold tabular-nums text-[#248A3D] dark:text-[#34C759] block mt-1">
              {currencySymbol}{totalDebitBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#86868B]">Debit cards & everyday cash</span>
          </div>
        </div>
      )}

      {/* Debt & Credit Overview Cards */}
      {debtAccounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 p-5 rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl">
            <span className="text-[11px] uppercase tracking-wider text-[#86868B] font-semibold block">Total Debt / Loan Balance</span>
            <span className="text-xl font-bold tabular-nums text-[#D70015] dark:text-[#FF3B30] block mt-1">
              {currencySymbol}{totalDebtBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#86868B]">Across {debtAccounts.length} credit lines & loans</span>
          </div>
          <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 p-5 rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl">
            <span className="text-[11px] uppercase tracking-wider text-[#86868B] font-semibold block">Total Authorized Capacity</span>
            <span className="text-xl font-bold tabular-nums text-[#1D1D1F] dark:text-white block mt-1">
              {currencySymbol}{totalDebtLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#86868B]">Credit limits (incl. overdraft) + loan principals</span>
          </div>
          <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 p-5 rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl">
            <span className="text-[11px] uppercase tracking-wider text-[#86868B] font-semibold block">Available Credit / Paid Principal</span>
            <span className="text-xl font-bold tabular-nums text-[#248A3D] dark:text-[#34C759] block mt-1">
              {currencySymbol}{Math.max(0, totalDebtLimit - totalDebtBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-[#86868B] tabular-nums">
              {totalDebtLimit > 0 ? `${Math.round(((totalDebtLimit - totalDebtBalance) / totalDebtLimit) * 100)}% remaining capacity` : '0%'}
            </span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {budgets.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 rounded-[22px] p-12 text-center text-xs text-[#86868B] space-y-3 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl">
          <p>No budgets, bank accounts, or debt accounts configured in database yet.</p>
          <button onClick={onOpenAddBudget} className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-5 py-2.5 rounded-full font-semibold transition">
            Create First Budget / Account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {budgets.map(b => {
            const budgetCatName = (b.name || b.category || '').trim();
            const isCreditCard = b.accountType === 'credit_card';
            const isLoan = b.accountType === 'loan';
            const isBankAccount = b.accountType === 'bank_account';
            const isDebitAccount = b.accountType === 'debit_account';
            const isCreditOrLoan = isCreditCard || isLoan;
            const isLiquidAccount = isBankAccount || isDebitAccount;
            const isStandard = !isCreditOrLoan && !isLiquidAccount;

            const spent = transactions
              .filter(
                t =>
                  t.type === 'expense' &&
                  !t.isLoanPayment &&
                  !t.isTransfer &&
                  (t.budgetId === b.id || (t.category || '').trim().toLowerCase() === budgetCatName.toLowerCase())
              )
              .reduce((sum, t) => sum + t.amount, 0);

            // Standard budget checklist items ONLY
            const items = isStandard ? (b.items || []) : [];
            const paidItemsCount = items.filter(i => i.isPaid).length;
            const itemsSum = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
            const extraExpenses = isStandard ? (Number(b.extraExpenses) || 0) : 0;

            // Credit Card calculations (Credit Limit + Overdraft % = Monthly Limit)
            const baseCreditLimit = Number(b.creditLimit || b.limit) || 0;
            const ccCalc = calculateCreditCardMonthlyLimit(baseCreditLimit, b.overdraftPercentage || 0);
            const effectiveLimit = isCreditCard
              ? (ccCalc.monthlyLimit > 0 ? ccCalc.monthlyLimit : b.limit)
              : b.limit;

            // Liquid Account (Bank / Debit) metrics
            const currentCashBalance = Number(b.accountBalance) || 0;
            const directInflows = transactions
              .filter(t => !t.isTransfer && t.type === 'income' && t.budgetId === b.id)
              .reduce((s, t) => s + t.amount, 0);
            const transfersIn = transactions
              .filter(t => t.isTransfer && t.transferToBudgetId === b.id)
              .reduce((s, t) => s + t.amount, 0);
            const directOutflows = transactions
              .filter(t => !t.isTransfer && t.type === 'expense' && t.budgetId === b.id)
              .reduce((s, t) => s + t.amount, 0);
            const transfersOut = transactions
              .filter(t => t.isTransfer && t.budgetId === b.id)
              .reduce((s, t) => s + t.amount, 0);
            const totalInflows = directInflows + transfersIn;
            const totalOutflows = directOutflows + transfersOut;

            const usedBalance = Number(b.actualUsedAmount) || 0;
            const availableCredit = isCreditCard
              ? Math.max(0, ccCalc.monthlyLimit - usedBalance)
              : Math.max(0, baseCreditLimit - usedBalance);
            const utilizationDenom = isCreditCard ? ccCalc.monthlyLimit : baseCreditLimit;
            const utilizationPct = utilizationDenom > 0 ? Math.min(Math.round((usedBalance / utilizationDenom) * 100), 100) : 0;

            // Loan calculations & Quotas
            const loanPrincipal = Number(b.creditLimit || b.limit) || 0;
            const loanRatePeriod: LoanRatePeriod = b.loanRatePeriod || 'annual';
            const loanCalcMethod: LoanCalcMethod = b.loanCalcMethod || 'amortized';
            const monthlyRatePct = getMonthlyInterestRate(Number(b.apr) || 0, loanRatePeriod) * 100;
            const loanQuotas = isLoan ? (b.loanQuotas || []) : [];
            const paidQuotasCount = loanQuotas.filter(q => q.isPaid).length;
            const nextDueQuota = loanQuotas.find(q => !q.isPaid);
            const computedQuota =
              Number(b.monthlyQuota) ||
              calculateLoanMonthlyQuota(loanPrincipal, Number(b.apr) || 0, Number(b.loanTermMonths) || 0, {
                ratePeriod: loanRatePeriod,
                calcMethod: loanCalcMethod
              }) ||
              (loanQuotas[0]?.amount || 0);
            const totalLoanInterest =
              loanQuotas.length > 0
                ? Number(loanQuotas.reduce((s, q) => s + (Number(q.interestAmount) || 0), 0).toFixed(2))
                : Math.max(0, Number((computedQuota * (Number(b.loanTermMonths) || 0) - loanPrincipal).toFixed(2)));
            const remainingLoanInterest = Number(
              loanQuotas
                .filter(q => !q.isPaid)
                .reduce((s, q) => s + (Number(q.interestAmount) || 0), 0)
                .toFixed(2)
            );
            const paidOffPrincipal = Math.max(0, loanPrincipal - usedBalance);
            const loanPaidOffPct = loanPrincipal > 0 ? Math.min(100, Math.round((paidOffPrincipal / loanPrincipal) * 100)) : 0;
            const isScheduleExpanded = Boolean(expandedLoans[b.id]);

            // Related payments (including transfers targeting this credit card or loan)
            const relatedPayments = transactions.filter(
              t =>
                ((t.budgetId === b.id || (t.category || '').toLowerCase() === budgetCatName.toLowerCase()) && t.isLoanPayment && !t.isTransfer) ||
                (t.isTransfer && t.transferToBudgetId === b.id)
            );
            const totalPaymentsMade = relatedPayments.reduce((s, t) => s + t.amount, 0);
            const hasFullLoanSplit =
              isLoan &&
              relatedPayments.length > 0 &&
              relatedPayments.every(
                t => typeof t.loanPrincipalPaid === 'number' && typeof t.loanInterestPaid === 'number'
              );
            const totalLoanPrincipalPaid = isLoan
              ? hasFullLoanSplit
                ? Number(relatedPayments.reduce((s, t) => s + (Number(t.loanPrincipalPaid) || 0), 0).toFixed(2))
                : paidOffPrincipal
              : 0;
            const totalLoanInterestPaid = isLoan
              ? hasFullLoanSplit
                ? Number(relatedPayments.reduce((s, t) => s + (Number(t.loanInterestPaid) || 0), 0).toFixed(2))
                : Number(
                    Math.max(
                      loanQuotas.filter(q => q.isPaid).reduce((s, q) => s + (Number(q.interestAmount) || 0), 0),
                      Math.max(0, totalPaymentsMade - paidOffPrincipal)
                    ).toFixed(2)
                  )
              : 0;
            const totalLoanPayoffLeft = Number((usedBalance + remainingLoanInterest).toFixed(2));
            const currentMonthPrefix = selectedMonth && selectedMonth !== 'All' ? selectedMonth : new Date().toISOString().slice(0, 7);
            const currentMonthLoanPaid = relatedPayments
              .filter(t => String(t.date || '').startsWith(currentMonthPrefix))
              .reduce((s, t) => s + t.amount, 0);

            const linkedQuotaTxIds = new Set(
              loanQuotas.filter(q => q.isPaid && q.paymentTxId).map(q => q.paymentTxId as string)
            );
            const unlinkedLoanPayments = isLoan
              ? relatedPayments.filter(t => {
                  if (linkedQuotaTxIds.has(t.id)) return false;
                  if (t.paidQuotaIds && t.paidQuotaIds.length > 0) {
                    const stillPaid = t.paidQuotaIds.some((qid: string) => loanQuotas.some(q => q.id === qid && q.isPaid));
                    if (stillPaid) return false;
                  }
                  return true;
                })
              : [];
            const unlinkedLoanTotal = Number(
              unlinkedLoanPayments.reduce((s, t) => s + (Number(t.amount) || 0), 0).toFixed(2)
            );

            return (
              <div
                key={b.id}
                className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 p-5 rounded-[22px] space-y-4 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl hover:border-black/[0.1] dark:hover:border-white/20 transition"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 truncate">
                    <div className="w-9 h-9 rounded-xl bg-[#F2F2F7] dark:bg-[#191919] border border-black/[0.05] dark:border-[#2c2c2c] flex items-center justify-center shrink-0 mt-0.5">
                      {isCreditCard ? (
                        <CreditCard className="w-4 h-4 text-[#FF9F0A]" />
                      ) : isLoan ? (
                        <Landmark className="w-4 h-4 text-[#AF52DE]" />
                      ) : isBankAccount ? (
                        <Building2 className="w-4 h-4 text-[#0071E3]" />
                      ) : isDebitAccount ? (
                        <Wallet className="w-4 h-4 text-[#248A3D] dark:text-teal-400" />
                      ) : (
                        <Wallet className="w-4 h-4 text-[#248A3D] dark:text-[#34C759]" />
                      )}
                    </div>
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#1D1D1F] dark:text-white text-sm truncate">{budgetCatName}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          isCreditCard
                            ? 'bg-[#FF9F0A]/12 text-[#B25000] dark:text-amber-400 border border-[#FF9F0A]/25'
                            : isLoan
                            ? 'bg-[#AF52DE]/12 text-[#8944AB] dark:text-purple-400 border border-[#AF52DE]/25'
                            : isBankAccount
                            ? 'bg-[#0071E3]/10 text-[#0071E3] dark:text-sky-400 border border-[#0071E3]/25'
                            : isDebitAccount
                            ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/25'
                            : 'bg-[#34C759]/12 text-[#248A3D] dark:text-emerald-400 border border-[#34C759]/25'
                        }`}>
                          {isCreditCard
                            ? 'Credit Card'
                            : isLoan
                            ? 'Loan Account'
                            : isBankAccount
                            ? 'Bank Account'
                            : isDebitAccount
                            ? 'Debit Account'
                            : 'Standard'}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#86868B] block mt-0.5">Category: {b.category || budgetCatName}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {onOpenTransfer && (isLiquidAccount || isCreditOrLoan) && budgets.length >= 2 && (
                      <button
                        onClick={() => onOpenTransfer(b)}
                        className="px-2.5 py-1 bg-[#0071E3]/10 hover:bg-[#0071E3]/20 text-[#0071E3] dark:text-blue-300 border border-[#0071E3]/25 rounded-full text-xs font-semibold transition flex items-center gap-1"
                        title="Transfer funds between accounts"
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                        <span>Transfer</span>
                      </button>
                    )}
                    {isCreditOrLoan && onOpenRecordPayment && (
                      <button
                        onClick={() => onOpenRecordPayment(b)}
                        className="px-2.5 py-1 bg-[#34C759]/12 hover:bg-[#34C759]/20 text-[#248A3D] dark:text-emerald-400 border border-[#34C759]/25 rounded-full text-xs font-semibold transition"
                        title="Make a Payment or Abono to this account"
                      >
                        Payment
                      </button>
                    )}
                    <button
                      onClick={() => onOpenEditBudget(b)}
                      className="px-2.5 py-1 bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#282828] dark:hover:bg-[#333] rounded-full text-xs font-medium text-[#1D1D1F] dark:text-zinc-300 dark:hover:text-white transition flex items-center gap-1"
                      title="Edit Budget / Account"
                    >
                      <Pencil className="w-3.5 h-3.5 text-[#0071E3]" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => onDeleteBudget(b.id)}
                      className="p-1.5 hover:bg-[#F2F2F7] dark:hover:bg-[#333] rounded-full text-[#86868B] hover:text-[#D70015] dark:hover:text-rose-400 transition"
                      title="Delete Budget"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Description */}
                {b.description && (
                  <p className="text-xs text-[#6E6E73] dark:text-zinc-300 bg-[#F5F5F7] dark:bg-[#191919] p-2.5 rounded-xl border border-black/[0.04] dark:border-[#2a2a2a] leading-relaxed">
                    {b.description}
                  </p>
                )}

                {/* BANK / DEBIT ACCOUNT VIEW */}
                {isLiquidAccount && (
                  <div className="space-y-2.5 bg-[#F5F5F7] dark:bg-[#171717] p-3 rounded-2xl border border-black/[0.04] dark:border-[#262626]">
                    <div className={`grid grid-cols-3 ${isBankAccount && (b.apr || 0) > 0 ? 'sm:grid-cols-4' : ''} gap-2`}>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center shadow-2xs border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Current Balance</span>
                        <span className={`text-xs font-bold tabular-nums block mt-0.5 ${currentCashBalance >= 0 ? 'text-[#248A3D] dark:text-emerald-400' : 'text-[#D70015] dark:text-rose-400'}`}>
                          {currencySymbol}{currentCashBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center shadow-2xs border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Inflows</span>
                        <span className="text-xs font-bold tabular-nums text-[#0071E3] dark:text-sky-400 block mt-0.5">
                          +{currencySymbol}{totalInflows.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center shadow-2xs border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Outflows</span>
                        <span className="text-xs font-bold tabular-nums text-[#D70015] dark:text-rose-400 block mt-0.5">
                          -{currencySymbol}{totalOutflows.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      {isBankAccount && (b.apr || 0) > 0 && (
                        <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center shadow-2xs border border-black/[0.03] dark:border-transparent">
                          <span className="text-[10px] text-[#86868B] block">APY</span>
                          <span className="text-xs font-bold tabular-nums text-[#B25000] dark:text-amber-400 block mt-0.5">{b.apr}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* CREDIT CARD VIEW */}
                {isCreditCard && (
                  <div className="space-y-2.5 bg-[#F5F5F7] dark:bg-[#171717] p-3 rounded-2xl border border-black/[0.04] dark:border-[#262626]">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">APR</span>
                        <span className="text-xs font-bold tabular-nums text-[#B25000] dark:text-amber-400 block mt-0.5">{b.apr || 0}%</span>
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Credit Limit</span>
                        <span className="text-xs font-bold tabular-nums text-[#1D1D1F] dark:text-white block mt-0.5">{currencySymbol}{ccCalc.baseCreditLimit.toLocaleString()}</span>
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Overdraft Allowed</span>
                        <span className="text-xs font-bold tabular-nums text-[#0071E3] dark:text-blue-400 block mt-0.5">
                          {ccCalc.overdraftPct}% {ccCalc.overdraftBuffer > 0 ? `(+${currencySymbol}${ccCalc.overdraftBuffer.toLocaleString()})` : ''}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Used Balance</span>
                        <span className="text-xs font-bold tabular-nums text-[#D70015] dark:text-rose-400 block mt-0.5">{currencySymbol}{usedBalance.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="bg-[#FF9F0A]/10 border border-[#FF9F0A]/25 rounded-xl px-3 py-2 flex items-center justify-between text-xs">
                      <span className="text-[#B25000] dark:text-amber-300 font-medium">Calculated Monthly Limit (Credit + Overdraft)</span>
                      <span className="text-[#1D1D1F] dark:text-white font-bold tabular-nums">
                        {currencySymbol}{effectiveLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* Credit Utilization Bar */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[11px] text-[#86868B] tabular-nums">
                        <span>Total Capacity Used: {utilizationPct}%</span>
                        <span className="text-[#248A3D] dark:text-emerald-400 font-semibold">Available: {currencySymbol}{availableCredit.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-[#E5E5EA] dark:bg-[#121212] h-2 rounded-full overflow-hidden border border-black/[0.04] dark:border-[#292929]">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${utilizationPct}%`,
                            backgroundColor: usedBalance > ccCalc.baseCreditLimit ? '#FF3B30' : (b.color || '#FF9F0A')
                          }}
                        />
                      </div>
                      {usedBalance > ccCalc.baseCreditLimit && (
                        <span className="text-[10px] text-[#B25000] dark:text-amber-400 block tabular-nums">
                          Using overdraft allowance ({currencySymbol}{(usedBalance - ccCalc.baseCreditLimit).toLocaleString()} over base limit)
                        </span>
                      )}
                    </div>

                    {totalPaymentsMade > 0 && (
                      <div className="text-[11px] text-[#248A3D] dark:text-emerald-400 pt-1 flex items-center justify-between tabular-nums">
                        <span>Total Payments / Abonos recorded:</span>
                        <span className="font-semibold">{currencySymbol}{totalPaymentsMade.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* LOAN ACCOUNT VIEW + MONTHLY QUOTAS */}
                {isLoan && (
                  <div className="space-y-3 bg-[#F5F5F7] dark:bg-[#171717] p-3.5 rounded-2xl border border-black/[0.04] dark:border-[#262626]">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">
                          {loanRatePeriod === 'monthly' ? 'Monthly Rate' : 'Interest (APR)'}
                        </span>
                        <span className="text-xs font-bold tabular-nums text-[#8944AB] dark:text-purple-400 block mt-0.5">
                          {b.apr || 0}%
                        </span>
                        <span className="text-[9px] text-[#86868B] block tabular-nums">
                          {monthlyRatePct.toFixed(2)}%/mo • {loanCalcMethod === 'flat' ? 'Flat' : 'Amort.'}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Loan Principal</span>
                        <span className="text-xs font-bold tabular-nums text-[#1D1D1F] dark:text-white block mt-0.5">{currencySymbol}{loanPrincipal.toLocaleString()}</span>
                        <span className="text-[9px] text-[#86868B] block tabular-nums">
                          Total Int: {currencySymbol}{totalLoanInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Rem. Principal</span>
                        <span className="text-xs font-bold tabular-nums text-[#D70015] dark:text-rose-400 block mt-0.5">
                          {currencySymbol}{usedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                        {loanQuotas.length > 0 && (
                          <span className="text-[9px] text-[#86868B] block tabular-nums">
                            +Int: {currencySymbol}{remainingLoanInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Monthly Quota</span>
                        <span className="text-xs font-bold tabular-nums text-[#248A3D] dark:text-emerald-400 block mt-0.5">
                          {currencySymbol}{computedQuota.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                        <span className="text-[9px] text-[#86868B] block tabular-nums">
                          {loanQuotas.length > 0
                            ? `Payoff Left: ${currencySymbol}${totalLoanPayoffLeft.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                            : `Repay: ${currencySymbol}${(loanPrincipal + totalLoanInterest).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                        </span>
                      </div>
                    </div>

                    {/* Loan Payoff Progress */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-[#86868B] tabular-nums">
                        <span>Principal Paid Off: {loanPaidOffPct}%</span>
                        <span className="text-[#1D1D1F] dark:text-zinc-300 font-medium">
                          {b.loanTermMonths ? `${b.loanTermMonths} Months Term • ` : ''}
                          {loanQuotas.length > 0 ? `${paidQuotasCount}/${loanQuotas.length} Quotas Paid` : 'No schedule yet'}
                        </span>
                      </div>
                      <div className="w-full bg-[#E5E5EA] dark:bg-[#121212] h-2 rounded-full overflow-hidden border border-black/[0.04] dark:border-[#292929]">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${loanPaidOffPct}%`,
                            backgroundColor: b.color || '#AF52DE'
                          }}
                        />
                      </div>
                    </div>

                    {/* Existing unlinked transfer/payment notice */}
                    {unlinkedLoanTotal > 0 && loanQuotas.length > 0 && nextDueQuota && (
                      <div className="bg-[#0071E3]/10 border border-[#0071E3]/25 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <span className="text-[#0071E3] dark:text-blue-300 font-semibold block tabular-nums">
                            Unlinked transfer / payment: {currencySymbol}{unlinkedLoanTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-[10px] text-[#6E6E73] dark:text-zinc-400 block mt-0.5 tabular-nums">
                            {unlinkedLoanTotal >= nextDueQuota.amount - 1.0
                              ? `Covers Quota #${nextDueQuota.quotaNumber} without creating a duplicate payment.`
                              : `Remaining to finish Quota #${nextDueQuota.quotaNumber}: ${currencySymbol}${Math.max(0, nextDueQuota.amount - unlinkedLoanTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                          </span>
                        </div>
                        {onReconcileLoanPayments && unlinkedLoanTotal >= nextDueQuota.amount - 1.0 && (
                          <button
                            type="button"
                            onClick={() => onReconcileLoanPayments(b.id)}
                            className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-2.5 py-1.5 rounded-full text-[11px] font-semibold shrink-0 transition"
                          >
                            Apply to Quotas
                          </button>
                        )}
                      </div>
                    )}

                    {/* Next Due Quota Quick Banner */}
                    {nextDueQuota && (() => {
                      const coveredByTransfer = unlinkedLoanTotal >= nextDueQuota.amount - 1.0;
                      const partialRemDue = Math.max(0, Number((nextDueQuota.amount - unlinkedLoanTotal).toFixed(2)));
                      return (
                        <div className="bg-[#AF52DE]/10 border border-[#AF52DE]/25 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-[#8944AB] dark:text-purple-300 font-semibold tabular-nums">
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              <span>Next Quota #{nextDueQuota.quotaNumber} • Due {nextDueQuota.dueDate}</span>
                            </div>
                            <span className="text-[10px] text-[#6E6E73] dark:text-zinc-400 block mt-0.5 tabular-nums">
                              Principal: {currencySymbol}{nextDueQuota.principalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} • Interest: {currencySymbol}{nextDueQuota.interestAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          {onToggleLoanQuotaPaid && (
                            <button
                              type="button"
                              onClick={() => onToggleLoanQuotaPaid(b.id, nextDueQuota.id)}
                              className={`${
                                coveredByTransfer
                                  ? 'bg-[#0071E3] hover:bg-[#0077ED]'
                                  : 'bg-[#AF52DE] hover:bg-purple-600'
                              } text-white px-3 py-1.5 rounded-full text-[11px] font-semibold shrink-0 transition tabular-nums`}
                            >
                              {coveredByTransfer
                                ? 'Apply Transfer'
                                : unlinkedLoanTotal > 0
                                ? `Pay Rem. ${currencySymbol}${partialRemDue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                                : `Pay ${currencySymbol}${nextDueQuota.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Quotas Controls Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-black/[0.06] dark:border-[#262626]">
                      <div className="flex items-center gap-2">
                        {loanQuotas.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedLoans(prev => ({ ...prev, [b.id]: !prev[b.id] }))}
                            className="text-[11px] text-[#1D1D1F] dark:text-zinc-300 dark:hover:text-white flex items-center gap-1 bg-white dark:bg-[#222] border border-black/[0.06] dark:border-transparent px-2.5 py-1 rounded-full transition font-medium"
                          >
                            {isScheduleExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            <span>{isScheduleExpanded ? 'Hide' : 'Follow'} Monthly Quotas ({paidQuotasCount}/{loanQuotas.length})</span>
                          </button>
                        )}
                        {loanQuotas.length === 0 && onGenerateLoanQuotas && loanPrincipal > 0 && (
                          <button
                            type="button"
                            onClick={() => onGenerateLoanQuotas(b.id)}
                            className="text-[11px] text-[#8944AB] dark:text-purple-300 flex items-center gap-1 bg-[#AF52DE]/12 hover:bg-[#AF52DE]/20 border border-[#AF52DE]/25 px-2.5 py-1 rounded-full transition font-medium"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Auto-Generate Quotas</span>
                          </button>
                        )}
                      </div>

                      {onAddLoanQuota && (
                        <button
                          type="button"
                          onClick={() => (addingQuotaLoanId === b.id ? setAddingQuotaLoanId(null) : openInlineAddQuota(b))}
                          className="text-[11px] text-[#248A3D] dark:text-emerald-400 flex items-center gap-1 bg-[#34C759]/12 hover:bg-[#34C759]/20 border border-[#34C759]/25 px-2.5 py-1 rounded-full transition font-medium"
                        >
                          <Plus className="w-3 h-3" />
                          <span>{addingQuotaLoanId === b.id ? 'Cancel' : 'Create Quota'}</span>
                        </button>
                      )}
                    </div>

                    {/* Inline Create Quota Form */}
                    {addingQuotaLoanId === b.id && (
                      <form onSubmit={e => handleSaveInlineQuota(e, b.id)} className="bg-white dark:bg-[#121212] border border-black/[0.06] dark:border-[#2d2d2d] rounded-xl p-3 space-y-2.5">
                        <span className="text-[11px] font-semibold text-[#1D1D1F] dark:text-white block">Add Monthly Quota</span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div>
                            <label className="text-[10px] text-[#86868B] block mb-0.5">Due Date</label>
                            <input
                              type="date"
                              required
                              value={newQuotaDueDate}
                              onChange={e => setNewQuotaDueDate(e.target.value)}
                              className="w-full bg-[#F5F5F7] dark:bg-[#1b1b1b] border border-black/[0.08] dark:border-[#333] rounded-lg px-2 py-1 text-[11px] text-[#1D1D1F] dark:text-white tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-[#86868B] block mb-0.5">Principal ({currencySymbol})</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={newQuotaPrincipal}
                              onChange={e => {
                                const p = e.target.value;
                                setNewQuotaPrincipal(p);
                                const sum = (parseFloat(p) || 0) + (parseFloat(newQuotaInterest) || 0);
                                if (sum > 0) setNewQuotaAmount(sum.toFixed(2));
                              }}
                              className="w-full bg-[#F5F5F7] dark:bg-[#1b1b1b] border border-black/[0.08] dark:border-[#333] rounded-lg px-2 py-1 text-[11px] text-[#1D1D1F] dark:text-white tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-[#86868B] block mb-0.5">Interest ({currencySymbol})</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={newQuotaInterest}
                              onChange={e => {
                                const intr = e.target.value;
                                setNewQuotaInterest(intr);
                                const sum = (parseFloat(newQuotaPrincipal) || 0) + (parseFloat(intr) || 0);
                                if (sum > 0) setNewQuotaAmount(sum.toFixed(2));
                              }}
                              className="w-full bg-[#F5F5F7] dark:bg-[#1b1b1b] border border-black/[0.08] dark:border-[#333] rounded-lg px-2 py-1 text-[11px] text-[#1D1D1F] dark:text-white tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-[#86868B] block mb-0.5">Quota Total ({currencySymbol})</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              required
                              placeholder="0.00"
                              value={newQuotaAmount}
                              onChange={e => setNewQuotaAmount(e.target.value)}
                              className="w-full bg-[#F5F5F7] dark:bg-[#1b1b1b] border border-black/[0.08] dark:border-[#333] rounded-lg px-2 py-1 text-[11px] text-[#1D1D1F] dark:text-white font-semibold tabular-nums"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="submit"
                            className="bg-[#34C759] hover:bg-emerald-500 text-black px-3 py-1 rounded-full text-[11px] font-semibold"
                          >
                            Save Quota
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Expandable Monthly Quotas Schedule */}
                    {isScheduleExpanded && loanQuotas.length > 0 && (
                      <div className="space-y-1 max-h-60 overflow-y-auto pr-1 scrollbar-thin pt-1">
                        {loanQuotas.map(q => (
                          <div
                            key={q.id}
                            className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-xl bg-white dark:bg-[#1d1d1d] hover:bg-[#F2F2F7] dark:hover:bg-[#242424] border border-black/[0.03] dark:border-transparent transition text-xs"
                          >
                            <button
                              type="button"
                              onClick={() => onToggleLoanQuotaPaid && onToggleLoanQuotaPaid(b.id, q.id)}
                              className="flex items-center gap-2 min-w-0 flex-1 text-left"
                            >
                              {q.isPaid ? (
                                <CheckSquare className="w-4 h-4 text-[#AF52DE] shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-zinc-300 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <span className={`font-medium block truncate tabular-nums ${q.isPaid ? 'line-through text-[#86868B]' : 'text-[#1D1D1F] dark:text-zinc-200'}`}>
                                  Quota #{q.quotaNumber} • {q.dueDate}
                                </span>
                                <span className="text-[10px] text-[#86868B] block tabular-nums">
                                  Prin: {currencySymbol}{q.principalAmount.toFixed(2)} | Int: {currencySymbol}{q.interestAmount.toFixed(2)} | Bal: {currencySymbol}{q.remainingBalance.toFixed(2)}
                                </span>
                              </div>
                            </button>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`font-semibold tabular-nums ${q.isPaid ? 'line-through text-[#86868B]' : 'text-[#1D1D1F] dark:text-white'}`}>
                                {currencySymbol}{q.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                              {onDeleteLoanQuota && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteLoanQuota(b.id, q.id)}
                                  className="text-[#86868B] hover:text-[#D70015] dark:hover:text-rose-400 p-0.5"
                                  title="Delete Quota"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {totalPaymentsMade > 0 && (
                      <div className="text-[11px] text-[#248A3D] dark:text-emerald-400 pt-1 space-y-0.5 tabular-nums">
                        <div className="flex items-center justify-between">
                          <span>Total Payments / Abonos recorded:</span>
                          <span className="font-semibold">{currencySymbol}{totalPaymentsMade.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[#6E6E73] dark:text-zinc-400">
                          <span>Applied Split (Principal / Interest):</span>
                          <span>
                            <span className="text-[#8944AB] dark:text-purple-300 font-medium">
                              Prin: {currencySymbol}{totalLoanPrincipalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            {' • '}
                            <span className="text-[#B25000] dark:text-amber-300 font-medium">
                              Int: {currencySymbol}{totalLoanInterestPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Monthly Spending / Quota Progress */}
                {(!isLiquidAccount || effectiveLimit > 0) && (() => {
                  const progressTarget = isLoan ? computedQuota : effectiveLimit;
                  const progressCurrent = isLoan ? currentMonthLoanPaid : spent;
                  const progressPct = progressTarget > 0 ? Math.min(Math.round((progressCurrent / progressTarget) * 100), 100) : 0;
                  const isBarOver = !isLoan && progressTarget > 0 && progressCurrent > progressTarget;
                  return (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-[#6E6E73] dark:text-[#9b9b9b] tabular-nums">
                        <span>
                          {isLoan ? 'This Month Paid' : 'Current Month Spent'}: {currencySymbol}{progressCurrent.toFixed(2)}
                        </span>
                        <span className={isBarOver ? 'text-[#D70015] dark:text-rose-400 font-bold' : 'text-[#1D1D1F] dark:text-white font-semibold'}>
                          {isLoan ? 'Monthly Quota' : 'Monthly Limit'}: {currencySymbol}{progressTarget.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="w-full bg-[#E5E5EA] dark:bg-[#191919] h-2 rounded-full overflow-hidden border border-black/[0.04] dark:border-[#2d2d2d]">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${progressPct}%`,
                            backgroundColor: isBarOver ? '#FF3B30' : isLoan ? '#AF52DE' : (b.color || '#34C759')
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-[#86868B] tabular-nums">
                        <span>
                          {progressPct}% of {isLoan ? 'monthly quota paid' : 'monthly limit used'}
                        </span>
                        {isBarOver && <span className="text-[#D70015] dark:text-rose-400 font-semibold">Over limit!</span>}
                      </div>
                    </div>
                  );
                })()}

                {/* Items Belonging to This Budget (Standard budgets ONLY) */}
                {isStandard && items.length > 0 && (
                  <div className="space-y-2 bg-[#F5F5F7] dark:bg-[#171717] p-3 rounded-2xl border border-black/[0.04] dark:border-[#262626]">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-[#1D1D1F] dark:text-white">
                        Belonging Items ({paidItemsCount}/{items.length} Paid)
                      </span>
                      <span className="text-[10px] text-[#86868B] tabular-nums">
                        Items Sum: {currencySymbol}{itemsSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="space-y-1 pt-1 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                      {items.map(item => (
                        <div
                          key={item.id}
                          onClick={() => onToggleItemPaid(b.id, item.id)}
                          className="flex items-center gap-2.5 py-1.5 px-2 rounded-xl hover:bg-white dark:hover:bg-[#222] cursor-pointer group transition select-none"
                        >
                          {item.isPaid ? (
                            <CheckSquare className="w-4 h-4 text-[#0071E3] shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-[#86868B] group-hover:text-[#1D1D1F] dark:group-hover:text-zinc-300 shrink-0" />
                          )}
                          <span className={`text-xs flex-1 transition ${item.isPaid ? 'line-through text-[#86868B]' : 'text-[#1D1D1F] dark:text-zinc-200'}`}>
                            {item.name}
                          </span>
                          <span className={`text-xs font-semibold shrink-0 transition tabular-nums ${item.isPaid ? 'line-through text-[#86868B]' : 'text-[#1D1D1F] dark:text-white'}`}>
                            {currencySymbol}{Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                    </div>

                    {extraExpenses > 0 && (
                      <div className="flex justify-between items-center text-[11px] text-[#86868B] pt-2 border-t border-black/[0.06] dark:border-[#262626] px-1 tabular-nums">
                        <span>+ Other Extra Expenses Buffer:</span>
                        <span className="font-semibold text-[#1D1D1F] dark:text-zinc-300">
                          {currencySymbol}{extraExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-[11px] text-[#6E6E73] dark:text-[#aaa] pt-1.5 border-t border-black/[0.06] dark:border-[#242424] px-1 font-medium tabular-nums">
                      <span>Total of all (Calculated Limit):</span>
                      <span className="font-bold text-[#1D1D1F] dark:text-white">
                        {currencySymbol}{(itemsSum + extraExpenses).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
