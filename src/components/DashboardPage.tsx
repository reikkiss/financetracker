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
  Mail,
  Upload
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
}

interface DashboardPageProps {
  transactions: Transaction[];
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
  colors?: string[];
  onOpenAddTx: (type: 'income' | 'expense', datePrefill?: string) => void;
  onOpenEditTx: (transaction: Transaction) => void;
  onDeleteTx: (id: string) => void;
  onOpenAddBudget?: () => void;
  onOpenEmailSync?: () => void;
  onOpenUploadStatement?: () => void;
  onNavigateBudgets?: () => void;
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

const FX_USD_TO_DOP = 60.5;

function CustomChartTooltip({ active, payload, label, displaySymbol }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1C1C1E]/95 border border-white/10 rounded-2xl p-3 shadow-2xl backdrop-blur-xl text-xs space-y-1">
        <div className="font-semibold text-[#86868B] text-[11px] tabular-nums">{label}</div>
        {payload.map((entry: any, index: number) => (
          <div key={`item-${index}`} className="flex items-center justify-between gap-3 text-white">
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
  budgets = [],
  chartMode,
  setChartMode,
  monthlyChartData,
  totalIncome,
  totalExpense,
  currencySymbol,
  currencyCode = 'USD',
  onOpenAddTx,
  onOpenEditTx,
  onDeleteTx,
  onOpenAddBudget,
  onOpenEmailSync,
  onOpenUploadStatement,
  onNavigateBudgets
}: DashboardPageProps) {
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
        fxMultiplier: baseIsDop ? 1 : FX_USD_TO_DOP
      };
    }
    return {
      displaySymbol: 'US$',
      fxMultiplier: baseIsDop ? 1 / FX_USD_TO_DOP : 1
    };
  }, [currencySegment, currencyCode, currencySymbol]);

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
      if (feedStatusFilter === 'pending' && t.status !== 'pending') return false;
      if (feedStatusFilter === 'cleared' && t.status === 'pending') return false;
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
      .filter(t => t.type === 'expense' && !t.isTransfer)
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
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif'
      }}
    >
      {/* 1. HERO SHOWCASE (Apple Store Banner Aesthetic) */}
      <section className="bg-gradient-to-b from-[#1C1C1E] to-[#141416] border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-[#0071E3]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-[#34C759]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-[12px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block mb-1">
                AVAILABLE NET LIQUID CASH
              </span>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-4xl sm:text-5xl font-bold tracking-tight text-white tabular-nums">
                  {formatAmt(netLiquidCash)}
                </span>
                <span className="text-xs font-semibold text-[#34C759] flex items-center gap-1">
                  <ArrowUpRight className="w-4 h-4" />
                  Net Flow: {formatAmt(totalIncome - totalExpense)}
                </span>
              </div>
            </div>

            {/* Currency Segmented Control (Apple iOS Style Pill) */}
            <div className="flex items-center p-1 bg-[#2C2C2E] rounded-full border border-white/5 self-start sm:self-center">
              <button
                type="button"
                onClick={() => setCurrencySegment('All')}
                className={`py-1.5 px-3.5 rounded-full text-xs font-semibold transition ${
                  currencySegment === 'All'
                    ? 'bg-[#0071E3] text-white shadow-sm'
                    : 'text-[#86868B] hover:text-white'
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
                    : 'text-[#86868B] hover:text-white'
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
                    : 'text-[#86868B] hover:text-white'
                }`}
              >
                US$ Dollars
              </button>
            </div>
          </div>

          {/* Metric Eyebrows Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-white/10">
            <div className="bg-[#2C2C2E]/50 rounded-2xl p-4 border border-white/5">
              <span className="text-[11px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block mb-1">
                TOTAL CREDIT & LOAN EXPOSURE
              </span>
              <div className="text-xl font-bold text-white tabular-nums">
                {formatAmt(totalCreditExposure)}
              </div>
              <span className="text-[11px] text-[#86868B] mt-0.5 block">
                {creditAccountsCount > 0
                  ? `${creditAccountsCount} active credit/loan line(s)`
                  : 'No credit cards or loans linked'}
              </span>
            </div>

            <div className="bg-[#2C2C2E]/50 rounded-2xl p-4 border border-white/5">
              <span className="text-[11px] uppercase tracking-[0.04em] font-semibold text-[#FF9F0A] block mb-1">
                PENDING FLOTANTES ({pendingCount})
              </span>
              <div className="text-xl font-bold text-[#FF9F0A] tabular-nums">
                {formatAmt(pendingFlotantesSum)}
              </div>
              <span className="text-[11px] text-[#86868B] mt-0.5 block">
                Awaiting statement reconciliation
              </span>
            </div>

            <div className="bg-[#2C2C2E]/50 rounded-2xl p-4 border border-white/5 flex items-center justify-between gap-3">
              <div>
                <span className="text-[11px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block mb-1">
                  EMAIL BANK SYNC
                </span>
                <span className="text-xs text-white font-medium flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-[#0071E3]" /> iCloud & Gmail
                </span>
              </div>
              {onOpenEmailSync && (
                <button
                  type="button"
                  onClick={onOpenEmailSync}
                  className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#0071E3] hover:bg-[#0077ED] text-white transition active:scale-[0.98] shrink-0"
                >
                  Sync Alerts
                </button>
              )}
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
            <h3 className="text-xl font-bold tracking-tight text-white">Connected Cards, Banks & Budgets</h3>
          </div>
          {onOpenAddBudget && (
            <button
              onClick={onOpenAddBudget}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white/10 hover:bg-white/15 text-white transition flex items-center gap-1.5 active:scale-[0.98]"
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

              const limit = Number(b.creditLimit || b.limit || 0);
              const used = Number(b.actualUsedAmount) || 0;
              const standardSpent = isStandard
                ? transactions
                    .filter(
                      t =>
                        t.type === 'expense' &&
                        !t.isTransfer &&
                        !t.isLoanPayment &&
                        (t.budgetId === b.id ||
                          (t.category || '').toLowerCase() === (b.name || b.category || '').toLowerCase())
                    )
                    .reduce((s, t) => s + t.amount, 0)
                : 0;

              const utilization = isCredit && limit > 0
                ? Math.min(100, Math.round((used / limit) * 100))
                : isStandard && limit > 0
                ? Math.min(100, Math.round((standardSpent / limit) * 100))
                : 0;

              const cardGradient = isCredit
                ? 'from-[#2A2B2E] via-[#1E1F22] to-[#121315]'
                : isLoan
                ? 'from-[#241E2F] via-[#1B1624] to-[#121018]'
                : isBank
                ? 'from-[#172535] via-[#111C28] to-[#0A121A]'
                : 'from-[#1D2B26] via-[#14201C] to-[#0B1310]';

              const accentColor = isCredit
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
                  className={`bg-gradient-to-br ${cardGradient} border border-white/10 rounded-[22px] p-6 shadow-xl relative overflow-hidden flex flex-col justify-between space-y-5 transition hover:scale-[1.015] duration-300 cursor-pointer`}
                >
                  <div className="flex items-start justify-between">
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
                      <h4 className="text-lg font-bold text-white tracking-tight mt-0.5 truncate">
                        {b.name || b.category}
                      </h4>
                    </div>
                    <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-white shrink-0">
                      {isCredit ? (
                        <CreditCard className="w-5 h-5 text-[#FF9F0A]" />
                      ) : isLoan ? (
                        <Building2 className="w-5 h-5 text-[#AF52DE]" />
                      ) : (
                        <Wallet className="w-5 h-5 text-[#0071E3]" />
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] text-[#86868B] block">
                      {isCredit || isLoan
                        ? 'Current Balance Used'
                        : isStandard
                        ? 'Monthly Spent'
                        : 'Available Balance'}
                    </span>
                    <div className="text-2xl font-extrabold text-white tabular-nums tracking-tight">
                      {formatAmt(isCredit || isLoan ? used : isStandard ? standardSpent : Number(b.accountBalance) || 0)}
                    </div>
                    {(isCredit || isStandard) && limit > 0 && (
                      <div className="flex items-center justify-between text-[11px] text-[#86868B] tabular-nums pt-1">
                        <span>Limit: {formatAmt(limit)}</span>
                        <span className={utilization > 80 ? 'text-[#FF3B30] font-semibold' : 'text-zinc-300'}>
                          {utilization}% used
                        </span>
                      </div>
                    )}
                  </div>

                  {(isCredit || isStandard) && limit > 0 && (
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${utilization}%`,
                          backgroundColor: utilization > 80 ? '#FF3B30' : accentColor
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-[#1C1C1E] border border-white/10 rounded-[22px] p-10 text-center space-y-3">
            <Wallet className="w-8 h-8 text-[#86868B] mx-auto opacity-60" />
            <h4 className="text-sm font-semibold text-white">No Accounts or Budgets Yet</h4>
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

      {/* 3. APPLE STORE HORIZONTAL ACTION SHELF */}
      <section className="space-y-3">
        <span className="text-[12px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block">
          QUICK RECONCILIATION & TOOLS
        </span>
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none apple-shelf">
          <button
            type="button"
            onClick={() => onOpenUploadStatement && onOpenUploadStatement()}
            className="text-left apple-shelf-item shrink-0 w-72 bg-[#1C1C1E] border border-white/10 rounded-2xl p-5 shadow-lg space-y-2 hover:scale-[1.015] transition duration-300"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#0071E3] flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> STATEMENT RECONCILIATION
            </span>
            <h5 className="text-sm font-bold text-white">Upload PDF / CSV Statement</h5>
            <p className="text-xs text-[#86868B] leading-relaxed">
              Fuzzy-match pending flotante alerts with your monthly bank statement to settle exact amounts.
            </p>
          </button>

          <button
            type="button"
            onClick={() => onOpenEmailSync && onOpenEmailSync()}
            className="text-left apple-shelf-item shrink-0 w-72 bg-[#1C1C1E] border border-white/10 rounded-2xl p-5 shadow-lg space-y-2 hover:scale-[1.015] transition duration-300"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#34C759] flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> LIVE EMAIL SYNC
            </span>
            <h5 className="text-sm font-bold text-white">Connect iCloud & Gmail</h5>
            <p className="text-xs text-[#86868B] leading-relaxed">
              Fetch transaction alerts directly from your real inbox into your pending ledger.
            </p>
          </button>

          <button
            type="button"
            onClick={() => onOpenAddTx('expense')}
            className="text-left apple-shelf-item shrink-0 w-72 bg-[#1C1C1E] border border-white/10 rounded-2xl p-5 shadow-lg space-y-2 hover:scale-[1.015] transition duration-300"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#FF9F0A] flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> QUICK ENTRY
            </span>
            <h5 className="text-sm font-bold text-white">Record Expense or Income</h5>
            <p className="text-xs text-[#86868B] leading-relaxed">
              Log transactions directly to your Firestore account and update linked card balances automatically.
            </p>
          </button>
        </div>
      </section>

      {/* 4. CHARTS & SPENDING BREAKDOWN */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#1C1C1E] border border-white/10 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-[#86868B] block">
                TIMELINE ANALYTICS
              </span>
              <h4 className="text-lg font-bold text-white tracking-tight">Financial Flow Dynamics</h4>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex p-1 bg-[#2C2C2E] rounded-full border border-white/5">
                {(['Cashflow', 'Expense', 'Income'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setChartMode(mode)}
                    className={`px-3 py-1 text-xs font-semibold rounded-full transition ${
                      chartMode === mode ? 'bg-[#0071E3] text-white shadow-sm' : 'text-[#86868B] hover:text-white'
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
                      <stop offset="5%" stopColor="#0071E3" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0071E3" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="appleGreenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34C759" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#34C759" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="appleRedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF3B30" stopOpacity={0.4} />
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
        <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-6 shadow-xl space-y-4 flex flex-col justify-between">
          <div>
            <span className="text-[11px] uppercase tracking-wider font-semibold text-[#86868B] block">
              SPENDING BREAKDOWN
            </span>
            <h4 className="text-lg font-bold text-white tracking-tight">Top Spending Categories</h4>
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
                  <span className="text-xs font-bold text-white max-w-[90px] truncate text-center">
                    {categoryData[0]?.name || 'None'}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-xs text-[#86868B] text-center">No expenses recorded for this period.</div>
            )}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-white/10">
            {categoryData.slice(0, 4).map((cat, idx) => (
              <div key={cat.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-zinc-300">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: APPLE_PALETTE[idx % APPLE_PALETTE.length] }}
                  />
                  <span className="truncate max-w-[130px]">{cat.name}</span>
                </span>
                <span className="font-semibold text-white tabular-nums">
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
            <h3 className="text-xl font-bold tracking-tight text-white">Activity Feed</h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search merchant, category..."
              value={feedSearch}
              onChange={e => setFeedSearch(e.target.value)}
              className="bg-[#2C2C2E] border border-white/10 rounded-full px-3.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#0071E3] w-48"
            />

            <div className="flex p-0.5 bg-[#2C2C2E] rounded-full border border-white/5">
              <button
                type="button"
                onClick={() => setFeedStatusFilter('all')}
                className={`py-1 px-3 rounded-full text-xs font-semibold transition ${
                  feedStatusFilter === 'all' ? 'bg-[#0071E3] text-white shadow-sm' : 'text-[#86868B] hover:text-white'
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
                    : 'text-[#86868B] hover:text-white'
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
                    : 'text-[#86868B] hover:text-white'
                }`}
              >
                Cleared
              </button>
            </div>
          </div>
        </div>

        {/* Grouped Inset Container */}
        <div className="bg-[#1C1C1E] border border-white/10 rounded-[20px] overflow-hidden shadow-2xl">
          {filteredFeed.length > 0 ? (
            <div className="divide-y divide-white/[0.06]">
              {filteredFeed.slice(0, 30).map(t => {
                const isPending = t.status === 'pending';
                const isIncome = t.type === 'income';
                const matchedBudget = budgets.find(b => b.id === t.budgetId);

                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTxForDetail(t)}
                    className="p-4 hover:bg-white/[0.03] transition flex items-center justify-between gap-4 cursor-pointer active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-[12px] bg-[#2C2C2E] border border-white/5 flex items-center justify-center shrink-0">
                        {isIncome ? (
                          <ArrowUpRight className="w-5 h-5 text-[#34C759]" />
                        ) : t.isTransfer ? (
                          <ArrowRightLeft className="w-5 h-5 text-[#0071E3]" />
                        ) : (
                          <ArrowDownRight className="w-5 h-5 text-[#FF3B30]" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h5 className="text-sm font-semibold text-white truncate">{t.title}</h5>
                          {isPending && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30">
                              Flotante
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#86868B] flex items-center gap-2 mt-0.5">
                          <span className="tabular-nums">{t.date}</span>
                          <span>•</span>
                          <span>{t.category}</span>
                          {matchedBudget && (
                            <>
                              <span>•</span>
                              <span className="text-zinc-300 truncate max-w-[140px]">
                                {matchedBudget.name || matchedBudget.category}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div
                          className={`text-base font-bold tabular-nums tracking-tight ${
                            isIncome ? 'text-[#34C759]' : t.isTransfer ? 'text-[#5AC8FA]' : 'text-white'
                          }`}
                        >
                          {t.isTransfer ? '' : isIncome ? '+' : '-'} {formatAmt(t.amount)}
                        </div>
                        <div className="text-[10px] text-[#86868B] tabular-nums">
                          {isPending ? 'Pending alert' : 'Cleared'}
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
              <h5 className="text-sm font-semibold text-white">No transactions found</h5>
              <p className="text-xs text-[#86868B]">
                Add a transaction, sync your email alerts, or select another month filter to view activity.
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
      />
    </div>
  );
}
