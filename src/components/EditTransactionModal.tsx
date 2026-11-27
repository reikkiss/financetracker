import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft, Link2 } from 'lucide-react';
import { Budget } from './BudgetsPage';
import { Transaction } from '../App';
import {
  parseDayOfMonth,
  getCreditCardCycleForMonth,
  getTransactionCreditCardCycleKey,
  getRecentCreditCardCycles
} from '../utils/financeMath';

interface EditTransactionModalProps {
  tx: Transaction | null;
  onClose: () => void;
  budgets: Budget[];
  availableCategories: string[];
  currencySymbol: string;
  onSave: (txId: string, updated: Partial<Transaction>) => Promise<void>;
  onOpenLinkTransfer?: (tx: Transaction) => void;
}

function getAccountTypeLabel(accountType?: Budget['accountType']): string {
  if (accountType === 'credit_card') return '(Credit Card)';
  if (accountType === 'loan') return '(Loan)';
  if (accountType === 'bank_account') return '(Bank Account)';
  if (accountType === 'debit_account') return '(Debit Account)';
  return '(Budget)';
}

export default function EditTransactionModal({
  tx,
  onClose,
  budgets,
  availableCategories,
  currencySymbol,
  onSave,
  onOpenLinkTransfer
}: EditTransactionModalProps) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [category, setCategory] = useState('Groceries');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [budgetId, setBudgetId] = useState('');
  const [isLoanPayment, setIsLoanPayment] = useState(false);
  const [isTransfer, setIsTransfer] = useState(false);
  const [transferToBudgetId, setTransferToBudgetId] = useState('');
  const [status, setStatus] = useState<'pending' | 'cleared'>('cleared');
  const [statementCycle, setStatementCycle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (tx) {
      setTitle(tx.title || '');
      setAmount(String(tx.amount || ''));
      setType(tx.type || 'expense');
      setCategory(tx.category || availableCategories[0] || 'Groceries');
      setDate(tx.date || new Date().toISOString().split('T')[0]);
      setNotes(tx.notes || '');
      setBudgetId(tx.budgetId || '');
      setIsLoanPayment(Boolean(tx.isLoanPayment));
      setIsTransfer(Boolean(tx.isTransfer));
      setTransferToBudgetId(tx.transferToBudgetId || '');
      setStatus(tx.status || 'cleared');
      setStatementCycle(tx.statementCycle || '');
    }
  }, [tx, availableCategories]);

  if (!tx) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = Math.abs(parseFloat(amount));
    if (!title.trim() || isNaN(parsedAmount) || parsedAmount <= 0) return;

    setIsSubmitting(true);
    try {
      await onSave(tx.id, {
        title: title.trim(),
        amount: parsedAmount,
        type,
        category,
        date: date || new Date().toISOString().split('T')[0],
        notes: notes.trim() || undefined,
        budgetId: budgetId || undefined,
        isLoanPayment: isLoanPayment || undefined,
        isTransfer: isTransfer || undefined,
        transferToBudgetId: isTransfer ? transferToBudgetId || undefined : undefined,
        statementCycle: cardBudget ? statementCycle : '',
        status
      });
      onClose();
    } catch (err) {
      console.error('Failed to update transaction:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedBudget = budgets.find(b => b.id === budgetId);
  const transferTargetBudget = isTransfer ? budgets.find(b => b.id === transferToBudgetId) : undefined;
  const transferTargetIsDebt =
    transferTargetBudget?.accountType === 'credit_card' || transferTargetBudget?.accountType === 'loan';
  const cardBudget =
    selectedBudget?.accountType === 'credit_card'
      ? selectedBudget
      : transferTargetBudget?.accountType === 'credit_card'
      ? transferTargetBudget
      : undefined;
  const cardCutoffDay = cardBudget ? parseDayOfMonth(cardBudget.cutoffDate) : null;
  const cardDueDay = cardBudget ? parseDayOfMonth(cardBudget.dueDate) : null;
  const autoCycleKey = cardCutoffDay ? getTransactionCreditCardCycleKey(date, cardCutoffDay) : null;
  const autoCycleInfo =
    cardCutoffDay && autoCycleKey ? getCreditCardCycleForMonth(cardCutoffDay, cardDueDay, autoCycleKey) : null;
  const recentCycles = cardCutoffDay
    ? getRecentCreditCardCycles(cardCutoffDay, cardDueDay, statementCycle || autoCycleKey || undefined, 8, 2)
    : [];

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#1D1D1F] dark:text-[#F5F5F7]">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white">
              {isTransfer ? 'Edit Bank Transfer' : `Edit ${type === 'income' ? 'Income' : 'Expense'}`}
            </h3>
            {status === 'pending' && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FF9F0A]/15 text-[#B25000] dark:text-[#FF9F0A] border border-[#FF9F0A]/30">
                Flotante
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Type Switcher */}
          {!isTransfer && (
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
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-[#86868B] block mb-1">Title *</label>
            <input
              type="text"
              required
              maxLength={200}
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
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
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
            <div className="space-y-2.5 bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.04] dark:border-white/5 p-3 rounded-2xl">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-medium text-[#86868B] block">
                  {isTransfer ? 'From Account (Source)' : 'Link to Bank / Debit / Credit Card / Loan / Budget Account'}
                </label>
                {isTransfer && budgetId && transferToBudgetId && (
                  <button
                    type="button"
                    onClick={() => {
                      const prev = budgetId;
                      setBudgetId(transferToBudgetId);
                      setTransferToBudgetId(prev);
                      const nextDest = budgets.find(b => b.id === prev);
                      setIsLoanPayment(nextDest?.accountType === 'credit_card' || nextDest?.accountType === 'loan');
                    }}
                    className="text-[11px] font-semibold text-[#0071E3] dark:text-[#5AC8FA] hover:underline flex items-center gap-1 shrink-0"
                  >
                    <ArrowRightLeft className="w-3 h-3" /> Swap
                  </button>
                )}
              </div>
              <select
                value={budgetId}
                onChange={e => {
                  const nextId = e.target.value;
                  setBudgetId(nextId);
                  if (nextId === transferToBudgetId) {
                    setTransferToBudgetId('');
                  }
                  const matched = budgets.find(b => b.id === nextId);
                  if (!matched || (matched.accountType !== 'credit_card' && matched.accountType !== 'loan')) {
                    if (!isTransfer) setIsLoanPayment(false);
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

              {budgets.length >= 2 && (
                <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isTransfer}
                    onChange={e => {
                      const checked = e.target.checked;
                      setIsTransfer(checked);
                      if (!checked) {
                        setTransferToBudgetId('');
                      } else {
                        // Smart direction: if this was an Income deposited into budgetId, budgetId is destination!
                        if (type === 'income' && budgetId) {
                          const currentDest = budgetId;
                          const fallbackSource =
                            budgets.find(b => b.id !== currentDest && (b.accountType === 'bank_account' || b.accountType === 'debit_account'))?.id ||
                            budgets.find(b => b.id !== currentDest)?.id ||
                            '';
                          setBudgetId(fallbackSource);
                          setTransferToBudgetId(currentDest);
                          const dest = budgets.find(b => b.id === currentDest);
                          setIsLoanPayment(dest?.accountType === 'credit_card' || dest?.accountType === 'loan');
                        } else {
                          const currentSource =
                            budgetId ||
                            budgets.find(b => b.accountType === 'bank_account' || b.accountType === 'debit_account')?.id ||
                            budgets[0]?.id ||
                            '';
                          if (!budgetId && currentSource) setBudgetId(currentSource);
                          const fallbackDest = budgets.find(b => b.id !== currentSource)?.id || '';
                          setTransferToBudgetId(fallbackDest);
                          const dest = budgets.find(b => b.id === fallbackDest);
                          setIsLoanPayment(dest?.accountType === 'credit_card' || dest?.accountType === 'loan');
                        }
                      }
                    }}
                    className="accent-[#0071E3] w-3.5 h-3.5"
                  />
                  <span className="text-[11px] text-[#0071E3] dark:text-blue-300 font-medium">
                    Link as Transfer between accounts (From → To)
                  </span>
                </label>
              )}

              {isTransfer && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] font-medium text-[#86868B] block mb-1">To Account (Destination)</label>
                    <select
                      value={transferToBudgetId}
                      onChange={e => {
                        const nextDestId = e.target.value;
                        setTransferToBudgetId(nextDestId);
                        const dest = budgets.find(b => b.id === nextDestId);
                        setIsLoanPayment(dest?.accountType === 'credit_card' || dest?.accountType === 'loan');
                      }}
                      className="w-full bg-white dark:bg-[#1C1C1E] border border-[#0071E3]/40 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                    >
                      <option value="" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">-- Select Destination Account --</option>
                      {budgets
                        .filter(b => b.id !== budgetId)
                        .map(b => (
                          <option key={b.id} value={b.id} className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">
                            {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                          </option>
                        ))}
                    </select>
                  </div>

                  {transferToBudgetId && (
                    <p className={`text-[10px] leading-snug ${transferTargetIsDebt ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#0071E3]/80 dark:text-blue-300/80'}`}>
                      {transferTargetIsDebt
                        ? '• Debt / Card payment: reduces debt balance and counts as an Expense in monthly cashflow.'
                        : '• Internal bank transfer: excluded from monthly Income & Expense totals.'}
                    </p>
                  )}
                </div>
              )}

              {onOpenLinkTransfer && !tx.isTransfer && budgets.length >= 2 && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLinkTransfer(tx);
                  }}
                  className="w-full py-1.5 px-3 rounded-xl bg-[#0071E3]/10 hover:bg-[#0071E3]/20 text-[#0071E3] dark:text-[#5AC8FA] border border-[#0071E3]/25 text-[11px] font-semibold transition flex items-center justify-center gap-1.5"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Pair & Merge with Another Bank Transaction
                </button>
              )}

              {!isTransfer && selectedBudget && (selectedBudget.accountType === 'credit_card' || selectedBudget.accountType === 'loan') && (
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

              {cardBudget && cardCutoffDay && autoCycleInfo && (
                <div className="pt-2 border-t border-black/[0.06] dark:border-white/10 space-y-1">
                  <label className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider block">
                    Statement Cycle / Ciclo (Corte día {cardCutoffDay})
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-[#86868B] block mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#86868B] block mb-1">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as 'pending' | 'cleared')}
                className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
              >
                <option value="cleared" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">Cleared (Reconciled / Statement)</option>
                <option value="pending" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">Pending (Email Alert / Floating)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#86868B] block mb-1">Notes (Optional)</label>
            <input
              type="text"
              maxLength={500}
              placeholder="Additional notes..."
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
              disabled={isSubmitting}
              className="flex-1 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white py-2.5 rounded-full text-xs font-semibold transition"
            >
              {isSubmitting ? 'Updating...' : 'Update Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
