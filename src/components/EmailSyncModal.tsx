import React, { useState, useMemo } from 'react';
import {
  X,
  Mail,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  KeyRound
} from 'lucide-react';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Budget } from './BudgetsPage';
import { Transaction } from '../App';
import { parseBankEmailAlert, ParsedEmailTransaction } from '../utils/bankEmailParser';

interface EmailSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  budgets: Budget[];
  existingTransactions: Transaction[];
  currencySymbol: string;
  onIngestParsedTx: (parsed: ParsedEmailTransaction & { budgetId?: string }) => Promise<void>;
  onBatchIngestTxs?: (txs: Array<ParsedEmailTransaction & { budgetId?: string }>) => Promise<number>;
}

export default function EmailSyncModal({
  isOpen,
  onClose,
  budgets,
  existingTransactions,
  onIngestParsedTx,
  onBatchIngestTxs
}: EmailSyncModalProps) {
  const [activeTab, setActiveTab] = useState<'icloud' | 'gmail' | 'paste'>('icloud');

  // iCloud state
  const [iCloudEmail, setICloudEmail] = useState(() => localStorage.getItem('icloud_saved_email') || '');
  const [iCloudPassword, setICloudPassword] = useState('');
  const [iCloudLimit, setICloudLimit] = useState('40');
  const [isTestingICloud, setIsTestingICloud] = useState(false);
  const [isSyncingICloud, setIsSyncingICloud] = useState(false);
  const [iCloudStatus, setICloudStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Gmail state
  const [gmailAccessToken, setGmailAccessToken] = useState(() => sessionStorage.getItem('gmail_oauth_token') || '');
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [isSyncingGmail, setIsSyncingGmail] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Paste / Forwarding state
  const [pasteSubject, setPasteSubject] = useState('');
  const [pasteSender, setPasteSender] = useState('');
  const [pasteBody, setPasteBody] = useState('');
  const [pasteBudgetId, setPasteBudgetId] = useState('');
  const [parsedPreview, setParsedPreview] = useState<ParsedEmailTransaction | null>(null);

  // Detected alerts list
  const [detectedAlerts, setDetectedAlerts] = useState<Array<ParsedEmailTransaction & { selectedBudgetId?: string; imported?: boolean }>>([]);
  const [importingIndex, setImportingIndex] = useState<number | null>(null);
  const [isBatchImporting, setIsBatchImporting] = useState(false);

  const existingSignatureSet = useMemo(() => {
    const set = new Set<string>();
    existingTransactions.forEach(t => {
      const amtKey = Math.abs(Number(t.amount) || 0).toFixed(2);
      const dateKey = (t.date || '').slice(0, 10);
      const titleKey = (t.title || '').trim().toLowerCase().slice(0, 24);
      set.add(`${dateKey}|${amtKey}|${titleKey}`);
    });
    return set;
  }, [existingTransactions]);

  if (!isOpen) return null;

  const mapAlertsWithAccountMatch = (rawAlerts: ParsedEmailTransaction[]) => {
    return rawAlerts.map(alert => {
      let matchedBudget = budgets.find(b => {
        if (!alert.cardNumber) return false;
        const nameOrDesc = `${b.name || ''} ${b.category || ''} ${b.description || ''}`;
        return nameOrDesc.includes(alert.cardNumber);
      });
      if (!matchedBudget && alert.bankName) {
        const cleanBank = alert.bankName.toLowerCase().replace('banco ', '').trim();
        matchedBudget = budgets.find(b => {
          const nameOrDesc = `${b.name || ''} ${b.category || ''}`.toLowerCase();
          return cleanBank.length >= 3 && nameOrDesc.includes(cleanBank);
        });
      }

      const sig = `${(alert.date || '').slice(0, 10)}|${Math.abs(alert.amount).toFixed(2)}|${alert.title.trim().toLowerCase().slice(0, 24)}`;
      const alreadyImported = existingSignatureSet.has(sig);

      return {
        ...alert,
        selectedBudgetId: matchedBudget?.id || '',
        imported: alreadyImported
      };
    });
  };

  // 1. iCloud Sync Handlers
  const handleTestICloud = async () => {
    if (!iCloudEmail.trim() || !iCloudPassword.trim()) {
      setICloudStatus({ ok: false, msg: 'Please enter your iCloud email and App-Specific Password.' });
      return;
    }
    setIsTestingICloud(true);
    setICloudStatus(null);
    try {
      const res = await fetch('/api/email/test-icloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: iCloudEmail.trim(), password: iCloudPassword.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Connection failed.');
      }
      localStorage.setItem('icloud_saved_email', iCloudEmail.trim());
      setICloudStatus({
        ok: true,
        msg: `Connected to iCloud Mail (${data.totalInboxMessages} messages in INBOX).`
      });
    } catch (err: any) {
      setICloudStatus({ ok: false, msg: err.message });
    } finally {
      setIsTestingICloud(false);
    }
  };

  const handleSyncICloud = async () => {
    if (!iCloudEmail.trim() || !iCloudPassword.trim()) {
      setICloudStatus({ ok: false, msg: 'Please enter your iCloud email and App-Specific Password.' });
      return;
    }
    setIsSyncingICloud(true);
    setICloudStatus(null);
    try {
      const res = await fetch('/api/email/sync-icloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: iCloudEmail.trim(),
          password: iCloudPassword.trim(),
          limit: parseInt(iCloudLimit, 10) || 40
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to scan iCloud messages.');
      }
      localStorage.setItem('icloud_saved_email', iCloudEmail.trim());
      const mapped = mapAlertsWithAccountMatch(data.alerts || []);
      setDetectedAlerts(mapped);
      setICloudStatus({
        ok: true,
        msg: `Scanned ${data.totalScanned} emails. Detected ${mapped.length} bank transaction alert(s).`
      });
    } catch (err: any) {
      setICloudStatus({ ok: false, msg: err.message });
    } finally {
      setIsSyncingICloud(false);
    }
  };

  // 2. Gmail Connect & Sync Handlers
  const handleAuthorizeGmail = async () => {
    setIsConnectingGmail(true);
    setGmailStatus(null);
    try {
      const auth = getAuth();
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
      provider.setCustomParameters({ prompt: 'consent' });
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      if (!token) {
        throw new Error('Google did not return an OAuth access token. Ensure Gmail API OAuth is enabled for this app.');
      }
      sessionStorage.setItem('gmail_oauth_token', token);
      setGmailAccessToken(token);
      setGmailStatus({ ok: true, msg: 'Google Gmail account authorized! Click "Scan Bank Alerts in Gmail" to sync.' });
    } catch (err: any) {
      setGmailStatus({
        ok: false,
        msg: err.message || 'Could not authorize Gmail read-only access.'
      });
    } finally {
      setIsConnectingGmail(false);
    }
  };

  const handleSyncGmail = async () => {
    if (!gmailAccessToken.trim()) {
      setGmailStatus({
        ok: false,
        msg: 'Click "Connect Google Gmail" or provide an OAuth access token with gmail.readonly.'
      });
      return;
    }
    setIsSyncingGmail(true);
    setGmailStatus(null);
    try {
      const res = await fetch('/api/email/sync-gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: gmailAccessToken.trim(), maxResults: 30 })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync Gmail alerts.');
      }
      const mapped = mapAlertsWithAccountMatch(data.alerts || []);
      setDetectedAlerts(mapped);
      setGmailStatus({
        ok: true,
        msg: `Scanned ${data.totalScanned} Gmail messages. Detected ${mapped.length} bank transaction(s).`
      });
    } catch (err: any) {
      setGmailStatus({ ok: false, msg: err.message });
    } finally {
      setIsSyncingGmail(false);
    }
  };

  // 3. Paste parse handler
  const handleParsePastedText = () => {
    if (!pasteBody.trim()) return;
    const result = parseBankEmailAlert(pasteBody, pasteSubject, pasteSender);
    setParsedPreview(result);
    if (result) {
      const matched = mapAlertsWithAccountMatch([result])[0];
      setPasteBudgetId(matched.selectedBudgetId || '');
    }
  };

  // 4. Ingest single alert
  const handleImportSingle = async (index: number) => {
    const item = detectedAlerts[index];
    if (!item || item.imported) return;
    setImportingIndex(index);
    try {
      await onIngestParsedTx({
        ...item,
        budgetId: item.selectedBudgetId || undefined
      });
      setDetectedAlerts(prev =>
        prev.map((it, idx) => (idx === index ? { ...it, imported: true } : it))
      );
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setImportingIndex(null);
    }
  };

  // 5. Batch Import all
  const handleBatchImportAll = async () => {
    const unimported = detectedAlerts.filter(a => !a.imported);
    if (unimported.length === 0) return;
    setIsBatchImporting(true);
    try {
      if (onBatchIngestTxs) {
        await onBatchIngestTxs(
          unimported.map(u => ({ ...u, budgetId: u.selectedBudgetId || undefined }))
        );
      } else {
        for (const item of unimported) {
          await onIngestParsedTx({ ...item, budgetId: item.selectedBudgetId || undefined });
        }
      }
      setDetectedAlerts(prev => prev.map(it => ({ ...it, imported: true })));
    } catch (err) {
      console.error('Batch import error:', err);
    } finally {
      setIsBatchImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-6 w-full max-w-2xl space-y-5 shadow-2xl max-h-[92vh] overflow-y-auto text-[#F5F5F7]">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-2xl bg-[#0071E3]/20 text-[#0071E3] flex items-center justify-center">
                <Mail className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-xl font-bold tracking-tight text-white">Connect Email Accounts</h3>
                <p className="text-xs text-[#86868B] mt-0.5">
                  Sync bank alerts from iCloud Mail or Gmail into pending flotante transactions.
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher - Apple Style Segmented Pill */}
        <div className="flex p-1 bg-[#2C2C2E] rounded-full border border-white/5">
          <button
            type="button"
            onClick={() => setActiveTab('icloud')}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-semibold transition ${
              activeTab === 'icloud'
                ? 'bg-[#0071E3] text-white shadow-sm'
                : 'text-[#86868B] hover:text-white'
            }`}
          >
            iCloud Mail (IMAP)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gmail')}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-semibold transition ${
              activeTab === 'gmail'
                ? 'bg-[#0071E3] text-white shadow-sm'
                : 'text-[#86868B] hover:text-white'
            }`}
          >
            Gmail API
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('paste')}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-semibold transition ${
              activeTab === 'paste'
                ? 'bg-[#0071E3] text-white shadow-sm'
                : 'text-[#86868B] hover:text-white'
            }`}
          >
            Paste Email
          </button>
        </div>

        {/* TAB 1: iCloud IMAP */}
        {activeTab === 'icloud' && (
          <div className="space-y-4 bg-[#2C2C2E]/60 border border-white/5 p-4 rounded-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">
                  Apple iCloud Mail (IMAP SSL 993)
                </h4>
                <p className="text-[11px] text-[#86868B] mt-0.5">
                  Direct encrypted connection to <code className="text-blue-400">imap.mail.me.com</code>.
                </p>
              </div>
              <a
                href="https://account.apple.com"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-[#0071E3] hover:underline flex items-center gap-1 shrink-0"
              >
                Apple Account <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-[#86868B] block mb-1">iCloud Email Address</label>
                <input
                  type="email"
                  placeholder="yourname@icloud.com"
                  value={iCloudEmail}
                  onChange={e => setICloudEmail(e.target.value)}
                  className="w-full bg-[#1C1C1E] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0071E3]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#86868B] block mb-1">Apple App-Specific Password</label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    value={iCloudPassword}
                    onChange={e => setICloudPassword(e.target.value)}
                    className="w-full bg-[#1C1C1E] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0071E3] font-mono"
                  />
                  <KeyRound className="w-3.5 h-3.5 text-[#86868B] absolute right-3 top-2.5" />
                </div>
              </div>
            </div>

            <div className="bg-[#1C1C1E] border border-white/5 p-3 rounded-xl flex items-start gap-2.5 text-[11px] text-[#86868B]">
              <ShieldCheck className="w-4 h-4 text-[#34C759] shrink-0 mt-0.5" />
              <div>
                <strong className="text-zinc-200">How to get an App-Specific Password:</strong>
                <p className="mt-0.5">
                  Sign in at <a href="https://account.apple.com" target="_blank" rel="noreferrer" className="text-[#0071E3] underline">account.apple.com</a> → Sign-In and Security → <strong>App-Specific Passwords</strong> → Generate a password for Finance Tracker.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#86868B]">Emails to scan:</span>
                <select
                  value={iCloudLimit}
                  onChange={e => setICloudLimit(e.target.value)}
                  className="bg-[#1C1C1E] border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
                >
                  <option value="20">Latest 20</option>
                  <option value="40">Latest 40</option>
                  <option value="80">Latest 80</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestICloud}
                  disabled={isTestingICloud || isSyncingICloud}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/15 text-zinc-200 transition disabled:opacity-50"
                >
                  {isTestingICloud ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  onClick={handleSyncICloud}
                  disabled={isSyncingICloud || isTestingICloud}
                  className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#0071E3] hover:bg-[#0077ED] text-white transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingICloud ? 'animate-spin' : ''}`} />
                  {isSyncingICloud ? 'Scanning iCloud...' : 'Scan & Sync Alerts'}
                </button>
              </div>
            </div>

            {iCloudStatus && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  iCloudStatus.ok
                    ? 'bg-[#34C759]/10 text-emerald-300 border border-[#34C759]/25'
                    : 'bg-[#FF3B30]/10 text-rose-300 border border-[#FF3B30]/25'
                }`}
              >
                {iCloudStatus.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#34C759]" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-[#FF3B30]" />
                )}
                <span>{iCloudStatus.msg}</span>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Gmail API */}
        {activeTab === 'gmail' && (
          <div className="space-y-4 bg-[#2C2C2E]/60 border border-white/5 p-4 rounded-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-white">Gmail Read-Only Sync</h4>
                <p className="text-[11px] text-[#86868B] mt-0.5">
                  Queries bank alerts from Banreservas, Banco Popular, BHD, and Qik via Google OAuth.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAuthorizeGmail}
                disabled={isConnectingGmail}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white text-black hover:bg-zinc-200 transition disabled:opacity-50 shrink-0"
              >
                {isConnectingGmail ? 'Authorizing...' : gmailAccessToken ? 'Re-authorize Gmail' : 'Connect Google Gmail'}
              </button>
            </div>

            <div>
              <label className="text-[11px] text-[#86868B] block mb-1">
                Google OAuth Access Token (<code className="text-blue-400">gmail.readonly</code>)
              </label>
              <input
                type="password"
                placeholder="Authorized automatically via Connect Google Gmail or paste token"
                value={gmailAccessToken}
                onChange={e => setGmailAccessToken(e.target.value)}
                className="w-full bg-[#1C1C1E] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0071E3] font-mono"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSyncGmail}
                disabled={isSyncingGmail}
                className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#0071E3] hover:bg-[#0077ED] text-white transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingGmail ? 'animate-spin' : ''}`} />
                {isSyncingGmail ? 'Scanning Gmail...' : 'Scan Bank Alerts in Gmail'}
              </button>
            </div>

            {gmailStatus && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  gmailStatus.ok
                    ? 'bg-[#34C759]/10 text-emerald-300 border border-[#34C759]/25'
                    : 'bg-[#FF3B30]/10 text-rose-300 border border-[#FF3B30]/25'
                }`}
              >
                {gmailStatus.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#34C759]" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-[#FF3B30]" />
                )}
                <span>{gmailStatus.msg}</span>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Direct Ingest / Paste */}
        {activeTab === 'paste' && (
          <div className="space-y-3 bg-[#2C2C2E]/60 border border-white/5 p-4 rounded-2xl">
            <div>
              <h4 className="text-sm font-semibold text-white">Paste Real Bank Notification</h4>
              <p className="text-[11px] text-[#86868B] mt-0.5">
                Paste the subject and text from a real bank alert email to parse and import as pending flotante.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[11px] text-[#86868B] block mb-1">Email Subject (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Aviso de Transacción"
                  value={pasteSubject}
                  onChange={e => setPasteSubject(e.target.value)}
                  className="w-full bg-[#1C1C1E] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#86868B] block mb-1">Sender (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. alertas@banreservas.com"
                  value={pasteSender}
                  onChange={e => setPasteSender(e.target.value)}
                  className="w-full bg-[#1C1C1E] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-[#86868B] block mb-1">Email Body Text *</label>
              <textarea
                rows={4}
                placeholder="Paste your real bank email body here..."
                value={pasteBody}
                onChange={e => setPasteBody(e.target.value)}
                className="w-full bg-[#1C1C1E] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-[#0071E3]"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleParsePastedText}
                className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#0071E3] hover:bg-[#0077ED] text-white transition"
              >
                Parse Email
              </button>
            </div>

            {parsedPreview && (
              <div className="bg-[#1C1C1E] border border-white/10 rounded-2xl p-3.5 space-y-2.5 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-[#34C759]" />
                    {parsedPreview.bankName}
                  </span>
                  <span className="text-[#34C759] font-bold text-sm tabular-nums">
                    {parsedPreview.currency} {parsedPreview.amount.toFixed(2)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-[#86868B]">
                  <div>Merchant: <span className="text-zinc-200">{parsedPreview.title}</span></div>
                  <div>Category: <span className="text-zinc-200">{parsedPreview.category}</span></div>
                  <div>Date: <span className="text-zinc-200 tabular-nums">{parsedPreview.date}</span></div>
                  <div>Card: <span className="text-zinc-200">{parsedPreview.cardNumber ? `*${parsedPreview.cardNumber}` : 'N/A'}</span></div>
                </div>
                {budgets.length > 0 && (
                  <select
                    value={pasteBudgetId}
                    onChange={e => setPasteBudgetId(e.target.value)}
                    className="w-full text-xs bg-[#2C2C2E] border border-white/10 rounded-xl px-3 py-1.5 text-white"
                  >
                    <option value="">No Account Link</option>
                    {budgets.map(b => (
                      <option key={b.id} value={b.id}>{b.name || b.category}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await onIngestParsedTx({ ...parsedPreview, budgetId: pasteBudgetId || undefined });
                    setParsedPreview(null);
                    setPasteBody('');
                    setPasteSubject('');
                    setPasteSender('');
                  }}
                  className="w-full py-2 rounded-full bg-[#34C759] hover:bg-emerald-500 text-black text-xs font-semibold transition"
                >
                  Import as Pending Flotante
                </button>
              </div>
            )}
          </div>
        )}

        {/* DETECTED ALERTS LEDGER (REAL SCAN RESULTS) */}
        {detectedAlerts.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-white">
                  Detected Bank Transactions ({detectedAlerts.length})
                </h4>
                <span className="text-[11px] text-[#86868B]">
                  Review and link each detected transaction to your accounts.
                </span>
              </div>
              <button
                type="button"
                onClick={handleBatchImportAll}
                disabled={isBatchImporting || detectedAlerts.every(a => a.imported)}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#34C759] hover:bg-emerald-500 text-black transition disabled:opacity-40 shrink-0"
              >
                {isBatchImporting ? 'Importing...' : 'Import All Pending'}
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {detectedAlerts.map((alert, idx) => {
                const isImported = Boolean(alert.imported);
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-2xl border transition flex items-center justify-between gap-3 ${
                      isImported
                        ? 'bg-[#34C759]/5 border-[#34C759]/20 opacity-75'
                        : 'bg-[#2C2C2E] border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white truncate">{alert.title}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30 shrink-0">
                          Flotante
                        </span>
                        {alert.cardNumber && (
                          <span className="text-[10px] text-[#86868B] tabular-nums shrink-0">*{alert.cardNumber}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#86868B] mt-0.5 flex items-center gap-2">
                        <span>{alert.bankName}</span>
                        <span>•</span>
                        <span className="tabular-nums">{alert.date}</span>
                        <span>•</span>
                        <span>{alert.category}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-sm font-bold text-white tabular-nums">
                          {alert.currency} {alert.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        {budgets.length > 0 && (
                          <select
                            disabled={isImported}
                            value={alert.selectedBudgetId || ''}
                            onChange={e => {
                              const val = e.target.value;
                              setDetectedAlerts(prev =>
                                prev.map((a, i) => (i === idx ? { ...a, selectedBudgetId: val } : a))
                              );
                            }}
                            className="text-[10px] bg-[#1C1C1E] border border-white/10 rounded-lg px-1.5 py-0.5 text-zinc-300 mt-1 max-w-[140px] truncate"
                          >
                            <option value="">No Account Link</option>
                            {budgets.map(b => (
                              <option key={b.id} value={b.id}>
                                {b.name || b.category}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleImportSingle(idx)}
                        disabled={isImported || importingIndex === idx}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                          isImported
                            ? 'bg-[#34C759]/20 text-[#34C759] cursor-default'
                            : 'bg-[#0071E3] hover:bg-[#0077ED] text-white'
                        }`}
                      >
                        {isImported ? 'In Ledger' : importingIndex === idx ? 'Saving...' : 'Import'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
