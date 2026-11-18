import React from 'react';
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
  ArrowRightLeft
} from 'lucide-react';
import { Budget } from './BudgetsPage';

interface TransactionsPageProps {
  transactions: any[];
  budgets?: Budget[];
  currencySymbol?: string;
  onOpenAddTx: (type: 'income' | 'expense') => void;
  onOpenUploadStatement: () => void;
  onOpenTransfer?: () => void;
  onOpenEditTx: (transaction: any) => void;
  onDeleteTx: (id: string) => void;
}

function AccountTypeIcon({ accountType }: { accountType?: Budget['accountType'] }) {
  if (accountType === 'credit_card') return <CreditCard className="w-3 h-3 text-amber-400" />;
  if (accountType === 'loan') return <Landmark className="w-3 h-3 text-purple-400" />;
  if (accountType === 'bank_account') return <Building2 className="w-3 h-3 text-sky-400" />;
  if (accountType === 'debit_account') return <Wallet className="w-3 h-3 text-teal-400" />;
  return null;
}

export default function TransactionsPage({
  transactions,
  budgets = [],
  currencySymbol = '$',
  onOpenAddTx,
  onOpenUploadStatement,
  onOpenTransfer,
  onOpenEditTx,
  onDeleteTx
}: TransactionsPageProps) {
  const budgetById = React.useMemo(() => {
    const map: Record<string, Budget> = {};
    budgets.forEach(b => {
      map[b.id] = b;
    });
    return map;
  }, [budgets]);

  return (
    <div className="space-y-6 animate-fadeIn max-w-5xl pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">All Database Transactions</h2>
          <p className="text-xs text-[#9b9b9b]">Full ledger stored securely in seashore.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenTransfer && budgets.length >= 2 && (
            <button
              onClick={onOpenTransfer}
              className="bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 border border-blue-500/30 px-3.5 py-2 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shadow-sm"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
            </button>
          )}
          <button
            onClick={onOpenUploadStatement}
            className="bg-[#252525] hover:bg-[#2f2f2f] text-emerald-400 border border-[#333] px-3.5 py-2 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" /> Upload Statement
          </button>
          <button
            onClick={() => onOpenAddTx('expense')}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add Transaction
          </button>
        </div>
      </div>

      <div className="bg-[#202020] border border-[#282828] rounded-2xl overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#1c1c1c] border-b border-[#282828] text-[#9b9b9b]">
            <tr>
              <th className="p-3.5 font-medium">Title</th>
              <th className="p-3.5 font-medium">Category</th>
              <th className="p-3.5 font-medium">Account / Budget</th>
              <th className="p-3.5 font-medium">Type</th>
              <th className="p-3.5 font-medium">Date</th>
              <th className="p-3.5 font-medium text-right">Amount</th>
              <th className="p-3.5 font-medium text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#262626]">
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[#777]">No transactions recorded in database.</td>
              </tr>
            ) : (
              transactions.map(t => {
                const linkedBudget = t.budgetId ? budgetById[t.budgetId] : undefined;
                const transferToBudget = t.transferToBudgetId ? budgetById[t.transferToBudgetId] : undefined;
                const isTransfer = Boolean(t.isTransfer);
                return (
                  <tr key={t.id} className="hover:bg-[#252525] transition group">
                    <td className="p-3.5 font-medium text-white">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{t.title}</span>
                        {isTransfer && (
                          <span className="inline-flex items-center gap-1 bg-blue-500/10 text-blue-300 border border-blue-500/25 px-1.5 py-0.5 rounded text-[10px]">
                            <ArrowRightLeft className="w-2.5 h-2.5" /> Transfer
                          </span>
                        )}
                        {t.isLoanPayment && !isTransfer && (
                          <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded text-[10px]">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Payment
                          </span>
                        )}
                      </div>
                      {t.notes && <span className="text-[10px] text-[#777] block mt-0.5 truncate max-w-xs">{t.notes}</span>}
                    </td>
                    <td className="p-3.5"><span className="bg-[#292929] text-zinc-300 px-2 py-0.5 rounded text-[11px]">{t.category}</span></td>
                    <td className="p-3.5">
                      {isTransfer && linkedBudget && transferToBudget ? (
                        <div className="inline-flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 bg-[#252525] border border-[#333] text-zinc-200 px-2 py-0.5 rounded text-[11px]">
                            <AccountTypeIcon accountType={linkedBudget.accountType} />
                            {linkedBudget.name || linkedBudget.category}
                          </span>
                          <span className="text-blue-400 font-bold">→</span>
                          <span className="inline-flex items-center gap-1 bg-blue-500/10 border border-blue-500/25 text-blue-200 px-2 py-0.5 rounded text-[11px]">
                            <AccountTypeIcon accountType={transferToBudget.accountType} />
                            {transferToBudget.name || transferToBudget.category}
                          </span>
                        </div>
                      ) : linkedBudget ? (
                        <span className="inline-flex items-center gap-1 bg-[#252525] border border-[#333] text-zinc-200 px-2 py-0.5 rounded text-[11px]">
                          <AccountTypeIcon accountType={linkedBudget.accountType} />
                          {linkedBudget.name || linkedBudget.category}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#666]">—</span>
                      )}
                    </td>
                    <td className="p-3.5 uppercase font-medium text-[10px]">
                      {isTransfer ? (
                        <span className="text-blue-400">TRANSFER</span>
                      ) : (
                        <span className={t.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}>{t.type}</span>
                      )}
                    </td>
                    <td className="p-3.5 text-[#9b9b9b]">{t.date}</td>
                    <td className={`p-3.5 text-right font-bold ${isTransfer ? 'text-blue-300' : t.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isTransfer ? '' : t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toFixed(2)}
                    </td>
                    <td className="p-3.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => onOpenEditTx(t)}
                          className="text-[#888] hover:text-blue-400 p-1.5 rounded hover:bg-[#333] transition"
                          title="Edit transaction"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteTx(t.id)}
                          className="text-[#888] hover:text-rose-400 p-1.5 rounded hover:bg-[#333] transition"
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
