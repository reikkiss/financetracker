import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  ShieldCheck,
  X,
  Sparkles,
  Receipt,
  PieChart,
  LayoutDashboard,
  BarChart2,
  Settings,
  Pencil,
  Trash2,
  CreditCard,
  Landmark,
  Wallet,
  CheckSquare,
  Square,
  PlusCircle,
  Percent
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  deleteDoc,
  query,
  where
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

import DashboardPage from './components/DashboardPage';
import MonthlyStatsPage from './components/MonthlyStatsPage';
import BudgetsPage, { Budget, BudgetItem } from './components/BudgetsPage';
import TransactionsPage from './components/TransactionsPage';
import SettingsPage from './components/SettingsPage';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || 'seashore');
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string;
  currency: string;
  monthlyBudget: number;
}

export interface Transaction {
  id: string;
  userId: string;
  title: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  date: string;
  notes?: string;
  budgetId?: string;
  isLoanPayment?: boolean;
}

const CATEGORIES = [
  'Salary', 'Freelance', 'Groceries', 'Housing', 'Subscriptions',
  'Transport', 'Dining', 'Entertainment', 'Utilities', 'Business', 'Shopping', 'Other'
];

const CURRENCIES: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CAD: 'C$',
  AUD: 'A$',
  DOP: 'RD$'
};

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e', '#6366f1'];

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'stats' | 'budgets' | 'transactions' | 'settings'>('dashboard');

  // Data states (strictly from database)
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  
  // UI Tabs & Filters
  const [chartMode, setChartMode] = useState<'Expense' | 'Income' | 'Cashflow'>('Cashflow');
  const [breakdownMode, setBreakdownMode] = useState<'Expense' | 'Income'>('Expense');
  const [statsQuarterFilter, setStatsQuarterFilter] = useState<'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('All');

  // Modals
  const [isAddTxOpen, setIsAddTxOpen] = useState(false);
  const [defaultTxType, setDefaultTxType] = useState<'income' | 'expense'>('expense');
  const [newTxTitle, setNewTxTitle] = useState('');
  const [newTxAmount, setNewTxAmount] = useState('');
  const [newTxCategory, setNewTxCategory] = useState('Groceries');
  const [newTxDate, setNewTxDate] = useState(new Date().toISOString().split('T')[0]);
  const [newTxNotes, setNewTxNotes] = useState('');
  const [newTxBudgetId, setNewTxBudgetId] = useState('');
  const [newTxIsLoanPayment, setNewTxIsLoanPayment] = useState(false);

  // Edit Transaction Modal
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editTxTitle, setEditTxTitle] = useState('');
  const [editTxAmount, setEditTxAmount] = useState('');
  const [editTxType, setEditTxType] = useState<'income' | 'expense'>('expense');
  const [editTxCategory, setEditTxCategory] = useState('Groceries');
  const [editTxDate, setEditTxDate] = useState('');
  const [editTxNotes, setEditTxNotes] = useState('');
  const [editTxBudgetId, setEditTxBudgetId] = useState('');
  const [editTxIsLoanPayment, setEditTxIsLoanPayment] = useState(false);

  // Add Budget Modal
  const [isAddBudgetOpen, setIsAddBudgetOpen] = useState(false);
  const [newBudgetCategory, setNewBudgetCategory] = useState('Groceries');
  const [newBudgetDescription, setNewBudgetDescription] = useState('');
  const [newBudgetAccountType, setNewBudgetAccountType] = useState<'standard' | 'credit_card' | 'loan'>('standard');
  const [newBudgetLimit, setNewBudgetLimit] = useState('');
  const [newBudgetCreditLimit, setNewBudgetCreditLimit] = useState('');
  const [newBudgetApr, setNewBudgetApr] = useState('');
  const [newBudgetOverdraftPercentage, setNewBudgetOverdraftPercentage] = useState('');
  const [newBudgetActualUsedAmount, setNewBudgetActualUsedAmount] = useState('');
  const [newBudgetExtraExpenses, setNewBudgetExtraExpenses] = useState('');
  const [newBudgetItems, setNewBudgetItems] = useState<BudgetItem[]>([]);
  const [newBudgetItemName, setNewBudgetItemName] = useState('');
  const [newBudgetItemAmount, setNewBudgetItemAmount] = useState('');
  const [newBudgetColor, setNewBudgetColor] = useState('#10b981');

  // Edit Budget Modal
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [editBudgetCategory, setEditBudgetCategory] = useState('Groceries');
  const [editBudgetDescription, setEditBudgetDescription] = useState('');
  const [editBudgetAccountType, setEditBudgetAccountType] = useState<'standard' | 'credit_card' | 'loan'>('standard');
  const [editBudgetLimit, setEditBudgetLimit] = useState('');
  const [editBudgetCreditLimit, setEditBudgetCreditLimit] = useState('');
  const [editBudgetApr, setEditBudgetApr] = useState('');
  const [editBudgetOverdraftPercentage, setEditBudgetOverdraftPercentage] = useState('');
  const [editBudgetActualUsedAmount, setEditBudgetActualUsedAmount] = useState('');
  const [editBudgetExtraExpenses, setEditBudgetExtraExpenses] = useState('');
  const [editBudgetItems, setEditBudgetItems] = useState<BudgetItem[]>([]);
  const [editBudgetItemName, setEditBudgetItemName] = useState('');
  const [editBudgetItemAmount, setEditBudgetItemAmount] = useState('');
  const [editBudgetColor, setEditBudgetColor] = useState('#10b981');

  // AI Modal
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await loadOrCreateUserProfile(user);
      } else {
        setCurrentUserProfile(null);
        setTransactions([]);
        setBudgets([]);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loadOrCreateUserProfile = async (user: any) => {
    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        setCurrentUserProfile(snap.data() as UserProfile);
      } else {
        const newProfile: UserProfile = {
          id: user.uid,
          name: user.displayName || 'Finance User',
          email: user.email || '',
          avatar: '📊',
          currency: 'USD',
          monthlyBudget: 5000
        };
        await setDoc(userRef, newProfile);
        setCurrentUserProfile(newProfile);
      }
      await fetchUserData(user.uid);
    } catch (err) {
      console.error('Profile load error:', err);
    }
  };

  const fetchUserData = async (userId: string) => {
    try {
      const [txSnap, budgetSnap] = await Promise.all([
        getDocs(query(collection(db, 'transactions'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'budgets'), where('userId', '==', userId)))
      ]);
      setTransactions(txSnap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)));
      setBudgets(budgetSnap.docs.map(d => ({ id: d.id, ...d.data() } as Budget)));
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err.code !== 'auth/cancelled-popup-request' && err.code !== 'auth/popup-closed-by-user') {
        console.error('Sign-in error:', err);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const currencySymbol = currentUserProfile ? (CURRENCIES[currentUserProfile.currency] || '$') : '$';

  const totalIncome = useMemo(() => transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0), [transactions]);
  const totalExpense = useMemo(() => transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0), [transactions]);
  const cashflow = totalIncome - totalExpense;

  const availableCategories = useMemo(() => {
    const set = new Set<string>(CATEGORIES);
    transactions.forEach(t => {
      if (t.category && t.category.trim()) set.add(t.category.trim());
    });
    budgets.forEach(b => {
      if (b.category && b.category.trim()) set.add(b.category.trim());
      if (b.name && b.name.trim()) set.add(b.name.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [transactions, budgets]);

  const breakdownData = useMemo(() => {
    const map: Record<string, number> = {};
    transactions
      .filter(t => t.type === breakdownMode.toLowerCase())
      .forEach(t => {
        map[t.category] = (map[t.category] || 0) + t.amount;
      });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [transactions, breakdownMode]);

  const monthlyChartData = useMemo(() => {
    if (transactions.length === 0) {
      return [
        { date: 'Jan', value: 0 },
        { date: 'May', value: 0 },
        { date: 'Sep', value: 0 }
      ];
    }
    const map: Record<string, number> = {};
    transactions.forEach(t => {
      const monthKey = t.date ? t.date.slice(0, 7) : '2026-11';
      let val = t.amount;
      if (chartMode === 'Expense' && t.type !== 'expense') return;
      if (chartMode === 'Income' && t.type !== 'income') return;
      if (chartMode === 'Cashflow') {
        val = t.type === 'income' ? t.amount : -t.amount;
      }
      map[monthKey] = (map[monthKey] || 0) + val;
    });

    const sorted = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    if (sorted.length === 0) {
      return [{ date: 'Current', value: 0 }];
    }
    return sorted.map(([date, value]) => ({ date, value }));
  }, [transactions, chartMode]);

  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const currentMonthName = useMemo(() => {
    return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }, []);

  const currentMonthStats = useMemo(() => {
    const mTransactions = transactions.filter(t => t.date && t.date.startsWith(currentMonthKey));
    const income = mTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = mTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expense, cashflow: income - expense };
  }, [transactions, currentMonthKey]);

  // 1.5 years (18 months) with actual (current) month as the latest available and placed on top (i = 0)
  const allMonthsList = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 18; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const monthNum = String(d.getMonth() + 1).padStart(2, '0');
      const key = `${year}-${monthNum}`;
      const name = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const m = d.getMonth() + 1;
      let q: 'Q1' | 'Q2' | 'Q3' | 'Q4' = 'Q4';
      if (m >= 1 && m <= 3) q = 'Q1';
      else if (m >= 4 && m <= 6) q = 'Q2';
      else if (m >= 7 && m <= 9) q = 'Q3';
      months.push({ name, key, q, isCurrentMonth: i === 0 });
    }
    return months;
  }, []);

  const filteredMonthsStats = useMemo(() => {
    const listWithStats = allMonthsList.map(m => {
      const monthTxs = transactions.filter(t => t.date && t.date.startsWith(m.key));
      const income = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const expense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const cashflowVal = income - expense;
      const ratio = income > 0 ? Math.min(Math.round((expense / income) * 100), 100) : 0;
      return { ...m, income, expense, cashflow: cashflowVal, ratio };
    });

    if (statsQuarterFilter === 'All') return listWithStats;
    return listWithStats.filter(m => m.q === statsQuarterFilter);
  }, [transactions, allMonthsList, statsQuarterFilter]);

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !newTxTitle || !newTxAmount) return;
    try {
      const id = 'tx_' + Date.now();
      const newTx: Transaction = {
        id,
        userId: firebaseUser.uid,
        title: newTxTitle,
        amount: parseFloat(newTxAmount),
        type: defaultTxType,
        category: newTxCategory,
        date: newTxDate,
        notes: newTxNotes
      };
      await setDoc(doc(db, 'transactions', id), newTx);
      setTransactions([newTx, ...transactions]);
      setNewTxTitle('');
      setNewTxAmount('');
      setNewTxNotes('');
      setIsAddTxOpen(false);
    } catch (err) {
      console.error('Failed to save transaction:', err);
    }
  };

  const handleDeleteTx = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'transactions', id));
      setTransactions(transactions.filter(t => t.id !== id));
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleOpenEditTx = (t: Transaction) => {
    setEditingTx(t);
    setEditTxTitle(t.title);
    setEditTxAmount(t.amount.toString());
    setEditTxType(t.type);
    setEditTxCategory(t.category);
    setEditTxDate(t.date || new Date().toISOString().split('T')[0]);
    setEditTxNotes(t.notes || '');
  };

  const handleSaveEditTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !editingTx || !editTxTitle || !editTxAmount) return;
    try {
      const updatedTx: Transaction = {
        ...editingTx,
        title: editTxTitle.trim(),
        amount: parseFloat(editTxAmount),
        type: editTxType,
        category: editTxCategory.trim(),
        date: editTxDate,
        notes: editTxNotes.trim()
      };
      await setDoc(doc(db, 'transactions', editingTx.id), updatedTx);
      setTransactions(transactions.map(t => t.id === editingTx.id ? updatedTx : t));
      setEditingTx(null);
    } catch (err) {
      console.error('Failed to update transaction:', err);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !newBudgetLimit || !newBudgetCategory.trim()) return;
    try {
      const id = 'b_' + Date.now();
      const catVal = newBudgetCategory.trim();
      const budget: Budget = {
        id,
        userId: firebaseUser.uid,
        name: catVal,
        category: catVal,
        limit: parseFloat(newBudgetLimit),
        color: newBudgetColor
      };
      await setDoc(doc(db, 'budgets', id), budget);
      setBudgets([...budgets.filter(b => (b.category || b.name || '').toLowerCase() !== catVal.toLowerCase()), budget]);
      setNewBudgetLimit('');
      setIsAddBudgetOpen(false);
    } catch (err) {
      console.error('Failed to save budget:', err);
    }
  };

  const handleOpenEditBudget = (b: Budget) => {
    setEditingBudget(b);
    setEditBudgetCategory(b.name || b.category);
    setEditBudgetLimit(b.limit.toString());
    setEditBudgetColor(b.color || '#10b981');
  };

  const handleSaveEditBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !editingBudget || !editBudgetLimit || !editBudgetCategory.trim()) return;
    try {
      const catVal = editBudgetCategory.trim();
      const updatedBudget: Budget = {
        ...editingBudget,
        name: catVal,
        category: catVal,
        limit: parseFloat(editBudgetLimit),
        color: editBudgetColor
      };
      await setDoc(doc(db, 'budgets', editingBudget.id), updatedBudget);
      setBudgets(budgets.map(b => b.id === editingBudget.id ? updatedBudget : b));
      setEditingBudget(null);
    } catch (err) {
      console.error('Failed to update budget:', err);
    }
  };

  const handleDeleteBudget = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'budgets', id));
      setBudgets(budgets.filter(b => b.id !== id));
    } catch (err) {
      console.error('Failed to delete budget:', err);
    }
  };

  const handleAskAi = async () => {
    if (!aiPrompt.trim() || !firebaseUser || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: firebaseUser.uid, prompt: aiPrompt })
      });
      const data = await res.json();
      setAiResult(data.advice || 'No response generated.');
    } catch (err) {
      setAiResult('Error generating AI insights.');
    } finally {
      setAiLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-screen bg-[#191919] text-[#e0e0e0] items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-zinc-400">Loading Finance Tracker...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="flex h-screen bg-[#191919] text-white font-sans items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none"></div>
        <div className="max-w-md w-full bg-[#202020] border border-[#2f2f2f] rounded-2xl p-8 shadow-2xl relative z-10 text-center space-y-6">
          <div className="w-16 h-16 bg-gradient-to-tr from-emerald-600 to-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg text-3xl">
            📊
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Finance Tracker</h1>
            <p className="text-xs text-[#9b9b9b] mt-1">Private Notion-style financial workspace connected to Firebase DB <span className="text-emerald-400 font-mono">seashore</span></p>
          </div>

          <button
            onClick={handleGoogleSignIn}
            disabled={isLoggingIn}
            className="w-full bg-white hover:bg-zinc-200 disabled:opacity-50 text-black font-medium py-3 rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2"
          >
            {isLoggingIn ? (
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
            )}
            {isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#191919] text-[#e0e0e0] font-sans antialiased overflow-hidden select-none">
      
      {/* SIDEBAR / LEFT PANEL */}
      <aside className="w-64 bg-[#191919] border-r border-[#262626] flex flex-col p-4 z-10 overflow-y-auto">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#262626] cursor-pointer" onClick={() => setActiveTab('settings')}>
          <div className="flex items-center gap-2 truncate">
            <span className="text-xl">{currentUserProfile?.avatar || '📊'}</span>
            <div className="truncate">
              <span className="text-xs font-medium text-white truncate block">{currentUserProfile?.name || firebaseUser.displayName}</span>
              <span className="text-[10px] text-[#7a7a7a] truncate block">Edit Profile & Settings ⚙️</span>
            </div>
          </div>
        </div>

        {/* Navigation Pages */}
        <div className="text-[11px] font-semibold text-[#8a8a8a] uppercase tracking-wider mb-2">Views & Pages</div>
        <div className="space-y-1 mb-6">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded text-xs font-medium transition ${activeTab === 'dashboard' ? 'bg-[#282828] text-white' : 'text-[#aaa] hover:bg-[#222] hover:text-white'}`}
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" /> Dashboard
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded text-xs font-medium transition ${activeTab === 'stats' ? 'bg-[#282828] text-white' : 'text-[#aaa] hover:bg-[#222] hover:text-white'}`}
          >
            <BarChart2 className="w-3.5 h-3.5 text-purple-400" /> Monthly Stats
          </button>
          <button
            onClick={() => setActiveTab('budgets')}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded text-xs font-medium transition ${activeTab === 'budgets' ? 'bg-[#282828] text-white' : 'text-[#aaa] hover:bg-[#222] hover:text-white'}`}
          >
            <PieChart className="w-3.5 h-3.5 text-amber-400" /> Budgets Management
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded text-xs font-medium transition ${activeTab === 'transactions' ? 'bg-[#282828] text-white' : 'text-[#aaa] hover:bg-[#222] hover:text-white'}`}
          >
            <Receipt className="w-3.5 h-3.5 text-blue-400" /> Transactions DB
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded text-xs font-medium transition ${activeTab === 'settings' ? 'bg-[#282828] text-white' : 'text-[#aaa] hover:bg-[#222] hover:text-white'}`}
          >
            <Settings className="w-3.5 h-3.5 text-zinc-400" /> Settings & Profile
          </button>
        </div>

        <div className="text-[11px] font-semibold text-[#8a8a8a] uppercase tracking-wider mb-2">Quick Actions</div>
        <div className="space-y-1.5 mb-6">
          <button
            onClick={() => { setDefaultTxType('expense'); setIsAddTxOpen(true); }}
            className="w-full flex items-center gap-2 bg-[#222] hover:bg-[#282828] text-zinc-300 hover:text-white px-3 py-2 rounded-md text-xs font-medium border border-[#2f2f2f] transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-rose-400" /> New Expense
          </button>
          <button
            onClick={() => { setDefaultTxType('income'); setIsAddTxOpen(true); }}
            className="w-full flex items-center gap-2 bg-[#222] hover:bg-[#282828] text-zinc-300 hover:text-white px-3 py-2 rounded-md text-xs font-medium border border-[#2f2f2f] transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" /> New Income
          </button>
        </div>

        <div className="space-y-1 mb-6">
          <div className="bg-[#202020] border border-[#2a2a2a] rounded-xl p-3 space-y-2 text-xs">
            <div className="font-semibold text-white flex items-center justify-between">
              <span>{currentMonthName}</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            </div>
            <div className="space-y-1 text-[#9b9b9b] text-[11px]">
              <div className="flex justify-between">
                <span>Income:</span>
                <span className="text-emerald-400 font-medium">{currencySymbol}{currentMonthStats.income.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span>Expense:</span>
                <span className="text-rose-400 font-medium">{currencySymbol}{currentMonthStats.expense.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between border-t border-[#2a2a2a] pt-1">
                <span>Cashflow:</span>
                <span className="text-white font-medium">{currencySymbol}{currentMonthStats.cashflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[#191919] p-6 space-y-6">
        
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {activeTab === 'dashboard' && 'Finance Tracker'}
            {activeTab === 'stats' && 'Monthly Stats'}
            {activeTab === 'budgets' && 'Budgets Management'}
            {activeTab === 'transactions' && 'Transactions Database'}
            {activeTab === 'settings' && 'Profile & Settings'}
          </h1>
          <button
            onClick={() => setIsAiOpen(true)}
            className="flex items-center gap-1.5 bg-[#252525] hover:bg-[#2f2f2f] text-rose-400 border border-[#333] px-3.5 py-1.5 rounded-md text-xs font-medium transition"
          >
            <Sparkles className="w-4 h-4" /> AI Insights
          </button>
        </div>

        {/* ROUTED PAGES */}
        {activeTab === 'dashboard' && (
          <DashboardPage
            transactions={transactions}
            budgets={budgets}
            chartMode={chartMode}
            setChartMode={setChartMode}
            breakdownMode={breakdownMode}
            setBreakdownMode={setBreakdownMode}
            monthlyChartData={monthlyChartData}
            breakdownData={breakdownData}
            totalIncome={totalIncome}
            totalExpense={totalExpense}
            currencySymbol={currencySymbol}
            colors={COLORS}
            onOpenAddTx={(type, datePrefill) => {
              setDefaultTxType(type);
              if (datePrefill) {
                setNewTxDate(datePrefill);
              }
              setIsAddTxOpen(true);
            }}
            onOpenEditTx={handleOpenEditTx}
            onDeleteTx={handleDeleteTx}
          />
        )}

        {activeTab === 'stats' && (
          <MonthlyStatsPage
            statsQuarterFilter={statsQuarterFilter}
            setStatsQuarterFilter={setStatsQuarterFilter}
            filteredMonthsStats={filteredMonthsStats}
            currencySymbol={currencySymbol}
          />
        )}

        {activeTab === 'budgets' && (
          <BudgetsPage
            budgets={budgets}
            transactions={transactions}
            currencySymbol={currencySymbol}
            onOpenAddBudget={() => setIsAddBudgetOpen(true)}
            onOpenEditBudget={handleOpenEditBudget}
            onDeleteBudget={handleDeleteBudget}
          />
        )}

        {activeTab === 'transactions' && (
          <TransactionsPage
            transactions={transactions}
            currencySymbol={currencySymbol}
            onOpenAddTx={(type) => { setDefaultTxType(type); setIsAddTxOpen(true); }}
            onOpenEditTx={handleOpenEditTx}
            onDeleteTx={handleDeleteTx}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPage
            currentUserProfile={currentUserProfile}
            setCurrentUserProfile={setCurrentUserProfile}
            firebaseUser={firebaseUser}
            db={db}
            currencies={CURRENCIES}
            onSignOut={handleSignOut}
          />
        )}

      </main>

      {/* MODALS */}
      {isAddTxOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white capitalize">New {defaultTxType}</h3>
              <button onClick={() => setIsAddTxOpen(false)} className="text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreateTransaction} className="space-y-3">
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Title</label>
                <input
                  type="text"
                  required
                  placeholder={defaultTxType === 'expense' ? "e.g. Electricity, Groceries" : "e.g. Salary, Freelance"}
                  value={newTxTitle}
                  onChange={e => setNewTxTitle(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9b9b9b] block mb-1">Amount ({currencySymbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={newTxAmount}
                    onChange={e => setNewTxAmount(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9b9b9b] block mb-1">Category</label>
                  <select
                    value={newTxCategory}
                    onChange={e => setNewTxCategory(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Date</label>
                <input
                  type="date"
                  value={newTxDate}
                  onChange={e => setNewTxDate(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setIsAddTxOpen(false)} className="flex-1 bg-[#333] text-white py-2 rounded-lg text-xs">Cancel</button>
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-xs font-medium">Save to seashore DB</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT TRANSACTION MODAL */}
      {editingTx && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white">Edit {editTxType === 'income' ? 'Income' : 'Expense'}</h3>
              <button onClick={() => setEditingTx(null)} className="text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSaveEditTransaction} className="space-y-3">
              {/* Type Switcher */}
              <div className="flex bg-[#1a1a1a] p-1 rounded-lg border border-[#333]">
                <button
                  type="button"
                  onClick={() => setEditTxType('expense')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${editTxType === 'expense' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'text-[#888] hover:text-white'}`}
                >
                  Expense
                </button>
                <button
                  type="button"
                  onClick={() => setEditTxType('income')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${editTxType === 'income' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-[#888] hover:text-white'}`}
                >
                  Income
                </button>
              </div>

              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={editTxTitle}
                  onChange={e => setEditTxTitle(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9b9b9b] block mb-1">Amount ({currencySymbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editTxAmount}
                    onChange={e => setEditTxAmount(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9b9b9b] block mb-1">Category</label>
                  <select
                    value={editTxCategory}
                    onChange={e => setEditTxCategory(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Date</label>
                <input
                  type="date"
                  value={editTxDate}
                  onChange={e => setEditTxDate(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  placeholder="Additional notes..."
                  value={editTxNotes}
                  onChange={e => setEditTxNotes(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setEditingTx(null)} className="flex-1 bg-[#333] text-white py-2 rounded-lg text-xs">Cancel</button>
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-xs font-medium">Update in seashore DB</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BUDGET MODAL */}
      {isAddBudgetOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white">Set Category Budget Limit</h3>
              <button onClick={() => setIsAddBudgetOpen(false)} className="text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSaveBudget} className="space-y-3">
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Budget Name / Category</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Prestamo, Groceries, Dining..."
                  value={newBudgetCategory}
                  onChange={e => setNewBudgetCategory(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <div className="flex items-center gap-1.5 overflow-x-auto py-1.5 scrollbar-thin">
                  <span className="text-[10px] text-[#777] shrink-0">Quick pick:</span>
                  {availableCategories.slice(0, 8).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewBudgetCategory(c)}
                      className={`px-2 py-0.5 rounded text-[10px] shrink-0 transition ${newBudgetCategory.toLowerCase() === c.toLowerCase() ? 'bg-emerald-600 text-white' : 'bg-[#2a2a2a] text-zinc-300 hover:text-white'}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#777]">The budget name and expense category match for live tracking.</p>
              </div>
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Monthly Limit ({currencySymbol})</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  placeholder="500"
                  value={newBudgetLimit}
                  onChange={e => setNewBudgetLimit(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Bar Color</label>
                <div className="flex items-center gap-2">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewBudgetColor(c)}
                      className={`w-5 h-5 rounded-full transition-transform ${newBudgetColor === c ? 'scale-125 ring-2 ring-white' : 'opacity-80 hover:opacity-100'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setIsAddBudgetOpen(false)} className="flex-1 bg-[#333] text-white py-2 rounded-lg text-xs">Cancel</button>
                <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-xs font-medium">Save Budget</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT BUDGET MODAL */}
      {editingBudget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white">Edit Budget Limit</h3>
              <button onClick={() => setEditingBudget(null)} className="text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSaveEditBudget} className="space-y-3">
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Budget Name / Category</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Prestamo, Groceries, Dining..."
                  value={editBudgetCategory}
                  onChange={e => setEditBudgetCategory(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <div className="flex items-center gap-1.5 overflow-x-auto py-1.5 scrollbar-thin">
                  <span className="text-[10px] text-[#777] shrink-0">Quick pick:</span>
                  {availableCategories.slice(0, 8).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditBudgetCategory(c)}
                      className={`px-2 py-0.5 rounded text-[10px] shrink-0 transition ${editBudgetCategory.toLowerCase() === c.toLowerCase() ? 'bg-emerald-600 text-white' : 'bg-[#2a2a2a] text-zinc-300 hover:text-white'}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#777]">The budget name and expense category match for live tracking.</p>
              </div>
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Monthly Limit ({currencySymbol})</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  placeholder="500"
                  value={editBudgetLimit}
                  onChange={e => setEditBudgetLimit(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Bar Color</label>
                <div className="flex items-center gap-2">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditBudgetColor(c)}
                      className={`w-5 h-5 rounded-full transition-transform ${editBudgetColor === c ? 'scale-125 ring-2 ring-white' : 'opacity-80 hover:opacity-100'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setEditingBudget(null)} className="flex-1 bg-[#333] hover:bg-[#3a3a3a] text-white py-2 rounded-lg text-xs transition">Cancel</button>
                <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-xs font-medium transition">Update Budget</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAiOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-rose-400" /> NotionFin AI Assistant
              </h3>
              <button onClick={() => setIsAiOpen(false)} className="text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            
            <div className="space-y-3">
              <textarea
                rows={3}
                placeholder="Ask for financial insights, budget advice, or spending analysis..."
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl p-3 text-xs text-white focus:outline-none focus:border-rose-400"
              />
              <button
                onClick={handleAskAi}
                disabled={aiLoading || !aiPrompt.trim()}
                className="w-full bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-xs font-medium transition flex items-center justify-center gap-1.5"
              >
                {aiLoading ? 'Analyzing...' : 'Generate AI Insights'}
              </button>

              {aiResult && (
                <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-4 text-xs text-zinc-200 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {aiResult}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
