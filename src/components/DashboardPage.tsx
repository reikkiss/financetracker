import React, { useState, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Calendar,
  Filter,
  PieChart as PieIcon,
  RotateCcw,
  Tag,
  ArrowRight
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, PieChart as RechartsPie, Pie, Cell } from 'recharts';

interface Transaction {
  id: string;
  userId: string;
  title: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  date: string;
  notes?: string;
  isTransfer?: boolean;
}

interface DashboardPageProps {
  transactions: Transaction[];
  budgets?: any[];
  chartMode: 'Expense' | 'Income' | 'Cashflow';
  setChartMode: (mode: 'Expense' | 'Income' | 'Cashflow') => void;
  breakdownMode: 'Expense' | 'Income';
  setBreakdownMode: (mode: 'Expense' | 'Income') => void;
  monthlyChartData: any[];
  breakdownData: any[];
  totalIncome: number;
  totalExpense: number;
  currencySymbol: string;
  colors: string[];
  onOpenAddTx: (type: 'income' | 'expense', datePrefill?: string) => void;
  onOpenEditTx: (transaction: Transaction) => void;
  onDeleteTx: (id: string) => void;
}

function getCategoryPillStyle(category: string) {
  const cat = (category || '').toLowerCase();
  if (cat.includes('prestamo') || cat.includes('loan')) {
    return 'bg-[#4d2828] text-[#fca5a5] border border-[#6b2a2a]';
  }
  if (cat.includes('saving') || cat.includes('invest') || cat.includes('ahorro')) {
    return 'bg-[#3f3123] text-[#fcd34d] border border-[#5e4325]';
  }
  if (cat.includes('salary') || cat.includes('sueldo') || cat.includes('freelance') || cat.includes('income')) {
    return 'bg-[#243328] text-[#86efac] border border-[#235838]';
  }
  if (cat.includes('bill') || cat.includes('utilit') || cat.includes('electric')) {
    return 'bg-[#3d261e] text-[#fdba74] border border-[#5c3523]';
  }
  if (cat.includes('hous') || cat.includes('rent') || cat.includes('vivienda')) {
    return 'bg-[#1e293b] text-[#93c5fd] border border-[#334155]';
  }
  if (cat.includes('food') || cat.includes('din') || cat.includes('grocer')) {
    return 'bg-[#2e263b] text-[#d8b4fe] border border-[#483a5e]';
  }
  return 'bg-[#2d2d2d] text-zinc-300 border border-[#404040]';
}

const MONTH_NAMES = [
  { val: '01', name: 'Jan' },
  { val: '02', name: 'Feb' },
  { val: '03', name: 'Mar' },
  { val: '04', name: 'Apr' },
  { val: '05', name: 'May' },
  { val: '06', name: 'Jun' },
  { val: '07', name: 'Jul' },
  { val: '08', name: 'Aug' },
  { val: '09', name: 'Sep' },
  { val: '10', name: 'Oct' },
  { val: '11', name: 'Nov' },
  { val: '12', name: 'Dec' },
];

// Color palette matching the user's attachment:
// Top-Left: Navy Blue (#2b4c7e)
// Top-Right: Mint Seafoam (#52c5a0)
// Bottom-Left: Lavender Indigo (#6871be)
// Bottom-Right: Coral Watermelon Pink (#fa6889)
const BREAKDOWN_PALETTE = [
  '#2b4c7e',
  '#52c5a0',
  '#6871be',
  '#fa6889',
  '#f59e0b',
  '#38bdf8',
  '#10b981',
  '#a855f7',
  '#ec4899',
  '#06b6d4',
  '#eab308',
  '#64748b'
];

const BREAKDOWN_MONTHS = [
  { val: 'All', name: 'All Months' },
  { val: '01', name: 'Jan' },
  { val: '02', name: 'Feb' },
  { val: '03', name: 'Mar' },
  { val: '04', name: 'Apr' },
  { val: '05', name: 'May' },
  { val: '06', name: 'Jun' },
  { val: '07', name: 'Jul' },
  { val: '08', name: 'Aug' },
  { val: '09', name: 'Sep' },
  { val: '10', name: 'Oct' },
  { val: '11', name: 'Nov' },
  { val: '12', name: 'Dec' },
];

function CustomBreakdownTooltip({ active, payload, currencySymbol }: any) {
  if (active && payload && payload.length) {
    const data = payload[0];
    const val = Number(data.value || 0);
    const percent = data.payload?.percent !== undefined ? (data.payload.percent * 100).toFixed(1) : null;
    return (
      <div className="bg-[#1c1c1c] border border-[#333] rounded-xl p-3 shadow-2xl text-xs space-y-1 z-50 pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: data.payload?.fill || data.color }} />
          <span className="font-semibold text-white">{data.name}</span>
        </div>
        <div className="text-zinc-300">
          Amount: <span className="font-bold text-white">{currencySymbol}{val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        {percent && (
          <div className="text-[#888] text-[11px]">
            Share: {percent}% of period total
          </div>
        )}
      </div>
    );
  }
  return null;
}

function createPieLabel(currencySymbol: string) {
  return function ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
    value
  }: any) {
    if (percent < 0.05) return null;
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.52;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    let formatted = '';
    if (value >= 1000000) {
      formatted = `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      formatted = `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
    } else {
      formatted = `${Math.round(value)}`;
    }
    const prefix = currencySymbol.length <= 2 ? currencySymbol : '';

    return (
      <text
        x={x}
        y={y}
        fill="#ffffff"
        textAnchor="middle"
        dominantBaseline="central"
        className="text-[11px] font-bold pointer-events-none select-none drop-shadow-md"
        style={{ fontWeight: 700 }}
      >
        {prefix}{formatted}
      </text>
    );
  };
}

export default function DashboardPage({
  transactions,
  budgets = [],
  chartMode,
  setChartMode,
  breakdownMode,
  setBreakdownMode,
  monthlyChartData,
  breakdownData: _unusedBreakdownData,
  totalIncome,
  totalExpense,
  currencySymbol,
  colors,
  onOpenAddTx,
  onOpenEditTx,
  onDeleteTx
}: DashboardPageProps) {
  // Category Breakdown interactive filter state
  const [breakdownType, setBreakdownType] = useState<'expense' | 'income'>('expense');
  const [breakdownYear, setBreakdownYear] = useState<string>('All');
  const [breakdownMonth, setBreakdownMonth] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  // Expenses filter state
  const [expenseYear, setExpenseYear] = useState<string>('All');
  const [expenseMonth, setExpenseMonth] = useState<string>('All');
  const [collapsedExpenses, setCollapsedExpenses] = useState<Record<string, boolean>>({});

  // Incomes filter state
  const [incomeYear, setIncomeYear] = useState<string>('All');
  const [incomeMonth, setIncomeMonth] = useState<string>('All');
  const [collapsedIncomes, setCollapsedIncomes] = useState<Record<string, boolean>>({});

  // Extract distinct available years from transactions
  const availableYears = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => {
      if (t.date && t.date.length >= 4) {
        set.add(t.date.slice(0, 4));
      }
    });
    // Ensure current year is in list
    set.add(String(new Date().getFullYear()));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [transactions]);

  // Grouped and filtered Expenses
  const groupedExpenses = useMemo(() => {
    const list = transactions.filter(t => t.type === 'expense' && !t.isTransfer);
    const filtered = list.filter(t => {
      if (!t.date) return true;
      const [y, m] = t.date.split('-');
      if (expenseYear !== 'All' && y !== expenseYear) return false;
      if (expenseMonth !== 'All' && m !== expenseMonth) return false;
      return true;
    });

    const map: Record<string, Transaction[]> = {};
    filtered.forEach(t => {
      const k = t.date ? t.date.slice(0, 7) : 'Other';
      if (!map[k]) map[k] = [];
      map[k].push(t);
    });

    const sortedKeys = Object.keys(map).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map(k => {
      const items = map[k].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const total = items.reduce((sum, item) => sum + item.amount, 0);
      let label = k;
      if (k !== 'Other' && k.includes('-')) {
        const [yr, mo] = k.split('-');
        const d = new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, 1);
        label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      }
      return { key: k, label, total, items };
    });
  }, [transactions, expenseYear, expenseMonth]);

  // Grouped and filtered Incomes
  const groupedIncomes = useMemo(() => {
    const list = transactions.filter(t => t.type === 'income' && !t.isTransfer);
    const filtered = list.filter(t => {
      if (!t.date) return true;
      const [y, m] = t.date.split('-');
      if (incomeYear !== 'All' && y !== incomeYear) return false;
      if (incomeMonth !== 'All' && m !== incomeMonth) return false;
      return true;
    });

    const map: Record<string, Transaction[]> = {};
    filtered.forEach(t => {
      const k = t.date ? t.date.slice(0, 7) : 'Other';
      if (!map[k]) map[k] = [];
      map[k].push(t);
    });

    const sortedKeys = Object.keys(map).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map(k => {
      const items = map[k].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const total = items.reduce((sum, item) => sum + item.amount, 0);
      let label = k;
      if (k !== 'Other' && k.includes('-')) {
        const [yr, mo] = k.split('-');
        const d = new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, 1);
        label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      }
      return { key: k, label, total, items };
    });
  }, [transactions, incomeYear, incomeMonth]);

  const toggleExpenseGroup = (key: string) => {
    setCollapsedExpenses(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleIncomeGroup = (key: string) => {
    setCollapsedIncomes(prev => ({ ...prev, [key]: !prev[key] }));
  };
  // Transactions filtered by Type, Year, Month for the Category Breakdown
  const periodTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (t.isTransfer) return false;
      if (t.type !== breakdownType) return false;
      if (!t.date) return true;
      const [y, m] = t.date.split('-');
      if (breakdownYear !== 'All' && y !== breakdownYear) return false;
      if (breakdownMonth !== 'All' && m !== breakdownMonth) return false;
      return true;
    });
  }, [transactions, breakdownType, breakdownYear, breakdownMonth]);

  // Aggregate Category Breakdown for Donut Chart
  const categoryBreakdownList = useMemo(() => {
    const map: Record<string, { value: number; count: number }> = {};
    periodTransactions.forEach(t => {
      const cat = (t.category || 'Other').trim();
      if (!map[cat]) map[cat] = { value: 0, count: 0 };
      map[cat].value += t.amount;
      map[cat].count += 1;
    });
    const total = Object.values(map).reduce((s, c) => s + c.value, 0);
    return Object.entries(map)
      .map(([name, data]) => ({
        name,
        value: data.value,
        count: data.count,
        percent: total > 0 ? data.value / total : 0
      }))
      .sort((a, b) => b.value - a.value);
  }, [periodTransactions]);

  const totalPeriodAmount = useMemo(() => {
    return periodTransactions.reduce((s, t) => s + t.amount, 0);
  }, [periodTransactions]);

  // Available categories for current breakdown type
  const availableBreakdownCategories = useMemo(() => {
    const set = new Set<string>();
    transactions
      .filter(t => t.type === breakdownType && !t.isTransfer)
      .forEach(t => {
        if (t.category && t.category.trim()) set.add(t.category.trim());
      });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [transactions, breakdownType]);

  // Compatible transactions for selected category
  const compatibleTransactions = useMemo(() => {
    if (selectedCategory === 'All') return periodTransactions;
    return periodTransactions.filter(
      t => (t.category || 'Other').trim().toLowerCase() === selectedCategory.trim().toLowerCase()
    );
  }, [periodTransactions, selectedCategory]);

  // Active category stats and budget comparison
  const selectedCategoryStats = useMemo(() => {
    if (selectedCategory === 'All') return null;
    const match = categoryBreakdownList.find(
      c => c.name.trim().toLowerCase() === selectedCategory.trim().toLowerCase()
    );
    if (!match) return null;
    const matchingBudget = (budgets || []).find(
      (b: any) => (b.name || b.category || '').trim().toLowerCase() === selectedCategory.trim().toLowerCase()
    );
    return {
      ...match,
      budget: matchingBudget
    };
  }, [selectedCategory, categoryBreakdownList, budgets]);

  const isFilterActive = breakdownYear !== 'All' || breakdownMonth !== 'All' || selectedCategory !== 'All';
  const activeDisplayAmount = selectedCategoryStats ? selectedCategoryStats.value : totalPeriodAmount;

  return (
    <div className="space-y-6">
      
      {/* 1. MONTHLY CHARTS (Trend Area Chart) */}
      <div className="bg-[#202020] border border-[#282828] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm text-white">Monthly Charts</h2>
            <p className="text-xs text-[#888]">Timeline of overall cashflow, incomes, and expenses.</p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="bg-[#191919] border border-[#2d2d2d] rounded-lg p-0.5 flex text-xs">
              <button onClick={() => setChartMode('Expense')} className={`px-3 py-1 rounded-md transition ${chartMode === 'Expense' ? 'bg-[#2d2d2d] text-white font-medium' : 'text-[#888]'}`}>Expense</button>
              <button onClick={() => setChartMode('Income')} className={`px-3 py-1 rounded-md transition ${chartMode === 'Income' ? 'bg-[#2d2d2d] text-white font-medium' : 'text-[#888]'}`}>Income</button>
              <button onClick={() => setChartMode('Cashflow')} className={`px-3 py-1 rounded-md transition ${chartMode === 'Cashflow' ? 'bg-[#2d2d2d] text-white font-medium' : 'text-[#888]'}`}>Cashflow</button>
            </div>
            <button onClick={() => onOpenAddTx('expense')} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition">
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>
        </div>

        <div className="h-60 w-full">
          {transactions.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-[#777]">No transaction records in database to chart.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="#666" fontSize={11} tickLine={false} />
                <YAxis stroke="#666" fontSize={11} tickLine={false} tickFormatter={(v) => `${currencySymbol}${v}`} />
                <Tooltip contentStyle={{ background: '#1c1c1c', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} formatter={(val: any) => [`${currencySymbol}${Number(val).toLocaleString()}`, chartMode]} />
                <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 2. CATEGORY BREAKDOWN & COMPATIBLE DETAILS (Matching User's Segmented Donut Chart Attachment) */}
      <div className="bg-[#202020] border border-[#282828] rounded-2xl p-6 shadow-sm space-y-6">
        
        {/* Filter Toolbar */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-[#2a2a2a]">
          <div>
            <div className="flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-emerald-400" />
              <h2 className="font-semibold text-base text-white">Category Breakdown & Compatible Details</h2>
            </div>
            <p className="text-xs text-[#888] mt-0.5">
              Segmented visual distribution with category, year, and month filters.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Type Toggle: Expenses vs Incomes */}
            <div className="flex bg-[#191919] border border-[#333] rounded-lg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => { setBreakdownType('expense'); setSelectedCategory('All'); }}
                className={`px-3 py-1.5 rounded-md font-medium transition ${
                  breakdownType === 'expense'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : 'text-[#888] hover:text-white'
                }`}
              >
                Expenses
              </button>
              <button
                type="button"
                onClick={() => { setBreakdownType('income'); setSelectedCategory('All'); }}
                className={`px-3 py-1.5 rounded-md font-medium transition ${
                  breakdownType === 'income'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-[#888] hover:text-white'
                }`}
              >
                Incomes
              </button>
            </div>

            {/* Year Filter */}
            <div className="flex items-center gap-1 bg-[#191919] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs">
              <Calendar className="w-3.5 h-3.5 text-[#777]" />
              <select
                value={breakdownYear}
                onChange={e => { setBreakdownYear(e.target.value); setSelectedCategory('All'); }}
                className="bg-transparent text-xs text-zinc-200 focus:outline-none cursor-pointer"
              >
                <option value="All" className="bg-[#1f1f1f]">All Years</option>
                {availableYears.map(yr => (
                  <option key={yr} value={yr} className="bg-[#1f1f1f]">{yr}</option>
                ))}
              </select>
            </div>

            {/* Month Filter */}
            <div className="flex items-center gap-1 bg-[#191919] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs">
              <Filter className="w-3.5 h-3.5 text-[#777]" />
              <select
                value={breakdownMonth}
                onChange={e => { setBreakdownMonth(e.target.value); setSelectedCategory('All'); }}
                className="bg-transparent text-xs text-zinc-200 focus:outline-none cursor-pointer"
              >
                {BREAKDOWN_MONTHS.map(mo => (
                  <option key={mo.val} value={mo.val} className="bg-[#1f1f1f]">{mo.name}</option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-1 bg-[#191919] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs">
              <Tag className="w-3.5 h-3.5 text-[#777]" />
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="bg-transparent text-xs text-zinc-200 focus:outline-none cursor-pointer"
              >
                <option value="All" className="bg-[#1f1f1f]">All Categories</option>
                {availableBreakdownCategories.map(cat => (
                  <option key={cat} value={cat} className="bg-[#1f1f1f]">{cat}</option>
                ))}
              </select>
            </div>

            {/* Reset Filters */}
            {isFilterActive && (
              <button
                type="button"
                onClick={() => {
                  setBreakdownYear('All');
                  setBreakdownMonth('All');
                  setSelectedCategory('All');
                }}
                className="px-2.5 py-1.5 bg-[#2a2a2a] hover:bg-[#333] text-zinc-300 hover:text-white rounded-lg text-xs transition flex items-center gap-1"
                title="Reset filters"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Section */}
        {categoryBreakdownList.length === 0 ? (
          <div className="py-14 text-center text-xs text-[#777] bg-[#1a1a1a]/50 border border-[#2a2a2a] rounded-xl space-y-2">
            <p>No {breakdownType} records found in database matching the selected filters.</p>
            {isFilterActive && (
              <button
                onClick={() => { setBreakdownYear('All'); setBreakdownMonth('All'); setSelectedCategory('All'); }}
                className="text-xs text-blue-400 hover:underline inline-block"
              >
                Reset filters to view all
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left: Donut Chart & Category Legend (Matching User Image) */}
            <div className="lg:col-span-5 flex flex-col items-center space-y-5 bg-[#191919]/60 border border-[#262626] rounded-xl p-5">
              <div className="text-center">
                <span className="text-[11px] font-semibold text-[#888] uppercase tracking-wider block">
                  {breakdownType === 'expense' ? 'Expense' : 'Income'} Breakdown
                </span>
                <span className="text-xs text-[#666]">
                  Click any segment or chip to filter compatible details
                </span>
              </div>

              {/* Segmented Donut Chart Matching User Attachment */}
              <div className="relative w-64 h-64 mx-auto flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={categoryBreakdownList}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={5}
                      cornerRadius={8}
                      onClick={(_, idx) => {
                        const item = categoryBreakdownList[idx];
                        if (item) {
                          setSelectedCategory(prev => prev === item.name ? 'All' : item.name);
                        }
                      }}
                      cursor="pointer"
                      labelLine={false}
                      label={createPieLabel(currencySymbol)}
                    >
                      {categoryBreakdownList.map((entry, index) => {
                        const isSelected = selectedCategory === entry.name;
                        const isFaded = selectedCategory !== 'All' && !isSelected;
                        return (
                          <Cell
                            key={`cell-${entry.name}`}
                            fill={BREAKDOWN_PALETTE[index % BREAKDOWN_PALETTE.length]}
                            opacity={isFaded ? 0.35 : 1}
                            stroke={isSelected ? '#ffffff' : '#191919'}
                            strokeWidth={isSelected ? 3 : 1.5}
                            className="transition-all duration-300"
                          />
                        );
                      })}
                    </Pie>
                    <Tooltip content={<CustomBreakdownTooltip currencySymbol={currencySymbol} />} />
                  </RechartsPie>
                </ResponsiveContainer>

                {/* Center Hole Total Display */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-2">
                  <span className="text-[10px] text-[#888] font-medium uppercase tracking-wider">
                    {selectedCategory !== 'All' ? 'Filtered' : 'Total'}
                  </span>
                  <span className="text-sm font-bold text-white max-w-[100px] truncate">
                    {currencySymbol}{activeDisplayAmount >= 1000000
                      ? `${(activeDisplayAmount / 1000000).toFixed(1)}M`
                      : activeDisplayAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                  {selectedCategory !== 'All' ? (
                    <span className="text-[10px] text-blue-400 truncate max-w-[95px] font-medium">
                      {selectedCategory}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#777]">
                      {categoryBreakdownList.length} {categoryBreakdownList.length === 1 ? 'category' : 'categories'}
                    </span>
                  )}
                </div>
              </div>

              {/* Clickable Category Chips */}
              <div className="w-full space-y-1.5 pt-2 border-t border-[#262626]">
                <div className="flex items-center justify-between text-[11px] text-[#888] px-1 font-medium">
                  <span>Category</span>
                  <span>Share · Amount</span>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                  {categoryBreakdownList.map((item, idx) => {
                    const isSelected = selectedCategory === item.name;
                    const sliceColor = BREAKDOWN_PALETTE[idx % BREAKDOWN_PALETTE.length];
                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => setSelectedCategory(prev => prev === item.name ? 'All' : item.name)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition ${
                          isSelected
                            ? 'bg-[#2b2b2b] text-white ring-1 ring-white/30'
                            : 'hover:bg-[#242424] text-zinc-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sliceColor }} />
                          <span className="truncate font-medium">{item.name}</span>
                          <span className="text-[10px] text-[#777] font-mono">({item.count})</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-[#888]">{(item.percent * 100).toFixed(1)}%</span>
                          <span className="font-semibold text-white">
                            {currencySymbol}{item.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Compatible Details Panel */}
            <div className="lg:col-span-7 space-y-4">
              
              {/* If a category is selected: Show category details & matching transactions */}
              {selectedCategory !== 'All' && selectedCategoryStats ? (
                <div className="space-y-4">
                  <div className="bg-[#191919]/60 border border-[#262626] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            background:
                              BREAKDOWN_PALETTE[
                                categoryBreakdownList.findIndex(c => c.name === selectedCategoryStats.name) %
                                BREAKDOWN_PALETTE.length
                              ]
                          }}
                        />
                        <h3 className="text-sm font-bold text-white">{selectedCategoryStats.name} Details</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('All')}
                        className="text-xs text-blue-400 hover:text-blue-300 transition flex items-center gap-1 font-medium"
                      >
                        <span>View All Categories</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-1">
                      <div className="bg-[#202020] border border-[#2b2b2b] rounded-lg p-2.5 text-center">
                        <span className="text-[10px] text-[#888] block">Total Amount</span>
                        <span className="text-xs font-bold text-white block mt-0.5">
                          {currencySymbol}{selectedCategoryStats.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-[#202020] border border-[#2b2b2b] rounded-lg p-2.5 text-center">
                        <span className="text-[10px] text-[#888] block">Share of Total</span>
                        <span className="text-xs font-bold text-blue-400 block mt-0.5">
                          {((selectedCategoryStats.percent || 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="bg-[#202020] border border-[#2b2b2b] rounded-lg p-2.5 text-center">
                        <span className="text-[10px] text-[#888] block">Records Count</span>
                        <span className="text-xs font-bold text-white block mt-0.5">
                          {selectedCategoryStats.count} {selectedCategoryStats.count === 1 ? 'record' : 'records'}
                        </span>
                      </div>
                    </div>

                    {/* Matching Budget Comparison (if available) */}
                    {selectedCategoryStats.budget && (
                      <div className="bg-[#202020] border border-[#2b2b2b] rounded-lg p-3 space-y-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#888] flex items-center gap-1">
                            <span>Associated Budget:</span>
                            <span className="font-medium text-white">{selectedCategoryStats.budget.name || selectedCategoryStats.budget.category}</span>
                          </span>
                          <span className={selectedCategoryStats.value > selectedCategoryStats.budget.limit ? 'text-rose-400 font-bold' : 'text-emerald-400 font-medium'}>
                            Limit: {currencySymbol}{selectedCategoryStats.budget.limit.toLocaleString()}
                          </span>
                        </div>
                        <div className="w-full bg-[#141414] h-2 rounded-full overflow-hidden border border-[#2d2d2d]">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(Math.round((selectedCategoryStats.value / selectedCategoryStats.budget.limit) * 100), 100)}%`,
                              backgroundColor: selectedCategoryStats.value > selectedCategoryStats.budget.limit ? '#f43f5e' : '#10b981'
                            }}
                          />
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-[#777]">
                          <span>
                            {Math.round((selectedCategoryStats.value / selectedCategoryStats.budget.limit) * 100)}% of budget limit used
                          </span>
                          {selectedCategoryStats.value > selectedCategoryStats.budget.limit && (
                            <span className="text-rose-400 font-semibold">Over budget!</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Transactions Table for Selected Category */}
                  <div className="bg-[#191919]/60 border border-[#262626] rounded-xl overflow-hidden shadow-sm">
                    <div className="p-3 border-b border-[#262626] flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">
                        Compatible Transactions ({compatibleTransactions.length})
                      </span>
                    </div>
                    <div className="divide-y divide-[#262626] max-h-72 overflow-y-auto">
                      {compatibleTransactions.map(t => (
                        <div
                          key={t.id}
                          className="p-3 flex items-center justify-between text-xs hover:bg-[#222] transition group"
                        >
                          <div className="truncate mr-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white truncate">{t.title}</span>
                              <button
                                onClick={() => onOpenEditTx(t)}
                                className="p-0.5 text-[#777] hover:text-white transition"
                                title="Edit transaction"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-[#777] mt-0.5">
                              <span>{t.date}</span>
                              {t.notes && (
                                <>
                                  <span>·</span>
                                  <span className="italic truncate max-w-xs">{t.notes}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`font-semibold ${t.type === 'income' ? 'text-emerald-400' : 'text-zinc-200'}`}>
                              {t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            <button
                              onClick={() => onOpenEditTx(t)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#333] rounded text-[#888] hover:text-blue-400 transition"
                              title="Edit transaction"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onDeleteTx(t.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#333] rounded text-[#888] hover:text-rose-400 transition"
                              title="Delete transaction"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* All Categories View: Ranked progress bars + ledger */
                <div className="space-y-4">
                  <div className="bg-[#191919]/60 border border-[#262626] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">
                        All {breakdownType === 'expense' ? 'Expenses' : 'Incomes'} Ranking
                      </span>
                      <span className="text-[11px] text-[#888]">
                        Total: {currencySymbol}{totalPeriodAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {categoryBreakdownList.map((item, idx) => {
                        const sliceColor = BREAKDOWN_PALETTE[idx % BREAKDOWN_PALETTE.length];
                        const matchingBudget = (budgets || []).find(
                          (b: any) => (b.name || b.category || '').trim().toLowerCase() === item.name.toLowerCase()
                        );
                        return (
                          <div
                            key={item.name}
                            onClick={() => setSelectedCategory(item.name)}
                            className="bg-[#202020] hover:bg-[#252525] border border-[#282828] p-2.5 rounded-lg transition cursor-pointer space-y-1.5 group"
                          >
                            <div className="flex justify-between items-center text-xs">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: sliceColor }} />
                                <span className="font-medium text-white group-hover:text-blue-400 transition">{item.name}</span>
                                <span className="text-[10px] text-[#777]">({item.count} {item.count === 1 ? 'record' : 'records'})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[#888] text-[11px]">{(item.percent * 100).toFixed(1)}%</span>
                                <span className="font-semibold text-white">
                                  {currencySymbol}{item.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                                <ArrowRight className="w-3 h-3 text-[#666] group-hover:text-white transition" />
                              </div>
                            </div>
                            <div className="w-full bg-[#151515] h-1.5 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${Math.round(item.percent * 100)}%`, backgroundColor: sliceColor }}
                              />
                            </div>
                            {matchingBudget && (
                              <div className="flex justify-between items-center text-[10px] text-[#777] pt-0.5">
                                <span>Budget: {currencySymbol}{matchingBudget.limit.toLocaleString()}</span>
                                <span className={item.value > matchingBudget.limit ? 'text-rose-400 font-semibold' : ''}>
                                  {Math.round((item.value / matchingBudget.limit) * 100)}% used
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* All Compatible Transactions in Selected Period */}
                  <div className="bg-[#191919]/60 border border-[#262626] rounded-xl overflow-hidden shadow-sm">
                    <div className="p-3 border-b border-[#262626] flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">
                        Period Transactions ({compatibleTransactions.length})
                      </span>
                      <span className="text-[11px] text-[#777]">
                        Click any category above to filter
                      </span>
                    </div>
                    <div className="divide-y divide-[#262626] max-h-64 overflow-y-auto">
                      {compatibleTransactions.slice(0, 15).map(t => (
                        <div
                          key={t.id}
                          className="p-3 flex items-center justify-between text-xs hover:bg-[#222] transition group"
                        >
                          <div className="truncate mr-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white truncate">{t.title}</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${getCategoryPillStyle(t.category)}`}>
                                {t.category}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-[#777] mt-0.5">
                              <span>{t.date}</span>
                              {t.notes && (
                                <>
                                  <span>·</span>
                                  <span className="italic truncate max-w-xs">{t.notes}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`font-semibold ${t.type === 'income' ? 'text-emerald-400' : 'text-zinc-200'}`}>
                              {t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            <button
                              onClick={() => onOpenEditTx(t)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#333] rounded text-[#888] hover:text-blue-400 transition"
                              title="Edit transaction"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onDeleteTx(t.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#333] rounded text-[#888] hover:text-rose-400 transition"
                              title="Delete transaction"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* BOTTOM SECTION: Collapsible & Filterable Expenses and Incomes (Matching Notion Screenshot) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-8">
        
        {/* EXPENSES SECTION */}
        <div className="bg-[#202020] border border-[#282828] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-semibold text-sm text-white flex items-center gap-1.5">
              <span>Expenses</span>
            </h2>

            {/* Filters: Year & Month */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[#191919] border border-[#333] rounded-lg px-2 py-1">
                <Calendar className="w-3 h-3 text-[#777]" />
                <select
                  value={expenseYear}
                  onChange={e => setExpenseYear(e.target.value)}
                  className="bg-transparent text-xs text-zinc-200 focus:outline-none cursor-pointer"
                >
                  <option value="All" className="bg-[#1f1f1f]">All Years</option>
                  {availableYears.map(yr => (
                    <option key={yr} value={yr} className="bg-[#1f1f1f]">{yr}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1 bg-[#191919] border border-[#333] rounded-lg px-2 py-1">
                <Filter className="w-3 h-3 text-[#777]" />
                <select
                  value={expenseMonth}
                  onChange={e => setExpenseMonth(e.target.value)}
                  className="bg-transparent text-xs text-zinc-200 focus:outline-none cursor-pointer"
                >
                  <option value="All" className="bg-[#1f1f1f]">All Months</option>
                  {MONTH_NAMES.map(m => (
                    <option key={m.val} value={m.val} className="bg-[#1f1f1f]">{m.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => onOpenAddTx('expense')}
                className="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition"
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            </div>
          </div>

          {/* Grouped month list */}
          <div className="space-y-4 pt-1">
            {groupedExpenses.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#777] space-y-2">
                <p>No expense entries found for the selected filter.</p>
                <button
                  onClick={() => onOpenAddTx('expense')}
                  className="text-blue-400 hover:underline text-xs"
                >
                  + Add an expense
                </button>
              </div>
            ) : (
              groupedExpenses.map(grp => {
                const isCollapsed = !!collapsedExpenses[grp.key];
                return (
                  <div key={grp.key} className="space-y-1.5 border-b border-[#282828] pb-3 last:border-0">
                    {/* Collapsible Month Header (Matching screenshot style) */}
                    <div
                      onClick={() => toggleExpenseGroup(grp.key)}
                      className="flex items-center justify-between text-xs font-semibold text-white cursor-pointer select-none py-1 px-1 rounded-lg hover:bg-[#252525] transition group"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 flex items-center justify-center rounded border transition ${
                            isCollapsed
                              ? 'border-transparent text-[#777] bg-[#282828]'
                              : 'border-blue-500/60 text-blue-400 bg-blue-500/10'
                          }`}
                        >
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </span>
                        <span className="font-semibold text-zinc-100">{grp.label}</span>
                        <span className="text-[#888] font-normal text-xs ml-1">
                          {currencySymbol}{grp.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenAddTx('expense', grp.key !== 'Other' ? `${grp.key}-01` : undefined);
                          }}
                          className="p-1 hover:bg-[#333] rounded text-[#aaa] hover:text-white"
                          title={`Add expense into ${grp.label}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Month Items */}
                    {!isCollapsed && (
                      <div className="pl-6 space-y-1 pt-1">
                        {grp.items.map(t => (
                          <div
                            key={t.id}
                            className="py-1.5 px-2.5 rounded-lg flex items-center justify-between text-xs hover:bg-[#262626] group transition"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <ArrowDownRight className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                              <span className="font-medium text-white truncate">{t.title}</span>
                              <button
                                onClick={() => onOpenEditTx(t)}
                                className="p-1 hover:bg-[#333] rounded text-[#777] hover:text-white transition shrink-0"
                                title="Edit expense"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2.5 shrink-0">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${getCategoryPillStyle(t.category)}`}>
                                {t.category}
                              </span>
                              <span className="font-semibold text-zinc-200">
                                {currencySymbol}{t.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                              <button
                                onClick={() => onOpenEditTx(t)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#333] rounded text-[#888] hover:text-blue-400 transition"
                                title="Edit expense"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onDeleteTx(t.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#333] rounded text-[#888] hover:text-rose-400 transition"
                                title="Delete transaction"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* INCOMES SECTION */}
        <div className="bg-[#202020] border border-[#282828] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-semibold text-sm text-white flex items-center gap-1.5">
              <span>Incomes</span>
            </h2>

            {/* Filters: Year & Month */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-[#191919] border border-[#333] rounded-lg px-2 py-1">
                <Calendar className="w-3 h-3 text-[#777]" />
                <select
                  value={incomeYear}
                  onChange={e => setIncomeYear(e.target.value)}
                  className="bg-transparent text-xs text-zinc-200 focus:outline-none cursor-pointer"
                >
                  <option value="All" className="bg-[#1f1f1f]">All Years</option>
                  {availableYears.map(yr => (
                    <option key={yr} value={yr} className="bg-[#1f1f1f]">{yr}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1 bg-[#191919] border border-[#333] rounded-lg px-2 py-1">
                <Filter className="w-3 h-3 text-[#777]" />
                <select
                  value={incomeMonth}
                  onChange={e => setIncomeMonth(e.target.value)}
                  className="bg-transparent text-xs text-zinc-200 focus:outline-none cursor-pointer"
                >
                  <option value="All" className="bg-[#1f1f1f]">All Months</option>
                  {MONTH_NAMES.map(m => (
                    <option key={m.val} value={m.val} className="bg-[#1f1f1f]">{m.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => onOpenAddTx('income')}
                className="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition"
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            </div>
          </div>

          {/* Grouped month list */}
          <div className="space-y-4 pt-1">
            {groupedIncomes.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#777] space-y-2">
                <p>No income entries found for the selected filter.</p>
                <button
                  onClick={() => onOpenAddTx('income')}
                  className="text-blue-400 hover:underline text-xs"
                >
                  + Add income
                </button>
              </div>
            ) : (
              groupedIncomes.map(grp => {
                const isCollapsed = !!collapsedIncomes[grp.key];
                return (
                  <div key={grp.key} className="space-y-1.5 border-b border-[#282828] pb-3 last:border-0">
                    {/* Collapsible Month Header (Matching screenshot style) */}
                    <div
                      onClick={() => toggleIncomeGroup(grp.key)}
                      className="flex items-center justify-between text-xs font-semibold text-white cursor-pointer select-none py-1 px-1 rounded-lg hover:bg-[#252525] transition group"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 flex items-center justify-center rounded border transition ${
                            isCollapsed
                              ? 'border-transparent text-[#777] bg-[#282828]'
                              : 'border-blue-500/60 text-blue-400 bg-blue-500/10'
                          }`}
                        >
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </span>
                        <span className="font-semibold text-zinc-100">{grp.label}</span>
                        <span className="text-[#888] font-normal text-xs ml-1">
                          {currencySymbol}{grp.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenAddTx('income', grp.key !== 'Other' ? `${grp.key}-01` : undefined);
                          }}
                          className="p-1 hover:bg-[#333] rounded text-[#aaa] hover:text-white"
                          title={`Add income into ${grp.label}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Month Items */}
                    {!isCollapsed && (
                      <div className="pl-6 space-y-1 pt-1">
                        {grp.items.map(t => (
                          <div
                            key={t.id}
                            className="py-1.5 px-2.5 rounded-lg flex items-center justify-between text-xs hover:bg-[#262626] group transition"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className="font-medium text-white truncate">{t.title}</span>
                              <button
                                onClick={() => onOpenEditTx(t)}
                                className="p-1 hover:bg-[#333] rounded text-[#777] hover:text-white transition shrink-0"
                                title="Edit income"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2.5 shrink-0">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${getCategoryPillStyle(t.category)}`}>
                                {t.category}
                              </span>
                              <span className="font-semibold text-white">
                                {currencySymbol}{t.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                              <button
                                onClick={() => onOpenEditTx(t)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#333] rounded text-[#888] hover:text-blue-400 transition"
                                title="Edit income"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onDeleteTx(t.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#333] rounded text-[#888] hover:text-rose-400 transition"
                                title="Delete transaction"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
