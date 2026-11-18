import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Budget } from './BudgetsPage';

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
  onSave
}: AddTransactionModalProps) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'income' | 'expense'>(defaultType);
  const [category, setCategory] = useState(availableCategories[0] || 'Groceries');
  const [date, setDate] = useState(prefillDate || new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [budgetId, setBudgetId] = useState(prefillBudgetId || '');
  const [isLoanPayment, setIsLoanPayment] = useState(Boolean(prefillIsLoanPayment));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setType(defaultType);
      setDate(prefillDate || new Date().toISOString().split('T')[0]);
      setBudgetId(prefillBudgetId || '');
      setIsLoanPayment(Boolean(prefillIsLoanPayment));
      setTitle(prefillTitle || '');
      setAmount('');
      setNotes('');
      setCategory(prefillCategory || availableCategories[0] || 'Groceries');
    }
  }, [isOpen, defaultType, prefillDate, prefillBudgetId, prefillIsLoanPayment, prefillTitle, prefillCategory, availableCategories]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = Math.abs(parseFloat(amount));
    if (!title.trim() || isNaN(parsedAmount) || parsedAmount <= 0) return;

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
        isLoanPayment: isLoanPayment || undefined
      });
      onClose();
    } catch (err) {
      console.error('Failed to create transaction:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedBudget = budgets.find(b => b.id === budgetId);
  const canBeLoanPayment = selectedBudget && (selectedBudget.accountType === 'credit_card' || selectedBudget.accountType === 'loan');

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#1D1D1F] dark:text-[#F5F5F7]">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white capitalize">
            {isLoanPayment ? 'Record Payment / Abono' : `New ${type}`}
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
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
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
              disabled={isSubmitting}
              className="flex-1 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white py-2.5 rounded-full text-xs font-semibold transition"
            >
              {isSubmitting ? 'Saving...' : 'Save Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
