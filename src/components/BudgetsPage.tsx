import React from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  CreditCard,
  Landmark,
  Wallet,
  CheckSquare,
  Square,
  Percent,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';

export interface BudgetItem {
  id: string;
  name: string;
  amount: number;
  isPaid: boolean;
}

export interface Budget {
  id: string;
  userId: string;
  name: string;
  category: string;
  description?: string;
  limit: number;
  color: string;
  accountType?: 'standard' | 'credit_card' | 'loan';
  apr?: number;
  creditLimit?: number;
  overdraftPercentage?: number;
  actualUsedAmount?: number;
  extraExpenses?: number;
  items?: BudgetItem[];
}

interface BudgetsPageProps {
  budgets: Budget[];
  transactions: any[];
  currencySymbol?: string;
  onOpenAddBudget: () => void;
  onOpenEditBudget: (budget: Budget) => void;
  onDeleteBudget: (id: string) => void;
  onToggleItemPaid: (budgetId: string, itemId: string) => void;
  onOpenRecordPayment?: (budget: Budget) => void;
}

export default function BudgetsPage({
  budgets,
  transactions,
  currencySymbol = '$',
  onOpenAddBudget,
  onOpenEditBudget,
  onDeleteBudget,
  onToggleItemPaid,
  onOpenRecordPayment
}: BudgetsPageProps) {
  // Aggregate debt metrics
  const debtAccounts = budgets.filter(b => b.accountType === 'credit_card' || b.accountType === 'loan');
  const totalDebtBalance = debtAccounts.reduce((s, b) => s + (b.actualUsedAmount || 0), 0);
  const totalDebtLimit = debtAccounts.reduce((s, b) => s + (b.creditLimit || b.limit || 0), 0);

  return (
    <div className="space-y-6 animate-fadeIn max-w-5xl pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Category Budgets & Debt Accounts</h2>
          <p className="text-xs text-[#9b9b9b] mt-0.5">
            Manage spending limits, itemized checklists, credit cards, and loans with APR & overdraft tracking.
          </p>
        </div>
        <button
          onClick={onOpenAddBudget}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" /> Set New Budget / Account
        </button>
      </div>

      {/* Debt & Credit Overview Cards (if any credit cards or loans exist) */}
      {debtAccounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[#202020] border border-[#282828] p-4 rounded-xl shadow-sm">
            <span className="text-[11px] text-[#888] font-medium block">Total Debt / Credit Balance</span>
            <span className="text-lg font-bold text-rose-400 block mt-1">
              {currencySymbol}{totalDebtBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-[#666]">Across {debtAccounts.length} credit lines & loans</span>
          </div>
          <div className="bg-[#202020] border border-[#282828] p-4 rounded-xl shadow-sm">
            <span className="text-[11px] text-[#888] font-medium block">Total Approved Credit Lines</span>
            <span className="text-lg font-bold text-white block mt-1">
              {currencySymbol}{totalDebtLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-[#666]">Maximum borrowing capacity</span>
          </div>
          <div className="bg-[#202020] border border-[#282828] p-4 rounded-xl shadow-sm">
            <span className="text-[11px] text-[#888] font-medium block">Available Credit</span>
            <span className="text-lg font-bold text-emerald-400 block mt-1">
              {currencySymbol}{Math.max(0, totalDebtLimit - totalDebtBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-[#666]">
              {totalDebtLimit > 0 ? `${Math.round(((totalDebtLimit - totalDebtBalance) / totalDebtLimit) * 100)}% available` : '0%'}
            </span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {budgets.length === 0 ? (
        <div className="bg-[#202020] border border-[#282828] rounded-2xl p-12 text-center text-xs text-[#777] space-y-3">
          <p>No budgets or debt accounts configured in database yet.</p>
          <button onClick={onOpenAddBudget} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl font-medium">
            Create First Budget
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {budgets.map(b => {
            const budgetCatName = (b.name || b.category || '').trim();
            const spent = transactions
              .filter(t => t.type === 'expense' && (t.category || '').trim().toLowerCase() === budgetCatName.toLowerCase())
              .reduce((sum, t) => sum + t.amount, 0);
            const percent = b.limit > 0 ? Math.min(Math.round((spent / b.limit) * 100), 100) : 0;
            const isOver = spent > b.limit;
            const isCreditOrLoan = b.accountType === 'credit_card' || b.accountType === 'loan';
            
            // Checklist items calculations
            const items = b.items || [];
            const paidItemsCount = items.filter(i => i.isPaid).length;
            const itemsSum = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
            const extraExpenses = Number(b.extraExpenses) || 0;

            // Credit/Loan utilization
            const creditLimit = Number(b.creditLimit || b.limit) || 0;
            const usedBalance = Number(b.actualUsedAmount) || 0;
            const availableCredit = Math.max(0, creditLimit - usedBalance);
            const utilizationPct = creditLimit > 0 ? Math.min(Math.round((usedBalance / creditLimit) * 100), 100) : 0;
            const overdraftBuffer = b.overdraftPercentage ? (creditLimit * (b.overdraftPercentage / 100)) : 0;

            // Related payments
            const relatedPayments = transactions.filter(
              t => (t.budgetId === b.id || (t.category || '').toLowerCase() === budgetCatName.toLowerCase()) && t.isLoanPayment
            );
            const totalPaymentsMade = relatedPayments.reduce((s, t) => s + t.amount, 0);

            return (
              <div
                key={b.id}
                className="bg-[#202020] border border-[#282828] p-5 rounded-2xl space-y-4 shadow-sm hover:border-[#333] transition"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 truncate">
                    <div className="w-9 h-9 rounded-xl bg-[#191919] border border-[#2c2c2c] flex items-center justify-center shrink-0 mt-0.5">
                      {b.accountType === 'credit_card' ? (
                        <CreditCard className="w-4 h-4 text-amber-400" />
                      ) : b.accountType === 'loan' ? (
                        <Landmark className="w-4 h-4 text-purple-400" />
                      ) : (
                        <Wallet className="w-4 h-4 text-emerald-400" />
                      )}
                    </div>
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm truncate">{budgetCatName}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                          b.accountType === 'credit_card'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : b.accountType === 'loan'
                            ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {b.accountType === 'credit_card' ? 'Credit Card' : b.accountType === 'loan' ? 'Loan' : 'Standard'}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#777] block mt-0.5">Category: {b.category || budgetCatName}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isCreditOrLoan && onOpenRecordPayment && (
                      <button
                        onClick={() => onOpenRecordPayment(b)}
                        className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium transition"
                        title="Make a Payment or Abono to this account"
                      >
                        Payment
                      </button>
                    )}
                    <button
                      onClick={() => onOpenEditBudget(b)}
                      className="px-2 py-1 bg-[#282828] hover:bg-[#333] rounded-lg text-xs text-zinc-300 hover:text-white transition flex items-center gap-1"
                      title="Edit Budget Limit"
                    >
                      <Pencil className="w-3.5 h-3.5 text-blue-400" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => onDeleteBudget(b.id)}
                      className="p-1.5 hover:bg-[#333] rounded-lg text-[#888] hover:text-rose-400 transition"
                      title="Delete Budget"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Description (if provided) */}
                {b.description && (
                  <p className="text-xs text-zinc-300 bg-[#191919] p-2.5 rounded-lg border border-[#2a2a2a] leading-relaxed">
                    {b.description}
                  </p>
                )}

                {/* Credit Card / Loan Specifics: APR, Limit, Overdraft, Used Balance */}
                {isCreditOrLoan && (
                  <div className="space-y-2.5 bg-[#171717] p-3 rounded-xl border border-[#262626]">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="bg-[#1f1f1f] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-[#888] block">APR</span>
                        <span className="text-xs font-bold text-amber-400 block mt-0.5">{b.apr || 0}%</span>
                      </div>
                      <div className="bg-[#1f1f1f] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-[#888] block">Credit Limit</span>
                        <span className="text-xs font-bold text-white block mt-0.5">{currencySymbol}{creditLimit.toLocaleString()}</span>
                      </div>
                      <div className="bg-[#1f1f1f] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-[#888] block">Used Balance</span>
                        <span className="text-xs font-bold text-rose-400 block mt-0.5">{currencySymbol}{usedBalance.toLocaleString()}</span>
                      </div>
                      <div className="bg-[#1f1f1f] p-2 rounded-lg text-center">
                        <span className="text-[10px] text-[#888] block">Overdraft %</span>
                        <span className="text-xs font-bold text-blue-400 block mt-0.5">
                          {b.overdraftPercentage || 0}% {overdraftBuffer > 0 ? `(+${currencySymbol}${overdraftBuffer.toLocaleString()})` : ''}
                        </span>
                      </div>
                    </div>

                    {/* Credit Utilization Bar */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[11px] text-[#888]">
                        <span>Credit Line Utilization: {utilizationPct}%</span>
                        <span className="text-emerald-400 font-medium">Available: {currencySymbol}{availableCredit.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-[#121212] h-2 rounded-full overflow-hidden border border-[#292929]">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${utilizationPct}%`,
                            backgroundColor: utilizationPct > 80 ? '#f43f5e' : (b.color || '#f59e0b')
                          }}
                        />
                      </div>
                    </div>

                    {totalPaymentsMade > 0 && (
                      <div className="text-[11px] text-emerald-400 pt-1 flex items-center justify-between">
                        <span>Total Payments / Abonos recorded:</span>
                        <span className="font-semibold">{currencySymbol}{totalPaymentsMade.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Monthly Spending Limit & Progress */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-[#9b9b9b]">
                    <span>Current Month Spent: {currencySymbol}{spent.toFixed(2)}</span>
                    <span className={isOver ? 'text-rose-400 font-bold' : 'text-white'}>
                      Limit: {currencySymbol}{b.limit.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full bg-[#191919] h-2 rounded-full overflow-hidden border border-[#2d2d2d]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${percent}%`,
                        backgroundColor: isOver ? '#f43f5e' : (b.color || '#10b981')
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-[#777]">
                    <span>{percent}% of monthly limit used</span>
                    {isOver && <span className="text-rose-400 font-semibold">Over budget!</span>}
                  </div>
                </div>

                {/* Items Belonging to This Budget (Checklist matching user attachment!) */}
                {items.length > 0 && (
                  <div className="space-y-2 bg-[#171717] p-3 rounded-xl border border-[#262626]">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-white">
                        Belonging Items ({paidItemsCount}/{items.length} Paid)
                      </span>
                      <span className="text-[10px] text-[#888]">
                        Items Sum: {currencySymbol}{itemsSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="space-y-1 pt-1 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                      {items.map(item => (
                        <div
                          key={item.id}
                          onClick={() => onToggleItemPaid(b.id, item.id)}
                          className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-[#222] cursor-pointer group transition select-none"
                        >
                          {item.isPaid ? (
                            <CheckSquare className="w-4 h-4 text-blue-500 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-[#666] group-hover:text-zinc-300 shrink-0" />
                          )}
                          <span className={`text-xs flex-1 transition ${item.isPaid ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>
                            {item.name}
                          </span>
                          <span className={`text-xs font-semibold shrink-0 transition ${item.isPaid ? 'line-through text-zinc-500' : 'text-white'}`}>
                            {currencySymbol}{Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                    </div>

                    {extraExpenses > 0 && (
                      <div className="flex justify-between items-center text-[11px] text-[#888] pt-2 border-t border-[#262626] px-1">
                        <span>+ Other Extra Expenses Buffer:</span>
                        <span className="font-semibold text-zinc-300">
                          {currencySymbol}{extraExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-[11px] text-[#aaa] pt-1.5 border-t border-[#242424] px-1 font-medium">
                      <span>Total of all (Calculated Limit):</span>
                      <span className="font-bold text-white">
                        {currencySymbol}{(itemsSum + extraExpenses).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
