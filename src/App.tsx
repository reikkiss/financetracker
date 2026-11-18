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
  Percent,
  Upload,
  Building2,
  ArrowRightLeft
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
  deleteDoc,
  query,
  where
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

import DashboardPage from './components/DashboardPage';
import MonthlyStatsPage from './components/MonthlyStatsPage';
import BudgetsPage, { Budget, BudgetItem } from './components/BudgetsPage';
import {
  LoanQuota,
  LoanCalcMethod,
  LoanRatePeriod,
  allocateLoanPayment,
  calculateCreditCardMonthlyLimit,
  calculateLoanMonthlyQuota,
  generateLoanQuotasSchedule,
  reverseLoanPaymentOnQuotas
} from './utils/financeMath';
import TransactionsPage from './components/TransactionsPage';
import SettingsPage from './components/SettingsPage';
import StatementUploadModal, { ImportedTransactionDraft } from './components/StatementUploadModal';

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
}

function getAccountTypeLabel(accountType?: Budget['accountType']): string {
  if (accountType === 'credit_card') return '(Credit Card)';
  if (accountType === 'loan') return '(Loan)';
  if (accountType === 'bank_account') return '(Bank Account)';
  if (accountType === 'debit_account') return '(Debit Account)';
  return '(Budget)';
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
  const [authError, setAuthError] = useState<string | null>(null);
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
  const [editTxIsTransfer, setEditTxIsTransfer] = useState(false);
  const [editTxTransferToBudgetId, setEditTxTransferToBudgetId] = useState('');

  // Transfer Between Accounts Modal
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferFromId, setTransferFromId] = useState('');
  const [transferToId, setTransferToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split('T')[0]);
  const [transferTitle, setTransferTitle] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  // Add Budget Modal
  const [isAddBudgetOpen, setIsAddBudgetOpen] = useState(false);
  const [newBudgetCategory, setNewBudgetCategory] = useState('Groceries');
  const [newBudgetDescription, setNewBudgetDescription] = useState('');
  const [newBudgetAccountType, setNewBudgetAccountType] = useState<'standard' | 'credit_card' | 'loan' | 'bank_account' | 'debit_account'>('standard');
  const [newBudgetLimit, setNewBudgetLimit] = useState('');
  const [newBudgetCreditLimit, setNewBudgetCreditLimit] = useState('');
  const [newBudgetAccountBalance, setNewBudgetAccountBalance] = useState('');
  const [newBudgetApr, setNewBudgetApr] = useState('');
  const [newBudgetOverdraftPercentage, setNewBudgetOverdraftPercentage] = useState('');
  const [newBudgetLoanTermMonths, setNewBudgetLoanTermMonths] = useState('12');
  const [newBudgetLoanStartDate, setNewBudgetLoanStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [newBudgetLoanCalcMethod, setNewBudgetLoanCalcMethod] = useState<LoanCalcMethod>('amortized');
  const [newBudgetLoanRatePeriod, setNewBudgetLoanRatePeriod] = useState<LoanRatePeriod>('annual');
  const [newBudgetCustomMonthlyQuota, setNewBudgetCustomMonthlyQuota] = useState('');
  const [newBudgetLoanQuotas, setNewBudgetLoanQuotas] = useState<LoanQuota[]>([]);
  const [newBudgetExtraExpenses, setNewBudgetExtraExpenses] = useState('');
  const [newBudgetItems, setNewBudgetItems] = useState<BudgetItem[]>([]);
  const [newBudgetItemName, setNewBudgetItemName] = useState('');
  const [newBudgetItemAmount, setNewBudgetItemAmount] = useState('');
  const [newBudgetColor, setNewBudgetColor] = useState('#10b981');

  // Edit Budget Modal
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [editBudgetCategory, setEditBudgetCategory] = useState('Groceries');
  const [editBudgetDescription, setEditBudgetDescription] = useState('');
  const [editBudgetAccountType, setEditBudgetAccountType] = useState<'standard' | 'credit_card' | 'loan' | 'bank_account' | 'debit_account'>('standard');
  const [editBudgetLimit, setEditBudgetLimit] = useState('');
  const [editBudgetCreditLimit, setEditBudgetCreditLimit] = useState('');
  const [editBudgetAccountBalance, setEditBudgetAccountBalance] = useState('');
  const [editBudgetApr, setEditBudgetApr] = useState('');
  const [editBudgetOverdraftPercentage, setEditBudgetOverdraftPercentage] = useState('');
  const [editBudgetLoanTermMonths, setEditBudgetLoanTermMonths] = useState('12');
  const [editBudgetLoanStartDate, setEditBudgetLoanStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [editBudgetLoanCalcMethod, setEditBudgetLoanCalcMethod] = useState<LoanCalcMethod>('amortized');
  const [editBudgetLoanRatePeriod, setEditBudgetLoanRatePeriod] = useState<LoanRatePeriod>('annual');
  const [editBudgetCustomMonthlyQuota, setEditBudgetCustomMonthlyQuota] = useState('');
  const [editBudgetLoanQuotas, setEditBudgetLoanQuotas] = useState<LoanQuota[]>([]);
  const [editBudgetExtraExpenses, setEditBudgetExtraExpenses] = useState('');
  const [editBudgetItems, setEditBudgetItems] = useState<BudgetItem[]>([]);
  const [editBudgetItemName, setEditBudgetItemName] = useState('');
  const [editBudgetItemAmount, setEditBudgetItemAmount] = useState('');
  const [editBudgetColor, setEditBudgetColor] = useState('#10b981');

  // Statement Upload Modal
  const [isUploadStatementOpen, setIsUploadStatementOpen] = useState(false);

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
          name: (user.displayName || 'Finance User').slice(0, 100),
          email: (user.email || '').slice(0, 100),
          avatar: '📊',
          currency: 'USD',
          monthlyBudget: 5000
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
      setBudgets(budgetSnap.docs.map(d => ({ id: d.id, ...d.data() } as Budget)));
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
        const host = typeof window !== 'undefined' ? window.location.hostname : 'your-github-pages-domain';
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

  const totalIncome = useMemo(
    () => transactions.filter(t => t.type === 'income' && !t.isTransfer).reduce((s, t) => s + t.amount, 0),
    [transactions]
  );
  const totalExpense = useMemo(
    () => transactions.filter(t => t.type === 'expense' && !t.isTransfer).reduce((s, t) => s + t.amount, 0),
    [transactions]
  );
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
      .filter(t => !t.isTransfer && t.type === breakdownMode.toLowerCase())
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
      if (t.isTransfer) return;
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
    const mTransactions = transactions.filter(t => !t.isTransfer && t.date && t.date.startsWith(currentMonthKey));
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
      const monthTxs = transactions.filter(t => !t.isTransfer && t.date && t.date.startsWith(m.key));
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
        await setDoc(doc(db, 'budgets', budgetId), target);
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
        items: []
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

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !newTxTitle.trim() || !newTxAmount) return;
    const parsedAmount = Math.abs(parseFloat(newTxAmount) || 0);
    if (parsedAmount <= 0) return;

    const id = 'tx_' + Date.now();
    const newTx: Transaction = {
      id,
      userId: firebaseUser.uid,
      title: newTxTitle.trim().slice(0, 200),
      amount: parsedAmount,
      type: defaultTxType,
      category: (newTxCategory || 'Other').trim().slice(0, 50),
      date: (newTxDate || new Date().toISOString().split('T')[0]).slice(0, 20),
      notes: (newTxNotes || '').trim().slice(0, 500),
      ...(newTxBudgetId ? { budgetId: newTxBudgetId.slice(0, 50) } : {}),
      isLoanPayment: Boolean(newTxIsLoanPayment)
    };

    const latestBudgets = await ensureBudgetsForCategories(
      { [newTx.category]: newTx.type === 'expense' ? newTx.amount : 0 },
      budgets
    );

    const { enrichedTx, nextBudgets, touchedIds } = applySingleTxInMemory(newTx, latestBudgets);

    try {
      await setDoc(doc(db, 'transactions', id), enrichedTx);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `transactions/${id}`);
      return;
    }

    if (touchedIds.length > 0) {
      await persistTouchedBudgets(touchedIds, nextBudgets);
    }

    setTransactions(prev => [enrichedTx, ...prev].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    setNewTxTitle('');
    setNewTxAmount('');
    setNewTxNotes('');
    setNewTxBudgetId('');
    setNewTxIsLoanPayment(false);
    setIsAddTxOpen(false);
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
    setEditTxTitle(t.title);
    setEditTxAmount(t.amount.toString());
    setEditTxType(t.type);
    setEditTxCategory(t.category);
    setEditTxDate(t.date || new Date().toISOString().split('T')[0]);
    setEditTxNotes(t.notes || '');
    setEditTxBudgetId(t.budgetId || '');
    setEditTxIsLoanPayment(Boolean(t.isLoanPayment));
    setEditTxIsTransfer(Boolean(t.isTransfer));
    setEditTxTransferToBudgetId(t.transferToBudgetId || '');
  };

  const handleSaveEditTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !editingTx || !editTxTitle.trim() || !editTxAmount) return;
    const parsedAmount = Math.abs(parseFloat(editTxAmount) || 0);
    if (parsedAmount <= 0) return;

    const isTransferTx = Boolean(editTxIsTransfer && editTxBudgetId && editTxTransferToBudgetId && editTxBudgetId !== editTxTransferToBudgetId);
    const updatedTx: Transaction = {
      id: editingTx.id,
      userId: editingTx.userId,
      title: editTxTitle.trim().slice(0, 200),
      amount: parsedAmount,
      type: isTransferTx ? 'expense' : editTxType,
      category: (editTxCategory || (isTransferTx ? 'Transfer' : 'Other')).trim().slice(0, 50),
      date: (editTxDate || new Date().toISOString().split('T')[0]).slice(0, 20),
      notes: (editTxNotes || '').trim().slice(0, 500),
      ...(editTxBudgetId ? { budgetId: editTxBudgetId.slice(0, 50) } : {}),
      isLoanPayment: Boolean(editTxIsLoanPayment),
      isTransfer: isTransferTx,
      ...(isTransferTx ? { transferToBudgetId: editTxTransferToBudgetId.slice(0, 50) } : {})
    };

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
      await setDoc(doc(db, 'transactions', editingTx.id), applied.enrichedTx);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `transactions/${editingTx.id}`);
      return;
    }

    if (allTouched.length > 0) {
      await persistTouchedBudgets(allTouched, applied.nextBudgets);
    }

    setTransactions(prev =>
      prev.map(t => (t.id === editingTx.id ? applied.enrichedTx : t)).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    );
    setEditingTx(null);
  };

  const handleOpenTransfer = (fromBudget?: Budget) => {
    if (budgets.length < 2) return;
    const defaultFrom =
      fromBudget?.id ||
      budgets.find(b => b.accountType === 'bank_account' || b.accountType === 'debit_account')?.id ||
      budgets[0].id;
    const defaultTo = budgets.find(b => b.id !== defaultFrom)?.id || '';
    setTransferFromId(defaultFrom);
    setTransferToId(defaultTo);
    setTransferAmount('');
    setTransferDate(new Date().toISOString().split('T')[0]);
    setTransferTitle('');
    setTransferNotes('');
    setIsTransferOpen(true);
  };

  const handleSaveTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !transferFromId || !transferToId || transferFromId === transferToId) return;
    const parsedAmount = Math.abs(parseFloat(transferAmount) || 0);
    if (parsedAmount <= 0) return;

    const fromAcc = budgets.find(b => b.id === transferFromId);
    const toAcc = budgets.find(b => b.id === transferToId);
    const fromName = fromAcc?.name || fromAcc?.category || 'Account';
    const toName = toAcc?.name || toAcc?.category || 'Account';
    const isPayingDebt = toAcc?.accountType === 'credit_card' || toAcc?.accountType === 'loan';

    const id = `tx_tr_${Date.now()}`;
    const newTx: Transaction = {
      id,
      userId: firebaseUser.uid,
      title: (transferTitle.trim() || `Transfer: ${fromName} → ${toName}`).slice(0, 200),
      amount: parsedAmount,
      type: 'expense',
      category: 'Transfer',
      date: (transferDate || new Date().toISOString().split('T')[0]).slice(0, 20),
      notes: (transferNotes.trim() || `Internal transfer from ${fromName} to ${toName}`).slice(0, 500),
      budgetId: transferFromId.slice(0, 50),
      transferToBudgetId: transferToId.slice(0, 50),
      isTransfer: true,
      isLoanPayment: isPayingDebt
    };

    const { enrichedTx, nextBudgets, touchedIds } = applySingleTxInMemory(newTx, budgets);

    try {
      await setDoc(doc(db, 'transactions', id), enrichedTx);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `transactions/${id}`);
      return;
    }

    if (touchedIds.length > 0) {
      await persistTouchedBudgets(touchedIds, nextBudgets);
    }

    setTransactions(prev => [enrichedTx, ...prev].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    setIsTransferOpen(false);
  };

  const handleImportStatementTransactions = async (rows: ImportedTransactionDraft[]) => {
    if (!firebaseUser || rows.length === 0) return;

    const makeKey = (title: string, amount: number, date: string) => {
      const normTitle = (title || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const normAmount = Math.abs(Number(amount) || 0).toFixed(2);
      const normDate = (date || '').trim().slice(0, 10);
      return `${normTitle}|${normAmount}|${normDate}`;
    };

    const existingCounts = new Map<string, number>();
    transactions.forEach(et => {
      const k = makeKey(et.title, et.amount, et.date);
      existingCounts.set(k, (existingCounts.get(k) || 0) + 1);
    });

    const missingRows: ImportedTransactionDraft[] = [];
    for (const r of rows) {
      const key = makeKey(r.title, r.amount, r.date);
      const remaining = existingCounts.get(key) || 0;
      if (remaining > 0) {
        existingCounts.set(key, remaining - 1);
      } else {
        missingRows.push(r);
      }
    }

    if (missingRows.length === 0) return;

    const baseTs = Date.now();
    const createdTxs: Transaction[] = [];
    const categoryTotals: Record<string, number> = {};

    for (let i = 0; i < missingRows.length; i++) {
      const r = missingRows[i];
      if (r.isTransfer) continue;
      const cat = (r.category || 'Other').trim().slice(0, 50);
      const amt = Math.abs(Number(r.amount) || 0);
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (r.type === 'expense' ? amt : 0);
    }

    let workingBudgets = await ensureBudgetsForCategories(categoryTotals, budgets);
    const allTouchedIds = new Set<string>();

    for (let i = 0; i < missingRows.length; i++) {
      const r = missingRows[i];
      const id = `tx_${baseTs}_${i}`;
      const isTransferTx = Boolean(r.isTransfer && r.budgetId && r.transferToBudgetId && r.budgetId !== r.transferToBudgetId);
      const newTx: Transaction = {
        id,
        userId: firebaseUser.uid,
        title: (r.title || 'Transaction').trim().slice(0, 200),
        amount: Math.abs(Number(r.amount) || 0),
        type: isTransferTx ? 'expense' : r.type === 'income' ? 'income' : 'expense',
        category: (isTransferTx ? (r.category || 'Transfer') : r.category || 'Other').trim().slice(0, 50),
        date: (r.date || new Date().toISOString().split('T')[0]).slice(0, 20),
        notes: (r.notes || '').trim().slice(0, 500),
        ...(r.budgetId ? { budgetId: r.budgetId.slice(0, 50) } : {}),
        isLoanPayment: Boolean(r.isLoanPayment),
        isTransfer: isTransferTx,
        ...(isTransferTx && r.transferToBudgetId ? { transferToBudgetId: r.transferToBudgetId.slice(0, 50) } : {})
      };

      const { enrichedTx, nextBudgets, touchedIds } = applySingleTxInMemory(newTx, workingBudgets);
      workingBudgets = nextBudgets;
      touchedIds.forEach(tid => allTouchedIds.add(tid));

      try {
        await setDoc(doc(db, 'transactions', id), enrichedTx);
        createdTxs.push(enrichedTx);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `transactions/${id}`);
      }
    }

    if (allTouchedIds.size > 0) {
      await persistTouchedBudgets(Array.from(allTouchedIds), workingBudgets);
    }

    setTransactions(prev => [...createdTxs, ...prev].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
  };

  const handleToggleBudgetItemPaid = async (budgetId: string, itemId: string) => {
    const target = budgets.find(b => b.id === budgetId);
    if (!target || !target.items || (target.accountType || 'standard') !== 'standard') return;
    const updatedItems = target.items.map(item =>
      item.id === itemId ? { ...item, isPaid: !item.isPaid } : item
    );
    const updatedBudget: Budget = { ...target, items: updatedItems };
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

      updatedTxMap[ut.id] = {
        ...ut,
        loanPrincipalPaid: split.principalPaid,
        loanInterestPaid: split.interestPaid,
        ...(paidIdsForUt.length > 0 ? { paidQuotaIds: paidIdsForUt } : {})
      };
    }

    const updatedBudget: Budget = {
      ...target,
      actualUsedAmount: remPrin,
      loanQuotas: workingQuotas
    };

    for (const updatedTx of Object.values(updatedTxMap)) {
      try {
        await setDoc(doc(db, 'transactions', updatedTx.id), updatedTx);
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
        // Delete standalone quota payment transaction and restore principal
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
        // Legacy standalone quota tx missing from local list
        try {
          await deleteDoc(doc(db, 'transactions', quota.paymentTxId));
          setTransactions(prev => prev.filter(t => t.id !== quota.paymentTxId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `transactions/${quota.paymentTxId}`);
        }
        nextUsed = Math.min(maxCap > 0 ? maxCap : currentUsed + balanceStep, Number((currentUsed + balanceStep).toFixed(2)));
      } else if (!quota.paymentTxId) {
        // Manually toggled quota without payment tx
        nextUsed = Math.min(maxCap > 0 ? maxCap : currentUsed + balanceStep, Number((currentUsed + balanceStep).toFixed(2)));
      }

      // Unlink quotaId from any remaining referencing transactions (e.g., Bank -> Loan transfers) without deleting them
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
          await setDoc(doc(db, 'transactions', refTx.id), cleanedTx);
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

      const updatedBudget: Budget = { ...target, actualUsedAmount: nextUsed, loanQuotas: updatedQuotas };
      try {
        await setDoc(doc(db, 'budgets', budgetId), updatedBudget);
        setBudgets(prev => prev.map(b => (b.id === budgetId ? updatedBudget : b)));
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `budgets/${budgetId}`);
      }
      return;
    }

    // nextIsPaid === true: Check for existing unlinked transfers / payments before creating a duplicate transaction
    const unlinked = getUnlinkedLoanPayments(target, transactions);
    const unlinkedTotal = Number(
      unlinked.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0).toFixed(2)
    );

    if (unlinkedTotal >= quota.amount - 1.0) {
      // Existing unlinked transfer(s)/payment(s) already cover this quota — reconcile without creating a duplicate tx
      await reconcileUnlinkedPaymentsForLoan(target, unlinked);
      return;
    }

    let workingTarget = target;
    let partialAlreadyInt = 0;
    const partialTxUpdates: Record<string, Transaction> = {};

    if (unlinked.length > 0) {
      // First normalize any legacy partial transfer(s) so principal & interest are split properly
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
      paidQuotaIds: [quota.id]
    };

    try {
      await setDoc(doc(db, 'transactions', txId), newTx);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`);
      return;
    }

    for (const patchedPartial of Object.values(partialTxUpdates)) {
      try {
        await setDoc(doc(db, 'transactions', patchedPartial.id), patchedPartial);
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

    const updatedBudget: Budget = {
      ...workingTarget,
      actualUsedAmount: nextUsed,
      loanQuotas: updatedQuotas
    };

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
    const updatedBudget: Budget = {
      ...target,
      loanQuotas: nextQuotas,
      loanTermMonths: nextQuotas.length,
      monthlyQuota: nextMonthlyQuota,
      limit: nextMonthlyQuota > 0 ? nextMonthlyQuota : target.limit
    };
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
    const updatedBudget: Budget = {
      ...target,
      loanQuotas: filtered,
      loanTermMonths: filtered.length
    };
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

    const updatedBudget: Budget = {
      ...target,
      loanTermMonths: term,
      loanStartDate: (target.loanStartDate || new Date().toISOString().split('T')[0]).slice(0, 20),
      monthlyQuota: generated.monthlyQuota,
      limit: generated.monthlyQuota > 0 ? generated.monthlyQuota : target.limit,
      loanQuotas: generated.quotas
    };
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
    setNewTxTitle(`Payment - ${name}`);
    setNewTxCategory(name);
    setNewTxBudgetId(b.id);
    setNewTxIsLoanPayment(true);
    setNewTxDate(new Date().toISOString().split('T')[0]);
    setIsAddTxOpen(true);
  };

  const resetAddBudgetForm = () => {
    setNewBudgetCategory('Groceries');
    setNewBudgetDescription('');
    setNewBudgetAccountType('standard');
    setNewBudgetLimit('');
    setNewBudgetCreditLimit('');
    setNewBudgetAccountBalance('');
    setNewBudgetApr('');
    setNewBudgetOverdraftPercentage('');
    setNewBudgetLoanTermMonths('12');
    setNewBudgetLoanStartDate(new Date().toISOString().split('T')[0]);
    setNewBudgetLoanCalcMethod('amortized');
    setNewBudgetLoanRatePeriod('annual');
    setNewBudgetCustomMonthlyQuota('');
    setNewBudgetLoanQuotas([]);
    setNewBudgetExtraExpenses('');
    setNewBudgetItems([]);
    setNewBudgetItemName('');
    setNewBudgetItemAmount('');
    setNewBudgetColor('#10b981');
  };

  const handleAddNewBudgetItem = () => {
    const name = newBudgetItemName.trim();
    const amount = parseFloat(newBudgetItemAmount);
    if (!name || isNaN(amount) || amount < 0) return;
    const nextItem: BudgetItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.slice(0, 120),
      amount,
      isPaid: false
    };
    setNewBudgetItems(prev => [...prev, nextItem]);
    setNewBudgetItemName('');
    setNewBudgetItemAmount('');
  };

  const handleAddEditBudgetItem = () => {
    const name = editBudgetItemName.trim();
    const amount = parseFloat(editBudgetItemAmount);
    if (!name || isNaN(amount) || amount < 0) return;
    const nextItem: BudgetItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.slice(0, 120),
      amount,
      isPaid: false
    };
    setEditBudgetItems(prev => [...prev, nextItem]);
    setEditBudgetItemName('');
    setEditBudgetItemAmount('');
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !newBudgetCategory.trim()) return;

    const isStandard = newBudgetAccountType === 'standard';
    const isCreditCard = newBudgetAccountType === 'credit_card';
    const isLoan = newBudgetAccountType === 'loan';
    const isBankAccount = newBudgetAccountType === 'bank_account';
    const isDebitAccount = newBudgetAccountType === 'debit_account';
    const isLiquidAccount = isBankAccount || isDebitAccount;

    const creditLimitVal = Math.max(0, parseFloat(newBudgetCreditLimit) || 0);
    const aprVal = Math.max(0, parseFloat(newBudgetApr) || 0);
    const overdraftVal = Math.max(0, parseFloat(newBudgetOverdraftPercentage) || 0);
    const openingBalanceVal = Number((parseFloat(newBudgetAccountBalance) || 0).toFixed(2));

    let computedLimit = 0;
    let loanFields: Partial<Budget> = {};

    if (isStandard) {
      const itemsSum = newBudgetItems.reduce((s, item) => s + (Number(item.amount) || 0), 0);
      const extraExp = parseFloat(newBudgetExtraExpenses) || 0;
      const hasChecklist = newBudgetItems.length > 0 || extraExp > 0;
      computedLimit = hasChecklist ? itemsSum + extraExp : Math.max(0, parseFloat(newBudgetLimit) || 0);
      if (computedLimit <= 0) return;
    } else if (isLiquidAccount) {
      computedLimit = Math.max(0, parseFloat(newBudgetLimit) || 0);
    } else if (isCreditCard) {
      if (creditLimitVal <= 0) return;
      computedLimit = calculateCreditCardMonthlyLimit(creditLimitVal, overdraftVal).monthlyLimit;
    } else if (isLoan) {
      if (creditLimitVal <= 0) return;
      const termMonthsVal = Math.min(600, Math.max(1, Math.floor(parseFloat(newBudgetLoanTermMonths) || 12)));
      const startDateVal = (newBudgetLoanStartDate || new Date().toISOString().split('T')[0]).slice(0, 20);
      const customQuotaVal = Math.max(0, parseFloat(newBudgetCustomMonthlyQuota) || 0);
      const generated = generateLoanQuotasSchedule({
        principal: creditLimitVal,
        annualApr: aprVal,
        termMonths: termMonthsVal,
        startDate: startDateVal,
        ratePeriod: newBudgetLoanRatePeriod,
        calcMethod: newBudgetLoanCalcMethod,
        customMonthlyQuota: customQuotaVal > 0 ? customQuotaVal : undefined
      });
      const finalQuotas = newBudgetLoanQuotas.length > 0 ? newBudgetLoanQuotas : generated.quotas;
      const monthlyQuotaVal =
        customQuotaVal > 0
          ? customQuotaVal
          : generated.monthlyQuota ||
            calculateLoanMonthlyQuota(creditLimitVal, aprVal, termMonthsVal, {
              ratePeriod: newBudgetLoanRatePeriod,
              calcMethod: newBudgetLoanCalcMethod
            });
      computedLimit = monthlyQuotaVal > 0 ? monthlyQuotaVal : creditLimitVal;
      loanFields = {
        loanTermMonths: finalQuotas.length > 0 ? finalQuotas.length : termMonthsVal,
        loanStartDate: startDateVal,
        loanCalcMethod: newBudgetLoanCalcMethod,
        loanRatePeriod: newBudgetLoanRatePeriod,
        monthlyQuota: monthlyQuotaVal,
        loanQuotas: finalQuotas
      };
    }

    const id = 'b_' + Date.now();
    const catVal = newBudgetCategory.trim().slice(0, 50);
    const extraExpStandard = isStandard ? (parseFloat(newBudgetExtraExpenses) || 0) : 0;

    const budget: Budget = {
      id,
      userId: firebaseUser.uid,
      name: catVal,
      category: catVal,
      description: newBudgetDescription.trim().slice(0, 500),
      limit: computedLimit,
      color: newBudgetColor,
      accountType: newBudgetAccountType,
      extraExpenses: extraExpStandard,
      items: isStandard ? newBudgetItems : [],
      ...(isLiquidAccount
        ? {
            accountBalance: openingBalanceVal,
            ...(isBankAccount ? { apr: aprVal } : {})
          }
        : {}),
      ...(isCreditCard
        ? {
            apr: aprVal,
            creditLimit: creditLimitVal,
            overdraftPercentage: overdraftVal,
            actualUsedAmount: 0
          }
        : {}),
      ...(isLoan
        ? {
            apr: aprVal,
            creditLimit: creditLimitVal,
            overdraftPercentage: 0,
            actualUsedAmount: creditLimitVal,
            ...loanFields
          }
        : {})
    };

    try {
      await setDoc(doc(db, 'budgets', id), budget);
      setBudgets(prev => [
        ...prev.filter(b => (b.category || b.name || '').toLowerCase() !== catVal.toLowerCase()),
        budget
      ]);
      resetAddBudgetForm();
      setIsAddBudgetOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `budgets/${id}`);
    }
  };

  const handleOpenEditBudget = (b: Budget) => {
    const isStandard = (b.accountType || 'standard') === 'standard';
    const ratePeriod: LoanRatePeriod = b.loanRatePeriod || 'annual';
    const calcMethod: LoanCalcMethod = b.loanCalcMethod || 'amortized';
    const basePrincipal = Number(b.creditLimit ?? b.limit ?? 0);
    const formulaQuota = calculateLoanMonthlyQuota(basePrincipal, Number(b.apr || 0), Number(b.loanTermMonths || 12), {
      ratePeriod,
      calcMethod
    });
    const isCustomQuota =
      b.monthlyQuota !== undefined &&
      b.monthlyQuota > 0 &&
      Math.abs(b.monthlyQuota - formulaQuota) > 0.05;

    setEditingBudget(b);
    setEditBudgetCategory(b.name || b.category);
    setEditBudgetDescription(b.description || '');
    setEditBudgetAccountType(b.accountType || 'standard');
    setEditBudgetLimit(b.limit > 0 ? b.limit.toString() : '');
    setEditBudgetCreditLimit(b.creditLimit !== undefined ? b.creditLimit.toString() : '');
    setEditBudgetAccountBalance(b.accountBalance !== undefined ? b.accountBalance.toString() : '0');
    setEditBudgetApr(b.apr !== undefined ? b.apr.toString() : '');
    setEditBudgetOverdraftPercentage(b.overdraftPercentage !== undefined ? b.overdraftPercentage.toString() : '');
    setEditBudgetLoanTermMonths(b.loanTermMonths !== undefined ? b.loanTermMonths.toString() : '12');
    setEditBudgetLoanStartDate(b.loanStartDate || new Date().toISOString().split('T')[0]);
    setEditBudgetLoanCalcMethod(calcMethod);
    setEditBudgetLoanRatePeriod(ratePeriod);
    setEditBudgetCustomMonthlyQuota(isCustomQuota ? b.monthlyQuota!.toString() : '');
    setEditBudgetLoanQuotas(b.accountType === 'loan' && b.loanQuotas ? [...b.loanQuotas] : []);
    setEditBudgetExtraExpenses(isStandard && b.extraExpenses !== undefined && b.extraExpenses > 0 ? b.extraExpenses.toString() : '');
    setEditBudgetItems(isStandard && b.items ? [...b.items] : []);
    setEditBudgetItemName('');
    setEditBudgetItemAmount('');
    setEditBudgetColor(b.color || '#10b981');
  };

  const handleSaveEditBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !editingBudget || !editBudgetCategory.trim()) return;

    const isStandard = editBudgetAccountType === 'standard';
    const isCreditCard = editBudgetAccountType === 'credit_card';
    const isLoan = editBudgetAccountType === 'loan';
    const isBankAccount = editBudgetAccountType === 'bank_account';
    const isDebitAccount = editBudgetAccountType === 'debit_account';
    const isLiquidAccount = isBankAccount || isDebitAccount;

    const creditLimitVal = Math.max(0, parseFloat(editBudgetCreditLimit) || 0);
    const aprVal = Math.max(0, parseFloat(editBudgetApr) || 0);
    const overdraftVal = Math.max(0, parseFloat(editBudgetOverdraftPercentage) || 0);
    const accountBalanceVal = Number((parseFloat(editBudgetAccountBalance) || 0).toFixed(2));

    let computedLimit = 0;
    let loanFields: Partial<Budget> = {};
    let nextLoanUsedAmount = creditLimitVal;

    if (isStandard) {
      const itemsSum = editBudgetItems.reduce((s, item) => s + (Number(item.amount) || 0), 0);
      const extraExp = parseFloat(editBudgetExtraExpenses) || 0;
      const hasChecklist = editBudgetItems.length > 0 || extraExp > 0;
      computedLimit = hasChecklist ? itemsSum + extraExp : Math.max(0, parseFloat(editBudgetLimit) || 0);
    } else if (isLiquidAccount) {
      computedLimit = Math.max(0, parseFloat(editBudgetLimit) || 0);
    } else if (isCreditCard) {
      computedLimit = calculateCreditCardMonthlyLimit(creditLimitVal, overdraftVal).monthlyLimit;
    } else if (isLoan) {
      const termMonthsVal = Math.min(600, Math.max(1, Math.floor(parseFloat(editBudgetLoanTermMonths) || 12)));
      const startDateVal = (editBudgetLoanStartDate || new Date().toISOString().split('T')[0]).slice(0, 20);
      const customQuotaVal = Math.max(0, parseFloat(editBudgetCustomMonthlyQuota) || 0);
      const generated = generateLoanQuotasSchedule({
        principal: creditLimitVal,
        annualApr: aprVal,
        termMonths: termMonthsVal,
        startDate: startDateVal,
        ratePeriod: editBudgetLoanRatePeriod,
        calcMethod: editBudgetLoanCalcMethod,
        customMonthlyQuota: customQuotaVal > 0 ? customQuotaVal : undefined,
        existingQuotas: editingBudget.loanQuotas
      });
      const finalQuotas = editBudgetLoanQuotas.length > 0 ? editBudgetLoanQuotas : generated.quotas;
      const monthlyQuotaVal =
        customQuotaVal > 0
          ? customQuotaVal
          : generated.monthlyQuota ||
            calculateLoanMonthlyQuota(creditLimitVal, aprVal, termMonthsVal, {
              ratePeriod: editBudgetLoanRatePeriod,
              calcMethod: editBudgetLoanCalcMethod
            });
      computedLimit = monthlyQuotaVal > 0 ? monthlyQuotaVal : creditLimitVal;
      loanFields = {
        loanTermMonths: finalQuotas.length > 0 ? finalQuotas.length : termMonthsVal,
        loanStartDate: startDateVal,
        loanCalcMethod: editBudgetLoanCalcMethod,
        loanRatePeriod: editBudgetLoanRatePeriod,
        monthlyQuota: monthlyQuotaVal,
        loanQuotas: finalQuotas
      };

      if (editingBudget.accountType === 'loan') {
        const oldPrincipal = Number(editingBudget.creditLimit ?? creditLimitVal);
        const oldUsed = Number(editingBudget.actualUsedAmount ?? oldPrincipal);
        const principalAlreadyPaid = Math.max(0, Number((oldPrincipal - oldUsed).toFixed(2)));
        nextLoanUsedAmount = Math.max(0, Number((creditLimitVal - principalAlreadyPaid).toFixed(2)));
      }
    }

    const catVal = editBudgetCategory.trim().slice(0, 50);
    const extraExpStandard = isStandard ? (parseFloat(editBudgetExtraExpenses) || 0) : 0;

    const updatedBudget: Budget = {
      id: editingBudget.id,
      userId: editingBudget.userId,
      name: catVal,
      category: catVal,
      description: editBudgetDescription.trim().slice(0, 500),
      limit: computedLimit,
      color: editBudgetColor,
      accountType: editBudgetAccountType,
      extraExpenses: extraExpStandard,
      items: isStandard ? editBudgetItems : [],
      ...(isLiquidAccount
        ? {
            accountBalance: accountBalanceVal,
            ...(isBankAccount ? { apr: aprVal } : {})
          }
        : {}),
      ...(isCreditCard
        ? {
            apr: aprVal,
            creditLimit: creditLimitVal,
            overdraftPercentage: overdraftVal,
            actualUsedAmount: editingBudget.actualUsedAmount ?? 0
          }
        : {}),
      ...(isLoan
        ? {
            apr: aprVal,
            creditLimit: creditLimitVal,
            overdraftPercentage: 0,
            actualUsedAmount: nextLoanUsedAmount,
            ...loanFields
          }
        : {})
    };

    try {
      await setDoc(doc(db, 'budgets', editingBudget.id), updatedBudget);
      setBudgets(prev => prev.map(b => (b.id === editingBudget.id ? updatedBudget : b)));
      setEditingBudget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `budgets/${editingBudget.id}`);
    }
  };

  const handleDeleteBudget = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'budgets', id));
      setBudgets(prev => prev.filter(b => b.id !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `budgets/${id}`);
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
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setAiResult('AI Financial Advisor is unavailable on static hosting.');
        return;
      }
      const data = await res.json();
      setAiResult(data.advice || data.error || 'No response generated.');
    } catch (err) {
      setAiResult('Unable to reach the AI Advisor backend.');
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

          {authError && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl p-3 text-[11px] text-left leading-relaxed">
              {authError}
            </div>
          )}

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
            onClick={() => {
              setDefaultTxType('expense');
              setNewTxBudgetId('');
              setNewTxIsLoanPayment(false);
              setIsAddTxOpen(true);
            }}
            className="w-full flex items-center gap-2 bg-[#222] hover:bg-[#282828] text-zinc-300 hover:text-white px-3 py-2 rounded-md text-xs font-medium border border-[#2f2f2f] transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-rose-400" /> New Expense
          </button>
          <button
            onClick={() => {
              setDefaultTxType('income');
              setNewTxBudgetId('');
              setNewTxIsLoanPayment(false);
              setIsAddTxOpen(true);
            }}
            className="w-full flex items-center gap-2 bg-[#222] hover:bg-[#282828] text-zinc-300 hover:text-white px-3 py-2 rounded-md text-xs font-medium border border-[#2f2f2f] transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" /> New Income
          </button>
          {budgets.length >= 2 && (
            <button
              onClick={() => handleOpenTransfer()}
              className="w-full flex items-center gap-2 bg-[#222] hover:bg-[#282828] text-blue-300 hover:text-white px-3 py-2 rounded-md text-xs font-medium border border-[#2f2f2f] transition shadow-sm"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 text-blue-400" /> Transfer Money
            </button>
          )}
          <button
            onClick={() => setIsUploadStatementOpen(true)}
            className="w-full flex items-center gap-2 bg-[#222] hover:bg-[#282828] text-emerald-300 hover:text-white px-3 py-2 rounded-md text-xs font-medium border border-[#2f2f2f] transition shadow-sm"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" /> Upload Statement
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
              setNewTxBudgetId('');
              setNewTxIsLoanPayment(false);
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
            onOpenAddBudget={() => {
              resetAddBudgetForm();
              setIsAddBudgetOpen(true);
            }}
            onOpenEditBudget={handleOpenEditBudget}
            onDeleteBudget={handleDeleteBudget}
            onToggleItemPaid={handleToggleBudgetItemPaid}
            onOpenRecordPayment={handleOpenRecordPayment}
            onOpenTransfer={handleOpenTransfer}
            onToggleLoanQuotaPaid={handleToggleLoanQuotaPaid}
            onReconcileLoanPayments={handleReconcileLoanPayments}
            onAddLoanQuota={handleAddLoanQuota}
            onDeleteLoanQuota={handleDeleteLoanQuota}
            onGenerateLoanQuotas={handleGenerateLoanQuotas}
          />
        )}

        {activeTab === 'transactions' && (
          <TransactionsPage
            transactions={transactions}
            budgets={budgets}
            currencySymbol={currencySymbol}
            onOpenAddTx={(type) => {
              setDefaultTxType(type);
              setNewTxBudgetId('');
              setNewTxIsLoanPayment(false);
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
          />
        )}

      </main>

      {/* MODALS */}
      {isAddTxOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white capitalize">
                {newTxIsLoanPayment ? 'Record Payment / Abono' : `New ${defaultTxType}`}
              </h3>
              <button onClick={() => setIsAddTxOpen(false)} className="text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreateTransaction} className="space-y-3">
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Title</label>
                <input
                  type="text"
                  required
                  maxLength={200}
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
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={newTxAmount}
                    onChange={e => setNewTxAmount(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9b9b9b] block mb-1">Category (Matches Budget)</label>
                  <select
                    value={newTxCategory}
                    onChange={e => setNewTxCategory(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                  >
                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {budgets.length > 0 && (
                <div className="space-y-2 bg-[#1a1a1a] border border-[#2d2d2d] p-3 rounded-xl">
                  <label className="text-[11px] text-[#9b9b9b] block">Link to Bank / Debit / Credit Card / Loan / Budget Account (Optional)</label>
                  <select
                    value={newTxBudgetId}
                    onChange={e => {
                      const nextId = e.target.value;
                      setNewTxBudgetId(nextId);
                      const matched = budgets.find(b => b.id === nextId);
                      if (!matched || (matched.accountType !== 'credit_card' && matched.accountType !== 'loan')) {
                        setNewTxIsLoanPayment(false);
                      }
                    }}
                    className="w-full bg-[#121212] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="">None (Match by Category only)</option>
                    {budgets.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                      </option>
                    ))}
                  </select>

                  {(() => {
                    const linked = budgets.find(b => b.id === newTxBudgetId);
                    if (linked && (linked.accountType === 'credit_card' || linked.accountType === 'loan')) {
                      return (
                        <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={newTxIsLoanPayment}
                            onChange={e => setNewTxIsLoanPayment(e.target.checked)}
                            className="accent-emerald-500 w-3.5 h-3.5"
                          />
                          <span className="text-[11px] text-emerald-400 font-medium">
                            Payment / Abono to {linked.name || linked.category} (Reduces balance used)
                          </span>
                        </label>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Date</label>
                <input
                  type="date"
                  value={newTxDate}
                  onChange={e => setNewTxDate(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  maxLength={500}
                  placeholder="Optional reference or details..."
                  value={newTxNotes}
                  onChange={e => setNewTxNotes(e.target.value)}
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
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
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
                  maxLength={200}
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
                    min="0.01"
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

              {budgets.length > 0 && (
                <div className="space-y-2.5 bg-[#1a1a1a] border border-[#2d2d2d] p-3 rounded-xl">
                  <label className="text-[11px] text-[#9b9b9b] block">
                    {editTxIsTransfer ? 'Source Account (Money Leaves)' : 'Link to Bank / Debit / Credit Card / Loan / Budget Account (Optional)'}
                  </label>
                  <select
                    value={editTxBudgetId}
                    onChange={e => {
                      const nextId = e.target.value;
                      setEditTxBudgetId(nextId);
                      if (nextId === editTxTransferToBudgetId) {
                        setEditTxTransferToBudgetId('');
                      }
                      const matched = budgets.find(b => b.id === nextId);
                      if (!matched || (matched.accountType !== 'credit_card' && matched.accountType !== 'loan')) {
                        if (!editTxIsTransfer) setEditTxIsLoanPayment(false);
                      }
                    }}
                    className="w-full bg-[#121212] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="">None (Match by Category only)</option>
                    {budgets.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                      </option>
                    ))}
                  </select>

                  {budgets.length >= 2 && editTxBudgetId && (
                    <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={editTxIsTransfer}
                        onChange={e => {
                          const checked = e.target.checked;
                          setEditTxIsTransfer(checked);
                          if (!checked) {
                            setEditTxTransferToBudgetId('');
                          } else {
                            const fallbackDest = budgets.find(b => b.id !== editTxBudgetId)?.id || '';
                            setEditTxTransferToBudgetId(fallbackDest);
                            const dest = budgets.find(b => b.id === fallbackDest);
                            setEditTxIsLoanPayment(dest?.accountType === 'credit_card' || dest?.accountType === 'loan');
                          }
                        }}
                        className="accent-blue-500 w-3.5 h-3.5"
                      />
                      <span className="text-[11px] text-blue-300 font-medium">
                        Transfer to another account (Excluded from Income/Expense totals)
                      </span>
                    </label>
                  )}

                  {editTxIsTransfer && editTxBudgetId && (
                    <div>
                      <label className="text-[11px] text-[#9b9b9b] block mb-1">Destination Account (Money Enters)</label>
                      <select
                        value={editTxTransferToBudgetId}
                        onChange={e => {
                          const nextDestId = e.target.value;
                          setEditTxTransferToBudgetId(nextDestId);
                          const dest = budgets.find(b => b.id === nextDestId);
                          setEditTxIsLoanPayment(dest?.accountType === 'credit_card' || dest?.accountType === 'loan');
                        }}
                        className="w-full bg-[#121212] border border-blue-500/40 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-400"
                      >
                        <option value="">-- Select Destination Account --</option>
                        {budgets
                          .filter(b => b.id !== editTxBudgetId)
                          .map(b => (
                            <option key={b.id} value={b.id}>
                              {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {(() => {
                    const linked = budgets.find(b => b.id === editTxBudgetId);
                    if (!editTxIsTransfer && linked && (linked.accountType === 'credit_card' || linked.accountType === 'loan')) {
                      return (
                        <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={editTxIsLoanPayment}
                            onChange={e => setEditTxIsLoanPayment(e.target.checked)}
                            className="accent-emerald-500 w-3.5 h-3.5"
                          />
                          <span className="text-[11px] text-emerald-400 font-medium">
                            Payment / Abono to {linked.name || linked.category} (Reduces balance used)
                          </span>
                        </label>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

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
                  maxLength={500}
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

      {/* ADD BUDGET / ACCOUNT MODAL */}
      {isAddBudgetOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white">Create Budget / Account</h3>
              <button onClick={() => setIsAddBudgetOpen(false)} className="text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSaveBudget} className="space-y-3.5">
              {/* Account Type Switcher */}
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1.5">Account / Budget Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setNewBudgetAccountType('standard')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition ${
                      newBudgetAccountType === 'standard'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <Wallet className="w-3.5 h-3.5 shrink-0" /> Standard
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewBudgetAccountType('bank_account')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition ${
                      newBudgetAccountType === 'bank_account'
                        ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5 shrink-0" /> Bank
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewBudgetAccountType('debit_account')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition ${
                      newBudgetAccountType === 'debit_account'
                        ? 'bg-teal-500/15 text-teal-300 border-teal-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <Wallet className="w-3.5 h-3.5 shrink-0" /> Debit
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewBudgetAccountType('credit_card')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition ${
                      newBudgetAccountType === 'credit_card'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5 shrink-0" /> Credit
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewBudgetAccountType('loan')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition col-span-2 sm:col-span-1 ${
                      newBudgetAccountType === 'loan'
                        ? 'bg-purple-500/15 text-purple-300 border-purple-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <Landmark className="w-3.5 h-3.5 shrink-0" /> Loan
                  </button>
                </div>
              </div>

              {/* Budget Name / Category */}
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Budget Name / Category</label>
                <input
                  type="text"
                  required
                  maxLength={50}
                  placeholder="e.g. Prestamo, Visa Popular, Groceries..."
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
                <p className="text-[10px] text-[#777]">The budget name matches expense categories for live tracking.</p>
              </div>

              {/* Description */}
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Description</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder="Describe what belongs to this budget, due dates, terms..."
                  value={newBudgetDescription}
                  onChange={e => setNewBudgetDescription(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Credit Card Terms (NO editable actualUsedAmount; Monthly Limit = Credit Limit + Overdraft %) */}
              {newBudgetAccountType === 'credit_card' && (() => {
                const cc = calculateCreditCardMonthlyLimit(
                  parseFloat(newBudgetCreditLimit) || 0,
                  parseFloat(newBudgetOverdraftPercentage) || 0
                );
                return (
                  <div className="space-y-3">
                    <div className="bg-[#181818] border border-[#2f2f2f] p-3.5 rounded-xl space-y-3">
                      <div className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5" />
                        Credit Card Terms
                      </div>
                      <div className="grid grid-cols-3 gap-2.5">
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">Credit Limit ({currencySymbol}) *</label>
                          <input
                            type="number"
                            required
                            step="0.01"
                            min="0.01"
                            placeholder="50000"
                            value={newBudgetCreditLimit}
                            onChange={e => setNewBudgetCreditLimit(e.target.value)}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">Overdraft % Allowed</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="e.g. 10"
                            value={newBudgetOverdraftPercentage}
                            onChange={e => setNewBudgetOverdraftPercentage(e.target.value)}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">APR (%)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="e.g. 24.9"
                            value={newBudgetApr}
                            onChange={e => setNewBudgetApr(e.target.value)}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-[#777]">
                        Actual Used Balance starts at {currencySymbol}0.00 and updates automatically from linked transactions and payments.
                      </p>
                    </div>

                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-amber-300 font-semibold block">Calculated Monthly Limit</span>
                        <span className="text-[10px] text-amber-400/80">
                          Credit Limit ({currencySymbol}{cc.baseCreditLimit.toLocaleString()}) + {cc.overdraftPct}% Overdraft ({currencySymbol}{cc.overdraftBuffer.toLocaleString()})
                        </span>
                      </div>
                      <span className="text-base font-bold text-white">
                        {currencySymbol}{cc.monthlyLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Loan Account Terms & Monthly Quotas Generator */}
              {newBudgetAccountType === 'loan' && (() => {
                const principal = Math.max(0, parseFloat(newBudgetCreditLimit) || 0);
                const apr = Math.max(0, parseFloat(newBudgetApr) || 0);
                const termMonths = Math.min(600, Math.max(1, Math.floor(parseFloat(newBudgetLoanTermMonths) || 12)));
                const customQuota = Math.max(0, parseFloat(newBudgetCustomMonthlyQuota) || 0);
                const previewSchedule = generateLoanQuotasSchedule({
                  principal,
                  annualApr: apr,
                  termMonths,
                  startDate: newBudgetLoanStartDate || new Date().toISOString().split('T')[0],
                  ratePeriod: newBudgetLoanRatePeriod,
                  calcMethod: newBudgetLoanCalcMethod,
                  customMonthlyQuota: customQuota > 0 ? customQuota : undefined
                });
                const displayQuotas = newBudgetLoanQuotas.length > 0 ? newBudgetLoanQuotas : previewSchedule.quotas;

                return (
                  <div className="space-y-3">
                    <div className="bg-[#181818] border border-[#2f2f2f] p-3.5 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-purple-400 flex items-center gap-1.5">
                          <Landmark className="w-3.5 h-3.5" />
                          Loan Account Terms & Monthly Quotas
                        </span>
                        {principal > 0 && (
                          <button
                            type="button"
                            onClick={() => setNewBudgetLoanQuotas(previewSchedule.quotas)}
                            className="text-[10px] bg-purple-600/20 hover:bg-purple-600/35 text-purple-300 border border-purple-500/30 px-2 py-1 rounded-md transition"
                          >
                            Generate {termMonths} Quotas
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-[#888] block mb-1">Rate Period</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setNewBudgetLoanRatePeriod('annual');
                                setNewBudgetLoanQuotas([]);
                              }}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                                newBudgetLoanRatePeriod === 'annual'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/45'
                                  : 'bg-[#121212] text-zinc-400 border-[#333] hover:text-white'
                              }`}
                            >
                              Annual (APR %)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setNewBudgetLoanRatePeriod('monthly');
                                setNewBudgetLoanQuotas([]);
                              }}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                                newBudgetLoanRatePeriod === 'monthly'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/45'
                                  : 'bg-[#121212] text-zinc-400 border-[#333] hover:text-white'
                              }`}
                            >
                              Monthly (%)
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-[#888] block mb-1">Interest Method</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setNewBudgetLoanCalcMethod('amortized');
                                setNewBudgetLoanQuotas([]);
                              }}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                                newBudgetLoanCalcMethod === 'amortized'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/45'
                                  : 'bg-[#121212] text-zinc-400 border-[#333] hover:text-white'
                              }`}
                            >
                              Amortized
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setNewBudgetLoanCalcMethod('flat');
                                setNewBudgetLoanQuotas([]);
                              }}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                                newBudgetLoanCalcMethod === 'flat'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/45'
                                  : 'bg-[#121212] text-zinc-400 border-[#333] hover:text-white'
                              }`}
                            >
                              Flat Interest
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">Loan Principal ({currencySymbol}) *</label>
                          <input
                            type="number"
                            required
                            step="0.01"
                            min="0.01"
                            placeholder="150000"
                            value={newBudgetCreditLimit}
                            onChange={e => {
                              setNewBudgetCreditLimit(e.target.value);
                              setNewBudgetLoanQuotas([]);
                            }}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">
                            {newBudgetLoanRatePeriod === 'monthly' ? 'Monthly Interest Rate (%)' : 'Interest Rate (APR %)'}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={newBudgetLoanRatePeriod === 'monthly' ? 'e.g. 1.5' : 'e.g. 18'}
                            value={newBudgetApr}
                            onChange={e => {
                              setNewBudgetApr(e.target.value);
                              setNewBudgetLoanQuotas([]);
                            }}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">Term (Months / Quotas)</label>
                          <input
                            type="number"
                            min="1"
                            max="600"
                            placeholder="12"
                            value={newBudgetLoanTermMonths}
                            onChange={e => {
                              setNewBudgetLoanTermMonths(e.target.value);
                              setNewBudgetLoanQuotas([]);
                            }}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">First Quota Due Date</label>
                          <input
                            type="date"
                            value={newBudgetLoanStartDate}
                            onChange={e => {
                              setNewBudgetLoanStartDate(e.target.value);
                              setNewBudgetLoanQuotas([]);
                            }}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[11px] text-[#9b9b9b] block mb-1">Custom Monthly Quota ({currencySymbol}, optional)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={
                            previewSchedule.monthlyQuota > 0
                              ? `Auto-calculated: ${previewSchedule.monthlyQuota.toFixed(2)}`
                              : 'Auto-calculated from Principal + Rate + Term'
                          }
                          value={newBudgetCustomMonthlyQuota}
                          onChange={e => {
                            setNewBudgetCustomMonthlyQuota(e.target.value);
                            setNewBudgetLoanQuotas([]);
                          }}
                          className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      {displayQuotas.length > 0 && (
                        <div className="space-y-1 max-h-32 overflow-y-auto pr-1 pt-1 border-t border-[#262626]">
                          <span className="text-[10px] text-[#888] block mb-1">
                            Monthly Quotas Preview ({displayQuotas.length} installments auto-created on save):
                          </span>
                          {displayQuotas.slice(0, 12).map(q => (
                            <div key={q.id} className="flex items-center justify-between text-[11px] bg-[#222] px-2.5 py-1 rounded">
                              <span className="text-zinc-300">#{q.quotaNumber} • {q.dueDate}</span>
                              <span className="text-[10px] text-[#888]">
                                Prin {currencySymbol}{q.principalAmount.toFixed(2)} + Int {currencySymbol}{q.interestAmount.toFixed(2)}
                              </span>
                              <span className="font-semibold text-white">{currencySymbol}{q.amount.toFixed(2)}</span>
                            </div>
                          ))}
                          {displayQuotas.length > 12 && (
                            <span className="text-[10px] text-zinc-400 block text-center pt-0.5">
                              + {displayQuotas.length - 12} more monthly quotas...
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {principal > 0 && (
                      <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 flex items-center justify-between text-xs">
                        <div>
                          <span className="text-purple-300 font-semibold block">Monthly Quota Payment</span>
                          <span className="text-[10px] text-purple-300/80">
                            Total Interest: {currencySymbol}{previewSchedule.totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })} • Total Repay: {currencySymbol}{previewSchedule.totalRepayment.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <span className="text-base font-bold text-white">
                          {currencySymbol}{(customQuota > 0 ? customQuota : previewSchedule.monthlyQuota).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Bank / Debit Account Details */}
              {(newBudgetAccountType === 'bank_account' || newBudgetAccountType === 'debit_account') && (
                <div className="bg-[#181818] border border-[#2f2f2f] p-3.5 rounded-xl space-y-3">
                  <div className={`text-xs font-semibold flex items-center gap-1.5 ${newBudgetAccountType === 'bank_account' ? 'text-sky-400' : 'text-teal-400'}`}>
                    {newBudgetAccountType === 'bank_account' ? <Building2 className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />}
                    {newBudgetAccountType === 'bank_account' ? 'Bank Account Details' : 'Debit Account Details'}
                  </div>
                  <div className={`grid grid-cols-1 ${newBudgetAccountType === 'bank_account' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2.5`}>
                    <div>
                      <label className="text-[11px] text-[#9b9b9b] block mb-1">Opening Balance ({currencySymbol})</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={newBudgetAccountBalance}
                        onChange={e => setNewBudgetAccountBalance(e.target.value)}
                        className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#9b9b9b] block mb-1">Monthly Spend Limit ({currencySymbol}, opt.)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0 (No limit)"
                        value={newBudgetLimit}
                        onChange={e => setNewBudgetLimit(e.target.value)}
                        className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    {newBudgetAccountType === 'bank_account' && (
                      <div>
                        <label className="text-[11px] text-[#9b9b9b] block mb-1">Interest APY (%, opt.)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="e.g. 3.5"
                          value={newBudgetApr}
                          onChange={e => setNewBudgetApr(e.target.value)}
                          className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-[#777]">
                    Balance automatically increases on incomes or incoming transfers and decreases on expenses, payments, or outgoing transfers.
                  </p>
                </div>
              )}

              {/* Belonging Items Checklist + Extra Expenses Builder (Standard budgets only) */}
              {newBudgetAccountType === 'standard' && (
                <div className="bg-[#181818] border border-[#2f2f2f] p-3.5 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Items Belonging to This Budget</span>
                    <span className="text-[10px] text-[#888]">Auto-calculates monthly limit</span>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Limite Popular, Prestamo Qik"
                      value={newBudgetItemName}
                      onChange={e => setNewBudgetItemName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddNewBudgetItem();
                        }
                      }}
                      className="flex-1 bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={`Amount (${currencySymbol})`}
                      value={newBudgetItemAmount}
                      onChange={e => setNewBudgetItemAmount(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddNewBudgetItem();
                        }
                      }}
                      className="w-28 bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddNewBudgetItem}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>

                  {newBudgetItems.length > 0 && (
                    <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                      {newBudgetItems.map(item => (
                        <div key={item.id} className="flex items-center justify-between gap-2 bg-[#222] px-2.5 py-1.5 rounded-lg text-xs">
                          <span className="text-zinc-200 truncate flex-1">{item.name}</span>
                          <span className="text-white font-semibold shrink-0">
                            {currencySymbol}{Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                          <button
                            type="button"
                            onClick={() => setNewBudgetItems(prev => prev.filter(i => i.id !== item.id))}
                            className="text-[#777] hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] text-[#9b9b9b] block mb-1">Other Extra Expenses ({currencySymbol})</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={newBudgetExtraExpenses}
                      onChange={e => setNewBudgetExtraExpenses(e.target.value)}
                      className="w-full bg-[#121212] border border-[#333] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* Standard Budget Monthly Limit */}
              {newBudgetAccountType === 'standard' && (() => {
                const itemsSum = newBudgetItems.reduce((s, item) => s + (Number(item.amount) || 0), 0);
                const extraExp = parseFloat(newBudgetExtraExpenses) || 0;
                const hasChecklist = newBudgetItems.length > 0 || extraExp > 0;
                const totalCalculated = itemsSum + extraExp;

                if (hasChecklist) {
                  return (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-emerald-300 font-semibold block">Calculated Monthly Limit</span>
                        <span className="text-[10px] text-emerald-400/80">
                          Items ({currencySymbol}{itemsSum.toLocaleString()}) + Extra ({currencySymbol}{extraExp.toLocaleString()})
                        </span>
                      </div>
                      <span className="text-base font-bold text-white">
                        {currencySymbol}{totalCalculated.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  );
                }

                return (
                  <div>
                    <label className="text-[11px] text-[#9b9b9b] block mb-1">Monthly Limit ({currencySymbol})</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      min="0.01"
                      placeholder="500"
                      value={newBudgetLimit}
                      onChange={e => setNewBudgetLimit(e.target.value)}
                      className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>
                );
              })()}

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

      {/* EDIT BUDGET / ACCOUNT MODAL */}
      {editingBudget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white">Edit Budget / Account</h3>
              <button onClick={() => setEditingBudget(null)} className="text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSaveEditBudget} className="space-y-3.5">
              {/* Account Type Switcher */}
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1.5">Account / Budget Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditBudgetAccountType('standard')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition ${
                      editBudgetAccountType === 'standard'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <Wallet className="w-3.5 h-3.5 shrink-0" /> Standard
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditBudgetAccountType('bank_account')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition ${
                      editBudgetAccountType === 'bank_account'
                        ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5 shrink-0" /> Bank
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditBudgetAccountType('debit_account')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition ${
                      editBudgetAccountType === 'debit_account'
                        ? 'bg-teal-500/15 text-teal-300 border-teal-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <Wallet className="w-3.5 h-3.5 shrink-0" /> Debit
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditBudgetAccountType('credit_card')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition ${
                      editBudgetAccountType === 'credit_card'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5 shrink-0" /> Credit
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditBudgetAccountType('loan')}
                    className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition col-span-2 sm:col-span-1 ${
                      editBudgetAccountType === 'loan'
                        ? 'bg-purple-500/15 text-purple-300 border-purple-500/40'
                        : 'bg-[#1a1a1a] text-zinc-400 border-[#333] hover:text-white'
                    }`}
                  >
                    <Landmark className="w-3.5 h-3.5 shrink-0" /> Loan
                  </button>
                </div>
              </div>

              {/* Name / Category */}
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Budget Name / Category</label>
                <input
                  type="text"
                  required
                  maxLength={50}
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

              {/* Description */}
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Description</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder="Describe what belongs to this budget..."
                  value={editBudgetDescription}
                  onChange={e => setEditBudgetDescription(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Edit Credit Card Terms (NO editable actualUsedAmount; Monthly Limit = Credit Limit + Overdraft %) */}
              {editBudgetAccountType === 'credit_card' && (() => {
                const cc = calculateCreditCardMonthlyLimit(
                  parseFloat(editBudgetCreditLimit) || 0,
                  parseFloat(editBudgetOverdraftPercentage) || 0
                );
                return (
                  <div className="space-y-3">
                    <div className="bg-[#181818] border border-[#2f2f2f] p-3.5 rounded-xl space-y-3">
                      <div className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5" />
                        Credit Card Terms
                      </div>
                      <div className="grid grid-cols-3 gap-2.5">
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">Credit Limit ({currencySymbol}) *</label>
                          <input
                            type="number"
                            required
                            step="0.01"
                            min="0.01"
                            placeholder="50000"
                            value={editBudgetCreditLimit}
                            onChange={e => setEditBudgetCreditLimit(e.target.value)}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">Overdraft % Allowed</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="e.g. 10"
                            value={editBudgetOverdraftPercentage}
                            onChange={e => setEditBudgetOverdraftPercentage(e.target.value)}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">APR (%)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="e.g. 24.9"
                            value={editBudgetApr}
                            onChange={e => setEditBudgetApr(e.target.value)}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-[#777]">
                        Used Balance ({currencySymbol}{(editingBudget?.actualUsedAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}) is read-only and updated automatically from transactions and payments.
                      </p>
                    </div>

                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-amber-300 font-semibold block">Calculated Monthly Limit</span>
                        <span className="text-[10px] text-amber-400/80">
                          Credit Limit ({currencySymbol}{cc.baseCreditLimit.toLocaleString()}) + {cc.overdraftPct}% Overdraft ({currencySymbol}{cc.overdraftBuffer.toLocaleString()})
                        </span>
                      </div>
                      <span className="text-base font-bold text-white">
                        {currencySymbol}{cc.monthlyLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Edit Loan Terms & Monthly Quotas */}
              {editBudgetAccountType === 'loan' && (() => {
                const principal = Math.max(0, parseFloat(editBudgetCreditLimit) || 0);
                const apr = Math.max(0, parseFloat(editBudgetApr) || 0);
                const termMonths = Math.min(600, Math.max(1, Math.floor(parseFloat(editBudgetLoanTermMonths) || 12)));
                const customQuota = Math.max(0, parseFloat(editBudgetCustomMonthlyQuota) || 0);
                const previewSchedule = generateLoanQuotasSchedule({
                  principal,
                  annualApr: apr,
                  termMonths,
                  startDate: editBudgetLoanStartDate || new Date().toISOString().split('T')[0],
                  ratePeriod: editBudgetLoanRatePeriod,
                  calcMethod: editBudgetLoanCalcMethod,
                  customMonthlyQuota: customQuota > 0 ? customQuota : undefined,
                  existingQuotas: editingBudget?.loanQuotas
                });
                const displayQuotas = editBudgetLoanQuotas.length > 0 ? editBudgetLoanQuotas : previewSchedule.quotas;

                return (
                  <div className="space-y-3">
                    <div className="bg-[#181818] border border-[#2f2f2f] p-3.5 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-purple-400 flex items-center gap-1.5">
                          <Landmark className="w-3.5 h-3.5" />
                          Loan Account Terms & Monthly Quotas
                        </span>
                        {principal > 0 && (
                          <button
                            type="button"
                            onClick={() => setEditBudgetLoanQuotas(previewSchedule.quotas)}
                            className="text-[10px] bg-purple-600/20 hover:bg-purple-600/35 text-purple-300 border border-purple-500/30 px-2 py-1 rounded-md transition"
                          >
                            Regenerate {termMonths} Quotas
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-[#888] block mb-1">Rate Period</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditBudgetLoanRatePeriod('annual');
                                setEditBudgetLoanQuotas([]);
                              }}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                                editBudgetLoanRatePeriod === 'annual'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/45'
                                  : 'bg-[#121212] text-zinc-400 border-[#333] hover:text-white'
                              }`}
                            >
                              Annual (APR %)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditBudgetLoanRatePeriod('monthly');
                                setEditBudgetLoanQuotas([]);
                              }}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                                editBudgetLoanRatePeriod === 'monthly'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/45'
                                  : 'bg-[#121212] text-zinc-400 border-[#333] hover:text-white'
                              }`}
                            >
                              Monthly (%)
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-[#888] block mb-1">Interest Method</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditBudgetLoanCalcMethod('amortized');
                                setEditBudgetLoanQuotas([]);
                              }}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                                editBudgetLoanCalcMethod === 'amortized'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/45'
                                  : 'bg-[#121212] text-zinc-400 border-[#333] hover:text-white'
                              }`}
                            >
                              Amortized
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditBudgetLoanCalcMethod('flat');
                                setEditBudgetLoanQuotas([]);
                              }}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                                editBudgetLoanCalcMethod === 'flat'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/45'
                                  : 'bg-[#121212] text-zinc-400 border-[#333] hover:text-white'
                              }`}
                            >
                              Flat Interest
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">Loan Principal ({currencySymbol}) *</label>
                          <input
                            type="number"
                            required
                            step="0.01"
                            min="0.01"
                            placeholder="150000"
                            value={editBudgetCreditLimit}
                            onChange={e => {
                              setEditBudgetCreditLimit(e.target.value);
                              setEditBudgetLoanQuotas([]);
                            }}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">
                            {editBudgetLoanRatePeriod === 'monthly' ? 'Monthly Interest Rate (%)' : 'Interest Rate (APR %)'}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={editBudgetLoanRatePeriod === 'monthly' ? 'e.g. 1.5' : 'e.g. 18'}
                            value={editBudgetApr}
                            onChange={e => {
                              setEditBudgetApr(e.target.value);
                              setEditBudgetLoanQuotas([]);
                            }}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">Term (Months / Quotas)</label>
                          <input
                            type="number"
                            min="1"
                            max="600"
                            placeholder="12"
                            value={editBudgetLoanTermMonths}
                            onChange={e => {
                              setEditBudgetLoanTermMonths(e.target.value);
                              setEditBudgetLoanQuotas([]);
                            }}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#9b9b9b] block mb-1">First Quota Due Date</label>
                          <input
                            type="date"
                            value={editBudgetLoanStartDate}
                            onChange={e => {
                              setEditBudgetLoanStartDate(e.target.value);
                              setEditBudgetLoanQuotas([]);
                            }}
                            className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[11px] text-[#9b9b9b] block mb-1">Custom Monthly Quota ({currencySymbol}, optional)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={
                            previewSchedule.monthlyQuota > 0
                              ? `Auto-calculated: ${previewSchedule.monthlyQuota.toFixed(2)}`
                              : 'Auto-calculated from Principal + Rate + Term'
                          }
                          value={editBudgetCustomMonthlyQuota}
                          onChange={e => {
                            setEditBudgetCustomMonthlyQuota(e.target.value);
                            setEditBudgetLoanQuotas([]);
                          }}
                          className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      {displayQuotas.length > 0 && (
                        <div className="space-y-1 max-h-32 overflow-y-auto pr-1 pt-1 border-t border-[#262626]">
                          <span className="text-[10px] text-[#888] block mb-1">
                            Monthly Quotas ({displayQuotas.length} installments):
                          </span>
                          {displayQuotas.slice(0, 12).map(q => (
                            <div key={q.id} className="flex items-center justify-between text-[11px] bg-[#222] px-2.5 py-1 rounded">
                              <span className={q.isPaid ? 'line-through text-zinc-500' : 'text-zinc-300'}>
                                #{q.quotaNumber} • {q.dueDate}
                              </span>
                              <span className="text-[10px] text-[#888]">
                                Prin {currencySymbol}{q.principalAmount.toFixed(2)} + Int {currencySymbol}{q.interestAmount.toFixed(2)}
                              </span>
                              <span className="font-semibold text-white">{currencySymbol}{q.amount.toFixed(2)}</span>
                            </div>
                          ))}
                          {displayQuotas.length > 12 && (
                            <span className="text-[10px] text-zinc-400 block text-center pt-0.5">
                              + {displayQuotas.length - 12} more monthly quotas...
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {principal > 0 && (
                      <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 flex items-center justify-between text-xs">
                        <div>
                          <span className="text-purple-300 font-semibold block">Monthly Quota Payment</span>
                          <span className="text-[10px] text-purple-300/80">
                            Total Interest: {currencySymbol}{previewSchedule.totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })} • Total Repay: {currencySymbol}{previewSchedule.totalRepayment.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <span className="text-base font-bold text-white">
                          {currencySymbol}{(customQuota > 0 ? customQuota : previewSchedule.monthlyQuota).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Edit Bank / Debit Account Details */}
              {(editBudgetAccountType === 'bank_account' || editBudgetAccountType === 'debit_account') && (
                <div className="bg-[#181818] border border-[#2f2f2f] p-3.5 rounded-xl space-y-3">
                  <div className={`text-xs font-semibold flex items-center gap-1.5 ${editBudgetAccountType === 'bank_account' ? 'text-sky-400' : 'text-teal-400'}`}>
                    {editBudgetAccountType === 'bank_account' ? <Building2 className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />}
                    {editBudgetAccountType === 'bank_account' ? 'Bank Account Details' : 'Debit Account Details'}
                  </div>
                  <div className={`grid grid-cols-1 ${editBudgetAccountType === 'bank_account' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2.5`}>
                    <div>
                      <label className="text-[11px] text-[#9b9b9b] block mb-1">Current Balance ({currencySymbol})</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={editBudgetAccountBalance}
                        onChange={e => setEditBudgetAccountBalance(e.target.value)}
                        className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#9b9b9b] block mb-1">Monthly Spend Limit ({currencySymbol}, opt.)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0 (No limit)"
                        value={editBudgetLimit}
                        onChange={e => setEditBudgetLimit(e.target.value)}
                        className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    {editBudgetAccountType === 'bank_account' && (
                      <div>
                        <label className="text-[11px] text-[#9b9b9b] block mb-1">Interest APY (%, opt.)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="e.g. 3.5"
                          value={editBudgetApr}
                          onChange={e => setEditBudgetApr(e.target.value)}
                          className="w-full bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-[#777]">
                    Updates automatically with linked transactions and transfers, or adjust manually here to reconcile.
                  </p>
                </div>
              )}

              {/* Belonging Items Checklist + Extra Expenses Builder (Standard budgets only) */}
              {editBudgetAccountType === 'standard' && (
                <div className="bg-[#181818] border border-[#2f2f2f] p-3.5 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Items Belonging to This Budget</span>
                    <span className="text-[10px] text-[#888]">Auto-calculates monthly limit</span>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Limite Popular, Prestamo Qik"
                      value={editBudgetItemName}
                      onChange={e => setEditBudgetItemName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddEditBudgetItem();
                        }
                      }}
                      className="flex-1 bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={`Amount (${currencySymbol})`}
                      value={editBudgetItemAmount}
                      onChange={e => setEditBudgetItemAmount(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddEditBudgetItem();
                        }
                      }}
                      className="w-28 bg-[#121212] border border-[#333] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddEditBudgetItem}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>

                  {editBudgetItems.length > 0 && (
                    <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                      {editBudgetItems.map(item => (
                        <div key={item.id} className="flex items-center justify-between gap-2 bg-[#222] px-2.5 py-1.5 rounded-lg text-xs">
                          <button
                            type="button"
                            onClick={() =>
                              setEditBudgetItems(prev =>
                                prev.map(i => (i.id === item.id ? { ...i, isPaid: !i.isPaid } : i))
                              )
                            }
                            className="shrink-0"
                          >
                            {item.isPaid ? (
                              <CheckSquare className="w-4 h-4 text-blue-500" />
                            ) : (
                              <Square className="w-4 h-4 text-[#666]" />
                            )}
                          </button>
                          <span className={`truncate flex-1 ${item.isPaid ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>
                            {item.name}
                          </span>
                          <span className={`font-semibold shrink-0 ${item.isPaid ? 'line-through text-zinc-500' : 'text-white'}`}>
                            {currencySymbol}{Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditBudgetItems(prev => prev.filter(i => i.id !== item.id))}
                            className="text-[#777] hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] text-[#9b9b9b] block mb-1">Other Extra Expenses ({currencySymbol})</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={editBudgetExtraExpenses}
                      onChange={e => setEditBudgetExtraExpenses(e.target.value)}
                      className="w-full bg-[#121212] border border-[#333] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* Standard Budget Monthly Limit */}
              {editBudgetAccountType === 'standard' && (() => {
                const itemsSum = editBudgetItems.reduce((s, item) => s + (Number(item.amount) || 0), 0);
                const extraExp = parseFloat(editBudgetExtraExpenses) || 0;
                const hasChecklist = editBudgetItems.length > 0 || extraExp > 0;
                const totalCalculated = itemsSum + extraExp;

                if (hasChecklist) {
                  return (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-emerald-300 font-semibold block">Calculated Monthly Limit</span>
                        <span className="text-[10px] text-emerald-400/80">
                          Items ({currencySymbol}{itemsSum.toLocaleString()}) + Extra ({currencySymbol}{extraExp.toLocaleString()})
                        </span>
                      </div>
                      <span className="text-base font-bold text-white">
                        {currencySymbol}{totalCalculated.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  );
                }

                return (
                  <div>
                    <label className="text-[11px] text-[#9b9b9b] block mb-1">Monthly Limit ({currencySymbol})</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      min="0.01"
                      placeholder="500"
                      value={editBudgetLimit}
                      onChange={e => setEditBudgetLimit(e.target.value)}
                      className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                );
              })()}

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

      {/* TRANSFER BETWEEN ACCOUNTS MODAL */}
      {isTransferOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#222] border border-[#333] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-blue-400" />
                Transfer Between Accounts
              </h3>
              <button onClick={() => setIsTransferOpen(false)} className="text-[#888] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-[#9b9b9b]">
              Move funds between your accounts (or pay a credit card / loan from a bank or debit account) without inflating your expense or income totals.
            </p>
            <form onSubmit={handleSaveTransfer} className="space-y-3">
              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">From Account *</label>
                <select
                  required
                  value={transferFromId}
                  onChange={e => {
                    const nextFrom = e.target.value;
                    setTransferFromId(nextFrom);
                    if (nextFrom === transferToId) {
                      const nextTo = budgets.find(b => b.id !== nextFrom)?.id || '';
                      setTransferToId(nextTo);
                    }
                  }}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {budgets.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">To Account *</label>
                <select
                  required
                  value={transferToId}
                  onChange={e => setTransferToId(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Select Destination Account --</option>
                  {budgets
                    .filter(b => b.id !== transferFromId)
                    .map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9b9b9b] block mb-1">Amount ({currencySymbol}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={transferAmount}
                    onChange={e => setTransferAmount(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9b9b9b] block mb-1">Date</label>
                  <input
                    type="date"
                    value={transferDate}
                    onChange={e => setTransferDate(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Title (Optional)</label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="Auto-generated if left blank"
                  value={transferTitle}
                  onChange={e => setTransferTitle(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#9b9b9b] block mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  maxLength={500}
                  placeholder="Reference or transfer details..."
                  value={transferNotes}
                  onChange={e => setTransferNotes(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {(() => {
                const amt = Math.abs(parseFloat(transferAmount) || 0);
                const fromAcc = budgets.find(b => b.id === transferFromId);
                const toAcc = budgets.find(b => b.id === transferToId);
                if (!fromAcc || !toAcc || amt <= 0) return null;
                const toIsDebt = toAcc.accountType === 'credit_card' || toAcc.accountType === 'loan';
                const fromIsLiquid = fromAcc.accountType === 'bank_account' || fromAcc.accountType === 'debit_account';
                const toIsLiquid = toAcc.accountType === 'bank_account' || toAcc.accountType === 'debit_account';
                return (
                  <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl p-3 text-[11px] space-y-1 text-blue-200">
                    {fromIsLiquid && (
                      <div>• {fromAcc.name}: balance decreases by {currencySymbol}{amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    )}
                    {toIsLiquid && (
                      <div>• {toAcc.name}: balance increases by {currencySymbol}{amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    )}
                    {toIsDebt && (
                      <div>• {toAcc.name}: debt/used balance reduced by {currencySymbol}{amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    )}
                    <div className="text-[10px] text-blue-300/80 pt-0.5">
                      Excluded from monthly Expenses, Income, and Budget spending limits.
                    </div>
                  </div>
                );
              })()}

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setIsTransferOpen(false)} className="flex-1 bg-[#333] text-white py-2 rounded-lg text-xs">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!transferFromId || !transferToId || transferFromId === transferToId || !(parseFloat(transferAmount) > 0)}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded-lg text-xs font-medium"
                >
                  Save Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STATEMENT UPLOAD MODAL */}
      <StatementUploadModal
        isOpen={isUploadStatementOpen}
        onClose={() => setIsUploadStatementOpen(false)}
        budgets={budgets}
        existingTransactions={transactions}
        availableCategories={availableCategories}
        currencyCode={currentUserProfile?.currency || 'USD'}
        currencySymbol={currencySymbol}
        onImportTransactions={handleImportStatementTransactions}
        onOpenCreateBudget={() => {
          resetAddBudgetForm();
          setIsAddBudgetOpen(true);
        }}
      />

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
