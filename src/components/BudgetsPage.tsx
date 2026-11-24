import React, { useState, useEffect } from 'react';
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
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Clock,
  GripVertical,
  ArrowUpDown,
  Check,
  RefreshCw
} from 'lucide-react';
import {
  LoanQuota,
  LoanCalcMethod,
  LoanRatePeriod,
  addMonthsToIsoDate,
  calculateCreditCardMonthlyLimit,
  calculateLoanMonthlyQuota,
  getMonthlyInterestRate,
  parseDayOfMonth,
  getActiveCreditCardCycleKey,
  getCreditCardCycleForMonth,
  getTransactionCreditCardCycleKey,
  getRecentCreditCardCycles,
  shiftMonthKey,
  formatShortIsoDate
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
  cutoffDate?: string;
  dueDate?: string;
  order?: number;
}

interface BudgetsPageProps {
  budgets: Budget[];
  transactions: any[];
  allTransactions?: any[];
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
  onReorderBudget?: (budgetId: string, direction: 'up' | 'down') => void;
  onReorderBudgetToIndex?: (budgetId: string, targetIndex: number) => void | Promise<void>;
  onRecalculateLiquidBalance?: (budgetId: string) => Promise<void>;
  onRecalculateAccountBalance?: (budgetId: string) => Promise<void>;
}

export default function BudgetsPage({
  budgets,
  transactions,
  allTransactions,
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
  onGenerateLoanQuotas,
  onReorderBudget,
  onReorderBudgetToIndex,
  onRecalculateLiquidBalance,
  onRecalculateAccountBalance
}: BudgetsPageProps) {
  const [expandedLoans, setExpandedLoans] = useState<Record<string, boolean>>({});
  const [expandedCardCycles, setExpandedCardCycles] = useState<Record<string, boolean>>({});
  const [expandedLiquidLedgers, setExpandedLiquidLedgers] = useState<Record<string, boolean>>({});
  const [recalculatingId, setRecalculatingId] = useState<string | null>(null);
  const [cardCycleOverrides, setCardCycleOverrides] = useState<Record<string, string>>({});
  const [isReorganizeMode, setIsReorganizeMode] = useState(false);
  const [draggedBudgetId, setDraggedBudgetId] = useState<string | null>(null);
  const [dragOverBudgetId, setDragOverBudgetId] = useState<string | null>(null);
  const [orderSavedBanner, setOrderSavedBanner] = useState(false);
  const [addingQuotaLoanId, setAddingQuotaLoanId] = useState<string | null>(null);
  const [newQuotaDueDate, setNewQuotaDueDate] = useState('');
  const [newQuotaAmount, setNewQuotaAmount] = useState('');
  const [newQuotaPrincipal, setNewQuotaPrincipal] = useState('');
  const [newQuotaInterest, setNewQuotaInterest] = useState('');

  const triggerOrderSavedFeedback = () => {
    setOrderSavedBanner(true);
    setTimeout(() => setOrderSavedBanner(false), 1800);
  };

  const handleDropOnBudget = async (targetBudgetId: string) => {
    if (!draggedBudgetId || draggedBudgetId === targetBudgetId) {
      setDraggedBudgetId(null);
      setDragOverBudgetId(null);
      return;
    }
    const targetIdx = budgets.findIndex(item => item.id === targetBudgetId);
    setDraggedBudgetId(null);
    setDragOverBudgetId(null);
    if (targetIdx !== -1 && onReorderBudgetToIndex) {
      await onReorderBudgetToIndex(draggedBudgetId, targetIdx);
      triggerOrderSavedFeedback();
    }
  };

  useEffect(() => {
    setCardCycleOverrides({});
  }, [selectedMonth]);

  const fullLedgerTransactions = allTransactions || transactions;

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
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {orderSavedBanner && (
            <span className="inline-flex items-center gap-1 bg-[#34C759]/15 text-[#248A3D] dark:text-[#34C759] border border-[#34C759]/30 px-3 py-1.5 rounded-full text-[11px] font-semibold">
              <Check className="w-3 h-3" /> Order saved
            </span>
          )}
          {(onReorderBudget || onReorderBudgetToIndex) && budgets.length >= 2 && (
            <button
              type="button"
              onClick={() => setIsReorganizeMode(v => !v)}
              className={`px-3.5 py-2 rounded-full text-xs font-semibold transition flex items-center gap-1.5 shadow-sm border ${
                isReorganizeMode
                  ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F] border-transparent'
                  : 'bg-white hover:bg-[#F2F2F7] dark:bg-[#2C2C2E] dark:hover:bg-white/15 text-[#1D1D1F] dark:text-white border-black/[0.06] dark:border-white/10'
              }`}
              title="Drag and drop or reorder your accounts and budgets"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {isReorganizeMode ? 'Done Reorganizing' : 'Reorganize'}
            </button>
          )}
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

      {isReorganizeMode && budgets.length >= 2 && (
        <div className="bg-white dark:bg-[#1C1C1E] border border-[#0071E3]/30 rounded-[22px] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-[#1D1D1F] dark:text-white flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4 text-[#0071E3]" /> Reorganize Accounts & Budgets
              </h3>
              <p className="text-[11px] text-[#86868B] mt-0.5">
                Drag rows or use the arrows to set your preferred order. Changes are saved automatically to your database and reflected on the Dashboard.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsReorganizeMode(false)}
              className="px-3.5 py-1.5 rounded-full bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold transition shrink-0"
            >
              Done
            </button>
          </div>
          <div className="space-y-1.5">
            {budgets.map((item, idx) => (
              <div
                key={item.id}
                draggable
                onDragStart={e => {
                  setDraggedBudgetId(item.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={e => {
                  e.preventDefault();
                  if (draggedBudgetId && draggedBudgetId !== item.id) {
                    setDragOverBudgetId(item.id);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverBudgetId === item.id) setDragOverBudgetId(null);
                }}
                onDrop={e => {
                  e.preventDefault();
                  handleDropOnBudget(item.id);
                }}
                onDragEnd={() => {
                  setDraggedBudgetId(null);
                  setDragOverBudgetId(null);
                }}
                className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl border transition cursor-grab active:cursor-grabbing ${
                  dragOverBudgetId === item.id
                    ? 'bg-[#0071E3]/10 border-[#0071E3] ring-1 ring-[#0071E3]'
                    : draggedBudgetId === item.id
                    ? 'opacity-50 bg-[#F5F5F7] dark:bg-[#2C2C2E] border-black/[0.08] dark:border-white/10'
                    : 'bg-[#F5F5F7] dark:bg-[#2C2C2E]/70 border-black/[0.04] dark:border-white/5 hover:border-black/[0.1] dark:hover:border-white/15'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <GripVertical className="w-4 h-4 text-[#86868B] shrink-0" />
                  <span className="w-6 h-6 rounded-full bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 text-[11px] font-bold text-[#86868B] flex items-center justify-center tabular-nums shrink-0">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-semibold text-[#1D1D1F] dark:text-white truncate">
                    {item.name || item.category}
                  </span>
                  <span className="text-[10px] text-[#86868B] uppercase tracking-wider shrink-0">
                    {(item.accountType || 'standard').replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={async () => {
                      if (onReorderBudgetToIndex) {
                        await onReorderBudgetToIndex(item.id, idx - 1);
                        triggerOrderSavedFeedback();
                      } else if (onReorderBudget) {
                        onReorderBudget(item.id, 'up');
                        triggerOrderSavedFeedback();
                      }
                    }}
                    className="px-2 py-1 rounded-full bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 text-[11px] font-semibold text-[#1D1D1F] dark:text-white disabled:opacity-30 hover:bg-[#E5E5EA] dark:hover:bg-white/15 transition"
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={idx === budgets.length - 1}
                    onClick={async () => {
                      if (onReorderBudgetToIndex) {
                        await onReorderBudgetToIndex(item.id, idx + 1);
                        triggerOrderSavedFeedback();
                      } else if (onReorderBudget) {
                        onReorderBudget(item.id, 'down');
                        triggerOrderSavedFeedback();
                      }
                    }}
                    className="px-2 py-1 rounded-full bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 text-[11px] font-semibold text-[#1D1D1F] dark:text-white disabled:opacity-30 hover:bg-[#E5E5EA] dark:hover:bg-white/15 transition"
                    title="Move down"
                  >
                    ▼
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  t.emailOutcome !== 'declined' &&
                  t.type === 'expense' &&
                  !t.isLoanPayment &&
                  !t.isTransfer &&
                  (t.budgetId === b.id || (t.category || '').trim().toLowerCase() === budgetCatName.toLowerCase())
              )
              .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

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

            // Liquid Account (Bank / Debit) metrics (selected month + all-time ledger net)
            const currentCashBalance = Number(b.accountBalance) || 0;
            const belongsDirectLiquid = (t: any) =>
              t.emailOutcome !== 'declined' &&
              !t.isTransfer &&
              (t.budgetId === b.id || (!t.budgetId && (t.category || '').trim().toLowerCase() === budgetCatName.toLowerCase()));

            const directInflows = transactions
              .filter(t => belongsDirectLiquid(t) && t.type === 'income')
              .reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const transfersIn = transactions
              .filter(t => t.emailOutcome !== 'declined' && t.isTransfer && t.transferToBudgetId === b.id)
              .reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const directOutflows = transactions
              .filter(t => belongsDirectLiquid(t) && t.type === 'expense')
              .reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const transfersOut = transactions
              .filter(t => t.emailOutcome !== 'declined' && t.isTransfer && t.budgetId === b.id)
              .reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const totalInflows = directInflows + transfersIn;
            const totalOutflows = directOutflows + transfersOut;
            const liquidNetFlow = totalInflows - totalOutflows;
            const pendingLiquidOutflows = transactions
              .filter(
                t =>
                  t.status === 'pending' &&
                  t.emailOutcome !== 'declined' &&
                  ((belongsDirectLiquid(t) && t.type === 'expense') || (t.isTransfer && t.budgetId === b.id))
              )
              .reduce((s, t) => s + (Number(t.amount) || 0), 0);

            const allTimeLiquidTxs = isLiquidAccount
              ? fullLedgerTransactions
                  .filter(
                    t =>
                      t.emailOutcome !== 'declined' &&
                      (belongsDirectLiquid(t) ||
                        (t.isTransfer && (t.budgetId === b.id || t.transferToBudgetId === b.id)))
                  )
                  .sort((a, x) => String(x.date || '').localeCompare(String(a.date || '')))
              : [];
            const allTimeLedgerNet = Number(
              allTimeLiquidTxs
                .reduce((net, t) => {
                  const amt = Math.abs(Number(t.amount) || 0);
                  if (t.isTransfer) {
                    if (t.transferToBudgetId === b.id) net += amt;
                    if (t.budgetId === b.id) net -= amt;
                    return net;
                  }
                  return net + (t.type === 'income' ? amt : -amt);
                }, 0)
                .toFixed(2)
            );
            const hasLiquidBalanceDrift = isLiquidAccount && Math.abs(currentCashBalance - allTimeLedgerNet) > 0.01;
            const isLiquidLedgerExpanded = Boolean(expandedLiquidLedgers[b.id]);

            const usedBalance = Number(b.actualUsedAmount) || 0;
            const availableCredit = isCreditCard
              ? Math.max(0, ccCalc.monthlyLimit - usedBalance)
              : Math.max(0, baseCreditLimit - usedBalance);
            const utilizationDenom = isCreditCard ? ccCalc.monthlyLimit : baseCreditLimit;
            const utilizationPct = utilizationDenom > 0 ? Math.min(Math.round((usedBalance / utilizationDenom) * 100), 100) : 0;

            // Credit Card Billing Cycle calculation
            const cutoffDay = isCreditCard ? parseDayOfMonth(b.cutoffDate) : null;
            const dueDay = isCreditCard ? parseDayOfMonth(b.dueDate) : null;
            const defaultCycleKey =
              isCreditCard && cutoffDay
                ? selectedMonth && selectedMonth !== 'All' && /^\d{4}-\d{2}$/.test(selectedMonth)
                  ? selectedMonth
                  : getActiveCreditCardCycleKey(cutoffDay)
                : '';
            const activeCycleKey = isCreditCard ? cardCycleOverrides[b.id] || defaultCycleKey : '';
            const cycleInfo =
              isCreditCard && cutoffDay && activeCycleKey
                ? getCreditCardCycleForMonth(cutoffDay, dueDay, activeCycleKey)
                : null;
            const cycleOptions =
              isCreditCard && cutoffDay && activeCycleKey
                ? getRecentCreditCardCycles(cutoffDay, dueDay, activeCycleKey, 8, 2)
                : [];

            const cardChargesInCycle =
              isCreditCard && cycleInfo
                ? fullLedgerTransactions.filter(t => {
                    if (t.emailOutcome === 'declined') return false;
                    const belongsToCard =
                      t.budgetId === b.id ||
                      (!t.budgetId && (t.category || '').trim().toLowerCase() === budgetCatName.toLowerCase());
                    if (!belongsToCard) return false;
                    const isCharge =
                      (!t.isTransfer && t.type === 'expense' && !t.isLoanPayment) ||
                      (Boolean(t.isTransfer) && t.budgetId === b.id);
                    if (!isCharge) return false;
                    return getTransactionCreditCardCycleKey(t.date, cutoffDay, t.statementCycle) === cycleInfo.cycleKey;
                  })
                : [];

            const cardPaymentsInCycle =
              isCreditCard && cycleInfo
                ? fullLedgerTransactions.filter(t => {
                    if (t.emailOutcome === 'declined') return false;
                    const isDirectPayment =
                      (t.budgetId === b.id ||
                        (!t.budgetId && (t.category || '').trim().toLowerCase() === budgetCatName.toLowerCase())) &&
                      (Boolean(t.isLoanPayment) || t.type === 'income') &&
                      !t.isTransfer;
                    const isTransferPayment = Boolean(t.isTransfer) && t.transferToBudgetId === b.id;
                    if (!isDirectPayment && !isTransferPayment) return false;
                    return getTransactionCreditCardCycleKey(t.date, cutoffDay, t.statementCycle) === cycleInfo.cycleKey;
                  })
                : [];

            const postCutoffPaymentsTowardDue =
              isCreditCard && cycleInfo && cycleInfo.dueDate && cycleInfo.dueDate > cycleInfo.cutoffDate
                ? fullLedgerTransactions.filter(t => {
                    if (t.emailOutcome === 'declined') return false;
                    if (t.statementCycle && t.statementCycle !== cycleInfo.cycleKey) return false;
                    const isDirectPayment =
                      (t.budgetId === b.id ||
                        (!t.budgetId && (t.category || '').trim().toLowerCase() === budgetCatName.toLowerCase())) &&
                      (Boolean(t.isLoanPayment) || t.type === 'income') &&
                      !t.isTransfer;
                    const isTransferPayment = Boolean(t.isTransfer) && t.transferToBudgetId === b.id;
                    if (!isDirectPayment && !isTransferPayment) return false;
                    const d = String(t.date || '').slice(0, 10);
                    return d > cycleInfo.cutoffDate && d <= (cycleInfo.dueDate as string);
                  })
                : [];

            const cycleChargesTotal = cardChargesInCycle.reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const cyclePendingChargesTotal = cardChargesInCycle
              .filter(t => t.status === 'pending')
              .reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const cyclePaymentsTotal = cardPaymentsInCycle.reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const gracePaymentsTotal = postCutoffPaymentsTowardDue.reduce((s, t) => s + (Number(t.amount) || 0), 0);
            const cycleNetRemaining = Math.max(0, cycleChargesTotal - cyclePaymentsTotal - gracePaymentsTotal);
            const cycleAllTxs = [...cardChargesInCycle, ...cardPaymentsInCycle].sort((a, x) =>
              String(x.date || '').localeCompare(String(a.date || ''))
            );
            const isCycleLedgerExpanded = Boolean(expandedCardCycles[b.id]);

            // All-time card ledger reconciliation (explains carried-over / opening balance vs 0 cycle charges)
            let cardAllTimeCharges = 0;
            let cardAllTimePayments = 0;
            let cardAllTimeChargesCount = 0;
            if (isCreditCard) {
              fullLedgerTransactions.forEach(t => {
                if (t.emailOutcome === 'declined') return;
                const amt = Math.abs(Number(t.amount) || 0);
                if (t.isTransfer) {
                  if (t.budgetId === b.id) {
                    cardAllTimeCharges += amt;
                    cardAllTimeChargesCount += 1;
                  }
                  if (t.transferToBudgetId === b.id) {
                    cardAllTimePayments += amt;
                  }
                } else {
                  const belongs =
                    t.budgetId === b.id ||
                    (!t.budgetId && (t.category || '').trim().toLowerCase() === budgetCatName.toLowerCase());
                  if (!belongs) return;
                  if (t.isLoanPayment || t.type === 'income') {
                    cardAllTimePayments += amt;
                  } else {
                    cardAllTimeCharges += amt;
                    cardAllTimeChargesCount += 1;
                  }
                }
              });
            }
            const cardLedgerNetDebt = Math.max(0, Number((cardAllTimeCharges - cardAllTimePayments).toFixed(2)));
            const hasCardLedgerDrift = isCreditCard && Math.abs(usedBalance - cardLedgerNetDebt) > 0.01;

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
                t.emailOutcome !== 'declined' &&
                (((t.budgetId === b.id || (t.category || '').toLowerCase() === budgetCatName.toLowerCase()) && t.isLoanPayment && !t.isTransfer) ||
                  (t.isTransfer && t.transferToBudgetId === b.id))
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
                draggable={Boolean(onReorderBudgetToIndex && budgets.length >= 2)}
                onDragStart={e => {
                  if (!onReorderBudgetToIndex) return;
                  setDraggedBudgetId(b.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={e => {
                  if (!draggedBudgetId || draggedBudgetId === b.id) return;
                  e.preventDefault();
                  setDragOverBudgetId(b.id);
                }}
                onDragLeave={() => {
                  if (dragOverBudgetId === b.id) setDragOverBudgetId(null);
                }}
                onDrop={e => {
                  e.preventDefault();
                  handleDropOnBudget(b.id);
                }}
                onDragEnd={() => {
                  setDraggedBudgetId(null);
                  setDragOverBudgetId(null);
                }}
                className={`bg-white dark:bg-[#1C1C1E] border p-5 rounded-[22px] space-y-4 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl transition ${
                  dragOverBudgetId === b.id
                    ? 'border-[#0071E3] ring-2 ring-[#0071E3]/40'
                    : draggedBudgetId === b.id
                    ? 'opacity-50 border-black/[0.08] dark:border-white/20'
                    : 'border-black/[0.04] dark:border-white/10 hover:border-black/[0.1] dark:hover:border-white/20'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 truncate">
                    {onReorderBudgetToIndex && budgets.length >= 2 && (
                      <div
                        className="mt-2.5 text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white cursor-grab active:cursor-grabbing shrink-0"
                        title="Drag to reorder"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                    )}
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
                    {onReorderBudget && (
                      <div className="flex items-center gap-0.5 bg-[#F2F2F7] dark:bg-[#282828] rounded-full p-0.5">
                        <button
                          onClick={() => {
                            onReorderBudget(b.id, 'up');
                            triggerOrderSavedFeedback();
                          }}
                          disabled={budgets.indexOf(b) === 0}
                          className="px-1.5 py-0.5 text-[10px] text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white disabled:opacity-30 transition"
                          title="Move Up"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => {
                            onReorderBudget(b.id, 'down');
                            triggerOrderSavedFeedback();
                          }}
                          disabled={budgets.indexOf(b) === budgets.length - 1}
                          className="px-1.5 py-0.5 text-[10px] text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white disabled:opacity-30 transition"
                          title="Move Down"
                        >
                          ▼
                        </button>
                      </div>
                    )}
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
                  <div className="space-y-2.5 bg-[#F5F5F7] dark:bg-[#171717] p-3.5 rounded-2xl border border-black/[0.04] dark:border-[#262626]">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center shadow-2xs border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Net Flow</span>
                        <span className={`text-xs font-bold tabular-nums block mt-0.5 ${liquidNetFlow >= 0 ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#D70015] dark:text-[#FF3B30]'}`}>
                          {liquidNetFlow >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(liquidNetFlow).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    {isBankAccount && (b.apr || 0) > 0 && (
                      <div className="flex items-center justify-between bg-white dark:bg-[#1f1f1f] px-3 py-1.5 rounded-xl text-[11px] border border-black/[0.03] dark:border-transparent tabular-nums">
                        <span className="text-[#86868B]">Annual Percentage Yield (APY)</span>
                        <span className="font-bold text-[#B25000] dark:text-[#FF9F0A]">{b.apr}%</span>
                      </div>
                    )}

                    {pendingLiquidOutflows > 0 && (
                      <div className="flex items-center justify-between bg-[#FF9F0A]/10 border border-[#FF9F0A]/25 px-3 py-1.5 rounded-xl text-[11px] tabular-nums">
                        <span className="text-[#B25000] dark:text-[#FF9F0A] font-medium">
                          Pending Flotante Hold: -{currencySymbol}{pendingLiquidOutflows.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                        <span className="font-semibold text-[#1D1D1F] dark:text-white">
                          After Flotantes: {currencySymbol}{(currentCashBalance - pendingLiquidOutflows).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-black/[0.05] dark:border-[#262626] text-[11px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setExpandedLiquidLedgers(prev => ({ ...prev, [b.id]: !prev[b.id] }))}
                          className="text-[#1D1D1F] dark:text-zinc-300 flex items-center gap-1 bg-white dark:bg-[#222] border border-black/[0.06] dark:border-transparent px-2.5 py-1 rounded-full font-medium transition"
                        >
                          {isLiquidLedgerExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span>Activity ({allTimeLiquidTxs.length})</span>
                        </button>
                        <span className="text-[10px] text-[#86868B] tabular-nums">
                          Ledger Net: <strong className="text-[#1D1D1F] dark:text-white">{currencySymbol}{allTimeLedgerNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                        </span>
                      </div>
                      {hasLiquidBalanceDrift && (onRecalculateAccountBalance || onRecalculateLiquidBalance) && (
                        <button
                          type="button"
                          disabled={recalculatingId === b.id}
                          onClick={async () => {
                            setRecalculatingId(b.id);
                            try {
                              if (onRecalculateAccountBalance) {
                                await onRecalculateAccountBalance(b.id);
                              } else if (onRecalculateLiquidBalance) {
                                await onRecalculateLiquidBalance(b.id);
                              }
                            } finally {
                              setRecalculatingId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#0071E3]/12 hover:bg-[#0071E3]/20 text-[#0071E3] dark:text-[#5AC8FA] font-semibold text-[10px] transition disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${recalculatingId === b.id ? 'animate-spin' : ''}`} />
                          Sync Balance to Ledger
                        </button>
                      )}
                    </div>

                    {isLiquidLedgerExpanded && (
                      <div className="space-y-1 max-h-52 overflow-y-auto pr-1 scrollbar-thin">
                        {allTimeLiquidTxs.length === 0 ? (
                          <div className="bg-white dark:bg-[#1f1f1f] rounded-xl p-3 text-center text-[11px] text-[#86868B]">
                            No activity recorded for this account yet.
                          </div>
                        ) : (
                          allTimeLiquidTxs.slice(0, 30).map(txItem => {
                            const isInflow = txItem.isTransfer
                              ? txItem.transferToBudgetId === b.id
                              : txItem.type === 'income';
                            const otherAccount = txItem.isTransfer
                              ? budgets.find(x => x.id === (isInflow ? txItem.budgetId : txItem.transferToBudgetId))
                              : null;
                            return (
                              <div
                                key={txItem.id}
                                className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-xl bg-white dark:bg-[#1f1f1f] border border-black/[0.03] dark:border-transparent text-xs"
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="font-medium text-[#1D1D1F] dark:text-zinc-200 truncate block">
                                    {txItem.isTransfer && otherAccount
                                      ? isInflow
                                        ? `From ${otherAccount.name || otherAccount.category}`
                                        : `To ${otherAccount.name || otherAccount.category}`
                                      : txItem.title}
                                  </span>
                                  <span className="text-[10px] text-[#86868B] block tabular-nums">
                                    {txItem.date} • {txItem.category}
                                    {txItem.status === 'pending' ? ' • Flotante' : ''}
                                  </span>
                                </div>
                                <span className={`font-semibold tabular-nums shrink-0 ${isInflow ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#1D1D1F] dark:text-white'}`}>
                                  {isInflow ? '+' : '-'}{currencySymbol}{Math.abs(Number(txItem.amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* CREDIT CARD VIEW (Cycle-Based) */}
                {isCreditCard && (
                  <div className="space-y-3 bg-[#F5F5F7] dark:bg-[#171717] p-3.5 rounded-2xl border border-black/[0.04] dark:border-[#262626]">
                    {/* Billing Cycle Selector & Dates Header */}
                    {cycleInfo ? (
                      <div className="bg-white dark:bg-[#1f1f1f] border border-black/[0.05] dark:border-white/10 rounded-xl p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                cycleInfo.status === 'open'
                                  ? 'bg-[#34C759]/15 text-[#248A3D] dark:text-[#34C759]'
                                  : cycleInfo.status === 'upcoming'
                                  ? 'bg-[#0071E3]/15 text-[#0071E3] dark:text-[#5AC8FA]'
                                  : 'bg-black/[0.06] dark:bg-white/10 text-[#6E6E73] dark:text-zinc-300'
                              }`}
                            >
                              {cycleInfo.status === 'open'
                                ? 'Ciclo Abierto'
                                : cycleInfo.status === 'upcoming'
                                ? 'Próximo Ciclo'
                                : 'Ciclo Cerrado'}
                            </span>
                            <span className="text-xs font-bold text-[#1D1D1F] dark:text-white tabular-nums">
                              {cycleInfo.periodLabel}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                setCardCycleOverrides(prev => ({
                                  ...prev,
                                  [b.id]: shiftMonthKey(cycleInfo.cycleKey, -1)
                                }))
                              }
                              className="w-6 h-6 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:hover:bg-white/15 flex items-center justify-center text-[#1D1D1F] dark:text-white transition"
                              title="Ciclo anterior"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <select
                              value={cycleInfo.cycleKey}
                              onChange={e =>
                                setCardCycleOverrides(prev => ({
                                  ...prev,
                                  [b.id]: e.target.value
                                }))
                              }
                              className="bg-[#F2F2F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none cursor-pointer"
                            >
                              {cycleOptions.map(c => (
                                <option key={c.cycleKey} value={c.cycleKey} className="bg-white dark:bg-[#1C1C1E]">
                                  {c.label} ({c.periodLabel})
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                setCardCycleOverrides(prev => ({
                                  ...prev,
                                  [b.id]: shiftMonthKey(cycleInfo.cycleKey, 1)
                                }))
                              }
                              className="w-6 h-6 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:hover:bg-white/15 flex items-center justify-center text-[#1D1D1F] dark:text-white transition"
                              title="Siguiente ciclo"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1.5 border-t border-black/[0.05] dark:border-white/10 tabular-nums">
                          <span className="text-[#6E6E73] dark:text-zinc-300 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-[#FF9F0A]" />
                            Corte: <strong className="text-[#1D1D1F] dark:text-white">{formatShortIsoDate(cycleInfo.cutoffDate)}</strong>
                            {cycleInfo.daysUntilCutoff > 0 && (
                              <span className="text-[10px] text-[#0071E3] dark:text-[#5AC8FA] ml-1">
                                (en {cycleInfo.daysUntilCutoff}d)
                              </span>
                            )}
                            {cycleInfo.daysUntilCutoff === 0 && (
                              <span className="text-[10px] text-[#B25000] dark:text-[#FF9F0A] font-semibold ml-1">
                                (Hoy)
                              </span>
                            )}
                          </span>

                          {cycleInfo.dueDate ? (
                            <span className="text-[#6E6E73] dark:text-zinc-300 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-[#34C759]" />
                              Pago límite: <strong className="text-[#1D1D1F] dark:text-white">{formatShortIsoDate(cycleInfo.dueDate)}</strong>
                              {cycleInfo.daysUntilDue !== null && cycleInfo.daysUntilDue > 0 && (
                                <span className="text-[10px] text-[#248A3D] dark:text-[#34C759] ml-1">
                                  (en {cycleInfo.daysUntilDue}d)
                                </span>
                              )}
                              {cycleInfo.daysUntilDue === 0 && (
                                <span className="text-[10px] text-[#B25000] dark:text-[#FF9F0A] font-semibold ml-1">
                                  (Vence hoy)
                                </span>
                              )}
                              {cycleInfo.isPastDue && cycleNetRemaining > 0 && (
                                <span className="text-[10px] text-[#D70015] dark:text-[#FF3B30] font-semibold ml-1">
                                  (Vencido)
                                </span>
                              )}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onOpenEditBudget(b)}
                              className="text-[10px] text-[#0071E3] hover:underline font-medium"
                            >
                              + Agregar Día de Pago
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-[#FF9F0A]/10 border border-[#FF9F0A]/30 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-[#B25000] dark:text-amber-300">
                          Configura el Día de Corte y Día de Pago para operar por ciclo de facturación.
                        </span>
                        <button
                          type="button"
                          onClick={() => onOpenEditBudget(b)}
                          className="px-2.5 py-1 rounded-full bg-[#FF9F0A] text-black font-semibold text-[10px] shrink-0"
                        >
                          Configurar Fechas
                        </button>
                      </div>
                    )}

                    {/* Cycle Charges, Payments & Card Limits */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">
                          {cycleInfo ? 'Cargos del Ciclo' : 'Credit Limit'}
                        </span>
                        <span className="text-xs font-bold tabular-nums text-[#D70015] dark:text-rose-400 block mt-0.5">
                          {cycleInfo
                            ? `${currencySymbol}${cycleChargesTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                            : `${currencySymbol}${ccCalc.baseCreditLimit.toLocaleString()}`}
                        </span>
                        {cycleInfo && cyclePendingChargesTotal > 0 && (
                          <span className="text-[9px] text-[#B25000] dark:text-[#FF9F0A] block tabular-nums">
                            Flotante: {currencySymbol}{cyclePendingChargesTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">
                          {cycleInfo ? 'Pagos del Ciclo' : 'Overdraft Allowed'}
                        </span>
                        <span className="text-xs font-bold tabular-nums text-[#248A3D] dark:text-emerald-400 block mt-0.5">
                          {cycleInfo
                            ? `${currencySymbol}${(cyclePaymentsTotal + gracePaymentsTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                            : `${ccCalc.overdraftPct}%`}
                        </span>
                        {cycleInfo && gracePaymentsTotal > 0 && (
                          <span className="text-[9px] text-[#86868B] block tabular-nums">
                            Incl. {currencySymbol}{gracePaymentsTotal.toFixed(2)} post-corte
                          </span>
                        )}
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">
                          {cycleInfo ? 'Neto del Ciclo' : 'APR'}
                        </span>
                        <span className="text-xs font-bold tabular-nums text-[#1D1D1F] dark:text-white block mt-0.5">
                          {cycleInfo
                            ? `${currencySymbol}${cycleNetRemaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                            : `${b.apr || 0}%`}
                        </span>
                        {cycleInfo && (
                          <span className="text-[9px] text-[#86868B] block tabular-nums">
                            {cardChargesInCycle.length} cargos • {cardPaymentsInCycle.length + postCutoffPaymentsTowardDue.length} pagos
                          </span>
                        )}
                      </div>
                      <div className="bg-white dark:bg-[#1f1f1f] p-2.5 rounded-xl text-center border border-black/[0.03] dark:border-transparent">
                        <span className="text-[10px] text-[#86868B] block">Balance Total Usado</span>
                        <span className="text-xs font-bold tabular-nums text-[#B25000] dark:text-amber-400 block mt-0.5">
                          {currencySymbol}{usedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                        <span className="text-[9px] text-[#86868B] block tabular-nums">
                          Límite: {currencySymbol}{ccCalc.baseCreditLimit.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="bg-[#FF9F0A]/10 border border-[#FF9F0A]/25 rounded-xl px-3 py-2 flex items-center justify-between text-xs">
                      <span className="text-[#B25000] dark:text-amber-300 font-medium">
                        Monthly Limit (Credit + {ccCalc.overdraftPct}% Overdraft) • APR {b.apr || 0}%
                      </span>
                      <span className="text-[#1D1D1F] dark:text-white font-bold tabular-nums">
                        {currencySymbol}{effectiveLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* Credit Utilization Bar + Ledger Drift Explanation */}
                    <div className="space-y-1.5 pt-1">
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
                      {usedBalance > 0 && cycleChargesTotal === 0 && (
                        <div className="bg-white dark:bg-[#1f1f1f] border border-black/[0.05] dark:border-white/10 rounded-xl px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#6E6E73] dark:text-zinc-300">
                          <span className="leading-snug">
                            {cardAllTimeChargesCount > 0 && cardLedgerNetDebt > 0
                              ? `0 cargos en este ciclo — el balance usado proviene de ciclos anteriores (${cardAllTimeChargesCount} cargos registrados, neto ${currencySymbol}${cardLedgerNetDebt.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`
                              : `Sin cargos pendientes en el ledger (neto ${currencySymbol}${cardLedgerNetDebt.toLocaleString('en-US', { minimumFractionDigits: 2 })}). Este monto es un balance inicial manual o de cargos eliminados.`}
                          </span>
                          {hasCardLedgerDrift && onRecalculateAccountBalance && (
                            <button
                              type="button"
                              disabled={recalculatingId === b.id}
                              onClick={async () => {
                                setRecalculatingId(b.id);
                                try {
                                  await onRecalculateAccountBalance(b.id);
                                } finally {
                                  setRecalculatingId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#0071E3]/12 hover:bg-[#0071E3]/20 text-[#0071E3] dark:text-[#5AC8FA] font-semibold shrink-0 transition disabled:opacity-50"
                            >
                              <RefreshCw className={`w-3 h-3 ${recalculatingId === b.id ? 'animate-spin' : ''}`} />
                              Sync Balance ({currencySymbol}{cardLedgerNetDebt.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                            </button>
                          )}
                        </div>
                      )}
                      {usedBalance > 0 && cycleChargesTotal > 0 && hasCardLedgerDrift && onRecalculateAccountBalance && (
                        <div className="flex items-center justify-between gap-2 text-[10px] text-[#86868B] pt-0.5">
                          <span className="tabular-nums">
                            Ledger Net Debt: {currencySymbol}{cardLedgerNetDebt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                          <button
                            type="button"
                            disabled={recalculatingId === b.id}
                            onClick={async () => {
                              setRecalculatingId(b.id);
                              try {
                                await onRecalculateAccountBalance(b.id);
                              } finally {
                                setRecalculatingId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0071E3]/10 hover:bg-[#0071E3]/20 text-[#0071E3] dark:text-[#5AC8FA] font-semibold transition disabled:opacity-50"
                          >
                            <RefreshCw className={`w-2.5 h-2.5 ${recalculatingId === b.id ? 'animate-spin' : ''}`} />
                            Sync Balance
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Expandable Cycle Charges & Payments List */}
                    {cycleInfo && (
                      <div className="pt-1 border-t border-black/[0.05] dark:border-[#262626] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedCardCycles(prev => ({ ...prev, [b.id]: !prev[b.id] }))}
                            className="text-[11px] text-[#1D1D1F] dark:text-zinc-300 flex items-center gap-1 bg-white dark:bg-[#222] border border-black/[0.06] dark:border-transparent px-2.5 py-1 rounded-full font-medium transition"
                          >
                            {isCycleLedgerExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            <span>
                              {isCycleLedgerExpanded ? 'Ocultar' : 'Ver'} Cargos y Pagos del Ciclo ({cycleAllTxs.length})
                            </span>
                          </button>
                          {(b.cutoffDate || b.dueDate) && (
                            <span className="text-[10px] text-[#86868B] tabular-nums">
                              Día Corte: <strong className="text-[#1D1D1F] dark:text-white">{cutoffDay || b.cutoffDate}</strong>
                              {dueDay || b.dueDate ? (
                                <> • Día Pago: <strong className="text-[#1D1D1F] dark:text-white">{dueDay || b.dueDate}</strong></>
                              ) : null}
                            </span>
                          )}
                        </div>

                        {isCycleLedgerExpanded && (
                          <div className="space-y-1 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
                            {cycleAllTxs.length === 0 ? (
                              <div className="bg-white dark:bg-[#1f1f1f] rounded-xl p-3 text-center text-[11px] text-[#86868B]">
                                No hay cargos ni pagos registrados en el ciclo {cycleInfo.periodLabel}.
                              </div>
                            ) : (
                              cycleAllTxs.map(txItem => {
                                const isPayment =
                                  Boolean(txItem.isLoanPayment) ||
                                  txItem.type === 'income' ||
                                  (Boolean(txItem.isTransfer) && txItem.transferToBudgetId === b.id);
                                const isPending = txItem.status === 'pending';
                                return (
                                  <div
                                    key={txItem.id}
                                    className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-xl bg-white dark:bg-[#1f1f1f] border border-black/[0.03] dark:border-transparent text-xs"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-medium text-[#1D1D1F] dark:text-zinc-200 truncate">
                                          {txItem.title}
                                        </span>
                                        {isPending && (
                                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FF9F0A]/15 text-[#B25000] dark:text-[#FF9F0A] shrink-0">
                                            Flotante
                                          </span>
                                        )}
                                        {isPayment && (
                                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#34C759]/15 text-[#248A3D] dark:text-[#34C759] shrink-0">
                                            Abono
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[10px] text-[#86868B] block tabular-nums">
                                        {txItem.date} • {txItem.category}
                                        {txItem.statementCycle ? ` • Estado ${txItem.statementCycle}` : ''}
                                      </span>
                                    </div>
                                    <span
                                      className={`font-semibold tabular-nums shrink-0 ${
                                        isPayment ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#1D1D1F] dark:text-white'
                                      }`}
                                    >
                                      {isPayment ? '+' : '-'}{currencySymbol}{Number(txItem.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
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

                {/* Monthly Spending / Cycle / Quota Progress */}
                {(!isLiquidAccount || effectiveLimit > 0) && (() => {
                  const progressTarget = isLoan ? computedQuota : effectiveLimit;
                  const progressCurrent = isLoan
                    ? currentMonthLoanPaid
                    : isCreditCard && cycleInfo
                    ? cycleChargesTotal
                    : isLiquidAccount
                    ? directOutflows
                    : spent;
                  const progressPct = progressTarget > 0 ? Math.min(Math.round((progressCurrent / progressTarget) * 100), 100) : 0;
                  const isBarOver = !isLoan && progressTarget > 0 && progressCurrent > progressTarget;
                  return (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-[#6E6E73] dark:text-[#9b9b9b] tabular-nums">
                        <span>
                          {isLoan
                            ? 'This Month Paid'
                            : isCreditCard && cycleInfo
                            ? `Cargos del Ciclo (${cycleInfo.label})`
                            : 'Current Month Spent'}
                          : {currencySymbol}{progressCurrent.toFixed(2)}
                        </span>
                        <span className={isBarOver ? 'text-[#D70015] dark:text-rose-400 font-bold' : 'text-[#1D1D1F] dark:text-white font-semibold'}>
                          {isLoan ? 'Monthly Quota' : isCreditCard ? 'Cycle Limit' : 'Monthly Limit'}: {currencySymbol}{progressTarget.toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
                          {progressPct}% of {isLoan ? 'monthly quota paid' : isCreditCard && cycleInfo ? 'cycle limit used' : 'monthly limit used'}
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
