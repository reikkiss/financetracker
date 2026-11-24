import React, { useState, useRef, useMemo } from 'react';
import {
  X,
  Upload,
  FileText,
  Loader2,
  CheckSquare,
  Square,
  Trash2,
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Lock,
  Eye,
  EyeOff
} from 'lucide-react';
import { Budget } from './BudgetsPage';
import { parsePdfStatementLocally, PdfPasswordError } from '../utils/pdfStatementParser';
import { getApiUrl } from '../utils/apiConfig';
import {
  parseDayOfMonth,
  getActiveCreditCardCycleKey,
  getCreditCardCycleForMonth,
  getRecentCreditCardCycles,
  getTransactionCreditCardCycleKey,
  formatShortIsoDate
} from '../utils/financeMath';

export interface ExistingTransactionSummary {
  id?: string;
  title: string;
  amount: number;
  date: string;
  type?: 'income' | 'expense';
  category?: string;
  notes?: string;
  budgetId?: string;
  transferToBudgetId?: string;
  isTransfer?: boolean;
  isLoanPayment?: boolean;
  status?: 'pending' | 'cleared';
  emailId?: string;
  emailOutcome?: 'approved' | 'declined' | 'reversed';
  emailContext?: string;
}

export interface ImportedTransactionDraft {
  tempId: string;
  selected: boolean;
  isDuplicate?: boolean;
  isMatchedTransfer?: boolean;
  title: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  date: string;
  notes?: string;
  budgetId?: string;
  isLoanPayment?: boolean;
  isTransfer?: boolean;
  transferToBudgetId?: string;
  statementCycle?: string;
}

function inferMajorityCycleKey(rows: { date: string }[], cutoffDay: number): string {
  if (!rows || rows.length === 0) {
    return getActiveCreditCardCycleKey(cutoffDay);
  }
  const counts = new Map<string, number>();
  rows.forEach(r => {
    const key = getTransactionCreditCardCycleKey(r.date, cutoffDay);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let bestKey = getActiveCreditCardCycleKey(cutoffDay);
  let bestCount = -1;
  counts.forEach((cnt, key) => {
    if (cnt > bestCount) {
      bestCount = cnt;
      bestKey = key;
    }
  });
  return bestKey;
}

function getAccountTypeLabel(accountType?: Budget['accountType']): string {
  if (accountType === 'credit_card') return '(Credit Card)';
  if (accountType === 'loan') return '(Loan)';
  if (accountType === 'bank_account') return '(Bank Account)';
  if (accountType === 'debit_account') return '(Debit Account)';
  return '(Budget)';
}

function makeTxDedupKey(title: string, amount: number, date: string): string {
  const normTitle = (title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normAmount = Math.abs(Number(amount) || 0).toFixed(2);
  const normDate = (date || '').trim().slice(0, 10);
  return `${normTitle}|${normAmount}|${normDate}`;
}

function daysBetweenIso(d1: string, d2: string): number {
  const t1 = Date.parse((d1 || '').slice(0, 10));
  const t2 = Date.parse((d2 || '').slice(0, 10));
  if (isNaN(t1) || isNaN(t2)) return 999;
  return Math.abs(t1 - t2) / (1000 * 60 * 60 * 24);
}

function findMatchingTransferInDb(
  existingTransactions: ExistingTransactionSummary[],
  accountId: string,
  amount: number,
  date: string,
  rowTitle?: string,
  rowIsLoanPayment?: boolean
): boolean {
  if (!accountId || amount <= 0) return false;
  const paymentOrTransferRegex = /\b(?:transfer|transferencia|ach|lbtr|pago\s*(?:de\s*)?tarjeta|pago\s*tc|card\s*payment|pago\s*(?:de\s*)?pr[eé]stamo|pago\s*recibido|abono|cuota|deposit|dep[oó]sito)\b/i;
  const rowLooksTransferOrPay = Boolean(rowIsLoanPayment) || paymentOrTransferRegex.test(rowTitle || '');

  return existingTransactions.some(et => {
    const closeAmt = Math.abs(Math.abs(Number(et.amount) || 0) - amount) <= Math.max(0.05, amount * 0.005);
    if (!closeAmt || daysBetweenIso(et.date, date) > 3) return false;

    if (Boolean(et.isTransfer) && (et.budgetId === accountId || et.transferToBudgetId === accountId)) {
      return true;
    }
    if (Boolean(et.isLoanPayment) && et.budgetId === accountId) {
      return true;
    }
    if (
      et.budgetId &&
      et.budgetId !== accountId &&
      (rowLooksTransferOrPay || Boolean(et.isLoanPayment) || paymentOrTransferRegex.test(et.title || ''))
    ) {
      return true;
    }
    return false;
  });
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function normalizeDateToIso(raw: string): string {
  const s = (raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slashMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    let yr = Number(slashMatch[3]);
    if (yr < 100) yr += 2000;
    const isDayFirst = p1 > 12;
    const month = isDayFirst ? p2 : p1;
    const day = isDayFirst ? p1 : p2;
    return `${yr}-${String(Math.min(12, Math.max(1, month))).padStart(2, '0')}-${String(Math.min(31, Math.max(1, day))).padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

function parseCsvTransactionsLocally(text: string, fallbackCategories: string[]): any[] {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const headers = parseCsvLine(lines[0], delimiter).map(h => h.toLowerCase());

  const findCol = (patterns: string[]) => headers.findIndex(h => patterns.some(p => h.includes(p)));
  const dateIdx = findCol(['date', 'fecha', 'posted']);
  const titleIdx = findCol(['desc', 'merchant', 'title', 'name', 'memo', 'concept', 'detail', 'narration']);
  const amountIdx = findCol(['amount', 'monto', 'value', 'total', 'importe']);
  const debitIdx = findCol(['debit', 'cargo', 'withdrawal', 'outflow']);
  const creditIdx = findCol(['credit', 'abono', 'deposit', 'inflow']);
  const catIdx = findCol(['cat']);
  const typeIdx = findCol(['type', 'tipo']);

  const results: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter);
    if (cols.length < 2) continue;

    const cleanNum = (val: string) => {
      const n = parseFloat((val || '').replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? 0 : n;
    };

    let amount = 0;
    let type: 'income' | 'expense' = 'expense';

    if (debitIdx >= 0 || creditIdx >= 0) {
      const deb = debitIdx >= 0 ? Math.abs(cleanNum(cols[debitIdx])) : 0;
      const cred = creditIdx >= 0 ? Math.abs(cleanNum(cols[creditIdx])) : 0;
      if (cred > 0 && deb === 0) {
        amount = cred;
        type = 'income';
      } else {
        amount = deb || cred;
        type = 'expense';
      }
    } else if (amountIdx >= 0) {
      const rawAmt = cleanNum(cols[amountIdx]);
      amount = Math.abs(rawAmt);
      if (typeIdx >= 0) {
        const tStr = (cols[typeIdx] || '').toLowerCase();
        type = tStr.includes('inc') || tStr.includes('cred') || tStr.includes('dep') || tStr.includes('ingr') ? 'income' : 'expense';
      } else if (rawAmt > 0 && (cols[amountIdx] || '').includes('+')) {
        type = 'income';
      }
    }

    if (amount <= 0) continue;

    const title = ((titleIdx >= 0 ? cols[titleIdx] : cols[1]) || 'Transaction').slice(0, 180);
    const date = normalizeDateToIso(dateIdx >= 0 ? cols[dateIdx] : cols[0]);
    const rawCat = catIdx >= 0 ? cols[catIdx] : '';
    const matchedCat =
      fallbackCategories.find(c => c.toLowerCase() === rawCat.trim().toLowerCase()) ||
      rawCat.trim() ||
      'Other';
    const isPayment = /payment|pago|abono/i.test(title);

    results.push({
      title,
      amount,
      type,
      category: matchedCat.slice(0, 45),
      date,
      notes: '',
      isLoanPayment: isPayment
    });
  }
  return results;
}

interface StatementUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  budgets: Budget[];
  existingTransactions?: ExistingTransactionSummary[];
  availableCategories: string[];
  currencyCode: string;
  currencySymbol: string;
  onImportTransactions: (rows: ImportedTransactionDraft[]) => Promise<void>;
  onOpenCreateBudget?: () => void;
}

export default function StatementUploadModal({
  isOpen,
  onClose,
  budgets,
  existingTransactions = [],
  availableCategories,
  currencyCode,
  currencySymbol,
  onImportTransactions,
  onOpenCreateBudget
}: StatementUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [defaultBudgetId, setDefaultBudgetId] = useState<string>('');
  const latestBudgetIdRef = useRef<string>('');
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPasswordRequired, setIsPasswordRequired] = useState(false);
  const [pdfPassword, setPdfPassword] = useState('');
  const [showPdfPassword, setShowPdfPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [detectedInfo, setDetectedInfo] = useState<{ accountName: string; period: string } | null>(null);
  const [drafts, setDrafts] = useState<ImportedTransactionDraft[]>([]);
  const [selectedCycleKey, setSelectedCycleKey] = useState<string>('');

  if (!isOpen) return null;

  const resetState = () => {
    setSelectedFile(null);
    setDefaultBudgetId('');
    latestBudgetIdRef.current = '';
    setDrafts([]);
    setSelectedCycleKey('');
    setErrorMsg(null);
    setIsPasswordRequired(false);
    setPdfPassword('');
    setShowPdfPassword(false);
    setPasswordError(null);
    setDetectedInfo(null);
    setIsParsing(false);
    setIsImporting(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFilePicked = async (file: File) => {
    setSelectedFile(file);
    setErrorMsg(null);
    setIsPasswordRequired(false);
    setPdfPassword('');
    setShowPdfPassword(false);
    setPasswordError(null);
    setDetectedInfo(null);
    setDrafts([]);

    await parseStatementFile(file);
  };

  const parseStatementFile = async (file: File, passwordAttempt?: string) => {
    setIsParsing(true);
    setErrorMsg(null);
    try {
      const lowerName = file.name.toLowerCase();
      const isTextBased =
        file.type === 'text/csv' ||
        file.type === 'text/plain' ||
        lowerName.endsWith('.csv') ||
        lowerName.endsWith('.txt');

      let payload: any = {
        fileName: file.name,
        availableCategories,
        currency: currencyCode
      };

      if (isTextBased) {
        const text = await file.text();
        if (!text.trim()) {
          throw new Error('The uploaded file appears to be empty.');
        }
        payload.textContent = text;
      } else {
        const supportedBinaryTypes = [
          'application/pdf',
          'image/png',
          'image/jpeg',
          'image/jpg',
          'image/webp'
        ];
        const mime = file.type || (lowerName.endsWith('.pdf') ? 'application/pdf' : 'image/png');
        if (!supportedBinaryTypes.includes(mime)) {
          throw new Error('Unsupported file format. Please upload a PDF, CSV, TXT, PNG, or JPG statement.');
        }
        if (file.size > 15 * 1024 * 1024) {
          throw new Error('File exceeds 15 MB limit. Please upload a smaller statement file.');
        }

        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = String(reader.result || '');
            const idx = res.indexOf(',');
            resolve(idx >= 0 ? res.slice(idx + 1) : res);
          };
          reader.onerror = () => reject(new Error('Failed to read file data.'));
          reader.readAsDataURL(file);
        });
        payload.fileDataBase64 = base64;
        payload.mimeType = mime === 'image/jpg' ? 'image/jpeg' : mime;
      }

      const isPdf = payload.mimeType === 'application/pdf' || lowerName.endsWith('.pdf');
      let data: any = null;

      if (isTextBased && payload.textContent) {
        const localRows = parseCsvTransactionsLocally(payload.textContent, availableCategories);
        if (localRows.length > 0) {
          data = {
            detectedAccountName: file.name.replace(/\.[^/.]+$/, ''),
            statementPeriod: '',
            transactions: localRows
          };
        }
      } else if (isPdf) {
        const pdfParsed = await parsePdfStatementLocally(file, availableCategories, currencyCode, passwordAttempt);
        if (pdfParsed.transactions.length > 0 || passwordAttempt !== undefined) {
          data = pdfParsed;
        }
      }

      // Fall back to backend OCR only for images or unencrypted scanned PDFs with no extractable text transactions
      if (!data) {
        try {
          const response = await fetch(getApiUrl('/api/ai/parse-statement'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const respData = await response.json();
            if (!response.ok) {
              throw new Error(respData.error || 'Failed to parse statement.');
            }
            data = respData;
          } else if (isPdf) {
            throw new Error(
              'Could not extract text transactions from this PDF (it may be a scanned image). Please upload a text-based PDF or CSV statement.'
            );
          } else {
            throw new Error(
              'Image OCR statement parsing requires the backend server. Please upload a PDF or CSV statement when running on GitHub Pages.'
            );
          }
        } catch (networkErr: any) {
          if (networkErr instanceof PdfPasswordError) {
            throw networkErr;
          }
          if (isPdf) {
            throw new Error(
              'Could not extract text transactions from this PDF (it may be a scanned image). Please upload a text-based PDF or CSV statement.'
            );
          }
          throw networkErr;
        }
      }

      setIsPasswordRequired(false);
      setPdfPassword('');
      setShowPdfPassword(false);
      setPasswordError(null);

      const activeBudgetId = latestBudgetIdRef.current;
      const existingCounts = new Map<string, number>();
      existingTransactions.forEach(et => {
        const k = makeTxDedupKey(et.title, et.amount, et.date);
        existingCounts.set(k, (existingCounts.get(k) || 0) + 1);
      });

      const extracted: ImportedTransactionDraft[] = (data.transactions || []).map((t: any, idx: number) => {
        const title = t.title || 'Transaction';
        const amount = Number(t.amount) || 0;
        const date = t.date || new Date().toISOString().split('T')[0];
        const key = makeTxDedupKey(title, amount, date);
        const remaining = existingCounts.get(key) || 0;
        const isExactDup = remaining > 0;
        if (isExactDup) {
          existingCounts.set(key, remaining - 1);
        }
        const isMatchedTransfer =
          !isExactDup &&
          findMatchingTransferInDb(
            existingTransactions,
            activeBudgetId,
            amount,
            date,
            title,
            Boolean(t.isLoanPayment)
          );
        const isDuplicate = isExactDup || isMatchedTransfer;
        return {
          tempId: `draft_${Date.now()}_${idx}`,
          selected: !isDuplicate,
          isDuplicate,
          isMatchedTransfer,
          title,
          amount,
          type: t.type === 'income' ? 'income' : 'expense',
          category: t.category || 'Other',
          date,
          notes: t.notes || '',
          budgetId: activeBudgetId || '',
          isLoanPayment: Boolean(t.isLoanPayment),
          isTransfer: false,
          transferToBudgetId: ''
        };
      });

      setDetectedInfo({
        accountName: data.detectedAccountName || '',
        period: data.statementPeriod || ''
      });
      setDrafts(extracted);

      const activeBudgetObj = budgets.find(b => b.id === activeBudgetId);
      const activeCutoffDay = activeBudgetObj?.accountType === 'credit_card' ? parseDayOfMonth(activeBudgetObj.cutoffDate) : null;
      if (activeCutoffDay) {
        setSelectedCycleKey(inferMajorityCycleKey(extracted, activeCutoffDay));
      }

      if (extracted.length === 0) {
        setErrorMsg('No transactions were found in this statement. Please try another file.');
      }
    } catch (err: any) {
      if (err instanceof PdfPasswordError) {
        setIsPasswordRequired(true);
        setErrorMsg(null);
        setPasswordError(
          err.reason === 'INCORRECT_PASSWORD'
            ? 'Incorrect PDF password. Please check and try again.'
            : null
        );
      } else {
        setErrorMsg(err.message || 'Unable to parse statement.');
      }
    } finally {
      setIsParsing(false);
    }
  };

  const handleUnlockPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !pdfPassword || isParsing) return;
    setPasswordError(null);
    await parseStatementFile(selectedFile, pdfPassword);
  };

  const applyDefaultBudgetToAll = (budgetId: string) => {
    setDefaultBudgetId(budgetId);
    latestBudgetIdRef.current = budgetId;
    setErrorMsg(null);
    const targetObj = budgets.find(b => b.id === budgetId);
    const targetCutoffDay = targetObj?.accountType === 'credit_card' ? parseDayOfMonth(targetObj.cutoffDate) : null;
    if (targetCutoffDay) {
      setSelectedCycleKey(inferMajorityCycleKey(drafts, targetCutoffDay));
    } else {
      setSelectedCycleKey('');
    }
    setDrafts(prev => {
      const existingCounts = new Map<string, number>();
      existingTransactions.forEach(et => {
        const k = makeTxDedupKey(et.title, et.amount, et.date);
        existingCounts.set(k, (existingCounts.get(k) || 0) + 1);
      });
      return prev.map(d => {
        const k = makeTxDedupKey(d.title, d.amount, d.date);
        const rem = existingCounts.get(k) || 0;
        const isExactDup = rem > 0;
        if (isExactDup) existingCounts.set(k, rem - 1);
        const isMatchedTransfer =
          !isExactDup &&
          findMatchingTransferInDb(existingTransactions, budgetId, d.amount, d.date, d.title, d.isLoanPayment);
        const nextDup = isExactDup || isMatchedTransfer;
        return {
          ...d,
          budgetId,
          isDuplicate: nextDup,
          isMatchedTransfer,
          selected: nextDup ? false : d.isDuplicate ? true : d.selected
        };
      });
    });
  };

  const updateDraft = (tempId: string, patch: Partial<ImportedTransactionDraft>) => {
    setDrafts(prev => prev.map(d => (d.tempId === tempId ? { ...d, ...patch } : d)));
  };

  const removeDraft = (tempId: string) => {
    setDrafts(prev => prev.filter(d => d.tempId !== tempId));
  };

  const duplicateCount = drafts.filter(d => d.isDuplicate).length;
  const nonDuplicateDrafts = drafts.filter(d => !d.isDuplicate);
  const selectedDrafts = drafts.filter(d => d.selected && d.amount > 0 && d.title.trim().length > 0);
  const allSelected = nonDuplicateDrafts.length > 0 && nonDuplicateDrafts.every(d => d.selected);

  const toggleAll = () => {
    const next = !allSelected;
    // Toggle selection only for non-duplicate (missing) transactions so already-uploaded duplicates aren't re-added
    setDrafts(prev => prev.map(d => (d.isDuplicate ? { ...d, selected: false } : { ...d, selected: next })));
  };

  const totalSelectedIncome = selectedDrafts
    .filter(d => d.type === 'income')
    .reduce((s, d) => s + Number(d.amount || 0), 0);
  const totalSelectedExpense = selectedDrafts
    .filter(d => d.type === 'expense')
    .reduce((s, d) => s + Number(d.amount || 0), 0);

  const handleConfirmImport = async () => {
    if (!defaultBudgetId) {
      setErrorMsg('Please select a Credit Card or Budget account first so all statement transactions are added to it.');
      return;
    }
    if (selectedDrafts.length === 0 || isImporting) return;
    setIsImporting(true);
    setErrorMsg(null);
    try {
      const isCreditCardTarget = selectedBudgetObj?.accountType === 'credit_card';
      const cycleToAttach = isCreditCardTarget && selectedCycleKey ? selectedCycleKey : undefined;

      const normalizedRows = selectedDrafts.map(row => {
        const baseBudgetId = row.budgetId || defaultBudgetId;
        if (row.isTransfer && row.transferToBudgetId && baseBudgetId && row.transferToBudgetId !== baseBudgetId) {
          // If an incoming statement row (income) is linked to another account, the other account is the source (From)
          if (row.type === 'income') {
            return {
              ...row,
              type: 'expense' as const,
              budgetId: row.transferToBudgetId,
              transferToBudgetId: baseBudgetId,
              ...(cycleToAttach ? { statementCycle: cycleToAttach } : {})
            };
          }
          return {
            ...row,
            budgetId: baseBudgetId,
            ...(cycleToAttach ? { statementCycle: cycleToAttach } : {})
          };
        }
        return {
          ...row,
          budgetId: baseBudgetId,
          ...(cycleToAttach ? { statementCycle: cycleToAttach } : {})
        };
      });
      await onImportTransactions(normalizedRows);
      resetState();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save imported transactions.');
    } finally {
      setIsImporting(false);
    }
  };

  const categoryOptions = Array.from(
    new Set([...availableCategories, ...drafts.map(d => d.category).filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b));

  const selectedBudgetObj = budgets.find(b => b.id === defaultBudgetId);
  const selectedCardCutoffDay = selectedBudgetObj?.accountType === 'credit_card' ? parseDayOfMonth(selectedBudgetObj.cutoffDate) : null;
  const selectedCardDueDay = selectedBudgetObj?.accountType === 'credit_card' ? parseDayOfMonth(selectedBudgetObj.dueDate) : null;
  const availableCycleOptions = selectedCardCutoffDay
    ? getRecentCreditCardCycles(
        selectedCardCutoffDay,
        selectedCardDueDay,
        selectedCycleKey || getActiveCreditCardCycleKey(selectedCardCutoffDay),
        12,
        2
      )
    : [];
  const activeStatementCycleInfo =
    selectedCardCutoffDay && selectedCycleKey
      ? getCreditCardCycleForMonth(selectedCardCutoffDay, selectedCardDueDay, selectedCycleKey)
      : null;

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl space-y-4 text-[#1D1D1F] dark:text-[#F5F5F7]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] dark:border-white/10 pb-3 shrink-0">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-[#248A3D] dark:text-emerald-400" />
              Upload Bank / Credit Card Statement
            </h3>
            <p className="text-[11px] text-[#86868B] mt-0.5">
              Select a Credit Card or Budget account and upload a statement (PDF, CSV, TXT, or image) to add all transactions to it.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 1: Target Account Selector (Required) + Upload Zone */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0">
          <div className={`bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border rounded-2xl p-3.5 flex flex-col justify-center space-y-2 ${
            defaultBudgetId ? 'border-emerald-500/40' : 'border-amber-500/50'
          }`}>
            <label className="text-[11px] font-semibold flex items-center justify-between gap-1.5">
              <span className="flex items-center gap-1.5 text-[#1D1D1F] dark:text-white">
                <CreditCard className="w-3.5 h-3.5 text-[#B25000] dark:text-amber-400" />
                Target Credit Card / Budget *
              </span>
              {!defaultBudgetId ? (
                <span className="text-[10px] text-[#B25000] dark:text-amber-400 font-medium">Required</span>
              ) : (
                <span className="text-[10px] text-[#248A3D] dark:text-emerald-400 font-medium">Selected</span>
              )}
            </label>

            {budgets.length === 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] text-[#B25000] dark:text-amber-300 leading-snug">
                  No budgets or credit card accounts exist yet. Create one first to assign statement transactions.
                </p>
                {onOpenCreateBudget && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClose();
                      onOpenCreateBudget();
                    }}
                    className="w-full bg-[#0071E3] hover:bg-[#0077ED] text-white py-2 rounded-full text-xs font-semibold transition"
                  >
                    + Create Credit Card / Budget
                  </button>
                )}
              </div>
            ) : (
              <>
                <select
                  value={defaultBudgetId}
                  onChange={e => applyDefaultBudgetToAll(e.target.value)}
                  className={`w-full bg-white dark:bg-[#1C1C1E] border rounded-xl px-2.5 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none ${
                    defaultBudgetId ? 'border-emerald-500/50 focus:border-emerald-500' : 'border-amber-500/60 focus:border-amber-500'
                  }`}
                >
                  <option value="" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">-- Select Account / Budget --</option>
                  {budgets.map(b => (
                    <option key={b.id} value={b.id} className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">
                      {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-[#86868B]">
                  {selectedBudgetObj
                    ? `All imported transactions will be added to ${selectedBudgetObj.name || selectedBudgetObj.category}.`
                    : 'Choose the Bank, Debit, Credit Card, Loan, or Budget account to receive all extracted transactions.'}
                </p>

                {selectedBudgetObj?.accountType === 'credit_card' && (
                  <div className="pt-1.5 border-t border-black/[0.06] dark:border-white/10 space-y-1.5">
                    {selectedCardCutoffDay ? (
                      <>
                        <label className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider block">
                          Ciclo del Estado (Corte día {selectedCardCutoffDay})
                        </label>
                        <select
                          value={selectedCycleKey}
                          onChange={e => setSelectedCycleKey(e.target.value)}
                          className="w-full bg-white dark:bg-[#1C1C1E] border border-[#0071E3]/40 rounded-xl px-2.5 py-1.5 text-[11px] font-medium text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                        >
                          <option value="">Auto por fecha de cada cargo</option>
                          {availableCycleOptions.map(c => (
                            <option key={c.cycleKey} value={c.cycleKey}>
                              {c.label} ({c.periodLabel})
                            </option>
                          ))}
                        </select>
                        {activeStatementCycleInfo && (
                          <p className="text-[10px] text-[#0071E3] dark:text-[#5AC8FA] tabular-nums leading-snug">
                            Corte: {formatShortIsoDate(activeStatementCycleInfo.cutoffDate)}
                            {activeStatementCycleInfo.dueDate
                              ? ` • Pago límite: ${formatShortIsoDate(activeStatementCycleInfo.dueDate)}`
                              : ''}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-[10px] text-[#B25000] dark:text-amber-300 leading-snug">
                        Configura el Día de Corte en esta tarjeta para asociar el estado de cuenta a un ciclo exacto.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div
            onClick={() => !isParsing && budgets.length > 0 && fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f && !isParsing && budgets.length > 0) handleFilePicked(f);
            }}
            className={`md:col-span-2 border-2 border-dashed rounded-2xl p-4 flex items-center gap-4 transition ${
              budgets.length === 0
                ? 'border-black/[0.08] dark:border-white/10 bg-[#F5F5F7] dark:bg-[#2C2C2E]/40 opacity-50 cursor-not-allowed'
                : 'border-black/[0.12] dark:border-white/15 hover:border-[#0071E3] bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 cursor-pointer'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.csv,.txt,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFilePicked(f);
                e.target.value = '';
              }}
            />
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
              {isParsing ? (
                <Loader2 className="w-5 h-5 text-[#248A3D] dark:text-emerald-400 animate-spin" />
              ) : (
                <FileText className="w-5 h-5 text-[#248A3D] dark:text-emerald-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {isParsing ? (
                <>
                  <p className="text-xs font-semibold text-[#1D1D1F] dark:text-white">Extracting transactions from {selectedFile?.name}...</p>
                  <p className="text-[11px] text-[#86868B] mt-0.5">Reading dates, merchants, amounts, and categories.</p>
                </>
              ) : selectedFile ? (
                <>
                  <p className="text-xs font-semibold text-[#1D1D1F] dark:text-white truncate">{selectedFile.name}</p>
                  <p className="text-[11px] text-[#248A3D] dark:text-emerald-400 mt-0.5">Click or drop another statement to replace</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-[#1D1D1F] dark:text-white">Click to browse or drag & drop statement file</p>
                  <p className="text-[11px] text-[#86868B] mt-0.5">Supports PDF, CSV, TXT, PNG, JPG statements (up to 15 MB)</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Password-protected PDF unlock prompt */}
        {isPasswordRequired && selectedFile && (
          <form
            onSubmit={handleUnlockPdf}
            className="bg-amber-500/10 border border-amber-500/35 rounded-2xl p-4 space-y-3 shrink-0"
          >
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
                <Lock className="w-4 h-4 text-[#B25000] dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#B25000] dark:text-amber-200">
                  This PDF statement is password-protected
                </p>
                <p className="text-[11px] text-[#B25000]/80 dark:text-amber-200/75 mt-0.5">
                  Enter the document password to decrypt and extract transactions locally in your browser (the password is never saved or sent anywhere).
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showPdfPassword ? 'text' : 'password'}
                  value={pdfPassword}
                  onChange={e => {
                    setPdfPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                  }}
                  placeholder="Enter PDF password..."
                  autoFocus
                  className="w-full bg-white dark:bg-[#1C1C1E] border border-amber-500/40 rounded-xl pl-3 pr-9 py-2 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPdfPassword(prev => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white"
                  title={showPdfPassword ? 'Hide password' : 'Show password'}
                >
                  {showPdfPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="submit"
                disabled={!pdfPassword || isParsing}
                className="px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-xs font-semibold transition flex items-center justify-center gap-1.5 shrink-0"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Unlocking...
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" /> Unlock PDF
                  </>
                )}
              </button>
            </div>

            {passwordError && (
              <p className="text-[11px] text-[#D70015] dark:text-rose-300 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#D70015] dark:text-rose-400" />
                <span>{passwordError}</span>
              </p>
            )}
          </form>
        )}

        {/* Error banner */}
        {errorMsg && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-[#D70015] dark:text-rose-300 rounded-2xl px-4 py-2.5 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#D70015] dark:text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Detected statement summary */}
        {drafts.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.04] dark:border-white/5 rounded-2xl px-4 py-2.5 text-xs shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[#248A3D] dark:text-emerald-400 font-medium tabular-nums">
                <CheckCircle2 className="w-4 h-4" />
                {drafts.length} transactions extracted ({nonDuplicateDrafts.length} new)
              </span>
              {duplicateCount > 0 && (
                <span className="bg-amber-500/10 border border-amber-500/30 text-[#B25000] dark:text-amber-300 px-2 py-0.5 rounded-full text-[11px] font-medium tabular-nums">
                  {duplicateCount} already in DB (skipped)
                </span>
              )}
              {detectedInfo?.accountName && (
                <span className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 text-[#424245] dark:text-zinc-300 px-2.5 py-0.5 rounded-full text-[11px]">
                  Account: {detectedInfo.accountName}
                </span>
              )}
              {detectedInfo?.period && (
                <span className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 text-[#424245] dark:text-zinc-300 px-2.5 py-0.5 rounded-full text-[11px] tabular-nums">
                  Period: {detectedInfo.period}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-[11px] tabular-nums">
              <span className="text-[#248A3D] dark:text-emerald-400 font-medium">
                Income: +{currencySymbol}{totalSelectedIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[#D70015] dark:text-rose-400 font-medium">
                Expenses: -{currencySymbol}{totalSelectedExpense.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}

        {/* All-Duplicate Info Banner */}
        {drafts.length > 0 && nonDuplicateDrafts.length === 0 && (
          <div className="bg-blue-500/10 border border-blue-500/30 text-[#0071E3] dark:text-blue-300 rounded-2xl px-4 py-2 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#0071E3] dark:text-blue-400" />
            <span>All transactions from this statement already exist in your database (matching name, amount, and date).</span>
          </div>
        )}

        {/* Missing Account Selection Reminder Banner */}
        {drafts.length > 0 && !defaultBudgetId && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-[#B25000] dark:text-amber-300 rounded-2xl px-4 py-2 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#B25000] dark:text-amber-400" />
            <span>Please select a Credit Card or Budget account above before adding these transactions.</span>
          </div>
        )}

        {/* Auto-created Category Budgets Preview */}
        {(() => {
          if (selectedDrafts.length === 0) return null;
          const existingSet = new Set(
            budgets
              .flatMap(b => [(b.name || '').trim().toLowerCase(), (b.category || '').trim().toLowerCase()])
              .filter(Boolean)
          );
          const missingCats = Array.from(
            new Set(
              selectedDrafts
                .filter(d => !d.isTransfer)
                .map(d => (d.category || '').trim())
                .filter(c => c && !existingSet.has(c.toLowerCase()))
            )
          );
          if (missingCats.length === 0) return null;
          return (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-[#248A3D] dark:text-emerald-300 rounded-2xl px-4 py-2 text-[11px] flex items-center justify-between gap-2 shrink-0">
              <span>
                Budgets will be created immediately for selected categories:{' '}
                <strong className="text-[#1D1D1F] dark:text-white">{missingCats.join(', ')}</strong>
              </span>
            </div>
          );
        })()}

        {/* Review Table */}
        <div className="flex-1 overflow-y-auto border border-black/[0.06] dark:border-white/10 rounded-2xl bg-[#F5F5F7] dark:bg-[#1C1C1E] min-h-[220px]">
          {drafts.length === 0 ? (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-8 text-xs text-[#86868B] space-y-2">
              {isParsing ? (
                <>
                  <Loader2 className="w-7 h-7 text-[#248A3D] dark:text-emerald-400 animate-spin" />
                  <p className="text-[#1D1D1F] dark:text-zinc-300 font-medium">Reading statement transactions...</p>
                </>
              ) : (
                <>
                  <FileText className="w-8 h-8 text-[#86868B]/60" />
                  <p>Select a Credit Card or Budget account and upload a statement above to preview and edit extracted transactions.</p>
                </>
              )}
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F2F2F7] dark:bg-[#2C2C2E] border-b border-black/[0.06] dark:border-white/10 text-[#86868B] sticky top-0 z-10">
                <tr>
                  <th className="p-2.5 w-9 text-center">
                    <button type="button" onClick={toggleAll} className="text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white">
                      {allSelected ? <CheckSquare className="w-4 h-4 text-[#0071E3] dark:text-emerald-400" /> : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="p-2.5 font-medium w-32">Date</th>
                  <th className="p-2.5 font-medium">Title / Description</th>
                  <th className="p-2.5 font-medium w-36">Category</th>
                  <th className="p-2.5 font-medium w-36">Account / Card</th>
                  <th className="p-2.5 font-medium w-36">Transfer To</th>
                  <th className="p-2.5 font-medium w-28">Type</th>
                  <th className="p-2.5 font-medium w-28 text-right">Amount ({currencySymbol})</th>
                  <th className="p-2.5 font-medium w-20 text-center">Payment</th>
                  <th className="p-2.5 w-9"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] dark:divide-white/5 bg-white dark:bg-[#1C1C1E]">
                {drafts.map(row => (
                  <tr key={row.tempId} className={`hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]/50 transition ${row.isDuplicate ? 'bg-amber-500/5 opacity-60' : row.selected ? '' : 'opacity-45'}`}>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => updateDraft(row.tempId, { selected: !row.selected })}
                        className="text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white"
                      >
                        {row.selected ? <CheckSquare className="w-4 h-4 text-[#0071E3] dark:text-emerald-400" /> : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="p-2">
                      <input
                        type="date"
                        value={row.date}
                        onChange={e => updateDraft(row.tempId, { date: e.target.value })}
                        className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-lg px-2 py-1 text-[11px] text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                      />
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={row.title}
                          maxLength={180}
                          onChange={e => updateDraft(row.tempId, { title: e.target.value })}
                          className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-lg px-2 py-1 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                        />
                        {row.isDuplicate && (
                          <span
                            className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
                              row.isMatchedTransfer
                                ? 'bg-blue-500/15 text-[#0071E3] dark:text-blue-300 border-blue-500/30'
                                : 'bg-amber-500/15 text-[#B25000] dark:text-amber-300 border-amber-500/30'
                            }`}
                            title={
                              row.isMatchedTransfer
                                ? 'Already recorded via a Transfer involving this account'
                                : 'Exact match already exists in database'
                            }
                          >
                            {row.isMatchedTransfer ? 'Transfer / Payment in DB' : 'Duplicate'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2">
                      <select
                        value={row.category}
                        onChange={e => updateDraft(row.tempId, { category: e.target.value })}
                        className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-lg px-2 py-1 text-[11px] text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                      >
                        {categoryOptions.map(c => (
                          <option key={c} value={c} className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        value={row.budgetId || defaultBudgetId}
                        onChange={e => {
                          const nextSourceId = e.target.value;
                          const clearTransfer = row.transferToBudgetId === nextSourceId;
                          updateDraft(row.tempId, {
                            budgetId: nextSourceId,
                            ...(clearTransfer ? { isTransfer: false, transferToBudgetId: '' } : {})
                          });
                        }}
                        className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-lg px-2 py-1 text-[11px] text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
                      >
                        {!defaultBudgetId && <option value="" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">Select account...</option>}
                        {budgets.map(b => (
                          <option key={b.id} value={b.id} className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">
                            {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        value={row.transferToBudgetId || ''}
                        onChange={e => {
                          const nextOtherId = e.target.value;
                          if (!nextOtherId) {
                            updateDraft(row.tempId, {
                              isTransfer: false,
                              transferToBudgetId: ''
                            });
                            return;
                          }
                          const thisAccId = row.budgetId || defaultBudgetId;
                          const destAcc = budgets.find(b => b.id === (row.type === 'income' ? thisAccId : nextOtherId));
                          const isDebtDest = destAcc?.accountType === 'credit_card' || destAcc?.accountType === 'loan';
                          updateDraft(row.tempId, {
                            isTransfer: true,
                            transferToBudgetId: nextOtherId,
                            isLoanPayment: isDebtDest
                          });
                        }}
                        title={
                          row.type === 'income'
                            ? 'Source account this transfer came from (← From)'
                            : 'Destination account this transfer went to (→ To)'
                        }
                        className={`w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border rounded-lg px-2 py-1 text-[11px] focus:outline-none ${
                          row.isTransfer && row.transferToBudgetId
                            ? 'border-[#0071E3]/60 text-[#0071E3] dark:text-blue-300'
                            : 'border-black/[0.08] dark:border-white/10 text-[#86868B] dark:text-zinc-400'
                        }`}
                      >
                        <option value="" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">-- None --</option>
                        {budgets
                          .filter(b => b.id !== (row.budgetId || defaultBudgetId))
                          .map(b => (
                            <option key={b.id} value={b.id} className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">
                              {row.type === 'income' ? '← ' : '→ '}
                              {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        value={row.type}
                        onChange={e => updateDraft(row.tempId, { type: e.target.value as 'income' | 'expense' })}
                        className={`w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-lg px-2 py-1 text-[11px] font-medium focus:outline-none ${
                          row.type === 'income' ? 'text-[#248A3D] dark:text-emerald-400' : 'text-[#D70015] dark:text-rose-400'
                        }`}
                      >
                        <option value="expense" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">Expense</option>
                        <option value="income" className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">Income</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.amount}
                        onChange={e => updateDraft(row.tempId, { amount: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/10 rounded-lg px-2 py-1 text-xs text-right font-semibold text-[#1D1D1F] dark:text-white tabular-nums focus:outline-none focus:border-[#0071E3]"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(row.isLoanPayment)}
                        onChange={e => updateDraft(row.tempId, { isLoanPayment: e.target.checked })}
                        title="Credit Card / Loan Payment (Abono)"
                        className="accent-[#34C759] w-3.5 h-3.5 cursor-pointer"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeDraft(row.tempId)}
                        className="text-[#86868B] hover:text-[#FF3B30] p-1 rounded"
                        title="Remove row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-black/[0.06] dark:border-white/10 shrink-0">
          <span className="text-[11px] text-[#86868B] tabular-nums">
            {selectedDrafts.length} of {drafts.length} transactions selected
            {selectedBudgetObj ? ` • Target: ${selectedBudgetObj.name || selectedBudgetObj.category}` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:hover:bg-white/15 text-[#1D1D1F] dark:text-white text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!defaultBudgetId || selectedDrafts.length === 0 || isImporting || isParsing}
              onClick={handleConfirmImport}
              className="px-5 py-2 rounded-full bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition flex items-center gap-1.5"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing to seashore DB...
                </>
              ) : (
                <>Import {selectedDrafts.length} Transactions</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
