import React from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';

interface AiAdvisorModalProps {
  isOpen: boolean;
  onClose: () => void;
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  aiResult: string | null;
  aiLoading: boolean;
  onAskAi: () => void;
}

export default function AiAdvisorModal({
  isOpen,
  onClose,
  aiPrompt,
  setAiPrompt,
  aiResult,
  aiLoading,
  onAskAi
}: AiAdvisorModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto text-[#F5F5F7]">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#0071E3]" /> Financial Insights Advisor
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[#86868B] hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <textarea
            rows={3}
            placeholder="Ask anything about your spending, loans, bank statements, or savings goals..."
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            className="w-full bg-[#2C2C2E] border border-white/10 rounded-2xl p-3.5 text-xs text-white focus:outline-none focus:border-[#0071E3]"
          />

          <div className="flex justify-between items-center gap-3">
            <span className="text-[11px] text-[#86868B]">Analyzes your saved ledger & budgets</span>
            <button
              onClick={onAskAi}
              disabled={aiLoading || !aiPrompt.trim()}
              className="bg-[#0071E3] hover:bg-[#0077ED] text-white px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {aiLoading ? 'Analyzing...' : 'Generate Insights'}
            </button>
          </div>

          {aiResult && (
            <div className="mt-4 p-4 bg-[#2C2C2E]/70 border border-white/5 rounded-2xl text-xs text-zinc-200 leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap">
              {aiResult}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
