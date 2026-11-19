import React, { useState } from 'react';
import { ShieldCheck, LogOut, Save, Sun, Moon } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';

interface SettingsPageProps {
  currentUserProfile: any;
  setCurrentUserProfile: (profile: any) => void;
  firebaseUser: any;
  db: any;
  currencies: Record<string, string>;
  onSignOut: () => void;
  theme?: 'light' | 'dark';
  setTheme?: (theme: 'light' | 'dark') => void;
}

export default function SettingsPage({
  currentUserProfile,
  setCurrentUserProfile,
  firebaseUser,
  db,
  currencies,
  onSignOut,
  theme = 'light',
  setTheme
}: SettingsPageProps) {
  const [name, setName] = useState(currentUserProfile?.name || firebaseUser.displayName || '');
  const [avatar, setAvatar] = useState(currentUserProfile?.avatar || '📊');
  const [currency, setCurrency] = useState(currentUserProfile?.currency || 'USD');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setSaving(true);
    setSuccessMsg('');
    try {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const updated = {
        name,
        avatar,
        currency
      };
      await updateDoc(userRef, updated);
      setCurrentUserProfile({ ...currentUserProfile, ...updated });
      setSuccessMsg('Profile preferences saved.');
    } catch (err) {
      console.error('Error updating profile:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl pb-12">
      <div>
        <span className="text-[12px] uppercase tracking-[0.04em] font-semibold text-[#86868B] block">
          ACCOUNT & PREFERENCES
        </span>
        <h2 className="text-2xl font-bold tracking-[-0.03em] text-[#1D1D1F] dark:text-white">Profile & Settings</h2>
      </div>

      <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.04] dark:border-white/10 rounded-3xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-xl space-y-6">
        {successMsg && (
          <div className="bg-[#34C759]/10 border border-[#34C759]/30 text-[#248A3D] dark:text-[#34C759] p-3 rounded-2xl text-xs font-medium">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="text-[11px] text-[#86868B] block mb-1">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-[#86868B] block mb-1">Avatar Emoji</label>
              <input
                type="text"
                maxLength={4}
                value={avatar}
                onChange={e => setAvatar(e.target.value)}
                className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-xl px-3 py-2 text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3] text-center text-lg"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#86868B] block mb-1">Primary Currency</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:border-[#0071E3]"
              >
                {Object.keys(currencies).map(cur => (
                  <option key={cur} value={cur} className="bg-white dark:bg-[#1C1C1E] text-[#1D1D1F] dark:text-white">
                    {cur} ({currencies[cur]})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {setTheme && (
            <div>
              <label className="text-[11px] text-[#86868B] block mb-1.5">Appearance Theme</label>
              <div className="inline-flex p-1 bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-full border border-black/[0.05] dark:border-white/10">
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition ${
                    theme === 'light'
                      ? 'bg-white text-[#1D1D1F] shadow-sm'
                      : 'text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5 text-[#FF9F0A]" /> Light Mode
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition ${
                    theme === 'dark'
                      ? 'bg-[#0071E3] text-white shadow-sm'
                      : 'text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" /> Dark Mode
                </button>
              </div>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white px-5 py-2.5 rounded-full text-xs font-semibold transition flex items-center gap-2 shadow-sm active:scale-[0.98]"
            >
              <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>

        <div className="pt-6 border-t border-black/[0.06] dark:border-white/10 space-y-4">
          <h3 className="text-xs font-semibold text-[#1D1D1F] dark:text-white">Account Security</h3>
          <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E]/60 p-4 rounded-2xl border border-black/[0.04] dark:border-white/5 text-xs space-y-1 text-[#86868B]">
            <p className="flex items-center gap-1.5 text-[#1D1D1F] dark:text-white font-medium">
              <ShieldCheck className="w-4 h-4 text-[#248A3D] dark:text-[#34C759]" /> Private Cloud Storage Active
            </p>
            <p>Signed in as: <span className="text-[#1D1D1F] dark:text-zinc-200 font-medium">{firebaseUser.email}</span></p>
          </div>

          <button
            onClick={onSignOut}
            className="bg-[#FF3B30]/10 hover:bg-[#FF3B30]/20 text-[#D70015] dark:text-[#FF3B30] border border-[#FF3B30]/25 px-4 py-2 rounded-full text-xs font-semibold transition flex items-center gap-2 active:scale-[0.98]"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
