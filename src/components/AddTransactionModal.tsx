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
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#F5F5F7]">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold tracking-tight text-white capitalize">
            {isLoanPayment ? 'Record Payment / Abono' : `New ${type}`}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Type selector toggle */}
        <div className="flex p-1 bg-[#2C2C2E] rounded-full border border-white/5">
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-full transition ${
              type === 'expense'
                ? 'bg-[#FF3B30] text-white shadow-sm'
                : 'text-[#86868B] hover:text-white'
            }`}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => setType('income')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-full transition ${
              type === 'income'
                ? 'bg-[#34C759] text-black shadow-sm'
                : 'text-[#86868B] hover:text-white'
            }`}
          >
            Income
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[11px] text-[#9b9b9b] block mb-1">Title *</label>
            <input
              type="text"
              required
              maxLength={200}
              placeholder={type === 'expense' ? "e.g. Supermercado Bravo, Internet" : "e.g. Salary, Consulting"}
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-[#9b9b9b] block mb-1">Amount ({currencySymbol}) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#9b9b9b] block mb-1">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
              >
                {availableCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {budgets.length > 0 && (
            <div className="space-y-2 bg-[#1a1a1a] border border-[#2d2d2d] p-3 rounded-xl">
              <label className="text-[11px] text-[#9b9b9b] block">
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
                className="w-full bg-[#121212] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              >
                <option value="">None (Match by Category only)</option>
                {budgets.map(b => (
                  <option key={b.id} value={b.id}>
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
                    className="accent-emerald-500 w-3.5 h-3.5"
                  />
                  <span className="text-[11px] text-emerald-400 font-medium">
                    Payment / Abono to {selectedBudget.name || selectedBudget.category} (Reduces balance used)
                  </span>
                </label>
              )}
            </div>
          )}

          <div>
            <label className="text-[11px] text-[#9b9b9b] block mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] text-[#9b9b9b] block mb-1">Notes (Optional)</label>
            <input
              type="text"
              maxLength={500}
              placeholder="Optional reference or details..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-[#2C2C2E] hover:bg-white/15 text-white py-2.5 rounded-full text-xs font-semibold transition"
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
