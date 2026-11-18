import React, { useState, useRef } from 'react';
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

export interface ExistingTransactionSummary {
  title: string;
  amount: number;
  date: string;
}

export interface ImportedTransactionDraft {
  tempId: string;
  selected: boolean;
  isDuplicate?: boolean;
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

  if (!isOpen) return null;

  const resetState = () => {
    setSelectedFile(null);
    setDefaultBudgetId('');
    latestBudgetIdRef.current = '';
    setDrafts([]);
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
          const response = await fetch('/api/ai/parse-statement', {
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
        const isDuplicate = remaining > 0;
        if (isDuplicate) {
          existingCounts.set(key, remaining - 1);
        }
        return {
          tempId: `draft_${Date.now()}_${idx}`,
          selected: !isDuplicate,
          isDuplicate,
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
    setDrafts(prev => prev.map(d => ({ ...d, budgetId })));
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
      const normalizedRows = selectedDrafts.map(row => ({
        ...row,
        budgetId: row.budgetId || defaultBudgetId
      }));
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

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#202020] border border-[#333] rounded-2xl p-6 w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#2b2b2b] pb-3 shrink-0">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-400" />
              Upload Bank / Credit Card Statement
            </h3>
            <p className="text-[11px] text-[#9b9b9b] mt-0.5">
              Select a Credit Card or Budget account and upload a statement (PDF, CSV, TXT, or image) to add all transactions to it.
            </p>
          </div>
          <button onClick={handleClose} className="text-[#888] hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 1: Target Account Selector (Required) + Upload Zone */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0">
          <div className={`bg-[#181818] border rounded-xl p-3.5 flex flex-col justify-center space-y-2 ${
            defaultBudgetId ? 'border-emerald-500/40' : 'border-amber-500/50'
          }`}>
            <label className="text-[11px] font-semibold flex items-center justify-between gap-1.5">
              <span className="flex items-center gap-1.5 text-white">
                <CreditCard className="w-3.5 h-3.5 text-amber-400" />
                Target Credit Card / Budget *
              </span>
              {!defaultBudgetId ? (
                <span className="text-[10px] text-amber-400 font-medium">Required</span>
              ) : (
                <span className="text-[10px] text-emerald-400 font-medium">Selected</span>
              )}
            </label>

            {budgets.length === 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] text-amber-300 leading-snug">
                  No budgets or credit card accounts exist yet. Create one first to assign statement transactions.
                </p>
                {onOpenCreateBudget && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClose();
                      onOpenCreateBudget();
                    }}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-1.5 rounded-lg text-xs font-medium transition"
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
                  className={`w-full bg-[#222] border rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none ${
                    defaultBudgetId ? 'border-emerald-500/50 focus:border-emerald-400' : 'border-amber-500/60 focus:border-amber-400'
                  }`}
                >
                  <option value="">-- Select Account / Budget --</option>
                  {budgets.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-[#888]">
                  {selectedBudgetObj
                    ? `All imported transactions will be added to ${selectedBudgetObj.name || selectedBudgetObj.category}.`
                    : 'Choose the Bank, Debit, Credit Card, Loan, or Budget account to receive all extracted transactions.'}
                </p>
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
            className={`md:col-span-2 border-2 border-dashed rounded-xl p-4 flex items-center gap-4 transition ${
              budgets.length === 0
                ? 'border-[#2c2c2c] bg-[#161616] opacity-50 cursor-not-allowed'
                : 'border-[#383838] hover:border-emerald-500/70 bg-[#181818] cursor-pointer'
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
                <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
              ) : (
                <FileText className="w-5 h-5 text-emerald-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {isParsing ? (
                <>
                  <p className="text-xs font-semibold text-white">Extracting transactions from {selectedFile?.name}...</p>
                  <p className="text-[11px] text-[#888] mt-0.5">Reading dates, merchants, amounts, and categories.</p>
                </>
              ) : selectedFile ? (
                <>
                  <p className="text-xs font-semibold text-white truncate">{selectedFile.name}</p>
                  <p className="text-[11px] text-emerald-400 mt-0.5">Click or drop another statement to replace</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-white">Click to browse or drag & drop statement file</p>
                  <p className="text-[11px] text-[#888] mt-0.5">Supports PDF, CSV, TXT, PNG, JPG statements (up to 15 MB)</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Password-protected PDF unlock prompt */}
        {isPasswordRequired && selectedFile && (
          <form
            onSubmit={handleUnlockPdf}
            className="bg-amber-500/10 border border-amber-500/35 rounded-xl p-4 space-y-3 shrink-0"
          >
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
                <Lock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-200">
                  This PDF statement is password-protected
                </p>
                <p className="text-[11px] text-amber-200/75 mt-0.5">
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
                  className="w-full bg-[#141414] border border-amber-500/40 rounded-lg pl-3 pr-9 py-2 text-xs text-white placeholder-[#777] focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPdfPassword(prev => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888] hover:text-white"
                  title={showPdfPassword ? 'Hide password' : 'Show password'}
                >
                  {showPdfPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="submit"
                disabled={!pdfPassword || isParsing}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black text-xs font-semibold transition flex items-center justify-center gap-1.5 shrink-0"
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
              <p className="text-[11px] text-rose-300 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                <span>{passwordError}</span>
              </p>
            )}
          </form>
        )}

        {/* Error banner */}
        {errorMsg && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl px-4 py-2.5 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Detected statement summary */}
        {drafts.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#181818] border border-[#2b2b2b] rounded-xl px-4 py-2.5 text-xs shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                {drafts.length} transactions extracted ({nonDuplicateDrafts.length} new)
              </span>
              {duplicateCount > 0 && (
                <span className="bg-amber-500/10 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded text-[11px] font-medium">
                  {duplicateCount} already in DB (skipped)
                </span>
              )}
              {detectedInfo?.accountName && (
                <span className="bg-[#252525] text-zinc-300 px-2 py-0.5 rounded text-[11px]">
                  Account: {detectedInfo.accountName}
                </span>
              )}
              {detectedInfo?.period && (
                <span className="bg-[#252525] text-zinc-300 px-2 py-0.5 rounded text-[11px]">
                  Period: {detectedInfo.period}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="text-emerald-400 font-medium">
                Income: +{currencySymbol}{totalSelectedIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-rose-400 font-medium">
                Expenses: -{currencySymbol}{totalSelectedExpense.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}

        {/* All-Duplicate Info Banner */}
        {drafts.length > 0 && nonDuplicateDrafts.length === 0 && (
          <div className="bg-blue-500/10 border border-blue-500/30 text-blue-300 rounded-xl px-4 py-2 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-blue-400" />
            <span>All transactions from this statement already exist in your database (matching name, amount, and date).</span>
          </div>
        )}

        {/* Missing Account Selection Reminder Banner */}
        {drafts.length > 0 && !defaultBudgetId && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl px-4 py-2 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
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
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-xl px-4 py-2 text-[11px] flex items-center justify-between gap-2 shrink-0">
              <span>
                Budgets will be created immediately for selected categories:{' '}
                <strong className="text-white">{missingCats.join(', ')}</strong>
              </span>
            </div>
          );
        })()}

        {/* Review Table */}
        <div className="flex-1 overflow-y-auto border border-[#2a2a2a] rounded-xl bg-[#181818] min-h-[220px]">
          {drafts.length === 0 ? (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-8 text-xs text-[#777] space-y-2">
              {isParsing ? (
                <>
                  <Loader2 className="w-7 h-7 text-emerald-400 animate-spin" />
                  <p className="text-zinc-300 font-medium">Reading statement transactions...</p>
                </>
              ) : (
                <>
                  <FileText className="w-8 h-8 text-[#444]" />
                  <p>Select a Credit Card or Budget account and upload a statement above to preview and edit extracted transactions.</p>
                </>
              )}
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1e1e1e] border-b border-[#2b2b2b] text-[#9b9b9b] sticky top-0 z-10">
                <tr>
                  <th className="p-2.5 w-9 text-center">
                    <button type="button" onClick={toggleAll} className="text-zinc-300 hover:text-white">
                      {allSelected ? <CheckSquare className="w-4 h-4 text-emerald-400" /> : <Square className="w-4 h-4" />}
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
              <tbody className="divide-y divide-[#242424]">
                {drafts.map(row => (
                  <tr key={row.tempId} className={`hover:bg-[#222] transition ${row.isDuplicate ? 'bg-[#1b1915]/60 opacity-60' : row.selected ? '' : 'opacity-45'}`}>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => updateDraft(row.tempId, { selected: !row.selected })}
                        className="text-zinc-300 hover:text-white"
                      >
                        {row.selected ? <CheckSquare className="w-4 h-4 text-emerald-400" /> : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="p-2">
                      <input
                        type="date"
                        value={row.date}
                        onChange={e => updateDraft(row.tempId, { date: e.target.value })}
                        className="w-full bg-[#121212] border border-[#303030] rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-emerald-500"
                      />
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={row.title}
                          maxLength={180}
                          onChange={e => updateDraft(row.tempId, { title: e.target.value })}
                          className="w-full bg-[#121212] border border-[#303030] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                        />
                        {row.isDuplicate && (
                          <span className="shrink-0 bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium">
                            Duplicate
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2">
                      <select
                        value={row.category}
                        onChange={e => updateDraft(row.tempId, { category: e.target.value })}
                        className="w-full bg-[#121212] border border-[#303030] rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-emerald-500"
                      >
                        {categoryOptions.map(c => (
                          <option key={c} value={c}>{c}</option>
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
                        className="w-full bg-[#121212] border border-[#303030] rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-emerald-500"
                      >
                        {!defaultBudgetId && <option value="">Select account...</option>}
                        {budgets.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        value={row.transferToBudgetId || ''}
                        onChange={e => {
                          const nextToId = e.target.value;
                          if (!nextToId) {
                            updateDraft(row.tempId, {
                              isTransfer: false,
                              transferToBudgetId: ''
                            });
                            return;
                          }
                          const dest = budgets.find(b => b.id === nextToId);
                          const isDebtDest = dest?.accountType === 'credit_card' || dest?.accountType === 'loan';
                          updateDraft(row.tempId, {
                            isTransfer: true,
                            transferToBudgetId: nextToId,
                            isLoanPayment: isDebtDest
                          });
                        }}
                        className={`w-full bg-[#121212] border rounded px-2 py-1 text-[11px] focus:outline-none ${
                          row.isTransfer && row.transferToBudgetId
                            ? 'border-blue-500/60 text-blue-300'
                            : 'border-[#303030] text-zinc-400'
                        }`}
                      >
                        <option value="">-- None --</option>
                        {budgets
                          .filter(b => b.id !== (row.budgetId || defaultBudgetId))
                          .map(b => (
                            <option key={b.id} value={b.id}>
                              {b.name || b.category} {getAccountTypeLabel(b.accountType)}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        value={row.type}
                        onChange={e => updateDraft(row.tempId, { type: e.target.value as 'income' | 'expense' })}
                        className={`w-full bg-[#121212] border border-[#303030] rounded px-2 py-1 text-[11px] font-medium focus:outline-none ${
                          row.type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.amount}
                        onChange={e => updateDraft(row.tempId, { amount: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#121212] border border-[#303030] rounded px-2 py-1 text-xs text-right font-semibold text-white focus:outline-none focus:border-emerald-500"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(row.isLoanPayment)}
                        onChange={e => updateDraft(row.tempId, { isLoanPayment: e.target.checked })}
                        title="Credit Card / Loan Payment (Abono)"
                        className="accent-emerald-500 w-3.5 h-3.5 cursor-pointer"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeDraft(row.tempId)}
                        className="text-[#777] hover:text-rose-400 p-1 rounded"
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
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#2b2b2b] shrink-0">
          <span className="text-[11px] text-[#888]">
            {selectedDrafts.length} of {drafts.length} transactions selected
            {selectedBudgetObj ? ` • Target: ${selectedBudgetObj.name || selectedBudgetObj.category}` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg bg-[#333] hover:bg-[#3d3d3d] text-white text-xs transition"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!defaultBudgetId || selectedDrafts.length === 0 || isImporting || isParsing}
              onClick={handleConfirmImport}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition flex items-center gap-1.5"
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
