import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft } from 'lucide-react';
import { Budget } from './BudgetsPage';
import {
  parseDayOfMonth,
  getCreditCardCycleForMonth,
  getTransactionCreditCardCycleKey,
  getRecentCreditCardCycles
} from '../utils/financeMath';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType: 'income' | 'expense';
  budgets: Budget[];
  availableCategories: string[];
  currencySymbol: string;
  prefillDate?: string;
  prefillBudgetId?: string;
  prefillIsLoanPayment?: boolean;
  prefillTitle?: string;
  prefillCategory?: string;
  onSave: (tx: {
    title: string;
    amount: number;
    type: 'income' | 'expense';
    category: string;
    date: string;
    notes?: string;
    budgetId?: string;
    isLoanPayment?: boolean;
    statementCycle?: string;
  }) => Promise<void>;
  onSaveTransfer?: (data: {
    fromBudgetId: string;
    toBudgetId: string;
    amount: number;
    date: string;
    title?: string;
    notes?: string;
  }) => Promise<void>;
}

function getAccountTypeLabel(accountType?: Budget['accountType']): string {
  if (accountType === 'credit_card') return '(Credit Card)';
  if (accountType === 'loan') return '(Loan)';
  if (accountType === 'bank_account') return '(Bank Account)';
  if (accountType === 'debit_account') return '(Debit Account)';
  return '(Budget)';
}

export default function AddTransactionModal({
  isOpen,
  onClose,
  defaultType,
  budgets,
  availableCategories,
  currencySymbol,
  prefillDate,
  prefillBudgetId,
  prefillIsLoanPayment,
  prefillTitle,
  prefillCategory,
  onSave,
  onSaveTransfer
}: AddTransactionModalProps) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'income' | 'expense' | 'transfer'>(defaultType);
  const [category, setCategory] = useState(availableCategories[0] || 'Groceries');
  const [date, setDate] = useState(prefillDate || new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [budgetId, setBudgetId] = useState(prefillBudgetId || '');
  const [transferToBudgetId, setTransferToBudgetId] = useState('');
  const [isLoanPayment, setIsLoanPayment] = useState(Boolean(prefillIsLoanPayment));
  const [statementCycle, setStatementCycle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setType(defaultType);
      setDate(prefillDate || new Date().toISOString().split('T')[0]);
      setBudgetId(prefillBudgetId || '');
      const fallbackDest = budgets.find(b => b.id !== (prefillBudgetId || ''))?.id || '';
      setTransferToBudgetId(fallbackDest);
      setIsLoanPayment(Boolean(prefillIsLoanPayment));
      setStatementCycle('');
      setTitle(prefillTitle || '');
      setAmount('');
      setNotes('');
      setCategory(prefillCategory || availableCategories[0] || 'Groceries');
    }
  }, [isOpen, defaultType, prefillDate, prefillBudgetId, prefillIsLoanPayment, prefillTitle, prefillCategory, availableCategories, budgets]);

  if (!isOpen) return null;

  const handleSelectTransferTab = () => {
    setType('transfer');
    const defaultFrom =
      budgetId ||
      budgets.find(b => b.accountType === 'bank_account' || b.accountType === 'debit_account')?.id ||
      budgets[0]?.id ||
      '';
    setBudgetId(defaultFrom);
    if (!transferToBudgetId || transferToBudgetId === defaultFrom) {
      setTransferToBudgetId(budgets.find(b => b.id !== defaultFrom)?.id || '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = Math.abs(parseFloat(amount));
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    if (type === 'transfer') {
      if (!onSaveTransfer || !budgetId || !transferToBudgetId || budgetId === transferToBudgetId) return;
      setIsSubmitting(true);
      try {
        await onSaveTransfer({
          fromBudgetId: budgetId,
          toBudgetId: transferToBudgetId,
          amount: parsedAmount,
          date: date || new Date().toISOString().split('T')[0],
          title: title.trim() || undefined,
          notes: notes.trim() || undefined
        });
        onClose();
      } catch (err) {
        console.error('Failed to create transfer:', err);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      await onSave({
        title: title.trim(),
        amount: parsedAmount,
        type,
        category,
        date: date || new Date().toISOString().split('T')[0],
        notes: notes.trim() || undefined,
        budgetId: budgetId || undefined,
        isLoanPayment: isLoanPayment || undefined,
        statementCycle: selectedBudget?.accountType === 'credit_card' && statementCycle ? statementCycle : undefined
      });
      onClose();
    } catch (err) {
      console.error('Failed to create transaction:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedBudget = budgets.find(b => b.id === budgetId);
  const transferDestBudget = budgets.find(b => b.id === transferToBudgetId);
  const fromIsLiquid = selectedBudget?.accountType === 'bank_account' || selectedBudget?.accountType === 'debit_account';
  const toIsLiquid = transferDestBudget?.accountType === 'bank_account' || transferDestBudget?.accountType === 'debit_account';
  const toIsDebt = transferDestBudget?.accountType === 'credit_card' || transferDestBudget?.accountType === 'loan';
  const parsedAmt = Math.abs(parseFloat(amount) || 0);

  const canBeLoanPayment = type !== 'transfer' && selectedBudget && (selectedBudget.accountType === 'credit_card' || selectedBudget.accountType === 'loan');
  const selectedCardCutoffDay = type !== 'transfer' && selectedBudget?.accountType === 'credit_card' ? parseDayOfMonth(selectedBudget.cutoffDate) : null;
  const selectedCardDueDay = type !== 'transfer' && selectedBudget?.accountType === 'credit_card' ? parseDayOfMonth(selectedBudget.dueDate) : null;
  const autoCycleKey = selectedCardCutoffDay ? getTransactionCreditCardCycleKey(date, selectedCardCutoffDay) : null;
  const autoCycleInfo =
    selectedCardCutoffDay && autoCycleKey
      ? getCreditCardCycleForMonth(selectedCardCutoffDay, selectedCardDueDay, autoCycleKey)
      : null;
  const recentCycles = selectedCardCutoffDay
    ? getRecentCreditCardCycles(selectedCardCutoffDay, selectedCardDueDay, autoCycleKey || undefined, 6, 2)
    : [];

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#1D1D1F] dark:text-[#F5F5F7]">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white capitalize">
            {type === 'transfer' ? 'Attach Bank Transfer' : isLoanPayment ? 'Record Payment / Abono' : `New ${type}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Type selector toggle */}
        <div className="flex p-1 bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-full border border-black/[0.04] dark:border-white/5">
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-full transition ${
              type === 'expense'
                ? 'bg-[#FF3B30] text-white shadow-sm'
                : 'text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
            }`}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => setType('income')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-full transition ${
              type === 'income'
                ? 'bg-[#34C759] text-white dark:text-black shadow-sm'
                : 'text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
            }`}
          >
            Income
          </button>
          {onSaveTransfer && budgets.length >= 2 && (
            <button
              type="button"
              onClick={handleSelectTransferTab}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-full transition flex items-center justify-center gap-1 ${
                type === 'transfer'
                  ? 'bg-[#0071E3] text-white shadow-sm'
                  : 'text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
              }`}
            >
              <ArrowRightLeft className="w-3 h-3" /> Transfer
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {type === 'transfer' ? (
            <>
              <div className="space-y-2.5 bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.04] dark:border-white/5 p-3 rounded-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#1D1D1F] dark:text-white">
                    From Bank → To Bank / Card / Loan
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const prev = budgetId;
                      setBudgetId(transferToBudgetId);
                      setTransferToBudgetId(prev);
                    }}
                    className="text-[11px] font-semibold text-[#0071E3] dark:text-[#5AC8FA] hover:underline flex items-center gap-1"
                  >
                    <ArrowRightLeft className="w-3 h-3" /> Swap
                  </button>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-[#86868B] block mb-1">From Account (Source) *</label>
                  <select
                    required
                    value={budgetId}
                    onChange={e => {
                      const nextFrom = e.target.value;
                      setBudgetId(nextFrom);
                      if (nextFrom === transferToBudgetId) {
                        setTransferToBudgetId(budgets.find(b => b.id !== nextFrom)?.id || '');
                      }
                    }}
                    className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                  >
                    {budgets.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-[#86868B] block mb-1">To Account (Destination) *</label>
                  <select
                    required
                    value={transferToBudgetId}
                    onChange={e => setTransferToBudgetId(e.target.value)}
                    className="w-full bg-white dark:bg-[#1C1C1E] border border-[#0071E3]/40 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                  >
                    <option value="">-- Select Destination Account --</option>
                    {budgets
                      .filter(b => b.id !== budgetId)
                      .map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-[#86868B] block mb-1">Amount ({currencySymbol}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] tabular-nums focus:outline-none focus:border-[#0071E3]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[#86868B] block mb-1">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#86868B] block mb-1">Title (Optional)</label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="e.g. Transfer Popular → Banreservas"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3]"
                />
              </div>

              {selectedBudget && transferDestBudget && parsedAmt > 0 && (
                <div className="bg-[#0071E3]/10 border border-[#0071E3]/25 rounded-2xl p-3 text-[11px] space-y-1 text-[#0071E3] dark:text-blue-200 tabular-nums">
                  {fromIsLiquid && (
                    <div>• {selectedBudget.name}: balance decreases by {currencySymbol}{parsedAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                  )}
                  {toIsLiquid && (
                    <div>• {transferDestBudget.name}: balance increases by {currencySymbol}{parsedAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                  )}
                  {toIsDebt && (
                    <div>• {transferDestBudget.name}: debt/used balance reduced by {currencySymbol}{parsedAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                  )}
                  {toIsDebt ? (
                    <div className="text-[10px] text-[#248A3D] dark:text-[#34C759] pt-0.5 font-medium">
                      • Counted as an Expense (Debt / Card Payment) in your monthly cashflow.
                    </div>
                  ) : (
                    <div className="text-[10px] text-[#0071E3]/80 dark:text-blue-300/80 pt-0.5">
                      • Internal transfer between liquid bank accounts (excluded from expense totals).
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="text-[11px] font-medium text-[#86868B] block mb-1">Title *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  placeholder={type === 'expense' ? "e.g. Supermercado Bravo, Internet" : "e.g. Salary, Consulting"}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-[#86868B] block mb-1">Amount ({currencySymbol}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] tabular-nums focus:outline-none focus:border-[#0071E3]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[#86868B] block mb-1">Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                  >
                    {availableCategories.map(c => (
                      <option key={c} value={c} className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {budgets.length > 0 && (
                <div className="space-y-2 bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.04] dark:border-white/5 p-3 rounded-2xl">
                  <label className="text-[11px] font-medium text-[#86868B] block">
                    Link to Bank / Debit / Credit Card / Loan / Budget Account (Optional)
                  </label>
                  <select
                    value={budgetId}
                    onChange={e => {
                      const nextId = e.target.value;
                      setBudgetId(nextId);
                      const matched = budgets.find(b => b.id === nextId);
                      if (!matched || (matched.accountType !== 'credit_card' && matched.accountType !== 'loan')) {
                        setIsLoanPayment(false);
                      }
                    }}
                    className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                  >
                    <option value="" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">None (Match by Category only)</option>
                    {budgets.map(b => (
                      <option key={b.id} value={b.id} className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">
                        {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                      </option>
                    ))}
                  </select>

                  {canBeLoanPayment && (
                    <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isLoanPayment}
                        onChange={e => setIsLoanPayment(e.target.checked)}
                        className="accent-[#34C759] w-3.5 h-3.5"
                      />
                      <span className="text-[11px] text-[#248A3D] dark:text-emerald-400 font-medium">
                        Payment / Abono to {selectedBudget.name || selectedBudget.category} (Reduces balance used)
                      </span>
                    </label>
                  )}

                  {selectedBudget?.accountType === 'credit_card' && selectedCardCutoffDay && autoCycleInfo && (
                    <div className="pt-2 border-t border-black/[0.06] dark:border-white/10 space-y-1">
                      <label className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider block">
                        Statement Cycle / Ciclo (Corte día {selectedCardCutoffDay})
                      </label>
                      <select
                        value={statementCycle}
                        onChange={e => setStatementCycle(e.target.value)}
                        className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-[11px] text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                      >
                        <option value="">
                          Auto por fecha: {autoCycleInfo.label} ({autoCycleInfo.periodLabel})
                        </option>
                        {recentCycles.map(c => (
                          <option key={c.cycleKey} value={c.cycleKey}>
                            Ciclo {c.label} ({c.periodLabel})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-[11px] font-medium text-[#86868B] block mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                />
              </div>
            </>
          )}

          <div>
            <label className="text-[11px] font-medium text-[#86868B] block mb-1">Notes (Optional)</label>
            <input
              type="text"
              maxLength={500}
              placeholder="Optional reference or details..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:hover:bg-white/15 text-[#1D1D1F] dark:text-white py-2.5 rounded-full text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (type === 'transfer' && (!budgetId || !transferToBudgetId || budgetId === transferToBudgetId || parsedAmt <= 0))}
              className="flex-1 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white py-2.5 rounded-full text-xs font-semibold transition"
            >
              {isSubmitting ? 'Saving...' : type === 'transfer' ? 'Save Transfer' : 'Save Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
