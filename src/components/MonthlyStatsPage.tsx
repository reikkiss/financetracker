import React from 'react';
import { Calendar, CheckCircle2, TrendingUp, TrendingDown } from 'lucide-react';

interface MonthlyStatsPageProps {
  statsQuarterFilter: 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
  setStatsQuarterFilter: (q: 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4') => void;
  filteredMonthsStats: any[];
  currencySymbol: string;
  selectedMonth?: string;
  onSelectMonth?: (month: string) => void;
}

export default function MonthlyStatsPage({
  statsQuarterFilter,
  setStatsQuarterFilter,
  filteredMonthsStats,
  currencySymbol,
  selectedMonth,
  onSelectMonth
}: MonthlyStatsPageProps) {
  return (
    <div
      className="space-y-6 max-w-7xl mx-auto pb-12"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif'
      }}
    >
      {/* Header & Segmented Quarter Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[12px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block">
            HISTORICAL OVERVIEW
          </span>
          <h2 className="text-2xl font-bold tracking-tight text-white">Monthly Financial Summaries</h2>
        </div>

        {/* Apple Segmented Pill */}
        <div className="flex p-1 bg-[#2C2C2E] rounded-full border border-white/5 self-start sm:self-center">
          {(['All', 'Q1', 'Q2', 'Q3', 'Q4'] as const).map(q => (
            <button
              key={q}
              onClick={() => setStatsQuarterFilter(q)}
              className={`py-1.5 px-3.5 rounded-full text-xs font-semibold transition ${
                statsQuarterFilter === q
                  ? 'bg-[#0071E3] text-white shadow-sm'
                  : 'text-[#86868B] hover:text-white'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Apple Health / Activity Style Monthly Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredMonthsStats.map(m => {
          const mIncome = m.income || 0;
          const mExpense = m.expense || 0;
          const mCashflow = m.cashflow || 0;
          const ratio = m.ratio || 0;
          const isSelected = selectedMonth === m.key;

          return (
            <div
              key={m.key}
              onClick={() => onSelectMonth && onSelectMonth(m.key)}
              className={`bg-[#1C1C1E] rounded-[22px] p-5 space-y-4 shadow-xl flex flex-col justify-between transition cursor-pointer hover:scale-[1.015] duration-300 ${
                isSelected
                  ? 'border-2 border-[#0071E3] shadow-[#0071E3]/20 ring-1 ring-[#0071E3]/30'
                  : m.isCurrentMonth
                  ? 'border border-[#34C759]/40'
                  : 'border border-white/10'
              }`}
            >
              <div>
                <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-base tracking-tight">{m.name}</span>
                    {m.isCurrentMonth && (
                      <span className="w-2 h-2 rounded-full bg-[#34C759] animate-pulse" title="Current Month" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isSelected && (
                      <span className="text-[10px] bg-[#0071E3]/20 text-[#0071E3] border border-[#0071E3]/30 px-2 py-0.5 rounded-full font-semibold">
                        Active Filter
                      </span>
                    )}
                    <span className="text-[10px] bg-white/10 text-[#86868B] px-2 py-0.5 rounded-full font-semibold">
                      {m.q}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[#86868B] flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-[#34C759]" /> Income
                    </span>
                    <span className="text-[#34C759] font-semibold tabular-nums">
                      {currencySymbol}{mIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-[#86868B] flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5 text-[#FF3B30]" /> Expense
                    </span>
                    <span className="text-zinc-200 font-semibold tabular-nums">
                      {currencySymbol}{mExpense.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="h-[0.5px] bg-white/10 my-1" />

                  <div className="flex justify-between items-center">
                    <span className="text-[#86868B] font-medium">Net Cashflow</span>
                    <span
                      className={`font-bold tabular-nums text-sm ${
                        mCashflow >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'
                      }`}
                    >
                      {mCashflow >= 0 ? '+' : ''}{currencySymbol}{mCashflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expense Ratio Progress Bar */}
              <div className="space-y-1.5 pt-2">
                <div className="w-full bg-[#2C2C2E] h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, ratio)}%`,
                      backgroundColor: ratio > 90 ? '#FF3B30' : ratio > 75 ? '#FF9F0A' : '#34C759'
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#86868B]">
                  <span>Expense Ratio</span>
                  <span className="tabular-nums font-semibold text-zinc-300">{ratio}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
