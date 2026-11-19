import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Mail,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  KeyRound,
  Radio,
  Power
} from 'lucide-react';
import { Budget } from './BudgetsPage';
import { Transaction } from '../App';
import {
  parseBankEmailAlert,
  ParsedEmailTransaction,
  findExistingTransactionForEmailAlert
} from '../utils/bankEmailParser';
import { GmailAuthError, scanGmailBankAlerts } from '../services/gmailSyncService';

export interface PersistentGmailState {
  enabled: boolean;
  email: string;
  autoScan: boolean;
  tokenActive: boolean;
  tokenExpired: boolean;
  historyId?: string;
  lastSyncedAt?: string;
}

export interface SessionICloudState {
  connected: boolean;
  email: string;
  password: string;
  limit: number;
  autoScan: boolean;
  lastSyncedAt?: string;
}

interface EmailSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  budgets: Budget[];
  existingTransactions: Transaction[];
  processedEmailIds: string[];
  currencySymbol: string;
  gmailState: PersistentGmailState;
  gmailToken: string | null;
  onAuthorizeGmail: () => Promise<{
    accessToken: string;
    emailAddress: string;
    historyId: string;
  }>;
  onDisconnectGmail: () => Promise<void>;
  onToggleGmailAutoScan: (enabled: boolean) => Promise<void>;
  onGmailScanComplete: (meta: {
    historyId?: string;
    emailAddress?: string;
    lastSyncedAt: string;
    newProcessedIds?: string[];
  }) => Promise<void>;
  onMarkGmailTokenExpired: () => void;
  iCloudSession: SessionICloudState | null;
  onSetICloudSession: (session: SessionICloudState | null) => void;
  onIngestParsedTx: (parsed: ParsedEmailTransaction & { budgetId?: string }) => Promise<void>;
  onBatchIngestTxs?: (txs: Array<ParsedEmailTransaction & { budgetId?: string }>) => Promise<number>;
}

export default function EmailSyncModal({
  isOpen,
  onClose,
  budgets,
  existingTransactions,
  processedEmailIds,
  gmailState,
  gmailToken,
  onAuthorizeGmail,
  onDisconnectGmail,
  onToggleGmailAutoScan,
  onGmailScanComplete,
  onMarkGmailTokenExpired,
  iCloudSession,
  onSetICloudSession,
  onIngestParsedTx,
  onBatchIngestTxs
}: EmailSyncModalProps) {
  const [activeTab, setActiveTab] = useState<'gmail' | 'icloud' | 'paste'>(() =>
    gmailState.enabled ? 'gmail' : iCloudSession?.connected ? 'icloud' : 'gmail'
  );

  // iCloud form state (backed by App session memory so closing modal never disconnects)
  const [iCloudEmail, setICloudEmail] = useState(() => iCloudSession?.email || '');
  const [iCloudPassword, setICloudPassword] = useState(() => iCloudSession?.password || '');
  const [iCloudLimit, setICloudLimit] = useState(() => String(iCloudSession?.limit || 40));
  const [isTestingICloud, setIsTestingICloud] = useState(false);
  const [isSyncingICloud, setIsSyncingICloud] = useState(false);
  const [iCloudStatus, setICloudStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Gmail UI state
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [isSyncingGmail, setIsSyncingGmail] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Paste state
  const [pasteSubject, setPasteSubject] = useState('');
  const [pasteSender, setPasteSender] = useState('');
  const [pasteBody, setPasteBody] = useState('');
  const [pasteBudgetId, setPasteBudgetId] = useState('');
  const [parsedPreview, setParsedPreview] = useState<ParsedEmailTransaction | null>(null);

  // Detected alerts list
  const [detectedAlerts, setDetectedAlerts] = useState<
    Array<ParsedEmailTransaction & { selectedBudgetId?: string; imported?: boolean }>
  >([]);
  const [importingIndex, setImportingIndex] = useState<number | null>(null);
  const [isBatchImporting, setIsBatchImporting] = useState(false);

  useEffect(() => {
    if (iCloudSession?.connected) {
      setICloudEmail(iCloudSession.email);
      setICloudPassword(iCloudSession.password);
      setICloudLimit(String(iCloudSession.limit));
    }
  }, [iCloudSession]);

  const processedEmailIdSet = useMemo(() => new Set(processedEmailIds), [processedEmailIds]);

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
    const claimedTxIds = new Set<string>();
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

      const matchedExisting = findExistingTransactionForEmailAlert(
        existingTransactions,
        { ...alert, budgetId: matchedBudget?.id || undefined },
        claimedTxIds
      );
      if (matchedExisting?.id) {
        claimedTxIds.add(matchedExisting.id);
      }

      const alreadyImported =
        Boolean(alert.emailId && processedEmailIdSet.has(alert.emailId)) ||
        Boolean(matchedExisting);

      return {
        ...alert,
        selectedBudgetId: matchedBudget?.id || '',
        imported: alreadyImported
      };
    });
  };

  // Safe fetch JSON helper for /api/email/* endpoints
  const parseApiJsonSafe = async (res: Response) => {
    const raw = await res.text();
    const trimmed = raw.trim();
    if (!trimmed) {
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}.`);
      return {};
    }
    if (trimmed.startsWith('<')) {
      throw new Error(`Unexpected HTML response (HTTP ${res.status}). Please retry in a moment.`);
    }
    try {
      const json = JSON.parse(trimmed);
      if (!res.ok) throw new Error(json.error || `Request failed (HTTP ${res.status}).`);
      return json;
    } catch (err: any) {
      if (!res.ok) throw new Error(err.message || `Request failed (HTTP ${res.status}).`);
      throw new Error('Server returned invalid JSON.');
    }
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
      const data = await parseApiJsonSafe(res);
      onSetICloudSession({
        connected: true,
        email: iCloudEmail.trim(),
        password: iCloudPassword.trim(),
        limit: parseInt(iCloudLimit, 10) || 40,
        autoScan: iCloudSession?.autoScan ?? true,
        lastSyncedAt: new Date().toISOString()
      });
      setICloudStatus({
        ok: true,
        msg: `Connected to iCloud Mail (${data.totalInboxMessages} messages in INBOX). Session stays active.`
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
      const limitVal = parseInt(iCloudLimit, 10) || 40;
      const res = await fetch('/api/email/sync-icloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: iCloudEmail.trim(),
          password: iCloudPassword.trim(),
          limit: limitVal
        })
      });
      const data = await parseApiJsonSafe(res);
      onSetICloudSession({
        connected: true,
        email: iCloudEmail.trim(),
        password: iCloudPassword.trim(),
        limit: limitVal,
        autoScan: iCloudSession?.autoScan ?? true,
        lastSyncedAt: new Date().toISOString()
      });
      const mapped = mapAlertsWithAccountMatch(data.alerts || []);
      setDetectedAlerts(mapped);
      setICloudStatus({
        ok: true,
        msg: `Scanned ${data.totalScanned} emails. Detected ${mapped.length} bank alert(s). Auto-scan stays connected.`
      });
    } catch (err: any) {
      setICloudStatus({ ok: false, msg: err.message });
    } finally {
      setIsSyncingICloud(false);
    }
  };

  // 2. Gmail Connect & Direct Sync Handlers
  const runGmailScanWithToken = async (token: string) => {
    setIsSyncingGmail(true);
    setGmailStatus(null);
    try {
      const scanRes = await scanGmailBankAlerts(token, 25);
      const mapped = mapAlertsWithAccountMatch(scanRes.alerts);
      setDetectedAlerts(mapped);

      await onGmailScanComplete({
        historyId: scanRes.historyId,
        emailAddress: scanRes.emailAddress,
        lastSyncedAt: new Date().toISOString()
      });

      const pendingNewCount = mapped.filter(m => !m.imported).length;
      setGmailStatus({
        ok: true,
        msg: `Scanned ${scanRes.totalScanned} Gmail messages (${scanRes.alerts.length} bank alert(s), ${pendingNewCount} new). Gmail stays connected & auto-scanning.`
      });
    } catch (err: any) {
      if (err instanceof GmailAuthError && err.code === 'GMAIL_TOKEN_EXPIRED') {
        onMarkGmailTokenExpired();
      }
      setGmailStatus({
        ok: false,
        msg: err?.message || 'Failed to sync Gmail bank alerts.'
      });
    } finally {
      setIsSyncingGmail(false);
    }
  };

  const handleAuthorizeAndScanGmail = async () => {
    setIsConnectingGmail(true);
    setGmailStatus(null);
    try {
      const authResult = await onAuthorizeGmail();
      setGmailStatus({
        ok: true,
        msg: `Connected ${authResult.emailAddress || 'Gmail'}! Scanning bank alerts now...`
      });
      setIsConnectingGmail(false);
      await runGmailScanWithToken(authResult.accessToken);
    } catch (err: any) {
      setGmailStatus({
        ok: false,
        msg: err?.message || 'Could not authorize Gmail read-only access.'
      });
      setIsConnectingGmail(false);
    }
  };

  const handleSyncGmail = async () => {
    if (!gmailToken) {
      await handleAuthorizeAndScanGmail();
      return;
    }
    await runGmailScanWithToken(gmailToken);
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
      if (item.emailId) {
        await onGmailScanComplete({
          lastSyncedAt: new Date().toISOString(),
          newProcessedIds: [item.emailId]
        });
      }
      setDetectedAlerts(prev => prev.map((it, idx) => (idx === index ? { ...it, imported: true } : it)));
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setImportingIndex(null);
    }
  };

  // 5. Batch Import all unimported non-declined alerts
  const handleBatchImportAll = async () => {
    const unimported = detectedAlerts.filter(a => !a.imported && a.emailOutcome !== 'declined');
    if (unimported.length === 0) return;
    setIsBatchImporting(true);
    try {
      const payload = unimported.map(u => ({ ...u, budgetId: u.selectedBudgetId || undefined }));
      if (onBatchIngestTxs) {
        await onBatchIngestTxs(payload);
      } else {
        for (const item of payload) {
          await onIngestParsedTx(item);
        }
      }
      const importedIds = unimported.map(u => u.emailId).filter((id): id is string => Boolean(id));
      if (importedIds.length > 0) {
        await onGmailScanComplete({
          lastSyncedAt: new Date().toISOString(),
          newProcessedIds: importedIds
        });
      }
      setDetectedAlerts(prev =>
        prev.map(it => (it.emailOutcome !== 'declined' ? { ...it, imported: true } : it))
      );
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
                  Persistent bank alert sync with automatic live detection of newly received emails.
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
            onClick={() => setActiveTab('gmail')}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
              activeTab === 'gmail' ? 'bg-[#0071E3] text-white shadow-sm' : 'text-[#86868B] hover:text-white'
            }`}
          >
            <span>Gmail Auto-Sync</span>
            {gmailState.enabled && gmailState.tokenActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#34C759]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('icloud')}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
              activeTab === 'icloud' ? 'bg-[#0071E3] text-white shadow-sm' : 'text-[#86868B] hover:text-white'
            }`}
          >
            <span>iCloud Mail (IMAP)</span>
            {iCloudSession?.connected && <span className="w-1.5 h-1.5 rounded-full bg-[#34C759]" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('paste')}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-semibold transition ${
              activeTab === 'paste' ? 'bg-[#0071E3] text-white shadow-sm' : 'text-[#86868B] hover:text-white'
            }`}
          >
            Paste Email
          </button>
        </div>

        {/* TAB 1: Gmail Auto-Sync */}
        {activeTab === 'gmail' && (
          <div className="space-y-4 bg-[#2C2C2E]/60 border border-white/5 p-4 rounded-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-white">Gmail Live Read-Only Sync</h4>
                  {gmailState.enabled && gmailState.tokenActive ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#34C759]/15 text-[#34C759] border border-[#34C759]/30">
                      <Radio className="w-2.5 h-2.5 animate-pulse" /> Connected
                    </span>
                  ) : gmailState.enabled ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30">
                      Refresh Needed
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] text-[#86868B] mt-0.5">
                  {gmailState.email
                    ? `Linked to ${gmailState.email} — scans new bank alerts automatically as they arrive.`
                    : 'Connect once to stay synced and automatically detect new Banreservas, Popular, BHD & Qik alerts.'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleAuthorizeAndScanGmail}
                  disabled={isConnectingGmail || isSyncingGmail}
                  className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white text-black hover:bg-zinc-200 transition disabled:opacity-50"
                >
                  {isConnectingGmail
                    ? 'Connecting...'
                    : gmailState.enabled && !gmailState.tokenActive
                    ? 'Reconnect Gmail'
                    : gmailState.enabled
                    ? 'Refresh Auth'
                    : 'Connect Google Gmail'}
                </button>
                {gmailState.enabled && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onDisconnectGmail();
                      setGmailStatus({ ok: true, msg: 'Gmail auto-sync disconnected.' });
                    }}
                    title="Disconnect Gmail"
                    className="p-1.5 rounded-full bg-white/10 hover:bg-[#FF3B30]/20 text-[#86868B] hover:text-[#FF3B30] transition"
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Persistent Connection & Auto-Scan Controls */}
            <div className="bg-[#1C1C1E] border border-white/10 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#34C759]" />
                  Automatic Incoming Email Scanner
                </div>
                <p className="text-[11px] text-[#86868B]">
                  Watches your inbox continuously and auto-imports newly received alerts as Pending Flotante.
                  {gmailState.lastSyncedAt && (
                    <span className="block text-[10px] text-zinc-400 mt-0.5 tabular-nums">
                      Last checked: {new Date(gmailState.lastSyncedAt).toLocaleTimeString()}
                    </span>
                  )}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={gmailState.autoScan}
                  onChange={e => onToggleGmailAutoScan(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-[#2C2C2E] peer-checked:bg-[#34C759] rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
              </label>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-[#86868B]">
                {gmailState.tokenActive
                  ? 'OAuth session active in memory — safe to close modal.'
                  : gmailState.enabled
                  ? 'Click "Reconnect Gmail" or "Scan Now" to renew your 1-hour session token.'
                  : 'Read-only access (gmail.readonly).'}
              </span>

              <button
                type="button"
                onClick={handleSyncGmail}
                disabled={isSyncingGmail || isConnectingGmail}
                className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#0071E3] hover:bg-[#0077ED] text-white transition flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingGmail ? 'animate-spin' : ''}`} />
                {isSyncingGmail ? 'Scanning Gmail...' : 'Scan Bank Alerts Now'}
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

        {/* TAB 2: iCloud IMAP */}
        {activeTab === 'icloud' && (
          <div className="space-y-4 bg-[#2C2C2E]/60 border border-white/5 p-4 rounded-2xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-white">Apple iCloud Mail (IMAP SSL 993)</h4>
                  {iCloudSession?.connected && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#34C759]/15 text-[#34C759] border border-[#34C759]/30">
                      <Radio className="w-2.5 h-2.5 animate-pulse" /> Connected
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#86868B] mt-0.5">
                  Direct encrypted connection to <code className="text-blue-400">imap.mail.me.com</code>.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href="https://account.apple.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-[#0071E3] hover:underline flex items-center gap-1"
                >
                  Apple Account <ExternalLink className="w-3 h-3" />
                </a>
                {iCloudSession?.connected && (
                  <button
                    type="button"
                    onClick={() => {
                      onSetICloudSession(null);
                      setICloudStatus({ ok: true, msg: 'iCloud session disconnected.' });
                    }}
                    title="Disconnect iCloud"
                    className="p-1.5 rounded-full bg-white/10 hover:bg-[#FF3B30]/20 text-[#86868B] hover:text-[#FF3B30] transition"
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
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
                  Sign in at{' '}
                  <a href="https://account.apple.com" target="_blank" rel="noreferrer" className="text-[#0071E3] underline">
                    account.apple.com
                  </a>{' '}
                  → Sign-In and Security → <strong>App-Specific Passwords</strong> → Generate a password for Finance Tracker.
                </p>
              </div>
            </div>

            {iCloudSession?.connected && (
              <div className="bg-[#1C1C1E] border border-white/10 rounded-2xl p-3 flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-200 font-medium">
                  Auto-scan new iCloud emails during session
                </span>
                <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={iCloudSession.autoScan}
                    onChange={e =>
                      onSetICloudSession({
                        ...iCloudSession,
                        autoScan: e.target.checked
                      })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-10 h-6 bg-[#2C2C2E] peer-checked:bg-[#34C759] rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
                </label>
              </div>
            )}

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
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-[#34C759]" />
                      {parsedPreview.bankName}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        parsedPreview.emailOutcome === 'declined'
                          ? 'bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/30'
                          : parsedPreview.emailOutcome === 'reversed'
                          ? 'bg-[#AF52DE]/15 text-purple-300 border-[#AF52DE]/30'
                          : 'bg-[#34C759]/15 text-[#34C759] border-[#34C759]/30'
                      }`}
                    >
                      {parsedPreview.outcomeLabel}
                    </span>
                  </div>
                  <span
                    className={`font-bold text-sm tabular-nums ${
                      parsedPreview.emailOutcome === 'declined'
                        ? 'text-[#FF3B30] line-through'
                        : parsedPreview.emailOutcome === 'reversed'
                        ? 'text-purple-300'
                        : 'text-[#34C759]'
                    }`}
                  >
                    {parsedPreview.currency} {parsedPreview.amount.toFixed(2)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-[#86868B]">
                  <div>Merchant: <span className="text-zinc-200">{parsedPreview.title}</span></div>
                  <div>Status: <span className="text-zinc-200">{parsedPreview.outcomeLabel}</span></div>
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
                disabled={isBatchImporting || detectedAlerts.every(a => a.imported || a.emailOutcome === 'declined')}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#34C759] hover:bg-emerald-500 text-black transition disabled:opacity-40 shrink-0"
              >
                {isBatchImporting ? 'Importing...' : 'Import All Pending'}
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {detectedAlerts.map((alert, idx) => {
                const isImported = Boolean(alert.imported);
                const isDeclined = alert.emailOutcome === 'declined';
                const isReversed = alert.emailOutcome === 'reversed';
                return (
                  <div
                    key={alert.emailId || idx}
                    className={`p-3 rounded-2xl border transition flex items-center justify-between gap-3 ${
                      isDeclined
                        ? 'bg-[#FF3B30]/5 border-[#FF3B30]/20 opacity-85'
                        : isImported
                        ? 'bg-[#34C759]/5 border-[#34C759]/20 opacity-75'
                        : 'bg-[#2C2C2E] border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-white truncate max-w-[180px]">{alert.title}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${
                            isDeclined
                              ? 'bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/30'
                              : isReversed
                              ? 'bg-[#AF52DE]/15 text-purple-300 border-[#AF52DE]/30'
                              : 'bg-[#34C759]/15 text-[#34C759] border-[#34C759]/30'
                          }`}
                        >
                          {alert.outcomeLabel || (isDeclined ? 'Declined' : isReversed ? 'Reversed' : 'Went Through')}
                        </span>
                        {!isDeclined && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30 shrink-0">
                            Flotante
                          </span>
                        )}
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
                        <div className={`text-sm font-bold tabular-nums ${isDeclined ? 'text-[#FF3B30] line-through' : isReversed ? 'text-purple-300' : 'text-white'}`}>
                          {alert.currency} {alert.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        {budgets.length > 0 && (
                          <select
                            disabled={isImported || isDeclined}
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
                        disabled={isImported || isDeclined || importingIndex === idx}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                          isDeclined
                            ? 'bg-[#FF3B30]/15 text-[#FF3B30] cursor-default'
                            : isImported
                            ? 'bg-[#34C759]/20 text-[#34C759] cursor-default'
                            : 'bg-[#0071E3] hover:bg-[#0077ED] text-white'
                        }`}
                      >
                        {isDeclined ? 'Declined' : isImported ? 'In Ledger' : importingIndex === idx ? 'Saving...' : 'Import'}
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
