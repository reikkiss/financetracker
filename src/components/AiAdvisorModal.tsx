import React from 'react';
import { X, Sparkles, Loader2, AlertCircle } from 'lucide-react';

interface AiAdvisorModalProps {
  isOpen: boolean;
  onClose: () => void;
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  aiResult: string | null;
  aiError?: string | null;
  aiLoading: boolean;
  onAskAi: (overridePrompt?: string) => void;
}

const QUICK_PROMPTS = [
  'Resumen de mi salud financiera este mes',
  '¿Cómo optimizar el uso y fechas de corte de mis tarjetas?',
  '¿En qué categorías estoy gastando más y dónde recortar?',
  'Analyze my cashflow & credit utilization'
];

export default function AiAdvisorModal({
  isOpen,
  onClose,
  aiPrompt,
  setAiPrompt,
  aiResult,
  aiError,
  aiLoading,
  onAskAi
}: AiAdvisorModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-6 w-full max-w-xl space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#1D1D1F] dark:text-[#F5F5F7]">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#0071E3]" /> Financial Insights Advisor
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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
              className="px-3 py-1 rounded-full text-[11px] font-medium bg-[#F2F2F7] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:hover:bg-white/15 text-[#1D1D1F] dark:text-zinc-200 transition disabled:opacity-50 text-left"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <textarea
            rows={3}
            placeholder="Ask anything about your spending, credit card cycles, loans, or savings goals..."
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && aiPrompt.trim() && !aiLoading) {
                e.preventDefault();
                onAskAi();
              }
            }}
            className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-2xl p-3.5 text-xs text-[#1D1D1F] dark:text-white placeholder:text-[#86868B] focus:outline-none focus:border-[#0071E3]"
          />

          <div className="flex justify-between items-center gap-3">
            <span className="text-[11px] text-[#86868B]">Analyzes your saved accounts, cycles & transactions</span>
            <button
              type="button"
              onClick={() => onAskAi()}
              disabled={aiLoading || !aiPrompt.trim()}
              className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 shrink-0 whitespace-nowrap"
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {aiLoading ? 'Analyzing...' : 'Generate Insights'}
            </button>
          </div>

          {aiError && (
            <div className="p-3.5 bg-[#FF3B30]/10 border border-[#FF3B30]/25 rounded-2xl text-xs text-[#D70015] dark:text-[#FF3B30] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{aiError}</span>
            </div>
          )}

          {aiResult && (
            <div className="mt-2 p-4 bg-[#F5F5F7] dark:bg-[#2C2C2E]/70 border border-black/[0.04] dark:border-white/5 rounded-2xl text-xs text-[#1D1D1F] dark:text-zinc-200 leading-relaxed max-h-80 overflow-y-auto whitespace-pre-wrap">
              {aiResult}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
