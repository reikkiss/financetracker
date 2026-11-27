import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  Upload,
  CreditCard,
  Landmark,
  CheckCircle2,
  Building2,
  Wallet,
  ArrowRightLeft,
  Filter,
  BookmarkCheck,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Link2,
  CheckSquare,
  Square,
  X,
  Sparkles
} from 'lucide-react';
import { Budget } from './BudgetsPage';
import {
  parseDayOfMonth,
  getCreditCardCycleForMonth,
  getTransactionCreditCardCycleKey,
  shiftMonthKey,
  formatShortIsoDate,
  getCleanTransactionDisplay,
  isDebtPaymentTransfer,
  isPureInternalTransfer,
  isRealExpenseTransaction,
  getTransactionExpenseCategory,
  findSimilarTransferPairs,
  TransferMatchCandidate
} from '../utils/financeMath';

interface TransactionsPageProps {
  transactions: any[];
  allTransactionsCount?: number;
  budgets?: Budget[];
  currencySymbol?: string;
  selectedMonth?: string;
  onSelectMonth?: (month: string) => void;
  onOpenAddTx: (type: 'income' | 'expense') => void;
  onOpenUploadStatement: () => void;
  onOpenTransfer?: () => void;
  onOpenEditTx: (transaction: any) => void;
  onDeleteTx: (id: string) => void;
  onOpenLinkTransfer?: (primaryTx: any, partnerTx?: any) => void;
  onOpenAutoLinkTransfers?: () => void;
}

function AccountTypeIcon({ accountType }: { accountType?: Budget['accountType'] }) {
  if (accountType === 'credit_card') return <CreditCard className="w-3 h-3 text-[#FF9F0A]" />;
  if (accountType === 'loan') return <Landmark className="w-3 h-3 text-[#AF52DE]" />;
  if (accountType === 'bank_account') return <Building2 className="w-3 h-3 text-[#0071E3] dark:text-[#5AC8FA]" />;
  if (accountType === 'debit_account') return <Wallet className="w-3 h-3 text-[#248A3D] dark:text-[#34C759]" />;
  return null;
}

export default function TransactionsPage({
  transactions,
  budgets = [],
  currencySymbol = '$',
  selectedMonth,
  onSelectMonth,
  onOpenAddTx,
  onOpenUploadStatement,
  onOpenTransfer,
  onOpenEditTx,
  onDeleteTx,
  onOpenLinkTransfer,
  onOpenAutoLinkTransfers
}: TransactionsPageProps) {
  const currentActualMonth = new Date().toISOString().slice(0, 7);
  const [filterMonth, setFilterMonth] = useState<string>(() => selectedMonth || localStorage.getItem('saved_tx_filter_month') || currentActualMonth);
  const [filterBudgetId, setFilterBudgetId] = useState<string>(() => localStorage.getItem('saved_tx_filter_budget') || 'All');
  const [useCycleFilter, setUseCycleFilter] = useState<boolean>(true);
  const [filterCategory, setFilterCategory] = useState<string>(() => localStorage.getItem('saved_tx_filter_cat') || 'All');
  const [filterType, setFilterType] = useState<string>(() => localStorage.getItem('saved_tx_filter_type') || 'All');
  const [filterStatus, setFilterStatus] = useState<string>(() => localStorage.getItem('saved_tx_filter_status') || 'All');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedIdsForLink, setSelectedIdsForLink] = useState<string[]>([]);

  useEffect(() => {
    if (selectedMonth && selectedMonth !== filterMonth) {
      setFilterMonth(selectedMonth);
    }
  }, [selectedMonth]);

  useEffect(() => {
    setSelectedIdsForLink(prev => prev.filter(id => transactions.some(t => t.id === id)));
  }, [transactions]);

  const handleMonthChange = (nextMonth: string) => {
    setFilterMonth(nextMonth);
    if (onSelectMonth) {
      onSelectMonth(nextMonth);
    }
  };

  const budgetById = useMemo(() => {
    const map: Record<string, Budget> = {};
    budgets.forEach(b => {
      map[b.id] = b;
    });
    return map;
  }, [budgets]);

  const selectedFilterBudget = useMemo(
    () => (filterBudgetId !== 'All' ? budgetById[filterBudgetId] : undefined),
    [filterBudgetId, budgetById]
  );

  const selectedCardCutoffDay = useMemo(
    () => (selectedFilterBudget?.accountType === 'credit_card' ? parseDayOfMonth(selectedFilterBudget.cutoffDate) : null),
    [selectedFilterBudget]
  );

  const selectedCardDueDay = useMemo(
    () => (selectedFilterBudget?.accountType === 'credit_card' ? parseDayOfMonth(selectedFilterBudget.dueDate) : null),
    [selectedFilterBudget]
  );

  const activeCycleInfo = useMemo(() => {
    if (!selectedCardCutoffDay || !useCycleFilter || filterMonth === 'All') return null;
    return getCreditCardCycleForMonth(selectedCardCutoffDay, selectedCardDueDay, filterMonth);
  }, [selectedCardCutoffDay, selectedCardDueDay, useCycleFilter, filterMonth]);

  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => { if (t.category) set.add(t.category); });
    return Array.from(set).sort();
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (filterBudgetId !== 'All') {
        if (t.budgetId !== filterBudgetId && t.transferToBudgetId !== filterBudgetId) return false;
      }
      if (filterMonth !== 'All') {
        if (selectedCardCutoffDay && useCycleFilter) {
          const txCycle = getTransactionCreditCardCycleKey(t.date || '', selectedCardCutoffDay, t.statementCycle);
          if (txCycle !== filterMonth) return false;
        } else if (t.date && !t.date.startsWith(filterMonth)) {
          return false;
        }
      }
      if (filterCategory !== 'All' && t.category !== filterCategory) return false;
      if (filterType !== 'All') {
        if (filterType === 'transfer') {
          if (!t.isTransfer) return false;
        } else if (filterType === 'expense') {
          if (!isRealExpenseTransaction(t, budgets || [])) return false;
        } else if (filterType === 'income') {
          if (t.type !== 'income' || t.isTransfer) return false;
        }
      }
      if (filterStatus !== 'All') {
        const st = t.status || 'cleared';
        if (filterStatus === 'pending' && st !== 'pending') return false;
        if (filterStatus === 'cleared' && st !== 'cleared') return false;
      }
      return true;
    });
  }, [transactions, filterBudgetId, filterMonth, selectedCardCutoffDay, useCycleFilter, filterCategory, filterType, filterStatus]);

  const handleSaveFilters = () => {
    localStorage.setItem('saved_tx_filter_month', filterMonth);
    localStorage.setItem('saved_tx_filter_budget', filterBudgetId);
    localStorage.setItem('saved_tx_filter_cat', filterCategory);
    localStorage.setItem('saved_tx_filter_type', filterType);
    localStorage.setItem('saved_tx_filter_status', filterStatus);
    if (onSelectMonth) {
      onSelectMonth(filterMonth);
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleResetFilters = () => {
    handleMonthChange(currentActualMonth);
    setFilterBudgetId('All');
    setUseCycleFilter(true);
    setFilterCategory('All');
    setFilterType('All');
    setFilterStatus('All');
    localStorage.removeItem('saved_tx_filter_month');
    localStorage.removeItem('saved_tx_filter_budget');
    localStorage.removeItem('saved_tx_filter_cat');
    localStorage.removeItem('saved_tx_filter_type');
    localStorage.removeItem('saved_tx_filter_status');
  };

  const canLinkTransfers = Boolean(onOpenLinkTransfer && budgets.length >= 2);

  const toggleSelectForLink = (txId: string) => {
    setSelectedIdsForLink(prev => {
      if (prev.includes(txId)) return prev.filter(id => id !== txId);
      if (prev.length >= 2) return [prev[1], txId];
      return [...prev, txId];
    });
  };

  const selectedTxsForLink = useMemo(
    () => selectedIdsForLink.map(id => transactions.find(t => t.id === id)).filter(Boolean),
    [selectedIdsForLink, transactions]
  );

  const hasAlreadyTransferInSelection = selectedTxsForLink.some(t => Boolean(t?.isTransfer));

  const detectedTransferPairs = useMemo(
    () => findSimilarTransferPairs(transactions, budgets),
    [transactions, budgets]
  );

  const pairByTxId = useMemo(() => {
    const map = new Map<string, { pair: TransferMatchCandidate; counterpart: any }>();
    detectedTransferPairs.forEach(pair => {
      map.set(pair.primaryTx.id, { pair, counterpart: pair.partnerTx });
      map.set(pair.partnerTx.id, { pair, counterpart: pair.primaryTx });
    });
    return map;
  }, [detectedTransferPairs]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[12px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block">
            LEDGER & RECONCILIATION
          </span>
          <h2 className="text-2xl font-bold tracking-[-0.03em] text-[#1D1D1F] dark:text-white">Transactions Database</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenAutoLinkTransfers && budgets.length >= 2 && (
            <button
              type="button"
              onClick={onOpenAutoLinkTransfers}
              className={`px-3.5 py-2 rounded-full text-xs font-semibold transition flex items-center gap-1.5 border ${
                detectedTransferPairs.length > 0
                  ? 'bg-[#34C759]/12 hover:bg-[#34C759]/20 text-[#248A3D] dark:text-[#34C759] border-[#34C759]/30 shadow-sm'
                  : 'bg-white hover:bg-[#F2F2F7] dark:bg-[#2C2C2E] dark:hover:bg-white/15 text-[#1D1D1F] dark:text-zinc-200 border-black/[0.06] dark:border-white/10'
              }`}
              title="Automatically find similar transfer pairs across accounts and attach them"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Auto-Match Transfers
              {detectedTransferPairs.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#34C759] text-white text-[10px] font-bold leading-none tabular-nums">
                  {detectedTransferPairs.length}
                </span>
              )}
            </button>
          )}
          {onOpenTransfer && budgets.length >= 2 && (
            <button
              onClick={onOpenTransfer}
              className="bg-[#0071E3]/10 hover:bg-[#0071E3]/20 text-[#0071E3] dark:text-[#5AC8FA] border border-[#0071E3]/25 px-3.5 py-2 rounded-full text-xs font-semibold transition flex items-center gap-1.5"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
            </button>
          )}
          <button
            onClick={onOpenUploadStatement}
            className="bg-white hover:bg-[#F2F2F7] dark:bg-[#2C2C2E] dark:hover:bg-white/15 text-[#248A3D] dark:text-[#34C759] border border-black/[0.06] dark:border-white/10 shadow-sm px-3.5 py-2 rounded-full text-xs font-semibold transition flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" /> Upload Statement
          </button>
          <button
            onClick={() => onOpenAddTx('expense')}
            className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-4 py-2 rounded-full text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add Transaction
          </button>
        </div>
      </div>

      {/* Detected Similar Transfers Banner */}
      {onOpenAutoLinkTransfers && detectedTransferPairs.length > 0 && (
        <div className="bg-[#34C759]/10 border border-[#34C759]/30 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs">
            <Sparkles className="w-4 h-4 text-[#248A3D] dark:text-[#34C759] shrink-0" />
            <div>
              <span className="font-semibold text-[#1D1D1F] dark:text-white">
                {detectedTransferPairs.length} similar {detectedTransferPairs.length === 1 ? 'transfer pair' : 'transfer pairs'} detected across accounts
              </span>
              <span className="text-[#6E6E73] dark:text-zinc-300 text-[11px] block">
                Review matching outflows/inflows or duplicate mirror entries and attach them in one click.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenAutoLinkTransfers}
            className="bg-[#248A3D] hover:bg-[#1e7634] dark:bg-[#34C759] dark:hover:bg-[#30b953] text-white dark:text-black px-4 py-1.5 rounded-full text-xs font-semibold transition flex items-center gap-1.5 shadow-sm shrink-0"
          >
            <Link2 className="w-3.5 h-3.5" /> Review & Attach All ({detectedTransferPairs.length})
          </button>
        </div>
      )}

      {/* Filter Toolbar & Saved Filters */}
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 p-5 rounded-[22px] space-y-3 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#1D1D1F] dark:text-white flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-[#0071E3]" /> Saved Ledger Filters
          </span>
          <div className="flex items-center gap-2">
            {saveSuccess && <span className="text-[11px] text-[#248A3D] dark:text-[#34C759] font-semibold">Filters Saved</span>}
            <button
              type="button"
              onClick={handleSaveFilters}
              className="bg-[#34C759]/12 hover:bg-[#34C759]/20 text-[#248A3D] dark:text-[#34C759] border border-[#34C759]/30 px-3 py-1 rounded-full text-[11px] font-semibold transition flex items-center gap-1"
            >
              <BookmarkCheck className="w-3.5 h-3.5" /> Save Filters
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:hover:bg-white/15 text-[#1D1D1F] dark:text-zinc-300 px-3 py-1 rounded-full text-[11px] font-semibold transition flex items-center gap-1"
              title="Reset to current month and clear filters"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div>
            <label className="text-[10px] text-[#86868B] uppercase tracking-wider font-semibold block mb-1">
              {selectedCardCutoffDay && useCycleFilter && filterMonth !== 'All' ? 'Billing Cycle' : 'Month'}
            </label>
            <input
              type="month"
              value={filterMonth === 'All' ? currentActualMonth : filterMonth}
              onChange={e => handleMonthChange(e.target.value || 'All')}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-xl px-3 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
            />
            <button
              type="button"
              onClick={() => handleMonthChange(filterMonth === 'All' ? currentActualMonth : 'All')}
              className="text-[10px] text-[#0071E3] hover:underline mt-1 block font-medium"
            >
              {filterMonth === 'All' ? 'Switch to Current Month' : 'View All Months'}
            </button>
          </div>

          <div>
            <label className="text-[10px] text-[#86868B] uppercase tracking-wider font-semibold block mb-1">Account / Card</label>
            <select
              value={filterBudgetId}
              onChange={e => setFilterBudgetId(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-xl px-3 py-1.5 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            >
              <option value="All" className="bg-white dark:bg-[#1C1C1E]">All Accounts & Cards</option>
              {budgets.map(b => (
                <option key={b.id} value={b.id} className="bg-white dark:bg-[#1C1C1E]">
                  {b.name || b.category}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-[#86868B] uppercase tracking-wider font-semibold block mb-1">Category</label>
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-xl px-3 py-1.5 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            >
              <option value="All" className="bg-white dark:bg-[#1C1C1E]">All Categories</option>
              {categoriesList.map(c => (
                <option key={c} value={c} className="bg-white dark:bg-[#1C1C1E]">{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-[#86868B] uppercase tracking-wider font-semibold block mb-1">Type</label>
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-xl px-3 py-1.5 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            >
              <option value="All" className="bg-white dark:bg-[#1C1C1E]">All Types</option>
              <option value="expense" className="bg-white dark:bg-[#1C1C1E]">Expense</option>
              <option value="income" className="bg-white dark:bg-[#1C1C1E]">Income</option>
              <option value="transfer" className="bg-white dark:bg-[#1C1C1E]">Transfer</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-[#86868B] uppercase tracking-wider font-semibold block mb-1">Reconciliation</label>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-xl px-3 py-1.5 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            >
              <option value="All" className="bg-white dark:bg-[#1C1C1E]">All Statuses</option>
              <option value="pending" className="bg-white dark:bg-[#1C1C1E]">Pending (Flotante)</option>
              <option value="cleared" className="bg-white dark:bg-[#1C1C1E]">Cleared</option>
            </select>
          </div>
        </div>

        {selectedCardCutoffDay && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-black/[0.05] dark:border-white/10 text-[11px]">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setUseCycleFilter(v => !v)}
                className={`px-2.5 py-1 rounded-full font-semibold transition border ${
                  useCycleFilter
                    ? 'bg-[#0071E3]/12 text-[#0071E3] dark:text-[#5AC8FA] border-[#0071E3]/30'
                    : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#86868B] border-transparent'
                }`}
              >
                {useCycleFilter ? 'Filtrando por Ciclo de Corte' : 'Mes Calendario (Click para Ciclo)'}
              </button>
              {activeCycleInfo && (
                <span className="text-[#1D1D1F] dark:text-zinc-200 font-medium tabular-nums">
                  Ciclo <strong className="text-[#0071E3] dark:text-[#5AC8FA]">{activeCycleInfo.label}</strong>: {activeCycleInfo.periodLabel}
                  {' • '}Corte {formatShortIsoDate(activeCycleInfo.cutoffDate)}
                  {activeCycleInfo.dueDate ? ` • Pago ${formatShortIsoDate(activeCycleInfo.dueDate)}` : ''}
                </span>
              )}
            </div>
            {useCycleFilter && filterMonth !== 'All' && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleMonthChange(shiftMonthKey(filterMonth, -1))}
                  className="p-1 rounded-full bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-white hover:bg-[#E5E5EA] dark:hover:bg-white/15 transition"
                  title="Ciclo anterior"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMonthChange(shiftMonthKey(filterMonth, 1))}
                  className="p-1 rounded-full bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-white hover:bg-[#E5E5EA] dark:hover:bg-white/15 transition"
                  title="Siguiente ciclo"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Link Transfer Action Bar */}
      {canLinkTransfers && selectedTxsForLink.length > 0 && (
        <div className="bg-[#0071E3]/8 dark:bg-[#0071E3]/15 border border-[#0071E3]/25 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#0071E3] dark:text-[#5AC8FA]">
              <Link2 className="w-4 h-4" />
              {selectedTxsForLink.length === 1
                ? '1 transaction selected'
                : '2 transactions selected'}
            </span>
            <span className="text-[#6E6E73] dark:text-zinc-300 text-[11px] truncate max-w-md">
              {selectedTxsForLink.map(t => `${t.title} (${currencySymbol}${Number(t.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })})`).join('  ↔  ')}
            </span>
            {selectedTxsForLink.length === 2 && hasAlreadyTransferInSelection && (
              <span className="text-[11px] text-[#B25000] dark:text-[#FF9F0A] font-medium">
                (One entry is already a transfer — select 2 unlinked entries to merge, or edit individually)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedTxsForLink.length === 1 && onOpenLinkTransfer && (
              <button
                type="button"
                onClick={() => {
                  onOpenLinkTransfer(selectedTxsForLink[0]);
                  setSelectedIdsForLink([]);
                }}
                className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-3.5 py-1.5 rounded-full text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
              >
                <Link2 className="w-3.5 h-3.5" />
                {selectedTxsForLink[0].isTransfer ? 'Re-link Transfer' : 'Attach / Link Transfer'}
              </button>
            )}
            {selectedTxsForLink.length === 2 && !hasAlreadyTransferInSelection && onOpenLinkTransfer && (
              <button
                type="button"
                onClick={() => {
                  onOpenLinkTransfer(selectedTxsForLink[0], selectedTxsForLink[1]);
                  setSelectedIdsForLink([]);
                }}
                className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-3.5 py-1.5 rounded-full text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Link 2 Selected as Bank Transfer
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIdsForLink([])}
              className="bg-white dark:bg-[#2C2C2E] hover:bg-[#F2F2F7] dark:hover:bg-white/15 text-[#6E6E73] dark:text-zinc-300 border border-black/[0.06] dark:border-white/10 px-3 py-1.5 rounded-full text-xs font-semibold transition flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          </div>
        </div>
      )}

      {/* Grouped Inset Ledger */}
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 rounded-[22px] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border-b border-black/[0.06] dark:border-white/10 text-[#6E6E73] dark:text-[#86868B]">
            <tr>
              {canLinkTransfers && (
                <th className="p-4 w-10 text-center font-semibold" title="Select 1 or 2 entries to link as a bank transfer">
                  Pair
                </th>
              )}
              <th className="p-4 font-semibold">Merchant / Title</th>
              <th className="p-4 font-semibold">Category</th>
              <th className="p-4 font-semibold">Account</th>
              <th className="p-4 font-semibold">Type</th>
              <th className="p-4 font-semibold">Date</th>
              <th className="p-4 font-semibold text-right">Amount</th>
              <th className="p-4 font-semibold text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan={canLinkTransfers ? 8 : 7} className="py-12 text-center text-[#86868B]">
                  No transactions match the selected filters.
                </td>
              </tr>
            ) : (
              filteredTransactions.map(t => {
                const isSelectedForLink = selectedIdsForLink.includes(t.id);
                const linkedBudget = t.budgetId ? budgetById[t.budgetId] : undefined;
                const transferToBudget = t.transferToBudgetId ? budgetById[t.transferToBudgetId] : undefined;
                const isTransfer = Boolean(t.isTransfer);
                const cardBudget =
                  linkedBudget?.accountType === 'credit_card'
                    ? linkedBudget
                    : transferToBudget?.accountType === 'credit_card'
                    ? transferToBudget
                    : undefined;
                const cardCutoffDay = cardBudget ? parseDayOfMonth(cardBudget.cutoffDate) : null;
                const txCycleKey = cardBudget
                  ? getTransactionCreditCardCycleKey(t.date || '', cardCutoffDay, t.statementCycle)
                  : null;
                const { displayTitle, displayNotes } = getCleanTransactionDisplay(
                  t,
                  linkedBudget,
                  transferToBudget
                );
                const isDebtPay = isDebtPaymentTransfer(t, budgets || []);
                const isPureTransfer = isPureInternalTransfer(t, budgets || []);
                const displayCategory = isDebtPay
                  ? getTransactionExpenseCategory(t, budgets || [])
                  : t.category;

                return (
                  <tr key={t.id} className={`hover:bg-[#F5F5F7]/75 dark:hover:bg-white/[0.03] transition group ${isSelectedForLink ? 'bg-[#0071E3]/[0.04] dark:bg-[#0071E3]/[0.08]' : ''}`}>
                    {canLinkTransfers && (
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelectForLink(t.id)}
                          className="text-[#86868B] hover:text-[#0071E3] transition p-0.5 rounded"
                          title={isSelectedForLink ? 'Unselect' : 'Select to link/pair bank transfer'}
                        >
                          {isSelectedForLink ? (
                            <CheckSquare className="w-4 h-4 text-[#0071E3]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    )}
                    <td className="p-4 font-medium text-[#1D1D1F] dark:text-white">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{displayTitle}</span>
                        {isPureTransfer && (
                          <span className="inline-flex items-center gap-1 bg-[#0071E3]/10 text-[#0071E3] dark:text-[#5AC8FA] border border-[#0071E3]/25 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                            <ArrowRightLeft className="w-2.5 h-2.5" /> Transfer
                          </span>
                        )}
                        {(t.isLoanPayment || isDebtPay) && (
                          <span className="inline-flex items-center gap-1 bg-[#FF3B30]/10 text-[#D70015] dark:text-[#FF453A] border border-[#FF3B30]/20 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                            <CheckCircle2 className="w-2.5 h-2.5" /> {transferToBudget?.accountType === 'loan' || linkedBudget?.accountType === 'loan' ? 'Pago Préstamo' : 'Pago Tarjeta'}
                          </span>
                        )}
                        {txCycleKey && (
                          <span className="inline-flex items-center gap-1 bg-black/[0.04] dark:bg-white/10 text-[#6E6E73] dark:text-zinc-300 px-2 py-0.5 rounded-full text-[10px] font-medium tabular-nums">
                            Ciclo {txCycleKey}
                          </span>
                        )}
                        {t.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 bg-[#FF9F0A]/15 text-[#B25000] dark:text-[#FF9F0A] border border-[#FF9F0A]/30 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                            Flotante
                          </span>
                        )}
                        {(!t.status || t.status === 'cleared') && (
                          <span className="inline-flex items-center gap-1 bg-[#34C759]/12 text-[#248A3D] dark:text-[#34C759] border border-[#34C759]/25 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                            Cleared
                          </span>
                        )}
                        {t.emailOutcome === 'reversed' && (
                          <span className="inline-flex items-center gap-1 bg-[#AF52DE]/12 text-[#8944AB] dark:text-purple-300 border border-[#AF52DE]/30 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                            Reversed
                          </span>
                        )}
                        {t.emailOutcome === 'declined' && (
                          <span className="inline-flex items-center gap-1 bg-[#FF3B30]/12 text-[#D70015] dark:text-[#FF3B30] border border-[#FF3B30]/30 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                            Declined
                          </span>
                        )}
                        {onOpenLinkTransfer && pairByTxId.has(t.id) && (
                          <button
                            type="button"
                            onClick={() => {
                              const match = pairByTxId.get(t.id)!;
                              onOpenLinkTransfer(match.pair.primaryTx, match.pair.partnerTx);
                            }}
                            className="inline-flex items-center gap-1 bg-[#34C759]/12 hover:bg-[#34C759]/22 text-[#248A3D] dark:text-[#34C759] border border-[#34C759]/30 px-2 py-0.5 rounded-full text-[10px] font-semibold transition"
                            title={`Similar entry found: ${pairByTxId.get(t.id)!.counterpart.title}`}
                          >
                            <Link2 className="w-2.5 h-2.5" /> Similar Match
                          </button>
                        )}
                      </div>
                      {(t.emailContext || displayNotes) && (
                        <span className="text-[11px] text-[#6E6E73] dark:text-[#86868B] block mt-0.5 line-clamp-2 max-w-md leading-snug">
                          {t.emailContext || displayNotes}
                        </span>
                      )}
                      {(typeof t.loanPrincipalPaid === 'number' || typeof t.loanInterestPaid === 'number') && (
                        <span className="text-[10px] text-[#8944AB] dark:text-purple-300 block mt-0.5 tabular-nums">
                          Principal: {currencySymbol}{(Number(t.loanPrincipalPaid) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          {' • '}
                          Interest: {currencySymbol}{(Number(t.loanInterestPaid) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-zinc-200 px-2.5 py-0.5 rounded-full text-[11px] font-medium">
                        {displayCategory}
                      </span>
                    </td>
                    <td className="p-4">
                      {isTransfer && linkedBudget && transferToBudget ? (
                        <div className="inline-flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 bg-[#F2F2F7] dark:bg-[#2C2C2E] border border-black/[0.05] dark:border-white/10 text-[#1D1D1F] dark:text-zinc-200 px-2 py-0.5 rounded-full text-[11px]">
                            <AccountTypeIcon accountType={linkedBudget.accountType} />
                            {linkedBudget.name || linkedBudget.category}
                          </span>
                          <span className="text-[#0071E3] font-bold">→</span>
                          <span className="inline-flex items-center gap-1 bg-[#0071E3]/10 border border-[#0071E3]/25 text-[#0071E3] dark:text-blue-200 px-2 py-0.5 rounded-full text-[11px]">
                            <AccountTypeIcon accountType={transferToBudget.accountType} />
                            {transferToBudget.name || transferToBudget.category}
                          </span>
                        </div>
                      ) : linkedBudget ? (
                        <span className="inline-flex items-center gap-1 bg-[#F2F2F7] dark:bg-[#2C2C2E] border border-black/[0.05] dark:border-white/10 text-[#1D1D1F] dark:text-zinc-200 px-2 py-0.5 rounded-full text-[11px]">
                          <AccountTypeIcon accountType={linkedBudget.accountType} />
                          {linkedBudget.name || linkedBudget.category}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#86868B]">—</span>
                      )}
                    </td>
                    <td className="p-4 uppercase font-semibold text-[10px]">
                      {isDebtPay ? (
                        <span className="text-[#D70015] dark:text-[#FF3B30]">EXPENSE (DEBT)</span>
                      ) : isPureTransfer ? (
                        <span className="text-[#0071E3] dark:text-[#5AC8FA]">TRANSFER</span>
                      ) : (
                        <span className={t.type === 'income' ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#D70015] dark:text-[#FF3B30]'}>{t.type}</span>
                      )}
                    </td>
                    <td className="p-4 text-[#86868B] tabular-nums">{t.date}</td>
                    <td className={`p-4 text-right font-bold tabular-nums ${isPureTransfer ? 'text-[#0071E3] dark:text-[#5AC8FA]' : t.type === 'income' ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#1D1D1F] dark:text-white'}`}>
                      {isPureTransfer ? '' : t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {canLinkTransfers && onOpenLinkTransfer && (
                          <button
                            type="button"
                            onClick={() => onOpenLinkTransfer(t)}
                            className={`p-1.5 rounded-full hover:bg-black/[0.05] dark:hover:bg-white/10 transition ${
                              t.isTransfer
                                ? 'text-[#0071E3] dark:text-[#5AC8FA]'
                                : 'text-[#86868B] hover:text-[#0071E3]'
                            }`}
                            title={t.isTransfer ? 'Re-link / Edit transfer accounts' : 'Attach / Link bank transfer'}
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => onOpenEditTx(t)}
                          className="text-[#86868B] hover:text-[#0071E3] p-1.5 rounded-full hover:bg-black/[0.05] dark:hover:bg-white/10 transition"
                          title="Edit transaction"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteTx(t.id)}
                          className="text-[#86868B] hover:text-[#FF3B30] p-1.5 rounded-full hover:bg-black/[0.05] dark:hover:bg-white/10 transition"
                          title="Delete transaction"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
