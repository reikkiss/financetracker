import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus,
  Sparkles,
  Receipt,
  PieChart,
  LayoutDashboard,
  BarChart2,
  Settings,
  Upload,
  ArrowRightLeft,
  Calendar,
  Sun,
  Moon
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  getDocFromServer,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

import DashboardPage from './components/DashboardPage';
import MonthlyStatsPage from './components/MonthlyStatsPage';
import BudgetsPage, { Budget } from './components/BudgetsPage';
import {
  LoanQuota,
  LoanCalcMethod,
  LoanRatePeriod,
  CardInstallment,
  allocateLoanPayment,
  generateLoanQuotasSchedule,
  reverseLoanPaymentOnQuotas,
  findFuzzyPendingMatch
} from './utils/financeMath';
import TransactionsPage from './components/TransactionsPage';
import SettingsPage from './components/SettingsPage';
import StatementUploadModal, { ImportedTransactionDraft } from './components/StatementUploadModal';
import AddTransactionModal from './components/AddTransactionModal';
import EditTransactionModal from './components/EditTransactionModal';
import AddBudgetModal from './components/AddBudgetModal';
import EditBudgetModal from './components/EditBudgetModal';
import TransferModal from './components/TransferModal';
import AiAdvisorModal from './components/AiAdvisorModal';
import { getApiUrl } from './utils/apiConfig';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || 'seashore');
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = v;
    }
  }
  return clean as T;
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string;
  currency: string;
  monthlyBudget: number;
  fxRateUsdToDop?: number;
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
  loanPrincipalPaid?: number;
  loanInterestPaid?: number;
  paidQuotaIds?: string[];
  isTransfer?: boolean;
  transferToBudgetId?: string;
  status?: 'pending' | 'cleared';
  emailId?: string;
  emailOutcome?: 'approved' | 'declined' | 'reversed';
  emailContext?: string;
  statementCycle?: string;
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

const COLORS = ['#34C759', '#0071E3', '#FF9F0A', '#FF2D55', '#AF52DE', '#5AC8FA', '#FF3B30', '#5856D6'];

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'stats' | 'budgets' | 'transactions' | 'settings'>('dashboard');

  // Data states (strictly from Firestore)
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);

  // UI Tabs & Filters
  const [chartMode, setChartMode] = useState<'Expense' | 'Income' | 'Cashflow'>('Cashflow');
  const [breakdownMode, setBreakdownMode] = useState<'Expense' | 'Income'>('Expense');
  const [statsQuarterFilter, setStatsQuarterFilter] = useState<'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('All');

  // Modals & Prefill Triggers
  const [isAddTxOpen, setIsAddTxOpen] = useState(false);
  const [defaultTxType, setDefaultTxType] = useState<'income' | 'expense'>('expense');
  const [newTxDate, setNewTxDate] = useState(new Date().toISOString().split('T')[0]);
  const [newTxBudgetId, setNewTxBudgetId] = useState('');
  const [newTxIsLoanPayment, setNewTxIsLoanPayment] = useState(false);
  const [newTxTitle, setNewTxTitle] = useState('');
  const [newTxCategory, setNewTxCategory] = useState('');

  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferInitialFromId, setTransferInitialFromId] = useState<string | undefined>(undefined);

  const [isAddBudgetOpen, setIsAddBudgetOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  const [isUploadStatementOpen, setIsUploadStatementOpen] = useState(false);

  const [isAiOpen, setIsAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('app_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    localStorage.setItem('app_theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const [globalSelectedMonth, setGlobalSelectedMonth] = useState<string>(() => {
    return localStorage.getItem('global_selected_month') || new Date().toISOString().slice(0, 7);
  });

  useEffect(() => {
    localStorage.setItem('global_selected_month', globalSelectedMonth);
  }, [globalSelectedMonth]);

  const displayTransactions = useMemo(() => {
    if (globalSelectedMonth === 'All') return transactions;
    return transactions.filter(t => t.date && t.date.startsWith(globalSelectedMonth));
  }, [transactions, globalSelectedMonth]);

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
          name: (user.displayName || 'Finance User').slice(0, 100),
          email: (user.email || '').slice(0, 100),
          avatar: '💳',
          currency: 'USD',
          monthlyBudget: 5000,
          fxRateUsdToDop: 60.5
        };
        await setDoc(userRef, newProfile);
        setCurrentUserProfile(newProfile);
      }
      await fetchUserData(user.uid);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
    }
  };

  const fetchUserData = async (userId: string) => {
    try {
      const [txSnap, budgetSnap] = await Promise.all([
        getDocs(query(collection(db, 'transactions'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'budgets'), where('userId', '==', userId)))
      ]);
      const fetchedTxs = txSnap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
      fetchedTxs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setTransactions(fetchedTxs);
      const fetchedBudgets = budgetSnap.docs.map(d => ({ id: d.id, ...d.data() } as Budget));
      let savedOrderIds: string[] = [];
      try {
        const rawOrder = localStorage.getItem(`seashore_budget_order_${userId}`);
        if (rawOrder) savedOrderIds = JSON.parse(rawOrder);
      } catch {
        // ignore
      }
      fetchedBudgets.sort((a, b) => {
        const aHasOrder = typeof a.order === 'number' && !isNaN(a.order);
        const bHasOrder = typeof b.order === 'number' && !isNaN(b.order);
        if (aHasOrder && bHasOrder && a.order !== b.order) {
          return (a.order as number) - (b.order as number);
        }
        if (aHasOrder && !bHasOrder) return -1;
        if (!aHasOrder && bHasOrder) return 1;
        const aIdx = savedOrderIds.indexOf(a.id);
        const bIdx = savedOrderIds.indexOf(b.id);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return (a.name || a.category || '').localeCompare(b.name || b.category || '');
      });
      setBudgets(fetchedBudgets);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'transactions/budgets');
    }
  };

  const handleGoogleSignIn = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err.code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'your-domain';
        setAuthError(
          `Domain "${host}" is not authorized in Firebase Auth yet. Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains.`
        );
      } else if (err.code !== 'auth/cancelled-popup-request' && err.code !== 'auth/popup-closed-by-user') {
        console.error('Sign-in error:', err);
        setAuthError(err.message || 'Failed to sign in with Google.');
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
  const baseCurrencyCode = currentUserProfile?.currency || 'USD';
  const fxRateUsdToDop = currentUserProfile?.fxRateUsdToDop && currentUserProfile.fxRateUsdToDop > 0 ? currentUserProfile.fxRateUsdToDop : 60.5;

  const totalIncome = useMemo(
    () =>
      displayTransactions
        .filter(t => t.type === 'income' && !t.isTransfer && t.emailOutcome !== 'declined')
        .reduce((s, t) => s + t.amount, 0),
    [displayTransactions]
  );
  const totalExpense = useMemo(
    () =>
      displayTransactions
        .filter(t => t.type === 'expense' && !t.isTransfer && t.emailOutcome !== 'declined')
        .reduce((s, t) => s + t.amount, 0),
    [displayTransactions]
  );

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
    displayTransactions
      .filter(t => !t.isTransfer && t.emailOutcome !== 'declined' && t.type === breakdownMode.toLowerCase())
      .forEach(t => {
        map[t.category] = (map[t.category] || 0) + t.amount;
      });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [displayTransactions, breakdownMode]);

  const monthlyChartData = useMemo(() => {
    if (transactions.length === 0) return [];
    const map: Record<string, { income: number; expense: number }> = {};
    transactions.forEach(t => {
      if (t.isTransfer || t.emailOutcome === 'declined') return;
      const monthKey = t.date ? t.date.slice(0, 7) : 'Unknown';
      if (!map[monthKey]) {
        map[monthKey] = { income: 0, expense: 0 };
      }
      if (t.type === 'income') {
        map[monthKey].income += Number(t.amount) || 0;
      } else {
        map[monthKey].expense += Number(t.amount) || 0;
      }
    });

    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, totals]) => {
        const income = Number(totals.income.toFixed(2));
        const expense = Number(totals.expense.toFixed(2));
        return {
          name: monthKey,
          date: monthKey,
          income,
          expense,
          cashflow: Number((income - expense).toFixed(2))
        };
      });
  }, [transactions]);

  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const selectedMonthName = useMemo(() => {
    if (globalSelectedMonth === 'All') return 'All Months';
    const [y, m] = globalSelectedMonth.split('-').map(Number);
    if (!y || !m) return globalSelectedMonth;
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }, [globalSelectedMonth]);

  const selectedMonthStats = useMemo(() => {
    const mTransactions = displayTransactions.filter(t => !t.isTransfer && t.emailOutcome !== 'declined');
    const income = mTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = mTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expense, cashflow: income - expense };
  }, [displayTransactions]);

  // 18 months list with current actual month first
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
      const monthTxs = transactions.filter(
        t => !t.isTransfer && t.emailOutcome !== 'declined' && t.date && t.date.startsWith(m.key)
      );
      const income = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const expense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const cashflowVal = income - expense;
      const ratio = income > 0 ? Math.min(Math.round((expense / income) * 100), 100) : 0;
      return { ...m, income, expense, cashflow: cashflowVal, ratio };
    });

    if (statsQuarterFilter === 'All') return listWithStats;
    return listWithStats.filter(m => m.q === statsQuarterFilter);
  }, [transactions, allMonthsList, statsQuarterFilter]);

  const applySingleTxInMemory = (
    tx: Transaction,
    budgetList: Budget[]
  ): { enrichedTx: Transaction; nextBudgets: Budget[]; touchedIds: string[] } => {
    if (tx.emailOutcome === 'declined') {
      return { enrichedTx: tx, nextBudgets: budgetList, touchedIds: [] };
    }
    const amt = Math.abs(Number(tx.amount) || 0);
    if (amt <= 0) return { enrichedTx: tx, nextBudgets: budgetList, touchedIds: [] };

    const working = budgetList.map(b => ({ ...b }));
    const touchedIds = new Set<string>();
    let enrichedTx: Transaction = { ...tx };

    const isLiquid = (b?: Budget) => b?.accountType === 'bank_account' || b?.accountType === 'debit_account';
    const isCreditCard = (b?: Budget) => b?.accountType === 'credit_card';
    const isLoan = (b?: Budget) => b?.accountType === 'loan';

    const applyLoanPaymentToTarget = (loanBudget: Budget) => {
      const remPrin = Number(loanBudget.actualUsedAmount ?? loanBudget.creditLimit ?? 0);
      const loanPrincipal = Number(loanBudget.creditLimit || loanBudget.limit || remPrin);
      const split = allocateLoanPayment({
        amount: amt,
        principal: loanPrincipal,
        remainingPrincipal: remPrin,
        apr: Number(loanBudget.apr || 0),
        ratePeriod: loanBudget.loanRatePeriod || 'annual',
        calcMethod: loanBudget.loanCalcMethod || 'amortized',
        quotas: loanBudget.loanQuotas,
        paymentDate: tx.date,
        paymentTxId: tx.id
      });
      loanBudget.actualUsedAmount = Math.max(0, Number((remPrin - split.principalPaid).toFixed(2)));
      if (split.updatedQuotas) {
        loanBudget.loanQuotas = split.updatedQuotas;
      }
      touchedIds.add(loanBudget.id);
      enrichedTx = {
        ...enrichedTx,
        loanPrincipalPaid: split.principalPaid,
        loanInterestPaid: split.interestPaid,
        ...(split.paidQuotaIds.length > 0 ? { paidQuotaIds: split.paidQuotaIds } : {})
      };
    };

    if (tx.isTransfer && tx.budgetId && tx.transferToBudgetId && tx.budgetId !== tx.transferToBudgetId) {
      const src = working.find(b => b.id === tx.budgetId);
      const dst = working.find(b => b.id === tx.transferToBudgetId);
      if (src) {
        if (isLiquid(src)) {
          src.accountBalance = Number(((src.accountBalance || 0) - amt).toFixed(2));
          touchedIds.add(src.id);
        } else if (isCreditCard(src) || isLoan(src)) {
          src.actualUsedAmount = Math.max(0, Number(((src.actualUsedAmount || 0) + amt).toFixed(2)));
          touchedIds.add(src.id);
        }
      }
      if (dst) {
        if (isLiquid(dst)) {
          dst.accountBalance = Number(((dst.accountBalance || 0) + amt).toFixed(2));
          touchedIds.add(dst.id);
        } else if (isCreditCard(dst)) {
          dst.actualUsedAmount = Math.max(0, Number(((dst.actualUsedAmount || 0) - amt).toFixed(2)));
          touchedIds.add(dst.id);
        } else if (isLoan(dst)) {
          applyLoanPaymentToTarget(dst);
        }
      }
      return { enrichedTx, nextBudgets: working, touchedIds: Array.from(touchedIds) };
    }

    if (!tx.budgetId) return { enrichedTx, nextBudgets: budgetList, touchedIds: [] };
    const b = working.find(item => item.id === tx.budgetId);
    if (!b) return { enrichedTx, nextBudgets: budgetList, touchedIds: [] };

    if (isLiquid(b)) {
      const delta = tx.type === 'income' ? amt : -amt;
      b.accountBalance = Number(((b.accountBalance || 0) + delta).toFixed(2));
      touchedIds.add(b.id);
    } else if (isCreditCard(b)) {
      const delta = tx.isLoanPayment || tx.type === 'income' ? -amt : amt;
      b.actualUsedAmount = Math.max(0, Number(((b.actualUsedAmount || 0) + delta).toFixed(2)));
      touchedIds.add(b.id);
    } else if (isLoan(b)) {
      if (tx.isLoanPayment || tx.type === 'income') {
        applyLoanPaymentToTarget(b);
      } else {
        b.actualUsedAmount = Math.max(0, Number(((b.actualUsedAmount || 0) + amt).toFixed(2)));
        touchedIds.add(b.id);
      }
    }

    return { enrichedTx, nextBudgets: working, touchedIds: Array.from(touchedIds) };
  };

  const revertSingleTxInMemory = (
    tx: Transaction,
    budgetList: Budget[]
  ): { nextBudgets: Budget[]; touchedIds: string[] } => {
    if (tx.emailOutcome === 'declined') {
      return { nextBudgets: budgetList, touchedIds: [] };
    }
    const amt = Math.abs(Number(tx.amount) || 0);
    if (amt <= 0) return { nextBudgets: budgetList, touchedIds: [] };

    const working = budgetList.map(b => ({ ...b }));
    const touchedIds = new Set<string>();

    const isLiquid = (b?: Budget) => b?.accountType === 'bank_account' || b?.accountType === 'debit_account';
    const isCreditCard = (b?: Budget) => b?.accountType === 'credit_card';
    const isLoan = (b?: Budget) => b?.accountType === 'loan';

    const revertLoanPaymentOnTarget = (loanBudget: Budget) => {
      const principalToRestore =
        tx.loanPrincipalPaid !== undefined ? Number(tx.loanPrincipalPaid) || 0 : amt;
      const maxPrin = Number(loanBudget.creditLimit || loanBudget.limit || 0);
      const currentUsed = Number(loanBudget.actualUsedAmount || 0);
      const restored = Number((currentUsed + principalToRestore).toFixed(2));
      loanBudget.actualUsedAmount = maxPrin > 0 ? Math.min(maxPrin, restored) : restored;
      if (loanBudget.loanQuotas && loanBudget.loanQuotas.length > 0) {
        loanBudget.loanQuotas = reverseLoanPaymentOnQuotas(loanBudget.loanQuotas, tx.paidQuotaIds, tx.id);
      }
      touchedIds.add(loanBudget.id);
    };

    if (tx.isTransfer && tx.budgetId && tx.transferToBudgetId && tx.budgetId !== tx.transferToBudgetId) {
      const src = working.find(b => b.id === tx.budgetId);
      const dst = working.find(b => b.id === tx.transferToBudgetId);
      if (src) {
        if (isLiquid(src)) {
          src.accountBalance = Number(((src.accountBalance || 0) + amt).toFixed(2));
          touchedIds.add(src.id);
        } else if (isCreditCard(src) || isLoan(src)) {
          src.actualUsedAmount = Math.max(0, Number(((src.actualUsedAmount || 0) - amt).toFixed(2)));
          touchedIds.add(src.id);
        }
      }
      if (dst) {
        if (isLiquid(dst)) {
          dst.accountBalance = Number(((dst.accountBalance || 0) - amt).toFixed(2));
          touchedIds.add(dst.id);
        } else if (isCreditCard(dst)) {
          dst.actualUsedAmount = Math.max(0, Number(((dst.actualUsedAmount || 0) + amt).toFixed(2)));
          touchedIds.add(dst.id);
        } else if (isLoan(dst)) {
          revertLoanPaymentOnTarget(dst);
        }
      }
      return { nextBudgets: working, touchedIds: Array.from(touchedIds) };
    }

    if (!tx.budgetId) return { nextBudgets: budgetList, touchedIds: [] };
    const b = working.find(item => item.id === tx.budgetId);
    if (!b) return { nextBudgets: budgetList, touchedIds: [] };

    if (isLiquid(b)) {
      const delta = tx.type === 'income' ? -amt : amt;
      b.accountBalance = Number(((b.accountBalance || 0) + delta).toFixed(2));
      touchedIds.add(b.id);
    } else if (isCreditCard(b)) {
      const delta = tx.isLoanPayment || tx.type === 'income' ? amt : -amt;
      b.actualUsedAmount = Math.max(0, Number(((b.actualUsedAmount || 0) + delta).toFixed(2)));
      touchedIds.add(b.id);
    } else if (isLoan(b)) {
      if (tx.isLoanPayment || tx.type === 'income') {
        revertLoanPaymentOnTarget(b);
      } else {
        b.actualUsedAmount = Math.max(0, Number(((b.actualUsedAmount || 0) - amt).toFixed(2)));
        touchedIds.add(b.id);
      }
    }

    return { nextBudgets: working, touchedIds: Array.from(touchedIds) };
  };

  const persistTouchedBudgets = async (touchedIds: string[], updatedBudgets: Budget[]) => {
    const uniqueIds = Array.from(new Set(touchedIds));
    if (uniqueIds.length === 0) return updatedBudgets;
    for (const budgetId of uniqueIds) {
      const target = updatedBudgets.find(b => b.id === budgetId);
      if (!target) continue;
      try {
        await setDoc(doc(db, 'budgets', budgetId), stripUndefined(target));
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
      }
    }
    setBudgets(updatedBudgets);
    return updatedBudgets;
  };

  const ensureBudgetsForCategories = async (
    categoryExpenseTotals: Record<string, number>,
    currentBudgets: Budget[]
  ): Promise<Budget[]> => {
    if (!firebaseUser) return currentBudgets;
    const existingKeys = new Set(
      currentBudgets
        .flatMap(b => [(b.name || '').trim().toLowerCase(), (b.category || '').trim().toLowerCase()])
        .filter(Boolean)
    );

    const newBudgets: Budget[] = [];
    const baseTs = Date.now();
    let idx = 0;

    for (const [rawCat, suggestedLimit] of Object.entries(categoryExpenseTotals)) {
      const cat = rawCat.trim().slice(0, 50);
      if (!cat) continue;
      const key = cat.toLowerCase();
      if (existingKeys.has(key)) continue;

      existingKeys.add(key);
      const maxOrder = currentBudgets.reduce((m, b) => Math.max(m, typeof b.order === 'number' ? b.order : -1), -1);
      const id = `b_${baseTs}_${idx}`;
      const created: Budget = {
        id,
        userId: firebaseUser.uid,
        name: cat,
        category: cat,
        description: `Auto-created budget for ${cat}`,
        limit: Math.max(0, Number(suggestedLimit.toFixed(2))),
        color: COLORS[(currentBudgets.length + idx) % COLORS.length],
        accountType: 'standard',
        extraExpenses: 0,
        items: [],
        order: maxOrder + 1 + idx
      };
      idx++;

      try {
        await setDoc(doc(db, 'budgets', id), created);
        newBudgets.push(created);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `budgets/${id}`);
      }
    }

    if (newBudgets.length === 0) return currentBudgets;
    const merged = [...currentBudgets, ...newBudgets];
    setBudgets(merged);
    return merged;
  };

  const handleDeleteTx = async (id: string) => {
    const targetTx = transactions.find(t => t.id === id);
    try {
      await deleteDoc(doc(db, 'transactions', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${id}`);
      return;
    }

    if (targetTx) {
      const { nextBudgets, touchedIds } = revertSingleTxInMemory(targetTx, budgets);
      if (touchedIds.length > 0) {
        await persistTouchedBudgets(touchedIds, nextBudgets);
      }
    }
    setTransactions(prev => prev.filter(t => t.id !== id));
  };

  const handleOpenEditTx = (t: Transaction) => {
    setEditingTx(t);
  };

  const handleOpenTransfer = (fromBudget?: Budget) => {
    if (budgets.length < 2) return;
    setTransferInitialFromId(fromBudget?.id);
    setIsTransferOpen(true);
  };

  const budgetsRef = useRef(budgets);
  budgetsRef.current = budgets;
  const transactionsRef = useRef(transactions);
  transactionsRef.current = transactions;

  const handleImportStatementTransactions = async (rows: ImportedTransactionDraft[]) => {
    if (!firebaseUser || rows.length === 0) return;

    const baseTs = Date.now();
    const createdTxs: Transaction[] = [];
    const categoryTotals: Record<string, number> = {};

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.isTransfer) continue;
      const cat = (r.category || 'Other').trim().slice(0, 50);
      const amt = Math.abs(Number(r.amount) || 0);
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (r.type === 'expense' ? amt : 0);
    }

    let workingBudgets = await ensureBudgetsForCategories(categoryTotals, budgets);
    const allTouchedIds = new Set<string>();
    const updatedTxsMap = new Map<string, Transaction>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const baseBudgetId = r.budgetId || '';
      const stmtAmt = Math.abs(Number(r.amount) || 0);

      // Fuzzy match against existing pending (flotante) email transactions
      const matchedPending = findFuzzyPendingMatch(transactions, {
        budgetId: baseBudgetId,
        amount: stmtAmt,
        date: r.date || new Date().toISOString().split('T')[0]
      });

      if (matchedPending) {
        const updatedPending: Transaction = stripUndefined({
          ...matchedPending,
          amount: stmtAmt,
          status: 'cleared' as const,
          date: (r.date || matchedPending.date).slice(0, 20),
          ...(r.category ? { category: r.category.slice(0, 50) } : {}),
          ...(r.statementCycle ? { statementCycle: r.statementCycle.slice(0, 20) } : {})
        });
        const reverted = revertSingleTxInMemory(matchedPending, workingBudgets);
        const applied = applySingleTxInMemory(updatedPending, reverted.nextBudgets);
        workingBudgets = applied.nextBudgets;
        reverted.touchedIds.forEach(tid => allTouchedIds.add(tid));
        applied.touchedIds.forEach(tid => allTouchedIds.add(tid));

        updatedTxsMap.set(updatedPending.id, applied.enrichedTx);
        try {
          await setDoc(doc(db, 'transactions', updatedPending.id), applied.enrichedTx);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `transactions/${updatedPending.id}`);
        }
      } else {
        const id = `tx_${baseTs}_${i}`;
        const isTransferTx = Boolean(r.isTransfer && r.budgetId && r.transferToBudgetId && r.budgetId !== r.transferToBudgetId);
        const newTx: Transaction = stripUndefined({
          id,
          userId: firebaseUser.uid,
          title: (r.title || 'Transaction').trim().slice(0, 200),
          amount: stmtAmt,
          type: isTransferTx ? 'expense' : r.type === 'income' ? 'income' : 'expense',
          category: (isTransferTx ? (r.category || 'Transfer') : r.category || 'Other').trim().slice(0, 50),
          date: (r.date || new Date().toISOString().split('T')[0]).slice(0, 20),
          notes: (r.notes || '').trim().slice(0, 500),
          ...(r.budgetId ? { budgetId: r.budgetId.slice(0, 50) } : {}),
          isLoanPayment: Boolean(r.isLoanPayment),
          isTransfer: isTransferTx,
          status: 'cleared' as const,
          ...(isTransferTx && r.transferToBudgetId ? { transferToBudgetId: r.transferToBudgetId.slice(0, 50) } : {}),
          ...(r.statementCycle ? { statementCycle: r.statementCycle.slice(0, 20) } : {})
        });

        const { enrichedTx, nextBudgets, touchedIds } = applySingleTxInMemory(newTx, workingBudgets);
        workingBudgets = nextBudgets;
        touchedIds.forEach(tid => allTouchedIds.add(tid));

        try {
          await setDoc(doc(db, 'transactions', id), stripUndefined(enrichedTx));
          createdTxs.push(enrichedTx);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `transactions/${id}`);
        }
      }
    }

    if (allTouchedIds.size > 0) {
      await persistTouchedBudgets(Array.from(allTouchedIds), workingBudgets);
    }

    setTransactions(prev => {
      const merged = prev.map(t => updatedTxsMap.get(t.id) || t);
      return [...createdTxs, ...merged.filter(t => !createdTxs.some(c => c.id === t.id))].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    });
  };

  const handleToggleBudgetItemPaid = async (budgetId: string, itemId: string) => {
    const target = budgets.find(b => b.id === budgetId);
    if (!target || !target.items || (target.accountType || 'standard') !== 'standard') return;
    const updatedItems = target.items.map(item =>
      item.id === itemId ? { ...item, isPaid: !item.isPaid } : item
    );
    const updatedBudget: Budget = stripUndefined({ ...target, items: updatedItems });
    try {
      await setDoc(doc(db, 'budgets', budgetId), updatedBudget);
      setBudgets(prev => prev.map(b => (b.id === budgetId ? updatedBudget : b)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
    }
  };

  const getUnlinkedLoanPayments = (target: Budget, txList: Transaction[]): Transaction[] => {
    const targetName = (target.name || target.category || '').trim().toLowerCase();
    const quotas = target.loanQuotas || [];
    const linkedTxIds = new Set(
      quotas.filter(q => q.isPaid && q.paymentTxId).map(q => q.paymentTxId as string)
    );
    return txList
      .filter(
        t =>
          ((t.budgetId === target.id || (t.category || '').trim().toLowerCase() === targetName) &&
            t.isLoanPayment &&
            !t.isTransfer) ||
          (t.isTransfer && t.transferToBudgetId === target.id)
      )
      .filter(t => {
        if (linkedTxIds.has(t.id)) return false;
        if (t.paidQuotaIds && t.paidQuotaIds.length > 0) {
          const stillPaid = t.paidQuotaIds.some(qid => quotas.some(q => q.id === qid && q.isPaid));
          if (stillPaid) return false;
        }
        return true;
      })
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  };

  const reconcileUnlinkedPaymentsForLoan = async (
    target: Budget,
    unlinked: Transaction[]
  ): Promise<{ updatedBudget: Budget; updatedTxMap: Record<string, Transaction> } | null> => {
    if (!target.loanQuotas || unlinked.length === 0) return null;

    const loanPrincipal = Number(target.creditLimit || target.limit || 0);
    let remPrin = Number(target.actualUsedAmount ?? loanPrincipal);
    for (const ut of unlinked) {
      const prevPrin =
        typeof ut.loanPrincipalPaid === 'number'
          ? Math.max(0, Number(ut.loanPrincipalPaid) || 0)
          : Math.abs(Number(ut.amount) || 0);
      remPrin = Number((remPrin + prevPrin).toFixed(2));
    }
    if (loanPrincipal > 0) remPrin = Math.min(loanPrincipal, remPrin);

    let workingQuotas: LoanQuota[] = target.loanQuotas.map(q => ({ ...q }));
    const updatedTxMap: Record<string, Transaction> = {};
    let partialTxIds: string[] = [];
    let partialPoolAmt = 0;

    for (const ut of unlinked) {
      const split = allocateLoanPayment({
        amount: Math.abs(Number(ut.amount) || 0),
        principal: loanPrincipal,
        remainingPrincipal: remPrin,
        apr: Number(target.apr || 0),
        ratePeriod: target.loanRatePeriod || 'annual',
        calcMethod: target.loanCalcMethod || 'amortized',
        quotas: workingQuotas,
        paymentDate: ut.date,
        paymentTxId: ut.id
      });

      remPrin = Math.max(0, Number((remPrin - split.principalPaid).toFixed(2)));
      if (split.updatedQuotas) workingQuotas = split.updatedQuotas;

      let paidIdsForUt = [...split.paidQuotaIds];
      if (paidIdsForUt.length > 0) {
        partialTxIds = [];
        partialPoolAmt = 0;
      } else {
        partialTxIds.push(ut.id);
        partialPoolAmt = Number((partialPoolAmt + Math.abs(Number(ut.amount) || 0)).toFixed(2));
        const nextUnpaid = workingQuotas.find(q => !q.isPaid);
        if (nextUnpaid && partialPoolAmt >= nextUnpaid.amount - 1.0) {
          paidIdsForUt = [nextUnpaid.id];
          workingQuotas = workingQuotas.map(q =>
            q.id === nextUnpaid.id
              ? { ...q, isPaid: true, paidDate: ut.date || new Date().toISOString().split('T')[0], paymentTxId: ut.id }
              : q
          );
          for (const prevId of partialTxIds) {
            if (prevId !== ut.id && updatedTxMap[prevId]) {
              updatedTxMap[prevId] = { ...updatedTxMap[prevId], paidQuotaIds: [nextUnpaid.id] };
            }
          }
          partialTxIds = [];
          partialPoolAmt = 0;
        }
      }

      updatedTxMap[ut.id] = stripUndefined({
        ...ut,
        loanPrincipalPaid: split.principalPaid,
        loanInterestPaid: split.interestPaid,
        ...(paidIdsForUt.length > 0 ? { paidQuotaIds: paidIdsForUt } : {})
      });
    }

    const updatedBudget: Budget = stripUndefined({
      ...target,
      actualUsedAmount: remPrin,
      loanQuotas: workingQuotas
    });

    for (const updatedTx of Object.values(updatedTxMap)) {
      try {
        await setDoc(doc(db, 'transactions', updatedTx.id), stripUndefined(updatedTx));
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `transactions/${updatedTx.id}`);
      }
    }

    try {
      await setDoc(doc(db, 'budgets', target.id), updatedBudget);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `budgets/${target.id}`);
    }

    setTransactions(prev => prev.map(t => updatedTxMap[t.id] || t));
    setBudgets(prev => prev.map(b => (b.id === target.id ? updatedBudget : b)));

    return { updatedBudget, updatedTxMap };
  };

  const handleReconcileLoanPayments = async (budgetId: string) => {
    if (!firebaseUser) return;
    const target = budgets.find(b => b.id === budgetId);
    if (!target || target.accountType !== 'loan' || !target.loanQuotas) return;
    const unlinked = getUnlinkedLoanPayments(target, transactions);
    if (unlinked.length === 0) return;
    await reconcileUnlinkedPaymentsForLoan(target, unlinked);
  };

  const handleToggleLoanQuotaPaid = async (budgetId: string, quotaId: string) => {
    if (!firebaseUser) return;
    const target = budgets.find(b => b.id === budgetId);
    if (!target || target.accountType !== 'loan' || !target.loanQuotas) return;

    const quota = target.loanQuotas.find(q => q.id === quotaId);
    if (!quota) return;

    const today = new Date().toISOString().split('T')[0];
    const nextIsPaid = !quota.isPaid;
    const balanceStep = quota.principalAmount > 0 ? quota.principalAmount : quota.amount;
    const currentUsed = Number(target.actualUsedAmount ?? target.creditLimit ?? 0);
    const maxCap = Number(target.creditLimit || target.limit || currentUsed);

    if (!nextIsPaid) {
      const linkedTx = quota.paymentTxId ? transactions.find(t => t.id === quota.paymentTxId) : undefined;
      const txsReferencingQuota = transactions.filter(
        t => t.paidQuotaIds && t.paidQuotaIds.includes(quotaId)
      );

      let nextUsed = currentUsed;

      if (linkedTx && !linkedTx.isTransfer && (!linkedTx.paidQuotaIds || linkedTx.paidQuotaIds.length <= 1)) {
        const prinRestore =
          typeof linkedTx.loanPrincipalPaid === 'number'
            ? Math.max(0, Number(linkedTx.loanPrincipalPaid) || 0)
            : balanceStep;
        try {
          await deleteDoc(doc(db, 'transactions', linkedTx.id));
          setTransactions(prev => prev.filter(t => t.id !== linkedTx.id));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `transactions/${linkedTx.id}`);
        }
        nextUsed = Math.min(maxCap > 0 ? maxCap : currentUsed + prinRestore, Number((currentUsed + prinRestore).toFixed(2)));
      } else if (!linkedTx && quota.paymentTxId) {
        try {
          await deleteDoc(doc(db, 'transactions', quota.paymentTxId));
          setTransactions(prev => prev.filter(t => t.id !== quota.paymentTxId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `transactions/${quota.paymentTxId}`);
        }
        nextUsed = Math.min(maxCap > 0 ? maxCap : currentUsed + balanceStep, Number((currentUsed + balanceStep).toFixed(2)));
      } else if (!quota.paymentTxId) {
        nextUsed = Math.min(maxCap > 0 ? maxCap : currentUsed + balanceStep, Number((currentUsed + balanceStep).toFixed(2)));
      }

      for (const refTx of txsReferencingQuota) {
        if (linkedTx && !linkedTx.isTransfer && refTx.id === linkedTx.id && (!linkedTx.paidQuotaIds || linkedTx.paidQuotaIds.length <= 1)) {
          continue;
        }
        const remainingIds = (refTx.paidQuotaIds || []).filter(id => id !== quotaId);
        const cleanedTx: Transaction = { ...refTx };
        if (remainingIds.length > 0) {
          cleanedTx.paidQuotaIds = remainingIds;
        } else {
          delete cleanedTx.paidQuotaIds;
        }
        try {
          await setDoc(doc(db, 'transactions', refTx.id), stripUndefined(cleanedTx));
          setTransactions(prev => prev.map(t => (t.id === refTx.id ? cleanedTx : t)));
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `transactions/${refTx.id}`);
        }
      }

      const updatedQuotas: LoanQuota[] = target.loanQuotas.map(q => {
        if (q.id !== quotaId) return q;
        return {
          id: q.id,
          quotaNumber: q.quotaNumber,
          dueDate: q.dueDate,
          amount: q.amount,
          principalAmount: q.principalAmount,
          interestAmount: q.interestAmount,
          remainingBalance: q.remainingBalance,
          isPaid: false
        };
      });

      const updatedBudget: Budget = stripUndefined({ ...target, actualUsedAmount: nextUsed, loanQuotas: updatedQuotas });
      try {
        await setDoc(doc(db, 'budgets', budgetId), updatedBudget);
        setBudgets(prev => prev.map(b => (b.id === budgetId ? updatedBudget : b)));
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
      }
      return;
    }

    const unlinked = getUnlinkedLoanPayments(target, transactions);
    const unlinkedTotal = Number(
      unlinked.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0).toFixed(2)
    );

    if (unlinkedTotal >= quota.amount - 1.0) {
      await reconcileUnlinkedPaymentsForLoan(target, unlinked);
      return;
    }

    let workingTarget = target;
    let partialAlreadyInt = 0;
    const partialTxUpdates: Record<string, Transaction> = {};

    if (unlinked.length > 0) {
      const reconciled = await reconcileUnlinkedPaymentsForLoan(target, unlinked);
      if (reconciled) {
        workingTarget = reconciled.updatedBudget;
        for (const ut of unlinked) {
          const updatedUt = reconciled.updatedTxMap[ut.id] || ut;
          partialAlreadyInt = Number((partialAlreadyInt + (Number(updatedUt.loanInterestPaid) || 0)).toFixed(2));
          partialTxUpdates[updatedUt.id] = { ...updatedUt, paidQuotaIds: [quota.id] };
        }
      }
    }

    const remainingCashDue = Math.max(0.01, Number((quota.amount - unlinkedTotal).toFixed(2)));
    const remainingInt = Math.min(
      remainingCashDue,
      Math.max(0, Number((quota.interestAmount - partialAlreadyInt).toFixed(2)))
    );
    const workingCurrentUsed = Number(workingTarget.actualUsedAmount ?? workingTarget.creditLimit ?? 0);
    const remainingPrin = Math.min(
      workingCurrentUsed,
      Math.max(0, Number((remainingCashDue - remainingInt).toFixed(2)))
    );

    const txId = `tx_q_${Date.now()}`;
    const newTx: Transaction = {
      id: txId,
      userId: firebaseUser.uid,
      title: `Quota #${quota.quotaNumber} - ${workingTarget.name || workingTarget.category}`.slice(0, 200),
      amount: remainingCashDue,
      type: 'expense',
      category: (workingTarget.category || workingTarget.name || 'Loan').slice(0, 50),
      date: today.slice(0, 20),
      notes: (
        unlinkedTotal > 0
          ? `Remaining for quota #${quota.quotaNumber} after ${unlinkedTotal.toFixed(2)} transferred (Prin: ${remainingPrin.toFixed(2)}, Int: ${remainingInt.toFixed(2)})`
          : `Loan quota #${quota.quotaNumber} (Principal: ${remainingPrin.toFixed(2)}, Interest: ${remainingInt.toFixed(2)})`
      ).slice(0, 500),
      budgetId: workingTarget.id.slice(0, 50),
      isLoanPayment: true,
      loanPrincipalPaid: remainingPrin,
      loanInterestPaid: remainingInt,
      paidQuotaIds: [quota.id],
      status: 'cleared'
    };

    try {
      await setDoc(doc(db, 'transactions', txId), stripUndefined(newTx));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`);
      return;
    }

    for (const patchedPartial of Object.values(partialTxUpdates)) {
      try {
        await setDoc(doc(db, 'transactions', patchedPartial.id), stripUndefined(patchedPartial));
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `transactions/${patchedPartial.id}`);
      }
    }

    setTransactions(prev =>
      [newTx, ...prev.map(t => partialTxUpdates[t.id] || t)].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    );

    const nextUsed = Math.max(0, Number((workingCurrentUsed - remainingPrin).toFixed(2)));
    const updatedQuotas: LoanQuota[] = (workingTarget.loanQuotas || []).map(q => {
      if (q.id !== quotaId) return q;
      return {
        ...q,
        isPaid: true,
        paidDate: today,
        paymentTxId: txId
      };
    });

    const updatedBudget: Budget = stripUndefined({
      ...workingTarget,
      actualUsedAmount: nextUsed,
      loanQuotas: updatedQuotas
    });

    try {
      await setDoc(doc(db, 'budgets', budgetId), updatedBudget);
      setBudgets(prev => prev.map(b => (b.id === budgetId ? updatedBudget : b)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
    }
  };

  const handleAddLoanQuota = async (
    budgetId: string,
    quotaInput: { dueDate: string; amount: number; principalAmount: number; interestAmount: number }
  ) => {
    const target = budgets.find(b => b.id === budgetId);
    if (!target || target.accountType !== 'loan') return;
    const existing = target.loanQuotas || [];
    const lastBalance =
      existing.length > 0
        ? existing[existing.length - 1].remainingBalance
        : Number(target.actualUsedAmount ?? target.creditLimit ?? 0);
    const nextRemaining = Math.max(0, Number((lastBalance - quotaInput.principalAmount).toFixed(2)));
    const newQuota: LoanQuota = {
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      quotaNumber: existing.length + 1,
      dueDate: (quotaInput.dueDate || new Date().toISOString().split('T')[0]).slice(0, 20),
      amount: quotaInput.amount,
      principalAmount: quotaInput.principalAmount,
      interestAmount: quotaInput.interestAmount,
      remainingBalance: nextRemaining,
      isPaid: false
    };
    const nextQuotas = [...existing, newQuota].slice(0, 600);
    const nextMonthlyQuota = target.monthlyQuota && target.monthlyQuota > 0 ? target.monthlyQuota : quotaInput.amount;
    const updatedBudget: Budget = stripUndefined({
      ...target,
      loanQuotas: nextQuotas,
      loanTermMonths: nextQuotas.length,
      monthlyQuota: nextMonthlyQuota,
      limit: nextMonthlyQuota > 0 ? nextMonthlyQuota : target.limit
    });
    try {
      await setDoc(doc(db, 'budgets', budgetId), updatedBudget);
      setBudgets(prev => prev.map(b => (b.id === budgetId ? updatedBudget : b)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
    }
  };

  const handleDeleteLoanQuota = async (budgetId: string, quotaId: string) => {
    const target = budgets.find(b => b.id === budgetId);
    if (!target || target.accountType !== 'loan' || !target.loanQuotas) return;
    const filtered = target.loanQuotas
      .filter(q => q.id !== quotaId)
      .map((q, idx) => ({ ...q, quotaNumber: idx + 1 }));
    const updatedBudget: Budget = stripUndefined({
      ...target,
      loanQuotas: filtered,
      loanTermMonths: filtered.length
    });
    try {
      await setDoc(doc(db, 'budgets', budgetId), updatedBudget);
      setBudgets(prev => prev.map(b => (b.id === budgetId ? updatedBudget : b)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
    }
  };

  const handleGenerateLoanQuotas = async (budgetId: string) => {
    const target = budgets.find(b => b.id === budgetId);
    if (!target || target.accountType !== 'loan') return;
    const principal = Number(target.creditLimit || target.actualUsedAmount || target.limit || 0);
    const term = Number(target.loanTermMonths || 12);
    if (principal <= 0 || term <= 0) return;

    const generated = generateLoanQuotasSchedule({
      principal,
      annualApr: Number(target.apr || 0),
      termMonths: term,
      startDate: target.loanStartDate || new Date().toISOString().split('T')[0],
      ratePeriod: target.loanRatePeriod || 'annual',
      calcMethod: target.loanCalcMethod || 'amortized',
      customMonthlyQuota: target.monthlyQuota,
      existingQuotas: target.loanQuotas
    });

    const updatedBudget: Budget = stripUndefined({
      ...target,
      loanTermMonths: term,
      loanStartDate: (target.loanStartDate || new Date().toISOString().split('T')[0]).slice(0, 20),
      monthlyQuota: generated.monthlyQuota,
      limit: generated.monthlyQuota > 0 ? generated.monthlyQuota : target.limit,
      loanQuotas: generated.quotas
    });
    try {
      await setDoc(doc(db, 'budgets', budgetId), updatedBudget);
      setBudgets(prev => prev.map(b => (b.id === budgetId ? updatedBudget : b)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
    }
  };

  const handleOpenRecordPayment = (b: Budget) => {
    const name = b.name || b.category;
    setDefaultTxType('expense');
    setNewTxTitle(b.accountType === 'loan' ? 'Loan Payment' : 'Card Payment');
    setNewTxCategory('Debt Payment');
    setNewTxBudgetId(b.id);
    setNewTxIsLoanPayment(true);
    setNewTxDate(new Date().toISOString().split('T')[0]);
    setIsAddTxOpen(true);
  };

  const handleRecalculateLiquidBalance = async (budgetId: string) => {
    const target = budgetsRef.current.find(b => b.id === budgetId);
    if (!target || (target.accountType !== 'bank_account' && target.accountType !== 'debit_account')) return;
    const catName = (target.name || target.category || '').trim().toLowerCase();

    let net = 0;
    transactionsRef.current.forEach(t => {
      if (t.emailOutcome === 'declined') return;
      const amt = Math.abs(Number(t.amount) || 0);
      if (t.isTransfer) {
        if (t.budgetId === target.id) net -= amt;
        if (t.transferToBudgetId === target.id) net += amt;
      } else {
        const belongs =
          t.budgetId === target.id ||
          (!t.budgetId && (t.category || '').trim().toLowerCase() === catName);
        if (!belongs) return;
        net += t.type === 'income' ? amt : -amt;
      }
    });

    const computedBalance = Number(net.toFixed(2));
    try {
      await updateDoc(doc(db, 'budgets', target.id), { accountBalance: computedBalance });
      setBudgets(prev => prev.map(b => (b.id === target.id ? { ...b, accountBalance: computedBalance } : b)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `budgets/${target.id}`);
    }
  };

  const handleRecalculateAccountBalance = async (budgetId: string) => {
    const target = budgetsRef.current.find(b => b.id === budgetId);
    if (!target) return;
    if (target.accountType === 'bank_account' || target.accountType === 'debit_account') {
      await handleRecalculateLiquidBalance(budgetId);
      return;
    }
    if (target.accountType === 'credit_card') {
      const catName = (target.name || target.category || '').trim().toLowerCase();
      let charges = 0;
      let payments = 0;
      transactionsRef.current.forEach(t => {
        if (t.emailOutcome === 'declined') return;
        const amt = Math.abs(Number(t.amount) || 0);
        if (t.isTransfer) {
          if (t.budgetId === target.id) charges += amt;
          if (t.transferToBudgetId === target.id) payments += amt;
        } else {
          const belongs =
            t.budgetId === target.id ||
            (!t.budgetId && (t.category || '').trim().toLowerCase() === catName);
          if (!belongs) return;
          if (t.isLoanPayment || t.type === 'income') {
            payments += amt;
          } else {
            charges += amt;
          }
        }
      });
      const computedUsed = Math.max(0, Number((charges - payments).toFixed(2)));
      try {
        await updateDoc(doc(db, 'budgets', target.id), { actualUsedAmount: computedUsed });
        setBudgets(prev => prev.map(b => (b.id === target.id ? { ...b, actualUsedAmount: computedUsed } : b)));
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `budgets/${target.id}`);
      }
    }
  };

  const handleDeleteBudget = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'budgets', id));
      const remaining = budgetsRef.current
        .filter(b => b.id !== id)
        .map((b, idx) => ({ ...b, order: idx }));
      budgetsRef.current = remaining;
      setBudgets(remaining);
      if (remaining.length > 0) {
        await persistBudgetsOrder(remaining);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `budgets/${id}`);
    }
  };

  const persistBudgetsOrder = async (orderedBudgets: Budget[]) => {
    if (firebaseUser) {
      try {
        localStorage.setItem(
          `seashore_budget_order_${firebaseUser.uid}`,
          JSON.stringify(orderedBudgets.map(b => b.id))
        );
      } catch {
        // ignore
      }
    }
    try {
      const batch = writeBatch(db);
      orderedBudgets.forEach((b, idx) => {
        batch.update(doc(db, 'budgets', b.id), { order: idx });
      });
      await batch.commit();
    } catch (err) {
      console.warn('Batch budget order update failed, falling back to individual updates:', err);
      for (let i = 0; i < orderedBudgets.length; i++) {
        const b = orderedBudgets[i];
        try {
          await updateDoc(doc(db, 'budgets', b.id), { order: i });
        } catch (innerErr) {
          console.error('Failed to update budget order for', b.id, innerErr);
        }
      }
    }
  };

  const handleMoveBudgetToIndex = async (budgetId: string, targetIndex: number) => {
    const current = [...budgetsRef.current];
    const fromIndex = current.findIndex(b => b.id === budgetId);
    if (fromIndex === -1) return;
    const clampedTarget = Math.max(0, Math.min(current.length - 1, targetIndex));
    if (fromIndex === clampedTarget) return;

    const [moved] = current.splice(fromIndex, 1);
    current.splice(clampedTarget, 0, moved);

    const updatedWithOrder = current.map((b, idx) => ({ ...b, order: idx }));
    budgetsRef.current = updatedWithOrder;
    setBudgets(updatedWithOrder);

    await persistBudgetsOrder(updatedWithOrder);
  };

  const handleReorderBudget = async (budgetId: string, direction: 'up' | 'down') => {
    const current = budgetsRef.current;
    const index = current.findIndex(b => b.id === budgetId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;
    await handleMoveBudgetToIndex(budgetId, targetIndex);
  };

  // Credit Card Installments (Cuotas / Diferidos) inline update
  const handleUpdateCardInstallments = async (budgetId: string, nextInstallments: CardInstallment[]) => {
    const target = budgetsRef.current.find(b => b.id === budgetId);
    if (!target) return;
    const updatedBudget: Budget = stripUndefined({
      ...target,
      installments: nextInstallments
    });
    try {
      await setDoc(doc(db, 'budgets', budgetId), updatedBudget);
      setBudgets(prev => prev.map(b => (b.id === budgetId ? updatedBudget : b)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
    }
  };

  const handleMarkTransactionCleared = async (txId: string) => {
    const target = transactionsRef.current.find(t => t.id === txId);
    if (!target) return;
    try {
      await updateDoc(doc(db, 'transactions', txId), { status: 'cleared' });
      setTransactions(prev => prev.map(t => (t.id === txId ? { ...t, status: 'cleared' } : t)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `transactions/${txId}`);
    }
  };

  const handleAskAi = async (overridePrompt?: string) => {
    const effectivePrompt = (overridePrompt ?? aiPrompt).trim();
    if (!effectivePrompt || !firebaseUser || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    setAiResult('');
    try {
      const financialContext = {
        currency: baseCurrencyCode,
        currencySymbol,
        fxRateUsdToDop,
        selectedMonth: globalSelectedMonth,
        summary: {
          totalIncome: Number(totalIncome.toFixed(2)),
          totalExpense: Number(totalExpense.toFixed(2)),
          netCashflow: Number((totalIncome - totalExpense).toFixed(2))
        },
        accountsAndBudgets: budgets.map(b => ({
          name: b.name || b.category,
          type: b.accountType || 'standard',
          balance: b.accountBalance ?? null,
          creditLimit: b.creditLimit ?? b.limit ?? null,
          actualUsedAmount: b.actualUsedAmount ?? null,
          softCap: b.softCap ?? null,
          softCapUsd: b.softCapUsd ?? null,
          cutoffDate: b.cutoffDate || null,
          dueDate: b.dueDate || null,
          apr: b.apr ?? null
        })),
        recentTransactions: displayTransactions
          .filter(t => t.emailOutcome !== 'declined')
          .slice(0, 60)
          .map(t => ({
            title: t.title,
            amount: t.amount,
            type: t.type,
            category: t.category,
            date: t.date,
            status: t.status || 'cleared',
            isTransfer: Boolean(t.isTransfer)
          }))
      };

      const res = await fetch(getApiUrl('/api/ai/advice'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: effectivePrompt,
          financialContext
        })
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setAiError('AI Financial Advisor returned an unexpected response.');
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error || `AI request failed (${res.status}).`);
        return;
      }
      setAiResult(data.advice || 'No response generated.');
    } catch {
      setAiError('Unable to reach the AI Advisor backend.');
    } finally {
      setAiLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-screen bg-[#F5F5F7] dark:bg-[#000000] text-[#1D1D1F] dark:text-[#F5F5F7] items-center justify-center antialiased">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-[#0071E3] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#86868B] font-medium">Loading Wallet & Ledger...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="flex h-screen bg-[#F5F5F7] dark:bg-[#000000] text-[#1D1D1F] dark:text-[#F5F5F7] antialiased items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[520px] h-[520px] bg-[#0071E3]/10 dark:bg-[#0071E3]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 w-[480px] h-[480px] bg-[#34C759]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-md w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 rounded-3xl p-8 shadow-[0_4px_24px_rgba(0,0,0,0.06)] dark:shadow-2xl relative z-10 text-center space-y-6">
          <div className="w-16 h-16 bg-gradient-to-tr from-[#0071E3] to-[#5AC8FA] rounded-2xl mx-auto flex items-center justify-center shadow-lg text-3xl">
            💳
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] uppercase tracking-[0.06em] font-semibold text-[#86868B] block">
              PERSONAL FINANCE & WALLET
            </span>
            <h1 className="text-3xl font-bold tracking-[-0.03em] text-[#1D1D1F] dark:text-white">Finance Tracker</h1>
            <p className="text-xs text-[#86868B] leading-relaxed">
              Private multi-account ledger, credit cycle tracking, and statement reconciliation.
            </p>
          </div>

          {authError && (
            <div className="bg-[#FF3B30]/10 border border-[#FF3B30]/25 text-[#D70015] dark:text-rose-300 rounded-2xl p-3.5 text-[11px] text-left leading-relaxed">
              {authError}
            </div>
          )}

          <button
            onClick={handleGoogleSignIn}
            disabled={isLoggingIn}
            className="w-full bg-[#1D1D1F] hover:bg-black dark:bg-white dark:hover:bg-zinc-200 disabled:opacity-50 text-white dark:text-black font-semibold py-3 rounded-full text-xs transition shadow-md flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            {isLoggingIn ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
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
    <div className="flex h-screen bg-[#F5F5F7] dark:bg-[#000000] text-[#1D1D1F] dark:text-[#F5F5F7] antialiased overflow-hidden select-none">

      {/* SIDEBAR / LEFT PANEL */}
      <aside className="hidden md:flex w-72 bg-white/90 dark:bg-[#141416] border-r border-black/[0.06] dark:border-white/[0.08] flex-col p-4 z-10 overflow-y-auto shrink-0">
        <div
          className="flex items-center justify-between pb-4 mb-4 border-b border-black/[0.06] dark:border-white/[0.08] cursor-pointer group"
          onClick={() => setActiveTab('settings')}
        >
          <div className="flex items-center gap-2.5 truncate">
            <span className="w-9 h-9 rounded-2xl bg-[#F2F2F7] dark:bg-[#2C2C2E] border border-black/[0.05] dark:border-white/10 flex items-center justify-center text-lg shrink-0">
              {currentUserProfile?.avatar || '💳'}
            </span>
            <div className="truncate">
              <span className="text-xs font-semibold text-[#1D1D1F] dark:text-white truncate block group-hover:text-[#0071E3] transition">
                {currentUserProfile?.name || firebaseUser.displayName}
              </span>
              <span className="text-[10px] text-[#86868B] truncate block">Profile & Settings</span>
            </div>
          </div>
        </div>

        {/* Navigation Pages */}
        <div className="text-[11px] font-semibold text-[#86868B] uppercase tracking-[0.04em] mb-2 px-1">
          Views & Pages
        </div>
        <div className="space-y-1 mb-5">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition ${
              activeTab === 'dashboard'
                ? 'bg-[#0071E3] text-white shadow-sm'
                : 'text-[#6E6E73] dark:text-[#86868B] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-[#1D1D1F] dark:hover:text-white'
            }`}
          >
            <LayoutDashboard className="w-4 h-4 shrink-0" /> Dashboard
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition ${
              activeTab === 'stats'
                ? 'bg-[#0071E3] text-white shadow-sm'
                : 'text-[#6E6E73] dark:text-[#86868B] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-[#1D1D1F] dark:hover:text-white'
            }`}
          >
            <BarChart2 className="w-4 h-4 shrink-0" /> Monthly Stats
          </button>
          <button
            onClick={() => setActiveTab('budgets')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition ${
              activeTab === 'budgets'
                ? 'bg-[#0071E3] text-white shadow-sm'
                : 'text-[#6E6E73] dark:text-[#86868B] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-[#1D1D1F] dark:hover:text-white'
            }`}
          >
            <PieChart className="w-4 h-4 shrink-0" /> Budgets & Accounts
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition ${
              activeTab === 'transactions'
                ? 'bg-[#0071E3] text-white shadow-sm'
                : 'text-[#6E6E73] dark:text-[#86868B] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-[#1D1D1F] dark:hover:text-white'
            }`}
          >
            <Receipt className="w-4 h-4 shrink-0" /> Transactions DB
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition ${
              activeTab === 'settings'
                ? 'bg-[#0071E3] text-white shadow-sm'
                : 'text-[#6E6E73] dark:text-[#86868B] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-[#1D1D1F] dark:hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4 shrink-0" /> Settings & Profile
          </button>
        </div>

        <div className="text-[11px] font-semibold text-[#86868B] uppercase tracking-[0.04em] mb-2 px-1">
          Quick Actions
        </div>
        <div className="space-y-1.5 mb-5">
          <button
            onClick={() => {
              setDefaultTxType('expense');
              setNewTxBudgetId('');
              setNewTxIsLoanPayment(false);
              setNewTxTitle('');
              setNewTxCategory('');
              setNewTxDate(new Date().toISOString().split('T')[0]);
              setIsAddTxOpen(true);
            }}
            className="w-full flex items-center gap-2 bg-[#F5F5F7] hover:bg-[#E8E8ED] dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] text-[#1D1D1F] dark:text-zinc-200 dark:hover:text-white px-3 py-2 rounded-xl text-xs font-medium border border-black/[0.04] dark:border-white/[0.08] transition"
          >
            <Plus className="w-3.5 h-3.5 text-[#FF3B30]" /> New Expense
          </button>
          <button
            onClick={() => {
              setDefaultTxType('income');
              setNewTxBudgetId('');
              setNewTxIsLoanPayment(false);
              setNewTxTitle('');
              setNewTxCategory('');
              setNewTxDate(new Date().toISOString().split('T')[0]);
              setIsAddTxOpen(true);
            }}
            className="w-full flex items-center gap-2 bg-[#F5F5F7] hover:bg-[#E8E8ED] dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] text-[#1D1D1F] dark:text-zinc-200 dark:hover:text-white px-3 py-2 rounded-xl text-xs font-medium border border-black/[0.04] dark:border-white/[0.08] transition"
          >
            <Plus className="w-3.5 h-3.5 text-[#248A3D] dark:text-[#34C759]" /> New Income
          </button>
          {budgets.length >= 2 && (
            <button
              onClick={() => handleOpenTransfer()}
              className="w-full flex items-center gap-2 bg-[#F5F5F7] hover:bg-[#E8E8ED] dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] text-[#0071E3] dark:text-[#5AC8FA] px-3 py-2 rounded-xl text-xs font-medium border border-black/[0.04] dark:border-white/[0.08] transition"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer Money
            </button>
          )}
          <button
            onClick={() => setIsUploadStatementOpen(true)}
            className="w-full flex items-center gap-2 bg-[#F5F5F7] hover:bg-[#E8E8ED] dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] text-[#248A3D] dark:text-[#34C759] px-3 py-2 rounded-xl text-xs font-medium border border-black/[0.04] dark:border-white/[0.08] transition"
          >
            <Upload className="w-3.5 h-3.5" /> Upload Statement
          </button>
        </div>

        {/* Persistent Month Summary Card */}
        <div className="mt-auto">
          <div className="bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.05] dark:border-white/10 rounded-2xl p-3.5 space-y-2.5 text-xs shadow-sm dark:shadow-lg">
            <div className="font-semibold text-[#1D1D1F] dark:text-white flex items-center justify-between gap-2">
              <span className="truncate">{selectedMonthName}</span>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  globalSelectedMonth === currentMonthKey
                    ? 'bg-[#34C759]'
                    : 'bg-[#0071E3]'
                }`}
              />
            </div>
            <div className="space-y-1.5 text-[#86868B] text-[11px]">
              <div className="flex justify-between">
                <span>Income</span>
                <span className="text-[#248A3D] dark:text-[#34C759] font-semibold tabular-nums">
                  {currencySymbol}{selectedMonthStats.income.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Expense</span>
                <span className="text-[#D70015] dark:text-[#FF3B30] font-semibold tabular-nums">
                  {currencySymbol}{selectedMonthStats.expense.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between border-t border-black/[0.06] dark:border-white/10 pt-1.5">
                <span>Cashflow</span>
                <span className="text-[#1D1D1F] dark:text-white font-bold tabular-nums">
                  {currencySymbol}{selectedMonthStats.cashflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[#F5F5F7] dark:bg-[#000000]">

        {/* Sticky Translucent Apple Glass Header */}
        <header className="sticky top-0 z-20 apple-glass px-6 py-3.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-bold text-[#1D1D1F] dark:text-white tracking-[-0.03em] whitespace-nowrap">
                {activeTab === 'dashboard' && 'Wallet & Overview'}
                {activeTab === 'stats' && 'Monthly Stats'}
                {activeTab === 'budgets' && 'Budgets & Accounts'}
                {activeTab === 'transactions' && 'Transactions Database'}
                {activeTab === 'settings' && 'Profile & Settings'}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 bg-[#F2F2F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-full px-3.5 py-1.5 text-xs text-[#1D1D1F] dark:text-white shadow-sm whitespace-nowrap">
                <Calendar className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
                <span className="text-[#86868B] hidden sm:inline">Month:</span>
                <select
                  value={globalSelectedMonth}
                  onChange={e => setGlobalSelectedMonth(e.target.value)}
                  className="bg-transparent text-[#1D1D1F] dark:text-white focus:outline-none cursor-pointer font-semibold tabular-nums"
                >
                  <option value="All" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">All Months</option>
                  {allMonthsList.map(m => (
                    <option key={m.key} value={m.key} className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">{m.name}</option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
                title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
                aria-label={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
                className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:hover:bg-white/15 border border-black/[0.06] dark:border-white/10 flex items-center justify-center text-[#1D1D1F] dark:text-white transition active:scale-[0.98] shrink-0"
              >
                {theme === 'light' ? <Moon className="w-3.5 h-3.5 text-[#6E6E73]" /> : <Sun className="w-3.5 h-3.5 text-[#FF9F0A]" />}
              </button>

              <button
                onClick={() => setIsAiOpen(true)}
                className="flex items-center gap-1.5 bg-[#0071E3] hover:bg-[#0077ED] text-white px-3.5 py-1.5 rounded-full text-xs font-semibold transition active:scale-[0.98] whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Insights</span>
              </button>
            </div>
          </div>

          {/* Mobile Nav Bar */}
          <div className="flex md:hidden items-center gap-1.5 overflow-x-auto pt-3 pb-0.5 scrollbar-none">
            {([
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'stats', label: 'Stats' },
              { id: 'budgets', label: 'Budgets' },
              { id: 'transactions', label: 'Ledger' },
              { id: 'settings', label: 'Settings' }
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1 rounded-full text-xs font-semibold shrink-0 transition ${
                  activeTab === tab.id ? 'bg-[#0071E3] text-white' : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#6E6E73] dark:text-[#86868B]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        <div className="p-6 flex-1">
          {/* ROUTED PAGES */}
          {activeTab === 'dashboard' && (
            <DashboardPage
              transactions={displayTransactions}
              allTransactions={transactions}
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
              currencyCode={baseCurrencyCode}
              fxRateUsdToDop={fxRateUsdToDop}
              colors={COLORS}
              selectedMonth={globalSelectedMonth}
              onOpenAddTx={(type, datePrefill) => {
                setDefaultTxType(type);
                setNewTxBudgetId('');
                setNewTxIsLoanPayment(false);
                setNewTxTitle('');
                setNewTxCategory('');
                setNewTxDate(datePrefill || new Date().toISOString().split('T')[0]);
                setIsAddTxOpen(true);
              }}
              onOpenEditTx={handleOpenEditTx}
              onDeleteTx={handleDeleteTx}
              onOpenAddBudget={() => setIsAddBudgetOpen(true)}
              onNavigateBudgets={() => setActiveTab('budgets')}
              onMarkCleared={handleMarkTransactionCleared}
            />
          )}

          {activeTab === 'stats' && (
            <MonthlyStatsPage
              statsQuarterFilter={statsQuarterFilter}
              setStatsQuarterFilter={setStatsQuarterFilter}
              filteredMonthsStats={filteredMonthsStats}
              currencySymbol={currencySymbol}
              selectedMonth={globalSelectedMonth}
              onSelectMonth={setGlobalSelectedMonth}
            />
          )}

          {activeTab === 'budgets' && (
            <BudgetsPage
              budgets={budgets}
              transactions={displayTransactions}
              allTransactions={transactions}
              currencySymbol={currencySymbol}
              selectedMonth={globalSelectedMonth}
              onOpenAddBudget={() => setIsAddBudgetOpen(true)}
              onOpenEditBudget={setEditingBudget}
              onDeleteBudget={handleDeleteBudget}
              onToggleItemPaid={handleToggleBudgetItemPaid}
              onOpenRecordPayment={handleOpenRecordPayment}
              onOpenTransfer={handleOpenTransfer}
              onToggleLoanQuotaPaid={handleToggleLoanQuotaPaid}
              onReconcileLoanPayments={handleReconcileLoanPayments}
              onAddLoanQuota={handleAddLoanQuota}
              onDeleteLoanQuota={handleDeleteLoanQuota}
              onGenerateLoanQuotas={handleGenerateLoanQuotas}
              onReorderBudget={handleReorderBudget}
              onReorderBudgetToIndex={handleMoveBudgetToIndex}
              onRecalculateLiquidBalance={handleRecalculateLiquidBalance}
              onRecalculateAccountBalance={handleRecalculateAccountBalance}
              onUpdateCardInstallments={handleUpdateCardInstallments}
            />
          )}

          {activeTab === 'transactions' && (
            <TransactionsPage
              transactions={transactions}
              budgets={budgets}
              currencySymbol={currencySymbol}
              selectedMonth={globalSelectedMonth}
              onSelectMonth={setGlobalSelectedMonth}
              onOpenAddTx={(type) => {
                setDefaultTxType(type);
                setNewTxBudgetId('');
                setNewTxIsLoanPayment(false);
                setNewTxTitle('');
                setNewTxCategory('');
                setNewTxDate(new Date().toISOString().split('T')[0]);
                setIsAddTxOpen(true);
              }}
              onOpenUploadStatement={() => setIsUploadStatementOpen(true)}
              onOpenTransfer={() => handleOpenTransfer()}
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
              theme={theme}
              setTheme={setTheme}
            />
          )}
        </div>
      </main>

      {/* MODALS */}
      <AddTransactionModal
        isOpen={isAddTxOpen}
        onClose={() => setIsAddTxOpen(false)}
        defaultType={defaultTxType}
        budgets={budgets}
        availableCategories={availableCategories}
        currencySymbol={currencySymbol}
        prefillDate={newTxDate}
        prefillBudgetId={newTxBudgetId}
        prefillIsLoanPayment={newTxIsLoanPayment}
        prefillTitle={newTxTitle}
        prefillCategory={newTxCategory}
        onSave={async (txData) => {
          if (!firebaseUser) return;
          const id = 'tx_' + Date.now();
          const newTx: Transaction = stripUndefined({
            id,
            userId: firebaseUser.uid,
            title: txData.title.slice(0, 200),
            amount: Math.abs(Number(txData.amount) || 0),
            type: txData.type,
            category: (txData.category || 'Other').slice(0, 50),
            date: (txData.date || new Date().toISOString().split('T')[0]).slice(0, 20),
            notes: (txData.notes || '').slice(0, 500),
            ...(txData.budgetId ? { budgetId: txData.budgetId.slice(0, 50) } : {}),
            ...(txData.statementCycle ? { statementCycle: txData.statementCycle.slice(0, 20) } : {}),
            isLoanPayment: Boolean(txData.isLoanPayment),
            status: 'cleared' as const
          });
          const latestBudgets = await ensureBudgetsForCategories(
            { [newTx.category]: newTx.type === 'expense' ? newTx.amount : 0 },
            budgets
          );
          const { enrichedTx, nextBudgets, touchedIds } = applySingleTxInMemory(newTx, latestBudgets);
          try {
            await setDoc(doc(db, 'transactions', id), stripUndefined(enrichedTx));
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `transactions/${id}`);
            return;
          }
          if (touchedIds.length > 0) {
            await persistTouchedBudgets(touchedIds, nextBudgets);
          }
          setTransactions(prev => [enrichedTx, ...prev].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
        }}
      />

      <EditTransactionModal
        tx={editingTx}
        onClose={() => setEditingTx(null)}
        budgets={budgets}
        availableCategories={availableCategories}
        currencySymbol={currencySymbol}
        onSave={async (txId, updated) => {
          if (!firebaseUser || !editingTx) return;
          const isTransferTx = Boolean(
            updated.isTransfer && updated.budgetId && updated.transferToBudgetId && updated.budgetId !== updated.transferToBudgetId
          );
          const updatedTx: Transaction = stripUndefined({
            ...editingTx,
            ...updated,
            id: txId,
            userId: editingTx.userId,
            title: (updated.title || editingTx.title).slice(0, 200),
            amount: updated.amount !== undefined ? Math.abs(Number(updated.amount) || 0) : editingTx.amount,
            type: isTransferTx ? 'expense' : (updated.type || editingTx.type),
            category: (updated.category || (isTransferTx ? 'Transfer' : editingTx.category)).slice(0, 50),
            date: (updated.date || editingTx.date).slice(0, 20),
            notes: (updated.notes !== undefined ? updated.notes : editingTx.notes || '').slice(0, 500),
            budgetId: updated.budgetId ? updated.budgetId.slice(0, 50) : undefined,
            isLoanPayment: Boolean(updated.isLoanPayment),
            isTransfer: isTransferTx,
            transferToBudgetId: isTransferTx && updated.transferToBudgetId ? updated.transferToBudgetId.slice(0, 50) : undefined,
            statementCycle:
              updated.statementCycle !== undefined
                ? updated.statementCycle
                  ? updated.statementCycle.slice(0, 20)
                  : undefined
                : editingTx.statementCycle,
            status: updated.status || editingTx.status || 'cleared'
          });
          const latestBudgets = isTransferTx
            ? budgets
            : await ensureBudgetsForCategories(
                { [updatedTx.category]: updatedTx.type === 'expense' ? updatedTx.amount : 0 },
                budgets
              );
          const reverted = revertSingleTxInMemory(editingTx, latestBudgets);
          const applied = applySingleTxInMemory(updatedTx, reverted.nextBudgets);
          const allTouched = Array.from(new Set([...reverted.touchedIds, ...applied.touchedIds]));
          try {
            await setDoc(doc(db, 'transactions', txId), stripUndefined(applied.enrichedTx));
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `transactions/${txId}`);
            return;
          }
          if (allTouched.length > 0) {
            await persistTouchedBudgets(allTouched, applied.nextBudgets);
          }
          setTransactions(prev =>
            prev.map(t => (t.id === txId ? applied.enrichedTx : t)).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          );
          setEditingTx(null);
        }}
      />

      <AddBudgetModal
        isOpen={isAddBudgetOpen}
        onClose={() => setIsAddBudgetOpen(false)}
        availableCategories={availableCategories}
        currencySymbol={currencySymbol}
        colors={COLORS}
        onSave={async (data) => {
          if (!firebaseUser) return;
          const id = 'b_' + Date.now();
          const catVal = data.category.trim().slice(0, 50);
          const newBudget: Budget = stripUndefined({
            id,
            userId: firebaseUser.uid,
            name: catVal,
            category: catVal,
            description: (data.description || '').trim().slice(0, 500),
            limit: Number(data.limit) || 0,
            color: data.color || COLORS[0],
            accountType: data.accountType,
            creditLimit: data.creditLimit,
            actualUsedAmount:
              data.accountType === 'loan'
                ? Number(data.creditLimit || data.limit || 0)
                : data.actualUsedAmount,
            accountBalance: data.accountBalance,
            apr: data.apr,
            overdraftPercentage: data.overdraftPercentage,
            loanTermMonths: data.loanTermMonths,
            loanStartDate: data.loanStartDate,
            loanCalcMethod: data.loanCalcMethod,
            loanRatePeriod: data.loanRatePeriod,
            monthlyQuota: data.accountType === 'loan' ? data.limit : undefined,
            loanQuotas: data.loanQuotas,
            items: data.accountType === 'standard' ? (data.items || []) : [],
            extraExpenses: data.accountType === 'standard' ? (data.extraExpenses || 0) : 0,
            order:
              budgetsRef.current.reduce((m, b) => Math.max(m, typeof b.order === 'number' ? b.order : -1), -1) + 1,
            ...(data.accountType === 'credit_card'
              ? {
                  ...(data.cutoffDate ? { cutoffDate: data.cutoffDate.trim().slice(0, 40) } : {}),
                  ...(data.dueDate ? { dueDate: data.dueDate.trim().slice(0, 40) } : {}),
                  ...(data.softCap && data.softCap > 0 ? { softCap: Number(data.softCap) } : {}),
                  ...(data.softCapUsd && data.softCapUsd > 0 ? { softCapUsd: Number(data.softCapUsd) } : {}),
                  ...(data.installments && data.installments.length > 0 ? { installments: data.installments } : {})
                }
              : {})
          });
          try {
            await setDoc(doc(db, 'budgets', id), newBudget);
            setBudgets(prev => [
              ...prev.filter(b => (b.category || b.name || '').toLowerCase() !== catVal.toLowerCase()),
              newBudget
            ]);
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `budgets/${id}`);
          }
        }}
      />

      <EditBudgetModal
        budget={editingBudget}
        onClose={() => setEditingBudget(null)}
        availableCategories={availableCategories}
        currencySymbol={currencySymbol}
        colors={COLORS}
        onSave={async (budgetId, updated) => {
          if (!firebaseUser || !editingBudget) return;
          const nextAccountType = updated.accountType || editingBudget.accountType || 'standard';
          const catVal = (updated.category || editingBudget.category).trim().slice(0, 50);
          const isLiquid = nextAccountType === 'bank_account' || nextAccountType === 'debit_account';
          const isCredit = nextAccountType === 'credit_card';
          const isLoan = nextAccountType === 'loan';
          const isStandard = !isLiquid && !isCredit && !isLoan;

          const updatedBudget: Budget = stripUndefined({
            id: budgetId,
            userId: editingBudget.userId,
            name: catVal,
            category: catVal,
            description: (updated.description !== undefined ? updated.description : editingBudget.description || '').slice(0, 500),
            limit: updated.limit !== undefined ? updated.limit : editingBudget.limit,
            color: updated.color || editingBudget.color || COLORS[0],
            accountType: nextAccountType,
            order:
              typeof editingBudget.order === 'number'
                ? editingBudget.order
                : Math.max(0, budgetsRef.current.findIndex(b => b.id === budgetId)),
            extraExpenses: isStandard ? (updated.extraExpenses || 0) : 0,
            items: isStandard ? (updated.items || []) : [],
            ...(isLiquid
              ? {
                  accountBalance: updated.accountBalance ?? 0,
                  ...(nextAccountType === 'bank_account' && updated.apr !== undefined ? { apr: updated.apr } : {})
                }
              : {}),
            ...(isCredit
              ? {
                  apr: updated.apr ?? 0,
                  creditLimit: updated.creditLimit ?? 0,
                  overdraftPercentage: updated.overdraftPercentage ?? 0,
                  actualUsedAmount: updated.actualUsedAmount ?? editingBudget.actualUsedAmount ?? 0,
                  ...(updated.cutoffDate ? { cutoffDate: updated.cutoffDate.trim().slice(0, 40) } : {}),
                  ...(updated.dueDate ? { dueDate: updated.dueDate.trim().slice(0, 40) } : {}),
                  ...(updated.softCap !== undefined && updated.softCap > 0 ? { softCap: Number(updated.softCap) } : {}),
                  ...(updated.softCapUsd !== undefined && updated.softCapUsd > 0 ? { softCapUsd: Number(updated.softCapUsd) } : {}),
                  ...(updated.installments !== undefined
                    ? { installments: updated.installments }
                    : editingBudget.installments
                    ? { installments: editingBudget.installments }
                    : {})
                }
              : {}),
            ...(isLoan
              ? {
                  apr: updated.apr ?? 0,
                  creditLimit: updated.creditLimit ?? 0,
                  overdraftPercentage: 0,
                  actualUsedAmount: updated.actualUsedAmount ?? editingBudget.actualUsedAmount ?? updated.creditLimit ?? 0,
                  loanTermMonths: updated.loanTermMonths,
                  loanStartDate: updated.loanStartDate,
                  loanCalcMethod: updated.loanCalcMethod,
                  loanRatePeriod: updated.loanRatePeriod,
                  monthlyQuota: updated.monthlyQuota,
                  loanQuotas: updated.loanQuotas
                }
              : {})
          });

          try {
            await setDoc(doc(db, 'budgets', budgetId), updatedBudget);
            setBudgets(prev => prev.map(b => (b.id === budgetId ? updatedBudget : b)));
            setEditingBudget(null);
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
          }
        }}
      />

      <TransferModal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        budgets={budgets}
        currencySymbol={currencySymbol}
        initialFromId={transferInitialFromId}
        onSave={async ({ fromBudgetId, toBudgetId, amount, date, title, notes }) => {
          if (!firebaseUser || !fromBudgetId || !toBudgetId || fromBudgetId === toBudgetId) return;
          const toAcc = budgets.find(b => b.id === toBudgetId);
          const isPayingDebt = toAcc?.accountType === 'credit_card' || toAcc?.accountType === 'loan';
          const defaultLabel = isPayingDebt
            ? toAcc?.accountType === 'loan'
              ? 'Loan Payment'
              : 'Card Payment'
            : 'Self Transfer';
          const id = `tx_tr_${Date.now()}`;

          const newTx: Transaction = stripUndefined({
            id,
            userId: firebaseUser.uid,
            title: (title || defaultLabel).slice(0, 200),
            amount: Math.abs(Number(amount) || 0),
            type: 'expense',
            category: isPayingDebt ? 'Debt Payment' : 'Transfer',
            date: (date || new Date().toISOString().split('T')[0]).slice(0, 20),
            notes: (notes || '').trim().slice(0, 500),
            budgetId: fromBudgetId.slice(0, 50),
            transferToBudgetId: toBudgetId.slice(0, 50),
            isTransfer: true,
            isLoanPayment: isPayingDebt,
            status: 'cleared' as const
          });

          const { enrichedTx, nextBudgets, touchedIds } = applySingleTxInMemory(newTx, budgets);
          try {
            await setDoc(doc(db, 'transactions', id), stripUndefined(enrichedTx));
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `transactions/${id}`);
            return;
          }
          if (touchedIds.length > 0) {
            await persistTouchedBudgets(touchedIds, nextBudgets);
          }
          setTransactions(prev => [enrichedTx, ...prev].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
        }}
      />

      <StatementUploadModal
        isOpen={isUploadStatementOpen}
        onClose={() => setIsUploadStatementOpen(false)}
        budgets={budgets}
        existingTransactions={transactions}
        availableCategories={availableCategories}
        currencyCode={baseCurrencyCode}
        currencySymbol={currencySymbol}
        onImportTransactions={handleImportStatementTransactions}
        onOpenCreateBudget={() => setIsAddBudgetOpen(true)}
      />

      <AiAdvisorModal
        isOpen={isAiOpen}
        onClose={() => setIsAiOpen(false)}
        aiPrompt={aiPrompt}
        setAiPrompt={setAiPrompt}
        aiResult={aiResult}
        aiError={aiError}
        aiLoading={aiLoading}
        onAskAi={handleAskAi}
      />
    </div>
  );
}
