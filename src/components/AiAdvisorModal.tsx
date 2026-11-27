import React, { useState } from 'react';
import { X, Sparkles, Loader2, AlertCircle, Copy, Check, RefreshCw, UserCheck } from 'lucide-react';

interface AiAdvisorModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName?: string;
  currencySymbol?: string;
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  aiResult: string | null;
  aiError?: string | null;
  aiLoading: boolean;
  onAskAi: (overridePrompt?: string) => void;
}

const QUICK_PROMPTS = [
  'Resumen de mi salud financiera este mes',
  '¿Cómo optimizar el corte y límites de mis tarjetas?',
  '¿En qué categorías estoy gastando más y cómo recortar?',
  'Plan de pago para mis préstamos y diferidos',
  'Analyze my cashflow & credit utilization'
];

export default function AiAdvisorModal({
  isOpen,
  onClose,
  userName = 'User',
  currencySymbol = '$',
  aiPrompt,
  setAiPrompt,
  aiResult,
  aiError,
  aiLoading,
  onAskAi
}: AiAdvisorModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!aiResult) return;
    navigator.clipboard.writeText(aiResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-2xl space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#1D1D1F] dark:text-[#F5F5F7]">
        
        {/* Header */}
        <div className="flex justify-between items-start gap-3 pb-3 border-b border-black/[0.05] dark:border-white/10">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#0071E3]" /> Financial Insights Advisor
              </h3>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0071E3] dark:text-[#5AC8FA] bg-[#0071E3]/10 px-2.5 py-0.5 rounded-full border border-[#0071E3]/20">
                <UserCheck className="w-3 h-3" /> Personalized for {userName}
              </span>
            </div>
            <p className="text-xs text-[#86868B] mt-0.5">
              Multi-account intelligence analyzing your real balances ({currencySymbol}), credit card cycles, loans, and cashflow.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        <div className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-[#86868B] block">
            Suggested Analysis
          </span>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map(suggestion => (
              <button
                key={suggestion}
                type="button"
                disabled={aiLoading}
                onClick={() => {
                  setAiPrompt(suggestion);
                  onAskAi(suggestion);
                }}
                className="px-3 py-1 rounded-full text-[11px] font-medium bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:hover:bg-white/15 text-[#1D1D1F] dark:text-zinc-200 transition disabled:opacity-50 text-left active:scale-[0.98]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {/* Input & Action */}
        <div className="space-y-3">
          <textarea
            rows={3}
            placeholder={`Ask anything about your finances, ${userName}... (e.g. ¿Cómo pagar mis tarjetas antes del corte?)`}
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && aiPrompt.trim() && !aiLoading) {
                e.preventDefault();
                onAskAi();
              }
            }}
            className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-2xl p-3.5 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3] transition"
          />

          <div className="flex justify-between items-center gap-3">
            <span className="text-[11px] text-[#86868B]">
              Press <kbd className="px-1.5 py-0.5 rounded bg-black/[0.05] dark:bg-white/10 font-mono text-[10px]">Ctrl/Cmd + Enter</kbd> to submit
            </span>
            <button
              type="button"
              onClick={() => onAskAi()}
              disabled={aiLoading || !aiPrompt.trim()}
              className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-5 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 shrink-0 whitespace-nowrap shadow-sm active:scale-[0.98]"
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {aiLoading ? 'Analyzing...' : 'Generate Insights'}
            </button>
          </div>

          {/* Error Banner */}
          {aiError && (
            <div className="p-3.5 bg-[#FF3B30]/10 border border-[#FF3B30]/25 rounded-2xl text-xs text-[#D70015] dark:text-[#FF3B30] flex items-center justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-snug">{aiError}</span>
              </div>
              <button
                type="button"
                onClick={() => onAskAi()}
                disabled={aiLoading}
                className="px-3 py-1 rounded-full bg-[#FF3B30] text-white text-[11px] font-semibold flex items-center gap-1 shrink-0 hover:bg-[#E0352B] transition"
              >
                <RefreshCw className="w-3 h-3" /> Reintentar
              </button>
            </div>
          )}

          {/* Result Card */}
          {aiResult && (
            <div className="mt-3 bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 border border-black/[0.05] dark:border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-black/[0.05] dark:border-white/10">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-[#86868B] flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-[#0071E3]" /> Tailored Recommendations
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white dark:bg-white/10 hover:bg-black/[0.04] dark:hover:bg-white/15 text-[#1D1D1F] dark:text-white transition flex items-center gap-1 border border-black/[0.04] dark:border-white/10"
                >
                  {copied ? <Check className="w-3 h-3 text-[#34C759]" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy Advice'}
                </button>
              </div>

              <div className="text-xs text-[#1D1D1F] dark:text-zinc-200 leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap space-y-2 select-text font-normal">
                {aiResult}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
