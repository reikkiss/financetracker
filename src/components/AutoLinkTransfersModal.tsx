import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ArrowRightLeft,
  Link2,
  Sparkles,
  CheckSquare,
  Square,
  CheckCircle2,
  Building2,
  Wallet,
  CreditCard,
  Landmark
} from 'lucide-react';
import { Budget } from './BudgetsPage';
import { Transaction } from './DashboardPage';
import { findSimilarTransferPairs, TransferMatchCandidate } from '../utils/financeMath';

interface AutoLinkTransfersModalProps {
  isOpen: boolean;
  onClose: () => void;
  budgets: Budget[];
  transactions: Transaction[];
  currencySymbol: string;
  onAttachPairs: (
    pairs: Array<{
      primaryTx: Transaction;
      partnerTx: Transaction;
      fromBudgetId: string;
      toBudgetId: string;
      amount: number;
      date: string;
      title: string;
      notes?: string;
    }>
  ) => Promise<void>;
}

function AccountBadgeIcon({ accountType }: { accountType?: Budget['accountType'] }) {
  if (accountType === 'credit_card') return <CreditCard className="w-3 h-3 text-[#FF9F0A]" />;
  if (accountType === 'loan') return <Landmark className="w-3 h-3 text-[#AF52DE]" />;
  if (accountType === 'bank_account') return <Building2 className="w-3 h-3 text-[#0071E3] dark:text-[#5AC8FA]" />;
  if (accountType === 'debit_account') return <Wallet className="w-3 h-3 text-[#248A3D] dark:text-[#34C759]" />;
  return null;
}

export default function AutoLinkTransfersModal({
  isOpen,
  onClose,
  budgets,
  transactions,
  currencySymbol,
  onAttachPairs
}: AutoLinkTransfersModalProps) {
  const detectedPairs = useMemo(
    () => (isOpen ? findSimilarTransferPairs(transactions, budgets) : []),
    [isOpen, transactions, budgets]
  );

  const [selectedPairIds, setSelectedPairIds] = useState<string[]>([]);
  const [swappedIds, setSwappedIds] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const budgetById = useMemo(() => {
    const map: Record<string, Budget> = {};
    budgets.forEach(b => {
      map[b.id] = b;
    });
    return map;
  }, [budgets]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedPairIds(detectedPairs.map(p => p.id));
    setSwappedIds({});
  }, [isOpen, detectedPairs]);

  if (!isOpen) return null;

  const togglePair = (pairId: string) => {
    setSelectedPairIds(prev =>
      prev.includes(pairId) ? prev.filter(id => id !== pairId) : [...prev, pairId]
    );
  };

  const toggleSwap = (pairId: string) => {
    setSwappedIds(prev => ({ ...prev, [pairId]: !prev[pairId] }));
  };

  const allSelected = detectedPairs.length > 0 && selectedPairIds.length === detectedPairs.length;

  const toggleSelectAll = () => {
    if (allSelected) setSelectedPairIds([]);
    else setSelectedPairIds(detectedPairs.map(p => p.id));
  };

  const buildPayloadForPair = (pair: TransferMatchCandidate<Transaction>) => {
    const swapped = Boolean(swappedIds[pair.id]);
    const fromBudgetId = swapped ? pair.toBudgetId : pair.fromBudgetId;
    const toBudgetId = swapped ? pair.fromBudgetId : pair.toBudgetId;
    return {
      primaryTx: pair.primaryTx,
      partnerTx: pair.partnerTx,
      fromBudgetId,
      toBudgetId,
      amount: pair.amount,
      date: pair.date,
      title: pair.title,
      notes: pair.primaryTx.notes || pair.partnerTx.notes
    };
  };

  const handleAttachSelected = async () => {
    const targets = detectedPairs.filter(p => selectedPairIds.includes(p.id));
    if (targets.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onAttachPairs(targets.map(buildPayloadForPair));
      onClose();
    } catch (err) {
      console.error('Failed to batch attach transfers:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAttachSingle = async (pair: TransferMatchCandidate<Transaction>) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onAttachPairs([buildPayloadForPair(pair)]);
    } catch (err) {
      console.error('Failed to attach transfer pair:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/45 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col space-y-4 text-[#1D1D1F] dark:text-[#F5F5F7]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-black/[0.06] dark:border-white/10 pb-3 shrink-0">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#0071E3]" />
              Auto-Match & Attach Similar Transfers
            </h3>
            <p className="text-[11px] text-[#86868B] mt-0.5">
              Finds matching transfer or payment entries across your banks, cards, and loans so you can attach and merge duplicates into single clean transfers.
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

        {/* Summary / Select All Bar */}
        {detectedPairs.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#F5F5F7] dark:bg-[#2C2C2E]/70 border border-black/[0.05] dark:border-white/10 rounded-2xl px-4 py-2.5 text-xs shrink-0">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-2 font-semibold text-[#1D1D1F] dark:text-white hover:text-[#0071E3] transition"
            >
              {allSelected ? (
                <CheckSquare className="w-4 h-4 text-[#0071E3]" />
              ) : (
                <Square className="w-4 h-4 text-[#86868B]" />
              )}
              <span>
                {selectedPairIds.length} of {detectedPairs.length} similar {detectedPairs.length === 1 ? 'pair' : 'pairs'} selected
              </span>
            </button>
            <span className="text-[11px] text-[#86868B]">
              Merges duplicate entries & keeps account balances exact
            </span>
          </div>
        )}

        {/* Pairs List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[200px]">
          {detectedPairs.length === 0 ? (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-6 space-y-2.5">
              <div className="w-12 h-12 rounded-2xl bg-[#34C759]/12 border border-[#34C759]/25 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-[#248A3D] dark:text-[#34C759]" />
              </div>
              <p className="text-sm font-semibold text-[#1D1D1F] dark:text-white">
                All transfers look cleanly attached
              </p>
              <p className="text-xs text-[#86868B] max-w-md leading-relaxed">
                No unlinked matching transfer or duplicate payment pairs were found within ±5 days across your accounts. You can still pair any two transactions manually using the checkboxes in the ledger.
              </p>
            </div>
          ) : (
            detectedPairs.map(pair => {
              const isSelected = selectedPairIds.includes(pair.id);
              const swapped = Boolean(swappedIds[pair.id]);
              const effectiveFromId = swapped ? pair.toBudgetId : pair.fromBudgetId;
              const effectiveToId = swapped ? pair.fromBudgetId : pair.toBudgetId;
              const fromAcc = budgetById[effectiveFromId];
              const toAcc = budgetById[effectiveToId];
              const toIsDebt = toAcc?.accountType === 'credit_card' || toAcc?.accountType === 'loan';

              const leftTx = swapped ? pair.partnerTx : pair.primaryTx;
              const rightTx = swapped ? pair.primaryTx : pair.partnerTx;
              const leftAcc = leftTx.budgetId ? budgetById[leftTx.budgetId] : fromAcc;
              const rightAcc = rightTx.budgetId ? budgetById[rightTx.budgetId] : toAcc;

              return (
                <div
                  key={pair.id}
                  className={`rounded-2xl border p-3.5 transition space-y-2.5 ${
                    isSelected
                      ? 'bg-[#0071E3]/[0.04] dark:bg-[#0071E3]/[0.08] border-[#0071E3]/35'
                      : 'bg-[#F5F5F7]/70 dark:bg-[#2C2C2E]/40 border-black/[0.06] dark:border-white/10 opacity-70'
                  }`}
                >
                  {/* Top Meta Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => togglePair(pair.id)}
                        className="text-[#86868B] hover:text-[#0071E3] transition"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#0071E3]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          pair.confidence === 'exact'
                            ? 'bg-[#34C759]/15 text-[#248A3D] dark:text-[#34C759]'
                            : pair.confidence === 'high'
                            ? 'bg-[#0071E3]/15 text-[#0071E3] dark:text-[#5AC8FA]'
                            : 'bg-[#FF9F0A]/15 text-[#B25000] dark:text-[#FF9F0A]'
                        }`}
                      >
                        {pair.confidence === 'exact'
                          ? 'Exact Match'
                          : pair.confidence === 'high'
                          ? 'High Match'
                          : 'Possible Match'}
                      </span>
                      {pair.reasons.map(r => (
                        <span
                          key={r}
                          className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 text-[#6E6E73] dark:text-zinc-300"
                        >
                          {r}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSwap(pair.id)}
                        className="text-[10px] font-semibold text-[#0071E3] dark:text-[#5AC8FA] hover:underline flex items-center gap-1"
                        title="Swap From / To direction"
                      >
                        <ArrowRightLeft className="w-3 h-3" /> Swap
                      </button>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => handleAttachSingle(pair)}
                        className="bg-white dark:bg-[#1C1C1E] hover:bg-[#0071E3] hover:text-white border border-black/[0.08] dark:border-white/15 text-[#0071E3] dark:text-[#5AC8FA] px-2.5 py-1 rounded-full text-[10px] font-semibold transition flex items-center gap-1"
                      >
                        <Link2 className="w-3 h-3" /> Attach
                      </button>
                    </div>
                  </div>

                  {/* Two Matching Sides */}
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                    {/* Left Side (From) */}
                    <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-xl p-2.5 space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#6E6E73] dark:text-zinc-300 truncate">
                          <AccountBadgeIcon accountType={leftAcc?.accountType} />
                          FROM: {fromAcc?.name || fromAcc?.category || 'Source'}
                        </span>
                        <span
                          className={`text-xs font-bold tabular-nums shrink-0 ${
                            leftTx.type === 'income'
                              ? 'text-[#248A3D] dark:text-[#34C759]'
                              : 'text-[#D70015] dark:text-[#FF3B30]'
                          }`}
                        >
                          {leftTx.type === 'income' ? '+' : '-'}
                          {currencySymbol}
                          {Math.abs(Number(leftTx.amount) || 0).toLocaleString('en-US', {
                            minimumFractionDigits: 2
                          })}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-[#1D1D1F] dark:text-white truncate">
                        {leftTx.title}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-[#86868B] tabular-nums">
                        <span>{leftTx.date}</span>
                        <span>{leftTx.isTransfer ? 'Already Transfer' : leftTx.type?.toUpperCase()}</span>
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="flex flex-col items-center justify-center px-1">
                      <div className="w-7 h-7 rounded-full bg-[#0071E3]/12 border border-[#0071E3]/25 flex items-center justify-center text-[#0071E3] dark:text-[#5AC8FA]">
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    {/* Right Side (To) */}
                    <div className="bg-white dark:bg-[#1C1C1E] border border-[#0071E3]/25 rounded-xl p-2.5 space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0071E3] dark:text-[#5AC8FA] truncate">
                          <AccountBadgeIcon accountType={rightAcc?.accountType} />
                          TO: {toAcc?.name || toAcc?.category || 'Destination'}
                        </span>
                        <span
                          className={`text-xs font-bold tabular-nums shrink-0 ${
                            rightTx.type === 'income'
                              ? 'text-[#248A3D] dark:text-[#34C759]'
                              : 'text-[#D70015] dark:text-[#FF3B30]'
                          }`}
                        >
                          {rightTx.type === 'income' ? '+' : '-'}
                          {currencySymbol}
                          {Math.abs(Number(rightTx.amount) || 0).toLocaleString('en-US', {
                            minimumFractionDigits: 2
                          })}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-[#1D1D1F] dark:text-white truncate">
                        {rightTx.title}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-[#86868B] tabular-nums">
                        <span>{rightTx.date}</span>
                        <span>
                          {toIsDebt ? 'Counts as Debt Payment' : 'Internal Transfer'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/[0.06] dark:border-white/10 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:hover:bg-white/15 text-[#1D1D1F] dark:text-white px-5 py-2.5 rounded-full text-xs font-semibold transition"
          >
            Close
          </button>
          {detectedPairs.length > 0 && (
            <button
              type="button"
              disabled={selectedPairIds.length === 0 || isSubmitting}
              onClick={handleAttachSelected}
              className="bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white px-5 py-2.5 rounded-full text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
            >
              <Link2 className="w-3.5 h-3.5" />
              {isSubmitting
                ? 'Attaching Transfers...'
                : `Attach & Merge Selected (${selectedPairIds.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
