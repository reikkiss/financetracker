import React, { useState, useEffect, useMemo } from 'react';
import { X, ArrowRightLeft, Link2, Search, CheckCircle2, Sparkles, Unlink } from 'lucide-react';
import { Budget } from './BudgetsPage';
import { Transaction } from './DashboardPage';
import { findSimilarCandidatesForTransaction } from '../utils/financeMath';

interface LinkTransferModalProps {
  isOpen: boolean;
  primaryTx: Transaction | null;
  initialPartnerTx?: Transaction | null;
  onClose: () => void;
  budgets: Budget[];
  transactions: Transaction[];
  currencySymbol: string;
  onConfirmLink: (params: {
    primaryTx: Transaction;
    partnerTx?: Transaction | null;
    fromBudgetId: string;
    toBudgetId: string;
    amount: number;
    date: string;
    title: string;
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

export default function LinkTransferModal({
  isOpen,
  primaryTx,
  initialPartnerTx = null,
  onClose,
  budgets,
  transactions,
  currencySymbol,
  onConfirmLink
}: LinkTransferModalProps) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [partnerTxId, setPartnerTxId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const budgetById = useMemo(() => {
    const map: Record<string, Budget> = {};
    budgets.forEach(b => {
      map[b.id] = b;
    });
    return map;
  }, [budgets]);

  // Candidate transactions that could be the opposite/mirror side of this transfer
  const candidatePartners = useMemo(() => {
    if (!primaryTx) return [];
    return findSimilarCandidatesForTransaction(primaryTx, transactions, budgets);
  }, [primaryTx, transactions, budgets]);

  const filteredCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return candidatePartners.slice(0, 25);
    return candidatePartners
      .filter(({ tx }) => {
        const b = tx.budgetId ? budgetById[tx.budgetId] : undefined;
        const bName = (b?.name || b?.category || '').toLowerCase();
        return (
          (tx.title || '').toLowerCase().includes(q) ||
          (tx.date || '').toLowerCase().includes(q) ||
          String(tx.amount || '').includes(q) ||
          bName.includes(q)
        );
      })
      .slice(0, 30);
  }, [candidatePartners, searchQuery, budgetById]);

  useEffect(() => {
    if (!isOpen || !primaryTx) return;

    const partner = initialPartnerTx && initialPartnerTx.id !== primaryTx.id ? initialPartnerTx : null;
    setPartnerTxId(partner ? partner.id : '');
    setSearchQuery('');
    setAmount(String(Math.abs(Number(primaryTx.amount) || 0)));
    setDate(primaryTx.date || new Date().toISOString().split('T')[0]);
    setTitle(primaryTx.title || '');
    setNotes(primaryTx.notes || '');

    if (primaryTx.isTransfer && primaryTx.budgetId && primaryTx.transferToBudgetId) {
      setFromId(primaryTx.budgetId);
      setToId(primaryTx.transferToBudgetId);
      return;
    }

    if (partner) {
      // Determine direction from expense (source) -> income/payment (destination)
      if (primaryTx.type === 'expense' && partner.type === 'income') {
        setFromId(primaryTx.budgetId || '');
        setToId(partner.budgetId || '');
      } else if (primaryTx.type === 'income' && partner.type === 'expense') {
        setFromId(partner.budgetId || '');
        setToId(primaryTx.budgetId || '');
      } else {
        setFromId(primaryTx.budgetId || '');
        setToId(partner.budgetId || budgets.find(b => b.id !== primaryTx.budgetId)?.id || '');
      }
      return;
    }

    // Single transaction conversion
    if (primaryTx.type === 'income') {
      const destId = primaryTx.budgetId || '';
      const fallbackSrc = budgets.find(b => b.id !== destId && (b.accountType === 'bank_account' || b.accountType === 'debit_account'))?.id
        || budgets.find(b => b.id !== destId)?.id
        || '';
      setFromId(fallbackSrc);
      setToId(destId);
    } else {
      const srcId = primaryTx.budgetId || '';
      const fallbackDest = budgets.find(b => b.id !== srcId)?.id || '';
      setFromId(srcId);
      setToId(fallbackDest);
    }
  }, [isOpen, primaryTx, initialPartnerTx, budgets]);

  if (!isOpen || !primaryTx) return null;

  const selectedPartner = partnerTxId
    ? transactions.find(t => t.id === partnerTxId) || null
    : null;

  const handleSelectPartner = (candidate: Transaction | null) => {
    if (!candidate) {
      setPartnerTxId('');
      return;
    }
    setPartnerTxId(candidate.id);
    // Auto-align From -> To based on expense -> income/payment
    if (primaryTx.type === 'expense' && candidate.type === 'income') {
      if (primaryTx.budgetId) setFromId(primaryTx.budgetId);
      if (candidate.budgetId && candidate.budgetId !== primaryTx.budgetId) setToId(candidate.budgetId);
    } else if (primaryTx.type === 'income' && candidate.type === 'expense') {
      if (candidate.budgetId) setFromId(candidate.budgetId);
      if (primaryTx.budgetId && primaryTx.budgetId !== candidate.budgetId) setToId(primaryTx.budgetId);
    } else if (candidate.budgetId && candidate.budgetId !== fromId) {
      setToId(candidate.budgetId);
    }
  };

  const handleSwap = () => {
    const prevFrom = fromId;
    setFromId(toId);
    setToId(prevFrom);
  };

  const amt = Math.abs(parseFloat(amount) || 0);
  const fromAcc = budgetById[fromId];
  const toAcc = budgetById[toId];
  const fromIsLiquid = fromAcc?.accountType === 'bank_account' || fromAcc?.accountType === 'debit_account';
  const toIsLiquid = toAcc?.accountType === 'bank_account' || toAcc?.accountType === 'debit_account';
  const toIsDebt = toAcc?.accountType === 'credit_card' || toAcc?.accountType === 'loan';
  const canSubmit = Boolean(fromId && toId && fromId !== toId && amt > 0 && !isSubmitting);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      await onConfirmLink({
        primaryTx,
        partnerTx: selectedPartner,
        fromBudgetId: fromId,
        toBudgetId: toId,
        amount: amt,
        date: date || primaryTx.date || new Date().toISOString().split('T')[0],
        title: title.trim() || primaryTx.title || 'Bank Transfer',
        notes: notes.trim() || undefined
      });
      onClose();
    } catch (err) {
      console.error('Failed to link transfer:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/45 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#1D1D1F] dark:text-[#F5F5F7]">
        {/* Header */}
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white flex items-center gap-2">
              <Link2 className="w-4 h-4 text-[#0071E3]" />
              Attach & Link Bank Transfer
            </h3>
            <p className="text-[11px] text-[#86868B] mt-0.5">
              Connect this movement between accounts or pair two bank entries into one clean transfer.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Primary Transaction Summary */}
        <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.05] dark:border-white/10 rounded-2xl p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-[#86868B] block">
              Selected Transaction
            </span>
            <p className="text-xs font-bold text-[#1D1D1F] dark:text-white truncate">{primaryTx.title}</p>
            <p className="text-[11px] text-[#86868B] tabular-nums">
              {primaryTx.date} • {primaryTx.budgetId && budgetById[primaryTx.budgetId] ? (budgetById[primaryTx.budgetId].name || budgetById[primaryTx.budgetId].category) : 'Unassigned account'}
            </p>
          </div>
          <div className={`text-sm font-bold tabular-nums shrink-0 ${primaryTx.type === 'income' ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#D70015] dark:text-[#FF3B30]'}`}>
            {primaryTx.type === 'income' ? '+' : '-'}{currencySymbol}{Math.abs(Number(primaryTx.amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* From -> To Direction Box */}
          <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.05] dark:border-white/10 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#1D1D1F] dark:text-white flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-[#0071E3]" />
                Transfer Direction (From → To)
              </span>
              <button
                type="button"
                onClick={handleSwap}
                className="text-[11px] font-semibold text-[#0071E3] dark:text-[#5AC8FA] hover:underline flex items-center gap-1"
              >
                <ArrowRightLeft className="w-3 h-3" /> Swap
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] uppercase tracking-wider font-semibold text-[#86868B] block mb-1">
                  From Bank / Source *
                </label>
                <select
                  required
                  value={fromId}
                  onChange={e => {
                    const nextFrom = e.target.value;
                    setFromId(nextFrom);
                    if (nextFrom === toId) {
                      setToId(budgets.find(b => b.id !== nextFrom)?.id || '');
                    }
                  }}
                  className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                >
                  <option value="">-- Select Source --</option>
                  {budgets.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider font-semibold text-[#86868B] block mb-1">
                  To Bank / Card / Loan *
                </label>
                <select
                  required
                  value={toId}
                  onChange={e => setToId(e.target.value)}
                  className="w-full bg-white dark:bg-[#1C1C1E] border border-[#0071E3]/40 rounded-xl px-2.5 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                >
                  <option value="">-- Select Destination --</option>
                  {budgets
                    .filter(b => b.id !== fromId)
                    .map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>

          {/* Optional Counterparty Transaction Pairing */}
          <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.05] dark:border-white/10 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#1D1D1F] dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#FF9F0A]" />
                Pair with Matching Entry in Other Bank (Optional)
              </span>
              {selectedPartner && (
                <button
                  type="button"
                  onClick={() => handleSelectPartner(null)}
                  className="text-[10px] font-semibold text-[#D70015] dark:text-[#FF453A] hover:underline flex items-center gap-1"
                >
                  <Unlink className="w-3 h-3" /> Unpair
                </button>
              )}
            </div>

            {selectedPartner ? (
              <div className="bg-[#0071E3]/10 border border-[#0071E3]/30 rounded-xl p-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
                    <span className="text-xs font-semibold text-[#1D1D1F] dark:text-white truncate">
                      {selectedPartner.title}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#6E6E73] dark:text-zinc-300 tabular-nums mt-0.5">
                    {selectedPartner.date} •{' '}
                    {selectedPartner.budgetId && budgetById[selectedPartner.budgetId]
                      ? budgetById[selectedPartner.budgetId].name || budgetById[selectedPartner.budgetId].category
                      : 'No account'}
                    {' '}• Will merge both entries into 1 transfer (no duplicate income/expense)
                  </p>
                </div>
                <span className={`text-xs font-bold tabular-nums shrink-0 ${selectedPartner.type === 'income' ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#D70015] dark:text-[#FF3B30]'}`}>
                  {selectedPartner.type === 'income' ? '+' : '-'}{currencySymbol}{Math.abs(Number(selectedPartner.amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#86868B] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search receiving/sending bank transaction to merge..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-[11px] text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3]"
                  />
                </div>
                {filteredCandidates.length > 0 ? (
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5">
                    {filteredCandidates.map(({ tx: cand, isSuggested, reasons }) => {
                      const candAcc = cand.budgetId ? budgetById[cand.budgetId] : undefined;
                      return (
                        <button
                          key={cand.id}
                          type="button"
                          onClick={() => handleSelectPartner(cand)}
                          className={`w-full text-left px-2.5 py-2 rounded-xl border transition flex items-center justify-between gap-2 ${
                            isSuggested
                              ? 'bg-[#34C759]/8 border-[#34C759]/30 hover:bg-[#34C759]/15'
                              : 'bg-white dark:bg-[#1C1C1E] border-black/[0.06] dark:border-white/10 hover:border-[#0071E3]/40'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] font-semibold text-[#1D1D1F] dark:text-white truncate">
                                {cand.title}
                              </span>
                              {isSuggested && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[#34C759]/20 text-[#248A3D] dark:text-[#34C759] shrink-0">
                                  Similar Match
                                </span>
                              )}
                              {reasons.slice(0, 2).map(reason => (
                                <span
                                  key={reason}
                                  className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-black/[0.04] dark:bg-white/10 text-[#6E6E73] dark:text-zinc-300 shrink-0"
                                >
                                  {reason}
                                </span>
                              ))}
                            </div>
                            <span className="text-[10px] text-[#86868B] tabular-nums block truncate">
                              {cand.date} • {candAcc ? (candAcc.name || candAcc.category) : 'Unassigned'}
                            </span>
                          </div>
                          <span className={`text-[11px] font-bold tabular-nums shrink-0 ${cand.type === 'income' ? 'text-[#248A3D] dark:text-[#34C759]' : 'text-[#D70015] dark:text-[#FF3B30]'}`}>
                            {cand.type === 'income' ? '+' : '-'}{currencySymbol}{Math.abs(Number(cand.amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] text-[#86868B]">
                    No other unlinked entries found. You can still attach the destination/source account above directly.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Amount, Date & Title */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-[#86868B] block mb-1">Amount ({currencySymbol}) *</label>
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
            <label className="text-[11px] text-[#86868B] block mb-1">Title</label>
            <input
              type="text"
              maxLength={200}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Transfer Popular → Banreservas"
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          <div>
            <label className="text-[11px] text-[#86868B] block mb-1">Notes (Optional)</label>
            <input
              type="text"
              maxLength={500}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Reference or transfer memo..."
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          {/* Impact Preview */}
          {fromAcc && toAcc && fromId !== toId && amt > 0 && (
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
              {toIsDebt ? (
                <div className="text-[10px] text-[#248A3D] dark:text-[#34C759] pt-0.5 font-medium">
                  • Counted as a Debt / Card Payment expense in your monthly cashflow.
                </div>
              ) : (
                <div className="text-[10px] text-[#0071E3]/80 dark:text-blue-300/80 pt-0.5">
                  • Pure internal bank transfer (excluded from monthly Income & Expense totals).
                </div>
              )}
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
              disabled={!canSubmit}
              className="flex-1 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white py-2.5 rounded-full text-xs font-semibold transition flex items-center justify-center gap-1.5"
            >
              <Link2 className="w-3.5 h-3.5" />
              {isSubmitting ? 'Linking...' : selectedPartner ? 'Link & Merge Transfer' : 'Save Linked Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
