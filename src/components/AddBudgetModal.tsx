import React, { useState } from 'react';
import { X, Wallet, Building2, CreditCard, Landmark, Plus, Trash2 } from 'lucide-react';
import { BudgetItem } from './BudgetsPage';
import {
  LoanQuota,
  LoanCalcMethod,
  LoanRatePeriod,
  calculateCreditCardMonthlyLimit,
  generateLoanQuotasSchedule
} from '../utils/financeMath';

interface AddBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableCategories: string[];
  currencySymbol: string;
  colors?: string[];
  onSave: (data: {
    category: string;
    description: string;
    accountType: 'standard' | 'credit_card' | 'loan' | 'bank_account' | 'debit_account';
    limit: number;
    creditLimit?: number;
    actualUsedAmount?: number;
    accountBalance?: number;
    apr?: number;
    overdraftPercentage?: number;
    loanTermMonths?: number;
    loanStartDate?: string;
    loanCalcMethod?: LoanCalcMethod;
    loanRatePeriod?: LoanRatePeriod;
    loanQuotas?: LoanQuota[];
    items?: BudgetItem[];
    extraExpenses?: number;
    color: string;
  }) => Promise<void>;
}

const DEFAULT_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e', '#6366f1'];

export default function AddBudgetModal({
  isOpen,
  onClose,
  availableCategories,
  currencySymbol,
  colors = DEFAULT_COLORS,
  onSave
}: AddBudgetModalProps) {
  const [accountType, setAccountType] = useState<'standard' | 'credit_card' | 'loan' | 'bank_account' | 'debit_account'>('standard');
  const [category, setCategory] = useState(availableCategories[0] || 'Groceries');
  const [description, setDescription] = useState('');
  const [limit, setLimit] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [accountBalance, setAccountBalance] = useState('');
  const [apr, setApr] = useState('');
  const [overdraftPercentage, setOverdraftPercentage] = useState('');
  const [loanTermMonths, setLoanTermMonths] = useState('12');
  const [loanStartDate, setLoanStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [loanCalcMethod, setLoanCalcMethod] = useState<LoanCalcMethod>('amortized');
  const [loanRatePeriod, setLoanRatePeriod] = useState<LoanRatePeriod>('annual');
  const [customMonthlyQuota, setCustomMonthlyQuota] = useState('');
  const [loanQuotas, setLoanQuotas] = useState<LoanQuota[]>([]);
  const [extraExpenses, setExtraExpenses] = useState('');
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [itemName, setItemName] = useState('');
  const [itemAmount, setItemAmount] = useState('');
  const [color, setColor] = useState(colors[0] || '#10b981');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleAddNewItem = () => {
    if (!itemName.trim() || !itemAmount) return;
    const amt = parseFloat(itemAmount);
    if (isNaN(amt) || amt <= 0) return;
    setItems(prev => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: itemName.trim(),
        amount: amt,
        isPaid: false
      }
    ]);
    setItemName('');
    setItemAmount('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category.trim()) return;

    let computedLimit = parseFloat(limit) || 0;
    let computedCreditLimit: number | undefined;
    let computedApr: number | undefined;
    let computedOverdraft: number | undefined;
    let computedAccountBalance: number | undefined;
    let computedLoanTerm: number | undefined;
    let computedLoanQuotas: LoanQuota[] | undefined;

    if (accountType === 'credit_card') {
      const baseCredit = parseFloat(creditLimit) || 0;
      const overPct = parseFloat(overdraftPercentage) || 0;
      const cc = calculateCreditCardMonthlyLimit(baseCredit, overPct);
      computedLimit = cc.monthlyLimit;
      computedCreditLimit = baseCredit;
      computedOverdraft = overPct;
      computedApr = apr ? parseFloat(apr) : undefined;
    } else if (accountType === 'loan') {
      const principal = Math.max(0, parseFloat(creditLimit) || 0);
      const parsedApr = Math.max(0, parseFloat(apr) || 0);
      const term = Math.min(600, Math.max(1, Math.floor(parseFloat(loanTermMonths) || 12)));
      const customQuota = Math.max(0, parseFloat(customMonthlyQuota) || 0);

      const generated = generateLoanQuotasSchedule({
        principal,
        annualApr: parsedApr,
        termMonths: term,
        startDate: loanStartDate || new Date().toISOString().split('T')[0],
        ratePeriod: loanRatePeriod,
        calcMethod: loanCalcMethod,
        customMonthlyQuota: customQuota > 0 ? customQuota : undefined
      });

      computedLimit = customQuota > 0 ? customQuota : generated.monthlyQuota;
      computedCreditLimit = principal;
      computedApr = parsedApr;
      computedLoanTerm = term;
      computedLoanQuotas = loanQuotas.length > 0 ? loanQuotas : generated.quotas;
    } else if (accountType === 'bank_account' || accountType === 'debit_account') {
      computedAccountBalance = parseFloat(accountBalance) || 0;
      computedLimit = limit ? parseFloat(limit) || 0 : 0;
      computedApr = accountType === 'bank_account' && apr ? parseFloat(apr) : undefined;
    } else {
      // Standard
      const itemsSum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
      const extra = parseFloat(extraExpenses) || 0;
      if (items.length > 0 || extra > 0) {
        computedLimit = itemsSum + extra;
      }
    }

    setIsSubmitting(true);
    try {
      await onSave({
        category: category.trim(),
        description: description.trim(),
        accountType,
        limit: computedLimit,
        creditLimit: computedCreditLimit,
        actualUsedAmount:
          accountType === 'loan'
            ? computedCreditLimit || 0
            : accountType === 'credit_card'
            ? 0
            : undefined,
        accountBalance: computedAccountBalance,
        apr: computedApr,
        overdraftPercentage: computedOverdraft,
        loanTermMonths: computedLoanTerm,
        loanStartDate: accountType === 'loan' ? loanStartDate : undefined,
        loanCalcMethod: accountType === 'loan' ? loanCalcMethod : undefined,
        loanRatePeriod: accountType === 'loan' ? loanRatePeriod : undefined,
        loanQuotas: computedLoanQuotas,
        items: accountType === 'standard' ? items : undefined,
        extraExpenses: accountType === 'standard' && extraExpenses ? parseFloat(extraExpenses) : undefined,
        color
      });
      onClose();
    } catch (err) {
      console.error('Failed to create budget:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#1D1D1F] dark:text-[#F5F5F7]">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white">Create Budget / Account</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Account Type Switcher */}
          <div>
            <label className="text-[11px] font-medium text-[#86868B] block mb-1.5">Account / Budget Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              <button
                type="button"
                onClick={() => setAccountType('standard')}
                className={`flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-medium border transition ${
                  accountType === 'standard'
                    ? 'bg-emerald-500/15 text-[#248A3D] dark:text-emerald-300 border-emerald-500/40'
                    : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#86868B] dark:text-zinc-400 border-black/[0.04] dark:border-white/5 hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                <Wallet className="w-3.5 h-3.5 shrink-0" /> Standard
              </button>
              <button
                type="button"
                onClick={() => setAccountType('bank_account')}
                className={`flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-medium border transition ${
                  accountType === 'bank_account'
                    ? 'bg-sky-500/15 text-[#0071E3] dark:text-sky-300 border-sky-500/40'
                    : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#86868B] dark:text-zinc-400 border-black/[0.04] dark:border-white/5 hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                <Building2 className="w-3.5 h-3.5 shrink-0" /> Bank
              </button>
              <button
                type="button"
                onClick={() => setAccountType('debit_account')}
                className={`flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-medium border transition ${
                  accountType === 'debit_account'
                    ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/40'
                    : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#86868B] dark:text-zinc-400 border-black/[0.04] dark:border-white/5 hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                <Wallet className="w-3.5 h-3.5 shrink-0" /> Debit
              </button>
              <button
                type="button"
                onClick={() => setAccountType('credit_card')}
                className={`flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-medium border transition ${
                  accountType === 'credit_card'
                    ? 'bg-amber-500/15 text-[#B25000] dark:text-amber-300 border-amber-500/40'
                    : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#86868B] dark:text-zinc-400 border-black/[0.04] dark:border-white/5 hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5 shrink-0" /> Credit
              </button>
              <button
                type="button"
                onClick={() => setAccountType('loan')}
                className={`flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-medium border transition col-span-2 sm:col-span-1 ${
                  accountType === 'loan'
                    ? 'bg-purple-500/15 text-[#8944AB] dark:text-purple-300 border-purple-500/40'
                    : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#86868B] dark:text-zinc-400 border-black/[0.04] dark:border-white/5 hover:text-[#1D1D1F] dark:hover:text-white'
                }`}
              >
                <Landmark className="w-3.5 h-3.5 shrink-0" /> Loan
              </button>
            </div>
          </div>

          {/* Budget Name / Category */}
          <div>
            <label className="text-[11px] font-medium text-[#86868B] block mb-1">Budget Name / Category *</label>
            <input
              type="text"
              required
              maxLength={50}
              placeholder="e.g. Prestamo Banreservas, Visa Popular, Groceries..."
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3]"
            />
            <div className="flex items-center gap-1.5 overflow-x-auto py-1.5 scrollbar-thin">
              <span className="text-[10px] text-[#86868B] shrink-0">Quick pick:</span>
              {availableCategories.slice(0, 8).map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 transition ${
                    category.toLowerCase() === c.toLowerCase()
                      ? 'bg-[#0071E3] text-white'
                      : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-zinc-300 hover:bg-[#E5E5EA] dark:hover:bg-white/15'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] font-medium text-[#86868B] block mb-1">Description (Optional)</label>
            <textarea
              rows={2}
              maxLength={500}
              placeholder="Describe what belongs to this budget, due dates, terms..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          {/* Credit Card Terms */}
          {accountType === 'credit_card' && (() => {
            const cc = calculateCreditCardMonthlyLimit(
              parseFloat(creditLimit) || 0,
              parseFloat(overdraftPercentage) || 0
            );
            return (
              <div className="space-y-3">
                <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.04] dark:border-white/5 p-3.5 rounded-2xl space-y-3">
                  <div className="text-xs font-semibold text-[#B25000] dark:text-amber-400 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" /> Credit Card Terms
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[11px] text-[#86868B] block mb-1">Credit Limit ({currencySymbol}) *</label>
                      <input
                        type="number"
                        required
                        step="0.01"
                        min="0.01"
                        placeholder="50000"
                        value={creditLimit}
                        onChange={e => setCreditLimit(e.target.value)}
                        className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#86868B] block mb-1">Overdraft %</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 10"
                        value={overdraftPercentage}
                        onChange={e => setOverdraftPercentage(e.target.value)}
                        className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#86868B] block mb-1">APR (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 24.9"
                        value={apr}
                        onChange={e => setApr(e.target.value)}
                        className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[#B25000] dark:text-amber-300 font-semibold block">Calculated Monthly Limit</span>
                    <span className="text-[10px] text-[#B25000]/80 dark:text-amber-400/80 tabular-nums">
                      Credit Limit ({currencySymbol}{cc.baseCreditLimit.toLocaleString()}) + {cc.overdraftPct}% Overdraft
                    </span>
                  </div>
                  <span className="text-base font-bold text-[#1D1D1F] dark:text-white tabular-nums">
                    {currencySymbol}{cc.monthlyLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Loan Account Terms */}
          {accountType === 'loan' && (() => {
            const principal = Math.max(0, parseFloat(creditLimit) || 0);
            const parsedApr = Math.max(0, parseFloat(apr) || 0);
            const term = Math.min(600, Math.max(1, Math.floor(parseFloat(loanTermMonths) || 12)));
            const customQuota = Math.max(0, parseFloat(customMonthlyQuota) || 0);
            const previewSchedule = generateLoanQuotasSchedule({
              principal,
              annualApr: parsedApr,
              termMonths: term,
              startDate: loanStartDate || new Date().toISOString().split('T')[0],
              ratePeriod: loanRatePeriod,
              calcMethod: loanCalcMethod,
              customMonthlyQuota: customQuota > 0 ? customQuota : undefined
            });
            const displayQuotas = loanQuotas.length > 0 ? loanQuotas : previewSchedule.quotas;

            return (
              <div className="space-y-3">
                <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.04] dark:border-white/5 p-3.5 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#8944AB] dark:text-purple-400 flex items-center gap-1.5">
                      <Landmark className="w-3.5 h-3.5" /> Loan Terms & Quotas
                    </span>
                    {principal > 0 && (
                      <button
                        type="button"
                        onClick={() => setLoanQuotas(previewSchedule.quotas)}
                        className="text-[10px] bg-purple-500/15 hover:bg-purple-500/25 text-[#8944AB] dark:text-purple-300 border border-purple-500/30 px-2.5 py-1 rounded-full transition"
                      >
                        Generate {term} Quotas
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-[#86868B] block mb-1">Rate Period</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setLoanRatePeriod('annual');
                            setLoanQuotas([]);
                          }}
                          className={`py-1.5 px-2 rounded-xl text-[11px] font-medium border transition ${
                            loanRatePeriod === 'annual'
                              ? 'bg-purple-500/15 text-[#8944AB] dark:text-purple-300 border-purple-500/40'
                              : 'bg-white dark:bg-[#1C1C1E] text-[#86868B] dark:text-zinc-400 border-black/[0.08] dark:border-white/10 hover:text-[#1D1D1F] dark:hover:text-white'
                          }`}
                        >
                          Annual (APR %)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLoanRatePeriod('monthly');
                            setLoanQuotas([]);
                          }}
                          className={`py-1.5 px-2 rounded-xl text-[11px] font-medium border transition ${
                            loanRatePeriod === 'monthly'
                              ? 'bg-purple-500/15 text-[#8944AB] dark:text-purple-300 border-purple-500/40'
                              : 'bg-white dark:bg-[#1C1C1E] text-[#86868B] dark:text-zinc-400 border-black/[0.08] dark:border-white/10 hover:text-[#1D1D1F] dark:hover:text-white'
                          }`}
                        >
                          Monthly (%)
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-[#86868B] block mb-1">Method</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setLoanCalcMethod('amortized');
                            setLoanQuotas([]);
                          }}
                          className={`py-1.5 px-2 rounded-xl text-[11px] font-medium border transition ${
                            loanCalcMethod === 'amortized'
                              ? 'bg-purple-500/15 text-[#8944AB] dark:text-purple-300 border-purple-500/40'
                              : 'bg-white dark:bg-[#1C1C1E] text-[#86868B] dark:text-zinc-400 border-black/[0.08] dark:border-white/10 hover:text-[#1D1D1F] dark:hover:text-white'
                          }`}
                        >
                          Amortized
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLoanCalcMethod('flat');
                            setLoanQuotas([]);
                          }}
                          className={`py-1.5 px-2 rounded-xl text-[11px] font-medium border transition ${
                            loanCalcMethod === 'flat'
                              ? 'bg-purple-500/15 text-[#8944AB] dark:text-purple-300 border-purple-500/40'
                              : 'bg-white dark:bg-[#1C1C1E] text-[#86868B] dark:text-zinc-400 border-black/[0.08] dark:border-white/10 hover:text-[#1D1D1F] dark:hover:text-white'
                          }`}
                        >
                          Flat Interest
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] text-[#86868B] block mb-1">Principal ({currencySymbol}) *</label>
                      <input
                        type="number"
                        required
                        step="0.01"
                        min="0.01"
                        placeholder="150000"
                        value={creditLimit}
                        onChange={e => {
                          setCreditLimit(e.target.value);
                          setLoanQuotas([]);
                        }}
                        className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#86868B] block mb-1">
                        {loanRatePeriod === 'monthly' ? 'Monthly Rate (%)' : 'Interest Rate (APR %)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder={loanRatePeriod === 'monthly' ? 'e.g. 1.5' : 'e.g. 18'}
                        value={apr}
                        onChange={e => {
                          setApr(e.target.value);
                          setLoanQuotas([]);
                        }}
                        className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#86868B] block mb-1">Term (Months)</label>
                      <input
                        type="number"
                        min="1"
                        max="600"
                        value={loanTermMonths}
                        onChange={e => {
                          setLoanTermMonths(e.target.value);
                          setLoanQuotas([]);
                        }}
                        className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#86868B] block mb-1">Start / Due Date</label>
                      <input
                        type="date"
                        value={loanStartDate}
                        onChange={e => {
                          setLoanStartDate(e.target.value);
                          setLoanQuotas([]);
                        }}
                        className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>

                  {displayQuotas.length > 0 && (
                    <div className="space-y-1 max-h-32 overflow-y-auto pr-1 pt-1 border-t border-black/[0.06] dark:border-white/10">
                      <span className="text-[10px] text-[#86868B] block mb-1">
                        Monthly Quotas Preview ({displayQuotas.length} quotas):
                      </span>
                      {displayQuotas.slice(0, 10).map(q => (
                        <div key={q.id} className="flex items-center justify-between text-[11px] bg-white dark:bg-[#1C1C1E] px-2.5 py-1 rounded-lg tabular-nums">
                          <span className="text-[#424245] dark:text-zinc-300">#{q.quotaNumber} • {q.dueDate}</span>
                          <span className="font-semibold text-[#1D1D1F] dark:text-white">{currencySymbol}{q.amount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {principal > 0 && (
                  <div className="bg-purple-500/10 border border-purple-500/30 rounded-2xl p-3 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[#8944AB] dark:text-purple-300 font-semibold block">Monthly Quota Payment</span>
                      <span className="text-[10px] text-[#8944AB]/80 dark:text-purple-300/80 tabular-nums">
                        Total Interest: {currencySymbol}{previewSchedule.totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <span className="text-base font-bold text-[#1D1D1F] dark:text-white tabular-nums">
                      {currencySymbol}{(customQuota > 0 ? customQuota : previewSchedule.monthlyQuota).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Bank / Debit Account Details */}
          {(accountType === 'bank_account' || accountType === 'debit_account') && (
            <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.04] dark:border-white/5 p-3.5 rounded-2xl space-y-3">
              <div className={`text-xs font-semibold flex items-center gap-1.5 ${accountType === 'bank_account' ? 'text-[#0071E3] dark:text-sky-400' : 'text-teal-700 dark:text-teal-400'}`}>
                {accountType === 'bank_account' ? <Building2 className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />}
                {accountType === 'bank_account' ? 'Bank Account Details' : 'Debit Account Details'}
              </div>
              <div className={`grid grid-cols-1 ${accountType === 'bank_account' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2.5`}>
                <div>
                  <label className="text-[11px] text-[#86868B] block mb-1">Opening Balance ({currencySymbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={accountBalance}
                    onChange={e => setAccountBalance(e.target.value)}
                    className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#86868B] block mb-1">Monthly Spend Limit ({currencySymbol}, opt.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0 (No limit)"
                    value={limit}
                    onChange={e => setLimit(e.target.value)}
                    className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                  />
                </div>
                {accountType === 'bank_account' && (
                  <div>
                    <label className="text-[11px] text-[#86868B] block mb-1">Interest APY (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 3.5"
                      value={apr}
                      onChange={e => setApr(e.target.value)}
                      className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Belonging Items Checklist (Standard only) */}
          {accountType === 'standard' && (
            <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.04] dark:border-white/5 p-3.5 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#1D1D1F] dark:text-white">Items Belonging to This Budget</span>
                <span className="text-[10px] text-[#86868B]">Auto-calculates limit</span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Supermercado, Luz"
                  value={itemName}
                  onChange={e => setItemName(e.target.value)}
                  className="flex-1 bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3]"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={`Amount (${currencySymbol})`}
                  value={itemAmount}
                  onChange={e => setItemAmount(e.target.value)}
                  className="w-28 bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                />
                <button
                  type="button"
                  onClick={handleAddNewItem}
                  className="bg-[#34C759] hover:bg-emerald-500 text-white dark:text-black px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>

              {items.length > 0 && (
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {items.map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-2 bg-white dark:bg-[#1C1C1E] px-2.5 py-1.5 rounded-xl text-xs">
                      <span className="text-[#1D1D1F] dark:text-zinc-200 truncate flex-1">{item.name}</span>
                      <span className="text-[#1D1D1F] dark:text-white font-semibold shrink-0 tabular-nums">
                        {currencySymbol}{Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <button
                        type="button"
                        onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                        className="text-[#86868B] hover:text-[#FF3B30]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="text-[11px] text-[#86868B] block mb-1">Other Extra Expenses ({currencySymbol})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={extraExpenses}
                  onChange={e => setExtraExpenses(e.target.value)}
                  className="w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-1.5 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                />
              </div>
            </div>
          )}

          {/* Standard Monthly Limit display or manual input */}
          {accountType === 'standard' && (() => {
            const itemsSum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
            const extra = parseFloat(extraExpenses) || 0;
            const hasChecklist = items.length > 0 || extra > 0;
            const totalCalculated = itemsSum + extra;

            if (hasChecklist) {
              return (
                <div className="bg-[#34C759]/10 border border-[#34C759]/30 rounded-2xl p-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[#248A3D] dark:text-[#34C759] font-semibold block">Calculated Monthly Limit</span>
                    <span className="text-[10px] text-[#248A3D]/80 dark:text-emerald-400/80 tabular-nums">
                      Items ({currencySymbol}{itemsSum.toLocaleString()}) + Extra ({currencySymbol}{extra.toLocaleString()})
                    </span>
                  </div>
                  <span className="text-base font-bold text-[#1D1D1F] dark:text-white tabular-nums">
                    {currencySymbol}{totalCalculated.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              );
            }

            return (
              <div>
                <label className="text-[11px] font-medium text-[#86868B] block mb-1">Monthly Limit ({currencySymbol}) *</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0.01"
                  placeholder="500"
                  value={limit}
                  onChange={e => setLimit(e.target.value)}
                  className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                />
              </div>
            );
          })()}

          {/* Bar Color */}
          <div>
            <label className="text-[11px] font-medium text-[#86868B] block mb-1">Color Theme</label>
            <div className="flex items-center gap-2">
              {colors.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-5 h-5 rounded-full transition-transform ${
                    color === c ? 'scale-125 ring-2 ring-[#1D1D1F] dark:ring-white' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
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
              {isSubmitting ? 'Saving...' : 'Save Budget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
