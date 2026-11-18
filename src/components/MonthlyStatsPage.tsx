import React from 'react';

interface MonthlyStatsPageProps {
  statsQuarterFilter: 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
  setStatsQuarterFilter: (q: 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4') => void;
  filteredMonthsStats: any[];
  currencySymbol: string;
}

export default function MonthlyStatsPage({
  statsQuarterFilter,
  setStatsQuarterFilter,
  filteredMonthsStats,
  currencySymbol
}: MonthlyStatsPageProps) {
  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      <div className="flex flex-wrap items-center gap-2">
        {(['All', 'Q1', 'Q2', 'Q3', 'Q4'] as const).map(q => (
          <button
            key={q}
            onClick={() => setStatsQuarterFilter(q)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${statsQuarterFilter === q ? 'bg-[#2d2d2d] text-white border border-[#444]' : 'bg-[#202020] text-[#9b9b9b] border border-[#2a2a2a] hover:text-white'}`}
          >
            {q}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredMonthsStats.map(m => {
          const mIncome = m.income || 0;
          const mExpense = m.expense || 0;
          const mCashflow = m.cashflow || 0;
          const ratio = m.ratio || 0;

          return (
            <div
              key={m.key}
              className={`bg-[#202020] rounded-2xl p-4 space-y-3 shadow-sm flex flex-col justify-between transition ${
                m.isCurrentMonth
                  ? 'border-2 border-emerald-500/50 shadow-emerald-950/20 shadow-md ring-1 ring-emerald-500/20'
                  : 'border border-[#2a2a2a]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between border-b border-[#282828] pb-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white text-sm">{m.name}</span>
                    {m.isCurrentMonth && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Current Month"></span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {m.isCurrentMonth && (
                      <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800/80 px-1.5 py-0.5 rounded font-medium">
                        Latest
                      </span>
                    )}
                    <span className="text-[10px] bg-[#282828] text-zinc-400 px-2 py-0.5 rounded">{m.q}</span>
                  </div>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#9b9b9b]">Income:</span>
                    <span className="text-emerald-400 font-medium">
                      {currencySymbol}{mIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9b9b9b]">Expense:</span>
                    <span className="text-rose-400 font-medium">
                      {currencySymbol}{mExpense.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9b9b9b]">Cashflow:</span>
                    <span className={`font-semibold ${mCashflow >= 0 ? 'text-white' : 'text-rose-400'}`}>
                      {currencySymbol}{mCashflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-1 pt-2">
                <div className="w-full bg-[#191919] h-2 rounded-full overflow-hidden border border-[#2a2a2a]">
                  <div
                    className="bg-emerald-400 h-full rounded-full transition-all duration-500"
                    style={{ width: `${ratio}%` }}
                  ></div>
                </div>
                <div className="text-[10px] text-[#777] text-right">{ratio}% expense ratio</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
