import React, { useState, useMemo } from 'react';
import {
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  CreditCard,
  Building2,
  Wallet,
  ArrowRightLeft,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart as RechartsPie,
  Pie,
  Cell
} from 'recharts';
import { Budget } from './BudgetsPage';
import TransactionDetailDrawer from './TransactionDetailDrawer';
import {
  calculateCreditCardMonthlyLimit,
  parseDayOfMonth,
  getActiveCreditCardCycleKey,
  getCreditCardCycleForMonth,
  getTransactionCreditCardCycleKey,
  formatShortIsoDate,
  getCleanTransactionDisplay,
  evaluateCreditCardSoftCap,
  getCreditCardGoldenRuleStatus,
  calculateCardInstallmentsSummary
} from '../utils/financeMath';

export interface Transaction {
  id: string;
  userId: string;
  title: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  date: string;
  notes?: string;
  budgetId?: string;
  isLoanPayment?: boolean;
  loanPrincipalPaid?: number;
  loanInterestPaid?: number;
  paidQuotaIds?: string[];
  isTransfer?: boolean;
  transferToBudgetId?: string;
  status?: 'pending' | 'cleared';
  emailId?: string;
  emailOutcome?: 'approved' | 'declined' | 'reversed';
  emailContext?: string;
  statementCycle?: string;
}

interface DashboardPageProps {
  transactions: Transaction[];
  allTransactions?: Transaction[];
  budgets?: Budget[];
  chartMode: 'Expense' | 'Income' | 'Cashflow';
  setChartMode: (mode: 'Expense' | 'Income' | 'Cashflow') => void;
  breakdownMode?: 'Expense' | 'Income';
  setBreakdownMode?: (mode: 'Expense' | 'Income') => void;
  monthlyChartData: any[];
  breakdownData?: any[];
  totalIncome: number;
  totalExpense: number;
  currencySymbol: string;
  currencyCode?: string;
  fxRateUsdToDop?: number;
  colors?: string[];
  onOpenAddTx: (type: 'income' | 'expense', datePrefill?: string) => void;
  onOpenEditTx: (transaction: Transaction) => void;
  onDeleteTx: (id: string) => void;
  onOpenAddBudget?: () => void;
  onNavigateBudgets?: () => void;
  onMarkCleared?: (txId: string) => void;
  selectedMonth?: string;
}

const APPLE_PALETTE = [
  '#0071E3', // Apple Blue
  '#34C759', // Apple Green
  '#FF9F0A', // Apple Amber
  '#AF52DE', // Apple Purple
  '#FF2D55', // Apple Pink
  '#5AC8FA', // Apple Sky
  '#FF3B30', // Apple Red
  '#5856D6'  // Apple Indigo
];

function CustomChartTooltip({ active, payload, label, displaySymbol }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 dark:bg-[#1C1C1E]/95 border border-black/[0.08] dark:border-white/10 rounded-2xl p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-2xl backdrop-blur-xl text-xs space-y-1">
        <div className="font-semibold text-[#86868B] text-[11px] tabular-nums">{label}</div>
        {payload.map((entry: any, index: number) => (
          <div key={`item-${index}`} className="flex items-center justify-between gap-3 text-[#1D1D1F] dark:text-white">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-[#86868B] capitalize">{entry.name}:</span>
            </span>
            <span className="font-bold tabular-nums">
              {displaySymbol}{Number(entry.value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export default function DashboardPage({
  transactions,
  allTransactions,
  budgets = [],
  chartMode,
  setChartMode,
  monthlyChartData,
  totalIncome,
  totalExpense,
  currencySymbol,
  currencyCode = 'USD',
  fxRateUsdToDop = 60.5,
  onOpenAddTx,
  onOpenEditTx,
  onDeleteTx,
  onOpenAddBudget,
  onNavigateBudgets,
  onMarkCleared,
  selectedMonth
}: DashboardPageProps) {
  const fullLedgerTransactions = allTransactions || transactions;
  const activeFxRate = fxRateUsdToDop > 0 ? fxRateUsdToDop : 60.5;
  const [currencySegment, setCurrencySegment] = useState<'All' | 'DOP' | 'USD'>('All');
  const [selectedTxForDetail, setSelectedTxForDetail] = useState<Transaction | null>(null);
  const [feedStatusFilter, setFeedStatusFilter] = useState<'all' | 'pending' | 'cleared'>('all');
  const [feedSearch, setFeedSearch] = useState('');

  // Currency display multiplier based on user's base currency vs selected Apple pill
  const { displaySymbol, fxMultiplier } = useMemo(() => {
    const baseIsDop = currencyCode === 'DOP' || currencySymbol === 'RD$';
    if (currencySegment === 'All') {
      return { displaySymbol: currencySymbol, fxMultiplier: 1 };
    }
    if (currencySegment === 'DOP') {
      return {
        displaySymbol: 'RD$',
        fxMultiplier: baseIsDop ? 1 : activeFxRate
      };
    }
    return {
      displaySymbol: 'US$',
      fxMultiplier: baseIsDop ? 1 / activeFxRate : 1
    };
  }, [currencySegment, currencyCode, currencySymbol, activeFxRate]);

  const formatAmt = (val: number) =>
    `${displaySymbol}${(val * fxMultiplier).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;

  // 1. Compute True Net Liquid Balance & Total Credit Exposure strictly from DB records
  const {
    netLiquidCash,
    totalCreditExposure,
    creditAccountsCount,
    pendingFlotantesSum,
    pendingCount
  } = useMemo(() => {
    let liquid = 0;
    let exposure = 0;
    let debtCount = 0;
    let flotantes = 0;
    let pCount = 0;

    budgets.forEach(b => {
      if (b.accountType === 'bank_account' || b.accountType === 'debit_account') {
        liquid += Number(b.accountBalance) || 0;
      } else if (b.accountType === 'credit_card' || b.accountType === 'loan') {
        exposure += Number(b.actualUsedAmount) || 0;
        debtCount += 1;
      }
    });

    transactions.forEach(t => {
      if (t.emailOutcome === 'declined') return;
      if (t.status === 'pending') {
        flotantes += Number(t.amount) || 0;
        pCount += 1;
      }
    });

    return {
      netLiquidCash: liquid,
      totalCreditExposure: exposure,
      creditAccountsCount: debtCount,
      pendingFlotantesSum: flotantes,
      pendingCount: pCount
    };
  }, [budgets, transactions]);

  // 2. Filter transactions for feed
  const filteredFeed = useMemo(() => {
    return transactions.filter(t => {
      if (feedStatusFilter === 'pending' && (t.status !== 'pending' || t.emailOutcome === 'declined')) return false;
      if (feedStatusFilter === 'cleared' && (t.status === 'pending' || t.emailOutcome === 'declined')) return false;
      if (feedSearch.trim()) {
        const query = feedSearch.toLowerCase();
        const matchTitle = (t.title || '').toLowerCase().includes(query);
        const matchCat = (t.category || '').toLowerCase().includes(query);
        const matchNotes = (t.notes || '').toLowerCase().includes(query);
        if (!matchTitle && !matchCat && !matchNotes) return false;
      }
      return true;
    });
  }, [transactions, feedStatusFilter, feedSearch]);

  // 3. Category breakdown for donut
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    transactions
      .filter(t => t.emailOutcome !== 'declined' && t.type === 'expense' && !t.isTransfer)
      .forEach(t => {
        const cat = t.category || 'General';
        map[cat] = (map[cat] || 0) + (t.amount * fxMultiplier);
      });
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map)
      .map(([name, value]) => ({
        name,
        value,
        percent: total > 0 ? (value / total) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [transactions, fxMultiplier]);

  const convertedChartData = useMemo(() => {
    return monthlyChartData.map(pt => ({
      name: pt.name || pt.date || 'Month',
      income: Number(((pt.income || 0) * fxMultiplier).toFixed(2)),
      expense: Number(((pt.expense || 0) * fxMultiplier).toFixed(2)),
      cashflow: Number(((pt.cashflow || 0) * fxMultiplier).toFixed(2))
    }));
  }, [monthlyChartData, fxMultiplier]);

  const walletAccounts = useMemo(
    () =>
      budgets.filter(
        b =>
          b.accountType === 'bank_account' ||
          b.accountType === 'debit_account' ||
          b.accountType === 'credit_card' ||
          b.accountType === 'loan'
      ),
    [budgets]
  );

  const displayedWalletCards = walletAccounts.length > 0 ? walletAccounts : budgets;

  return (
    <div
      className="space-y-8 max-w-7xl mx-auto pb-12"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", sans-serif'
      }}
    >
      {/* 1. HERO SHOWCASE (Apple Store Banner Aesthetic) */}
      <section className="bg-white dark:bg-gradient-to-b dark:from-[#1C1C1E] dark:to-[#141416] border border-black/[0.04] dark:border-white/10 rounded-3xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-2xl relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-[#0071E3]/[0.07] dark:bg-[#0071E3]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-[#34C759]/[0.06] dark:bg-[#34C759]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-[12px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block mb-1">
                AVAILABLE NET LIQUID CASH
              </span>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-4xl sm:text-5xl font-bold tracking-[-0.04em] text-[#1D1D1F] dark:text-white tabular-nums">
                  {formatAmt(netLiquidCash)}
                </span>
                <span className="text-xs font-semibold text-[#248A3D] dark:text-[#34C759] flex items-center gap-1 tabular-nums">
                  <ArrowUpRight className="w-4 h-4" />
                  Net Flow: {formatAmt(totalIncome - totalExpense)}
                </span>
              </div>
            </div>

            {/* Currency Segmented Control (Apple iOS Style Pill) */}
            <div className="flex items-center p-1 bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-full border border-black/[0.04] dark:border-white/5 self-start sm:self-center">
              <button
                type="button"
                onClick={() => setCurrencySegment('All')}
                className={`py-1.5 px-3.5 rounded-full text-xs font-semibold transition ${
                  currencySegment === 'All'
                    ? 'bg-[#0071E3] text-white shadow-sm'
                    : 'text-[#6E6E73] dark:text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                All Accounts
              </button>
              <button
                type="button"
                onClick={() => setCurrencySegment('DOP')}
                className={`py-1.5 px-3.5 rounded-full text-xs font-semibold transition ${
                  currencySegment === 'DOP'
                    ? 'bg-[#0071E3] text-white shadow-sm'
                    : 'text-[#6E6E73] dark:text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                RD$ Pesos
              </button>
              <button
                type="button"
                onClick={() => setCurrencySegment('USD')}
                className={`py-1.5 px-3.5 rounded-full text-xs font-semibold transition ${
                  currencySegment === 'USD'
                    ? 'bg-[#0071E3] text-white shadow-sm'
                    : 'text-[#6E6E73] dark:text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                US$ Dollars
              </button>
            </div>
          </div>

          {/* Metric Eyebrows Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-black/[0.06] dark:border-white/10">
            <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E]/50 rounded-2xl p-4 border border-black/[0.03] dark:border-white/5">
              <span className="text-[11px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block mb-1">
                TOTAL CREDIT & LOAN EXPOSURE
              </span>
              <div className="text-xl font-bold text-[#1D1D1F] dark:text-white tabular-nums">
                {formatAmt(totalCreditExposure)}
              </div>
              <span className="text-[11px] text-[#86868B] mt-0.5 block">
                {creditAccountsCount > 0
                  ? `${creditAccountsCount} active credit/loan line(s)`
                  : 'No credit cards or loans linked'}
              </span>
            </div>

            <div className="bg-[#FFF9F0] dark:bg-[#2C2C2E]/50 rounded-2xl p-4 border border-[#FF9F0A]/20 dark:border-white/5">
              <span className="text-[11px] uppercase tracking-[0.04em] font-semibold text-[#B25000] dark:text-[#FF9F0A] block mb-1">
                PENDING FLOTANTES ({pendingCount})
              </span>
              <div className="text-xl font-bold text-[#C93400] dark:text-[#FF9F0A] tabular-nums">
                {formatAmt(pendingFlotantesSum)}
              </div>
              <span className="text-[11px] text-[#86868B] mt-0.5 block">
                Awaiting statement reconciliation
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. APPLE WALLET / CARD BENTO SECTION */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[12px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block">
              WALLET & ACCOUNTS
            </span>
            <h3 className="text-xl font-bold tracking-[-0.03em] text-[#1D1D1F] dark:text-white">Connected Cards, Banks & Budgets</h3>
          </div>
          {onOpenAddBudget && (
            <button
              onClick={onOpenAddBudget}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white hover:bg-[#F2F2F7] dark:bg-white/10 dark:hover:bg-white/15 text-[#1D1D1F] dark:text-white border border-black/[0.06] dark:border-white/10 shadow-sm transition flex items-center gap-1.5 active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5" /> Add Account
            </button>
          )}
        </div>

        {displayedWalletCards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {displayedWalletCards.map((b, idx) => {
              const isCredit = b.accountType === 'credit_card';
              const isLoan = b.accountType === 'loan';
              const isBank = b.accountType === 'bank_account';
              const isDebit = b.accountType === 'debit_account';
              const isStandard = !isCredit && !isLoan && !isBank && !isDebit;

              const baseLimit = Number(b.creditLimit || b.limit || 0);
              const ccCalc = isCredit
                ? calculateCreditCardMonthlyLimit(baseLimit, b.overdraftPercentage || 0)
                : null;
              const limit = isCredit
                ? (ccCalc && ccCalc.monthlyLimit > 0 ? ccCalc.monthlyLimit : baseLimit)
                : baseLimit;
              const used = Number(b.actualUsedAmount) || 0;
              const standardSpent = isStandard
                ? transactions
                    .filter(
                      t =>
                        t.emailOutcome !== 'declined' &&
                        t.type === 'expense' &&
                        !t.isTransfer &&
                        !t.isLoanPayment &&
                        (t.budgetId === b.id ||
                          (t.category || '').toLowerCase() === (b.name || b.category || '').toLowerCase())
                    )
                    .reduce((s, t) => s + t.amount, 0)
                : 0;

              const isLiquid = isBank || isDebit;
              const accountCatLower = (b.name || b.category || '').trim().toLowerCase();
              const liquidInflows = isLiquid
                ? transactions
                    .filter(t => {
                      if (t.emailOutcome === 'declined') return false;
                      if (t.isTransfer) return t.transferToBudgetId === b.id;
                      return (
                        t.type === 'income' &&
                        (t.budgetId === b.id || (!t.budgetId && (t.category || '').trim().toLowerCase() === accountCatLower))
                      );
                    })
                    .reduce((s, t) => s + (Number(t.amount) || 0), 0)
                : 0;
              const liquidOutflows = isLiquid
                ? transactions
                    .filter(t => {
                      if (t.emailOutcome === 'declined') return false;
                      if (t.isTransfer) return t.budgetId === b.id;
                      return (
                        t.type === 'expense' &&
                        (t.budgetId === b.id || (!t.budgetId && (t.category || '').trim().toLowerCase() === accountCatLower))
                      );
                    })
                    .reduce((s, t) => s + (Number(t.amount) || 0), 0)
                : 0;

              const cutoffDay = isCredit ? parseDayOfMonth(b.cutoffDate) : null;
              const dueDay = isCredit ? parseDayOfMonth(b.dueDate) : null;
              const cycleKey =
                isCredit && cutoffDay
                  ? selectedMonth && selectedMonth !== 'All' && /^\d{4}-\d{2}$/.test(selectedMonth)
                    ? selectedMonth
                    : getActiveCreditCardCycleKey(cutoffDay)
                  : '';
              const cycleInfo =
                isCredit && cutoffDay && cycleKey
                  ? getCreditCardCycleForMonth(cutoffDay, dueDay, cycleKey)
                  : null;
              const cardCycleCharges =
                isCredit && cycleInfo
                  ? fullLedgerTransactions
                      .filter(t => {
                        if (t.emailOutcome === 'declined') return false;
                        const belongs =
                          t.budgetId === b.id ||
                          (!t.budgetId &&
                            (t.category || '').trim().toLowerCase() === accountCatLower);
                        if (!belongs) return false;
                        const isCharge =
                          (!t.isTransfer && t.type === 'expense' && !t.isLoanPayment) ||
                          (Boolean(t.isTransfer) && t.budgetId === b.id);
                        if (!isCharge) return false;
                        return getTransactionCreditCardCycleKey(t.date, cutoffDay, t.statementCycle) === cycleInfo.cycleKey;
                      })
                      .reduce((s, t) => s + (Number(t.amount) || 0), 0)
                  : 0;

              let cardAllTimeNet = 0;
              let cardAllTimeChargesCount = 0;
              if (isCredit) {
                let cCharges = 0;
                let cPays = 0;
                fullLedgerTransactions.forEach(t => {
                  if (t.emailOutcome === 'declined') return;
                  const amt = Math.abs(Number(t.amount) || 0);
                  if (t.isTransfer) {
                    if (t.budgetId === b.id) {
                      cCharges += amt;
                      cardAllTimeChargesCount += 1;
                    }
                    if (t.transferToBudgetId === b.id) cPays += amt;
                  } else {
                    const belongs =
                      t.budgetId === b.id ||
                      (!t.budgetId && (t.category || '').trim().toLowerCase() === accountCatLower);
                    if (!belongs) return;
                    if (t.isLoanPayment || t.type === 'income') cPays += amt;
                    else {
                      cCharges += amt;
                      cardAllTimeChargesCount += 1;
                    }
                  }
                });
                cardAllTimeNet = Math.max(0, Number((cCharges - cPays).toFixed(2)));
              }

              const installmentSummary = isCredit
                ? calculateCardInstallmentsSummary(b.installments)
                : { activeCount: 0, monthlyQuotaTotal: 0, remainingCommittedTotal: 0 };
              const softCapEval = isCredit
                ? evaluateCreditCardSoftCap(cardCycleCharges, b.softCap)
                : { hasSoftCap: false, softCap: 0, cycleSpent: 0, pct: 0, level: 'none' as const, remainingToCap: 0, label: '' };
              const goldenRule =
                isCredit && cutoffDay ? getCreditCardGoldenRuleStatus(cutoffDay, dueDay) : null;
              const remainingCardLimit = isCredit
                ? Math.max(0, limit - used - installmentSummary.remainingCommittedTotal)
                : 0;

              const utilization = isCredit && limit > 0
                ? Math.min(100, Math.round(((used + installmentSummary.remainingCommittedTotal) / limit) * 100))
                : isStandard && limit > 0
                ? Math.min(100, Math.round((standardSpent / limit) * 100))
                : 0;

              const cardGradient =
                isCredit && softCapEval.level === 'critical'
                  ? 'from-[#FFF5F5] via-[#FFEBEB] to-[#FFE0DE] dark:from-[#3A1718] dark:via-[#261112] dark:to-[#180B0C]'
                  : isCredit && softCapEval.level === 'warning'
                  ? 'from-[#FFFBF2] via-[#FFF4E0] to-[#FFECD0] dark:from-[#382913] dark:via-[#251B0E] dark:to-[#171109]'
                  : isCredit
                  ? 'from-[#FFFFFF] via-[#FBFBFD] to-[#F2F2F7] dark:from-[#2A2B2E] dark:via-[#1E1F22] dark:to-[#121315]'
                  : isLoan
                  ? 'from-[#FFFFFF] via-[#F9F5FF] to-[#F1E8FE] dark:from-[#241E2F] dark:via-[#1B1624] dark:to-[#121018]'
                  : isBank
                  ? 'from-[#FFFFFF] via-[#F3F8FF] to-[#E6F0FF] dark:from-[#172535] dark:via-[#111C28] dark:to-[#0A121A]'
                  : 'from-[#FFFFFF] via-[#F3FBF6] to-[#E7F7ED] dark:from-[#1D2B26] dark:via-[#14201C] dark:to-[#0B1310]';

              const cardBorderClass =
                isCredit && softCapEval.level === 'critical'
                  ? 'border-[#FF3B30]/45'
                  : isCredit && softCapEval.level === 'warning'
                  ? 'border-[#FF9F0A]/45'
                  : 'border-black/[0.05] dark:border-white/10';

              const accentColor =
                isCredit && softCapEval.level === 'critical'
                  ? '#FF3B30'
                  : isCredit && softCapEval.level === 'warning'
                  ? '#FF9F0A'
                  : isCredit
                  ? '#FF9F0A'
                  : isLoan
                  ? '#AF52DE'
                  : isBank
                  ? '#0071E3'
                  : '#34C759';

              return (
                <div
                  key={b.id || idx}
                  onClick={() => onNavigateBudgets && onNavigateBudgets()}
                  className={`bg-gradient-to-br ${cardGradient} border ${cardBorderClass} rounded-[22px] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl relative overflow-hidden flex flex-col justify-between space-y-4 transition hover:scale-[1.015] duration-300 cursor-pointer`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-[#86868B] block">
                        {isCredit
                          ? 'Credit Card'
                          : isLoan
                          ? 'Loan Facility'
                          : isBank
                          ? 'Bank Account'
                          : isDebit
                          ? 'Debit Account'
                          : 'Budget Envelope'}
                      </span>
                      <h4 className="text-lg font-bold text-[#1D1D1F] dark:text-white tracking-tight mt-0.5 truncate">
                        {b.name || b.category}
                      </h4>
                    </div>
                    <div className="w-10 h-10 rounded-2xl bg-black/[0.04] dark:bg-white/10 flex items-center justify-center shrink-0">
                      {isCredit ? (
                        <CreditCard
                          className={`w-5 h-5 ${
                            softCapEval.level === 'critical' ? 'text-[#FF3B30]' : 'text-[#FF9F0A]'
                          }`}
                        />
                      ) : isLoan ? (
                        <Building2 className="w-5 h-5 text-[#AF52DE]" />
                      ) : (
                        <Wallet className="w-5 h-5 text-[#0071E3]" />
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[11px] text-[#86868B] block">
                      {isCredit || isLoan
                        ? 'Current Balance Used'
                        : isStandard
                        ? 'Monthly Spent'
                        : 'Available Balance'}
                    </span>
                    <div className="text-2xl font-extrabold text-[#1D1D1F] dark:text-white tabular-nums tracking-tight">
                      {formatAmt(isCredit || isLoan ? used : isStandard ? standardSpent : Number(b.accountBalance) || 0)}
                    </div>
                    {isLiquid && (
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#6E6E73] dark:text-zinc-300 tabular-nums pt-0.5">
                        <span className="text-[#248A3D] dark:text-[#34C759]">+{formatAmt(liquidInflows)}</span>
                        <span className="text-[#D70015] dark:text-[#FF3B30]">-{formatAmt(liquidOutflows)}</span>
                        <span className="font-semibold text-[#1D1D1F] dark:text-white">
                          Net {liquidInflows - liquidOutflows >= 0 ? '+' : '-'}{formatAmt(Math.abs(liquidInflows - liquidOutflows))}
                        </span>
                      </div>
                    )}
                    {isCredit && cycleInfo && (
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#6E6E73] dark:text-zinc-300 tabular-nums pt-0.5">
                        <span>
                          Ciclo {cycleInfo.periodLabel}: <strong className="text-[#1D1D1F] dark:text-white">{formatAmt(cardCycleCharges)}</strong>
                        </span>
                        <span className="text-[10px] text-[#B25000] dark:text-[#FF9F0A] font-medium">
                          Corte {formatShortIsoDate(cycleInfo.cutoffDate)}
                          {cycleInfo.dueDate ? ` • Pago ${formatShortIsoDate(cycleInfo.dueDate)}` : ''}
                        </span>
                      </div>
                    )}
                    {isCredit && softCapEval.hasSoftCap && (
                      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold tabular-nums">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                            softCapEval.level === 'critical'
                              ? 'bg-[#FF3B30]/15 text-[#D70015] dark:text-[#FF3B30] border-[#FF3B30]/35'
                              : softCapEval.level === 'warning'
                              ? 'bg-[#FF9F0A]/15 text-[#B25000] dark:text-[#FF9F0A] border-[#FF9F0A]/35'
                              : 'bg-[#34C759]/12 text-[#248A3D] dark:text-[#34C759] border-[#34C759]/25'
                          }`}
                        >
                          {softCapEval.level !== 'safe' && <AlertTriangle className="w-3 h-3" />}
                          {softCapEval.label}
                        </span>
                        <span className="text-[#86868B]">Tope: {formatAmt(softCapEval.softCap)}</span>
                      </div>
                    )}
                    {isCredit && goldenRule && (
                      <div
                        className={`text-[10px] font-semibold px-2.5 py-1 rounded-xl border leading-snug ${
                          goldenRule.status === 'good'
                            ? 'bg-[#34C759]/10 text-[#248A3D] dark:text-[#34C759] border-[#34C759]/25'
                            : goldenRule.status === 'avoid'
                            ? 'bg-[#FF3B30]/10 text-[#D70015] dark:text-[#FF3B30] border-[#FF3B30]/25'
                            : 'bg-black/[0.03] dark:bg-white/5 text-[#6E6E73] dark:text-zinc-300 border-black/[0.05] dark:border-white/10'
                        }`}
                      >
                        {goldenRule.headline}
                      </div>
                    )}
                    {isCredit && installmentSummary.activeCount > 0 && (
                      <div className="text-[10px] text-[#8944AB] dark:text-purple-300 tabular-nums flex items-center justify-between gap-2">
                        <span>
                          Diferidos ({installmentSummary.activeCount}): {formatAmt(installmentSummary.monthlyQuotaTotal)}/mes
                        </span>
                        <span>Comprometido: {formatAmt(installmentSummary.remainingCommittedTotal)}</span>
                      </div>
                    )}
                    {isCredit && used > 0 && cardCycleCharges === 0 && (
                      <span className="text-[10px] text-[#86868B] block">
                        {cardAllTimeChargesCount > 0 && cardAllTimeNet > 0
                          ? 'Balance carried from prior cycles'
                          : 'Opening balance (0 charges in ledger — sync in Budgets)'}
                      </span>
                    )}
                    {(isCredit || isStandard) && limit > 0 && (
                      <div className="flex items-center justify-between text-[11px] text-[#86868B] tabular-nums pt-0.5">
                        <span>
                          {isCredit ? `Disp: ${formatAmt(remainingCardLimit)}` : `Limit: ${formatAmt(limit)}`}
                        </span>
                        <span className={utilization > 80 ? 'text-[#D70015] dark:text-[#FF3B30] font-semibold' : 'text-[#6E6E73] dark:text-zinc-300'}>
                          {utilization}% used
                        </span>
                      </div>
                    )}
                  </div>

                  {(isCredit || isStandard) && limit > 0 && (
                    <div className="h-1.5 w-full bg-black/[0.08] dark:bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${utilization}%`,
                          backgroundColor:
                            softCapEval.level === 'critical' || utilization > 80
                              ? '#FF3B30'
                              : softCapEval.level === 'warning'
                              ? '#FF9F0A'
                              : accentColor
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 rounded-[22px] p-10 text-center space-y-3 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-none">
            <Wallet className="w-8 h-8 text-[#86868B] mx-auto opacity-60" />
            <h4 className="text-sm font-semibold text-[#1D1D1F] dark:text-white">No Accounts or Budgets Yet</h4>
            <p className="text-xs text-[#86868B] max-w-md mx-auto">
              Add your bank accounts, credit cards, loans, or monthly category budgets to view live balances and utilization here.
            </p>
            {onOpenAddBudget && (
              <button
                type="button"
                onClick={onOpenAddBudget}
                className="px-4 py-2 rounded-full text-xs font-semibold bg-[#0071E3] hover:bg-[#0077ED] text-white transition active:scale-[0.98]"
              >
                Create First Account / Budget
              </button>
            )}
          </div>
        )}
      </section>

      {/* 3. CHARTS & SPENDING BREAKDOWN */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 rounded-3xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-[#86868B] block">
                TIMELINE ANALYTICS
              </span>
              <h4 className="text-lg font-bold text-[#1D1D1F] dark:text-white tracking-tight">Financial Flow Dynamics</h4>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex p-1 bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-full border border-black/[0.04] dark:border-white/5">
                {(['Cashflow', 'Expense', 'Income'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setChartMode(mode)}
                    className={`px-3 py-1 text-xs font-semibold rounded-full transition ${
                      chartMode === mode ? 'bg-[#0071E3] text-white shadow-sm' : 'text-[#6E6E73] dark:text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <button
                onClick={() => onOpenAddTx('expense')}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#0071E3] hover:bg-[#0077ED] text-white transition flex items-center gap-1 active:scale-[0.98]"
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            </div>
          </div>

          <div className="h-64 w-full pt-2">
            {convertedChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={convertedChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="appleBlueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0071E3" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#0071E3" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="appleGreenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34C759" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#34C759" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="appleRedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF3B30" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#FF3B30" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" stroke="#86868B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#86868B" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomChartTooltip displaySymbol={displaySymbol} />} />
                  {chartMode === 'Cashflow' ? (
                    <>
                      <Area
                        type="monotone"
                        dataKey="income"
                        name="Income"
                        stroke="#34C759"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#appleGreenGrad)"
                      />
                      <Area
                        type="monotone"
                        dataKey="expense"
                        name="Expense"
                        stroke="#0071E3"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#appleBlueGrad)"
                      />
                    </>
                  ) : chartMode === 'Expense' ? (
                    <Area
                      type="monotone"
                      dataKey="expense"
                      name="Expense"
                      stroke="#FF3B30"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#appleRedGrad)"
                    />
                  ) : (
                    <Area
                      type="monotone"
                      dataKey="income"
                      name="Income"
                      stroke="#34C759"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#appleGreenGrad)"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-[#86868B]">
                Record transactions to visualize your monthly cashflow dynamics.
              </div>
            )}
          </div>
        </div>

        {/* Category Donut */}
        <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 rounded-3xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl space-y-4 flex flex-col justify-between">
          <div>
            <span className="text-[11px] uppercase tracking-wider font-semibold text-[#86868B] block">
              SPENDING BREAKDOWN
            </span>
            <h4 className="text-lg font-bold text-[#1D1D1F] dark:text-white tracking-tight">Top Spending Categories</h4>
          </div>

          <div className="h-48 w-full relative flex items-center justify-center">
            {categoryData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={categoryData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={75}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {categoryData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={APPLE_PALETTE[index % APPLE_PALETTE.length]} />
                      ))}
                    </Pie>
                  </RechartsPie>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[10px] uppercase font-semibold text-[#86868B]">Top Category</span>
                  <span className="text-xs font-bold text-[#1D1D1F] dark:text-white max-w-[90px] truncate text-center">
                    {categoryData[0]?.name || 'None'}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-xs text-[#86868B] text-center">No expenses recorded for this period.</div>
            )}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-black/[0.06] dark:border-white/10">
            {categoryData.slice(0, 4).map((cat, idx) => (
              <div key={cat.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-[#6E6E73] dark:text-zinc-300">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: APPLE_PALETTE[idx % APPLE_PALETTE.length] }}
                  />
                  <span className="truncate max-w-[130px]">{cat.name}</span>
                </span>
                <span className="font-semibold text-[#1D1D1F] dark:text-white tabular-nums">
                  {cat.percent.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. GROUPED INSET LIST (iOS Settings / Apple Card Activity Style) */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[12px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block">
              RECENT ACTIVITY & RECONCILIATION
            </span>
            <h3 className="text-xl font-bold tracking-[-0.03em] text-[#1D1D1F] dark:text-white">Activity Feed</h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search merchant, category..."
              value={feedSearch}
              onChange={e => setFeedSearch(e.target.value)}
              className="bg-white dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-full px-3.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3] w-48 shadow-sm"
            />

            <div className="flex p-0.5 bg-[#E5E5EA]/70 dark:bg-[#2C2C2E] rounded-full border border-black/[0.04] dark:border-white/5">
              <button
                type="button"
                onClick={() => setFeedStatusFilter('all')}
                className={`py-1 px-3 rounded-full text-xs font-semibold transition ${
                  feedStatusFilter === 'all' ? 'bg-[#0071E3] text-white shadow-sm' : 'text-[#6E6E73] dark:text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFeedStatusFilter('pending')}
                className={`py-1 px-3 rounded-full text-xs font-semibold transition ${
                  feedStatusFilter === 'pending'
                    ? 'bg-[#FF9F0A] text-black shadow-sm'
                    : 'text-[#6E6E73] dark:text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                Flotantes
              </button>
              <button
                type="button"
                onClick={() => setFeedStatusFilter('cleared')}
                className={`py-1 px-3 rounded-full text-xs font-semibold transition ${
                  feedStatusFilter === 'cleared'
                    ? 'bg-[#34C759] text-black shadow-sm'
                    : 'text-[#6E6E73] dark:text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                Cleared
              </button>
            </div>
          </div>
        </div>

        {/* Grouped Inset Container */}
        <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 rounded-[20px] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-2xl">
          {filteredFeed.length > 0 ? (
            <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
              {filteredFeed.slice(0, 30).map(t => {
                const isPending = t.status === 'pending';
                const isIncome = t.type === 'income';
                const matchedBudget = budgets.find(b => b.id === t.budgetId);
                const transferToBudget = t.transferToBudgetId
                  ? budgets.find(b => b.id === t.transferToBudgetId)
                  : undefined;
                const { displayTitle } = getCleanTransactionDisplay(t, matchedBudget, transferToBudget);

                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTxForDetail(t)}
                    className="p-4 hover:bg-[#F5F5F7] dark:hover:bg-white/[0.03] transition flex items-center justify-between gap-4 cursor-pointer active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-[12px] bg-[#F2F2F7] dark:bg-[#2C2C2E] border border-black/[0.04] dark:border-white/5 flex items-center justify-center shrink-0">
                        {isIncome ? (
                          <ArrowUpRight className="w-5 h-5 text-[#248A3D] dark:text-[#34C759]" />
                        ) : t.isTransfer ? (
                          <ArrowRightLeft className="w-5 h-5 text-[#0071E3]" />
                        ) : (
                          <ArrowDownRight className="w-5 h-5 text-[#D70015] dark:text-[#FF3B30]" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h5 className="text-sm font-semibold text-[#1D1D1F] dark:text-white truncate">{displayTitle}</h5>
                          {isPending && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FF9F0A]/15 text-[#B25000] dark:text-[#FF9F0A] border border-[#FF9F0A]/30">
                              Flotante
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#86868B] flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="tabular-nums">{t.date}</span>
                          <span>•</span>
                          <span>{t.category}</span>
                          {t.isTransfer && matchedBudget && transferToBudget ? (
                            <>
                              <span>•</span>
                              <span className="text-[#0071E3] dark:text-[#5AC8FA] truncate max-w-[220px] font-medium">
                                {matchedBudget.name || matchedBudget.category} → {transferToBudget.name || transferToBudget.category}
                              </span>
                            </>
                          ) : matchedBudget ? (
                            <>
                              <span>•</span>
                              <span className="text-[#6E6E73] dark:text-zinc-300 truncate max-w-[140px]">
                                {matchedBudget.name || matchedBudget.category}
                              </span>
                            </>
                          ) : null}
                        </div>
                        {t.emailContext && (
                          <p className="text-[11px] text-[#6E6E73] dark:text-zinc-400 mt-0.5 truncate max-w-md">
                            {t.emailContext}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div
                          className={`text-base font-bold tabular-nums tracking-tight ${
                            isIncome
                              ? 'text-[#248A3D] dark:text-[#34C759]'
                              : t.isTransfer
                              ? 'text-[#0071E3] dark:text-[#5AC8FA]'
                              : 'text-[#1D1D1F] dark:text-white'
                          }`}
                        >
                          {t.isTransfer ? '' : isIncome ? '+' : '-'} {formatAmt(t.amount)}
                        </div>
                        <div className="text-[10px] text-[#86868B] tabular-nums flex items-center justify-end gap-1">
                          {isPending ? (
                            'Pending alert'
                          ) : (
                            <>
                              <CheckCircle2 className="w-2.5 h-2.5 text-[#34C759]" /> Cleared
                            </>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#86868B]" />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center space-y-2">
              <CreditCard className="w-8 h-8 text-[#86868B] mx-auto opacity-40" />
              <h5 className="text-sm font-semibold text-[#1D1D1F] dark:text-white">No transactions found</h5>
              <p className="text-xs text-[#86868B]">
                Add a transaction, upload a statement, or select another month filter to view activity.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* 6. SLIDE-OVER DETAIL SHEET */}
      <TransactionDetailDrawer
        tx={selectedTxForDetail}
        onClose={() => setSelectedTxForDetail(null)}
        onEdit={onOpenEditTx}
        onDelete={onDeleteTx}
        budgets={budgets}
        currencySymbol={displaySymbol}
        fxRateUsdToDop={activeFxRate}
        onMarkCleared={onMarkCleared}
      />
    </div>
  );
}
