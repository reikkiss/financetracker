import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft } from 'lucide-react';
import { Budget } from './BudgetsPage';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  budgets: Budget[];
  currencySymbol: string;
  initialFromId?: string;
  onSave: (data: {
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

export default function TransferModal({
  isOpen,
  onClose,
  budgets,
  currencySymbol,
  initialFromId,
  onSave
}: TransferModalProps) {
  const [fromId, setFromId] = useState(budgets[0]?.id || '');
  const [toId, setToId] = useState(budgets[1]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && budgets.length > 0) {
      const defaultFrom =
        initialFromId ||
        budgets.find(b => b.accountType === 'bank_account' || b.accountType === 'debit_account')?.id ||
        budgets[0]?.id ||
        '';
      const defaultTo = budgets.find(b => b.id !== defaultFrom)?.id || '';
      setFromId(defaultFrom);
      setToId(defaultTo);
      setAmount('');
      setDate(new Date().toISOString().split('T')[0]);
      setTitle('');
      setNotes('');
    }
  }, [isOpen, initialFromId, budgets]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = Math.abs(parseFloat(amount));
    if (!fromId || !toId || fromId === toId || isNaN(parsedAmount) || parsedAmount <= 0) return;

    setIsSubmitting(true);
    try {
      await onSave({
        fromBudgetId: fromId,
        toBudgetId: toId,
        amount: parsedAmount,
        date: date || new Date().toISOString().split('T')[0],
        title: title.trim() || undefined,
        notes: notes.trim() || undefined
      });
      onClose();
    } catch (err) {
      console.error('Failed to save transfer:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const amt = Math.abs(parseFloat(amount) || 0);
  const fromAcc = budgets.find(b => b.id === fromId);
  const toAcc = budgets.find(b => b.id === toId);
  const toIsDebt = toAcc?.accountType === 'credit_card' || toAcc?.accountType === 'loan';
  const fromIsLiquid = fromAcc?.accountType === 'bank_account' || fromAcc?.accountType === 'debit_account';
  const toIsLiquid = toAcc?.accountType === 'bank_account' || toAcc?.accountType === 'debit_account';

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#1D1D1F] dark:text-[#F5F5F7]">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-[#0071E3]" />
            Transfer Between Accounts
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[11px] text-[#86868B]">
          Move funds between accounts or make a credit card / loan abono without distorting monthly expense and income totals.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[11px] text-[#86868B] block mb-1">From Account (Source) *</label>
            <select
              required
              value={fromId}
              onChange={e => {
                const nextFrom = e.target.value;
                setFromId(nextFrom);
                if (nextFrom === toId) {
                  const nextTo = budgets.find(b => b.id !== nextFrom)?.id || '';
                  setToId(nextTo);
                }
              }}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            >
              {budgets.map(b => (
                <option key={b.id} value={b.id} className="bg-white dark:bg-[#1C1C1E]">
                  {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] text-[#86868B] block mb-1">To Account (Destination) *</label>
            <select
              required
              value={toId}
              onChange={e => setToId(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            >
              <option value="" className="bg-white dark:bg-[#1C1C1E]">-- Select Destination Account --</option>
              {budgets
                .filter(b => b.id !== fromId)
                .map(b => (
                  <option key={b.id} value={b.id} className="bg-white dark:bg-[#1C1C1E]">
                    {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-[#86868B] block mb-1">Amount ({currencySymbol}) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#86868B] block mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-[#86868B] block mb-1">Title (Optional)</label>
            <input
              type="text"
              maxLength={200}
              placeholder="e.g. Pago Tarjeta Popular"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          <div>
            <label className="text-[11px] text-[#86868B] block mb-1">Notes (Optional)</label>
            <input
              type="text"
              maxLength={500}
              placeholder="Reference number or memo..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          {fromAcc && toAcc && amt > 0 && (
            <div className="bg-[#0071E3]/10 border border-[#0071E3]/25 rounded-2xl p-3 text-[11px] space-y-1 text-[#0071E3] dark:text-blue-200 tabular-nums">
              {fromIsLiquid && (
                <div>• {fromAcc.name}: balance decreases by {currencySymbol}{amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              )}
              {toIsLiquid && (
                <div>• {toAcc.name}: balance increases by {currencySymbol}{amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              )}
              {toIsDebt && (
                <div>• {toAcc.name}: debt/used balance reduced by {currencySymbol}{amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              )}
              <div className="text-[10px] text-[#0071E3]/80 dark:text-blue-300/80 pt-0.5">
                Excluded from monthly Expense and Income totals.
              </div>
            </div>
          )}

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
              disabled={isSubmitting || !fromId || !toId || fromId === toId || amt <= 0}
              className="flex-1 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white py-2.5 rounded-full text-xs font-semibold transition"
            >
              {isSubmitting ? 'Saving...' : 'Save Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
