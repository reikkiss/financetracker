import React from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';

interface TransactionsPageProps {
  transactions: any[];
  currencySymbol?: string;
  onOpenAddTx: (type: 'income' | 'expense') => void;
  onOpenEditTx: (transaction: any) => void;
  onDeleteTx: (id: string) => void;
}

export default function TransactionsPage({
  transactions,
  currencySymbol = '$',
  onOpenAddTx,
  onOpenEditTx,
  onDeleteTx
}: TransactionsPageProps) {
  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">All Database Transactions</h2>
          <p className="text-xs text-[#9b9b9b]">Full ledger stored securely in seashore.</p>
        </div>
        <button onClick={() => onOpenAddTx('expense')} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shadow-sm">
          <Plus className="w-4 h-4" /> Add Transaction
        </button>
      </div>

      <div className="bg-[#202020] border border-[#282828] rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#1c1c1c] border-b border-[#282828] text-[#9b9b9b]">
            <tr>
              <th className="p-3.5 font-medium">Title</th>
              <th className="p-3.5 font-medium">Category</th>
              <th className="p-3.5 font-medium">Type</th>
              <th className="p-3.5 font-medium">Date</th>
              <th className="p-3.5 font-medium text-right">Amount</th>
              <th className="p-3.5 font-medium text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#262626]">
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-[#777]">No transactions recorded in database.</td>
              </tr>
            ) : (
              transactions.map(t => (
                <tr key={t.id} className="hover:bg-[#252525] transition group">
                  <td className="p-3.5 font-medium text-white">{t.title}</td>
                  <td className="p-3.5"><span className="bg-[#292929] text-zinc-300 px-2 py-0.5 rounded text-[11px]">{t.category}</span></td>
                  <td className="p-3.5 uppercase font-medium text-[10px]">
                    <span className={t.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}>{t.type}</span>
                  </td>
                  <td className="p-3.5 text-[#9b9b9b]">{t.date}</td>
                  <td className={`p-3.5 text-right font-bold ${t.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toFixed(2)}
                  </td>
                  <td className="p-3.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => onOpenEditTx(t)}
                        className="text-[#888] hover:text-blue-400 p-1.5 rounded hover:bg-[#333] transition"
                        title="Edit transaction"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeleteTx(t.id)}
                        className="text-[#888] hover:text-rose-400 p-1.5 rounded hover:bg-[#333] transition"
                        title="Delete transaction"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
