import React from 'react';
import {
  X,
  Calendar,
  CreditCard,
  Building2,
  Tag,
  CheckCircle2,
  Clock,
  ArrowRightLeft,
  FileText,
  DollarSign,
  TrendingDown,
  TrendingUp,
  Receipt
} from 'lucide-react';
import { Transaction } from '../App';
import { Budget } from './BudgetsPage';

interface TransactionDetailDrawerProps {
  tx: Transaction | null;
  onClose: () => void;
  onEdit: (tx: Transaction) => void;
  onDelete: (id: string) => void;
  budgets: Budget[];
  currencySymbol: string;
}

export default function TransactionDetailDrawer({
  tx,
  onClose,
  onEdit,
  onDelete,
  budgets,
  currencySymbol
}: TransactionDetailDrawerProps) {
  if (!tx) return null;

  const linkedBudget = budgets.find(b => b.id === tx.budgetId);
  const transferToBudget = tx.transferToBudgetId ? budgets.find(b => b.id === tx.transferToBudgetId) : null;
  const isPending = tx.status === 'pending';
  const isIncome = tx.type === 'income';

  // Dominican FX estimation (USD <-> DOP ~ 60.50)
  const fxRate = 60.50;
  const isUSD = currencySymbol === '$' || currencySymbol === 'US$';
  const convertedAmount = isUSD
    ? `RD$ ${(tx.amount * fxRate).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : `US$ ${(tx.amount / fxRate).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end">
      <div
        className="w-full max-w-md bg-[#1C1C1E] text-[#F5F5F7] h-full shadow-2xl border-l border-white/10 flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-300"
        style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", sans-serif'
        }}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#1C1C1E]/90 backdrop-blur-xl z-10">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-[#86868B]">
              Transaction Details
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                isPending
                  ? 'bg-[#FF9F0A]/20 text-[#FF9F0A] border border-[#FF9F0A]/30'
                  : 'bg-[#34C759]/20 text-[#34C759] border border-[#34C759]/30'
              }`}
            >
              {isPending ? 'Pending Flotante' : 'Cleared / Reconciled'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Hero Section */}
        <div className="p-6 space-y-6 flex-1">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-white">{tx.title}</h2>
            <div className="text-3xl font-extrabold tracking-tight tabular-nums mt-2">
              <span className={isIncome ? 'text-[#34C759]' : 'text-white'}>
                {isIncome ? '+' : '-'} {currencySymbol}{tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <p className="text-xs text-[#86868B] tabular-nums pt-0.5">
              Approx. {convertedAmount} (Est. FX @ 1 USD = 60.50 DOP)
            </p>
          </div>

          {/* Activity / Reconciliation Card */}
          <div className="bg-[#2C2C2E] border border-white/5 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#86868B] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> Date
              </span>
              <span className="font-medium text-white tabular-nums">{tx.date}</span>
            </div>

            <div className="h-[0.5px] bg-white/10" />

            <div className="flex items-center justify-between text-xs">
              <span className="text-[#86868B] flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" /> Category
              </span>
              <span className="font-medium text-white">{tx.category}</span>
            </div>

            <div className="h-[0.5px] bg-white/10" />

            <div className="flex items-center justify-between text-xs">
              <span className="text-[#86868B] flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" /> Linked Product / Account
              </span>
              <span className="font-medium text-white truncate max-w-[200px]">
                {linkedBudget ? linkedBudget.name || linkedBudget.category : 'General Ledger'}
              </span>
            </div>

            {tx.isTransfer && transferToBudget && (
              <>
                <div className="h-[0.5px] bg-white/10" />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#86868B] flex items-center gap-1.5">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-blue-400" /> Transfer Target
                  </span>
                  <span className="font-medium text-white">
                    {transferToBudget.name || transferToBudget.category}
                  </span>
                </div>
              </>
            )}

            {tx.isLoanPayment && (
              <>
                <div className="h-[0.5px] bg-white/10" />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#86868B] flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Payment Type
                  </span>
                  <span className="font-medium text-emerald-400">
                    Debt Abono / Balance Payment
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Notes & Bank Details */}
          <div className="bg-[#2C2C2E] border border-white/5 rounded-2xl p-4 space-y-2">
            <span className="text-[11px] text-[#86868B] uppercase tracking-wider font-semibold block">
              Statement & Ingestion Notes
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {tx.notes || 'No specific notes recorded for this transaction.'}
            </p>
          </div>

          {/* Reconciliation Status Callout */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-start gap-3">
            {isPending ? (
              <Clock className="w-5 h-5 text-[#FF9F0A] shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-[#34C759] shrink-0 mt-0.5" />
            )}
            <div className="text-xs space-y-1">
              <strong className="text-white block font-semibold">
                {isPending ? 'Pending Dominican Bank Flotante' : 'Fully Cleared with Statement'}
              </strong>
              <p className="text-[#86868B] leading-relaxed">
                {isPending
                  ? 'Captured via real-time Dominican bank alert email (e.g. Banreservas, Popular, BHD, or Qik). When your monthly statement is uploaded, it will automatically match and lock as cleared.'
                  : 'This transaction has cleared against your monthly statement or was recorded directly to your seashore ledger.'}
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-white/10 bg-[#1C1C1E] flex items-center gap-3">
          <button
            onClick={() => {
              onEdit(tx);
              onClose();
            }}
            className="flex-1 py-2.5 rounded-full text-xs font-semibold bg-[#0071E3] hover:bg-[#0077ED] text-white transition active:scale-[0.98]"
          >
            Edit Transaction
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Delete transaction "${tx.title}"?`)) {
                onDelete(tx.id);
                onClose();
              }
            }}
            className="px-4 py-2.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 transition active:scale-[0.98]"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
