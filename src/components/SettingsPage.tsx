import React, { useState } from 'react';
import { ShieldCheck, LogOut, Save } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';

interface SettingsPageProps {
  currentUserProfile: any;
  setCurrentUserProfile: (profile: any) => void;
  firebaseUser: any;
  db: any;
  currencies: Record<string, string>;
  onSignOut: () => void;
}

export default function SettingsPage({
  currentUserProfile,
  setCurrentUserProfile,
  firebaseUser,
  db,
  currencies,
  onSignOut
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
      setSuccessMsg('Profile updated successfully in seashore database!');
    } catch (err) {
      console.error('Error updating profile:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-2xl pb-12">
      <div>
        <h2 className="text-lg font-bold text-white">Profile & Settings</h2>
        <p className="text-xs text-[#9b9b9b]">Update your personal workspace settings and currency preferences in seashore.</p>
      </div>

      <div className="bg-[#202020] border border-[#282828] rounded-2xl p-6 shadow-sm space-y-6">
        {successMsg && (
          <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-400 p-3 rounded-xl text-xs">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="text-[11px] text-[#9b9b9b] block mb-1">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-[#9b9b9b] block mb-1">Avatar / Profile Emoji</label>
              <input
                type="text"
                maxLength={4}
                value={avatar}
                onChange={e => setAvatar(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none text-center text-lg"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#9b9b9b] block mb-1">Currency</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
              >
                {Object.keys(currencies).map(cur => (
                  <option key={cur} value={cur}>{cur} ({currencies[cur]})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-xs font-medium transition flex items-center gap-2 shadow-sm"
            >
              <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Profile Changes'}
            </button>
          </div>
        </form>

        <div className="pt-6 border-t border-[#2a2a2a] space-y-4">
          <h3 className="text-xs font-semibold text-white">Database & Security</h3>
          <div className="bg-[#191919] p-4 rounded-xl border border-[#2a2a2a] text-xs space-y-1 text-[#9b9b9b]">
            <p className="flex items-center gap-1.5 text-white">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Firebase Firestore Database: <span className="font-mono text-emerald-400">seashore</span>
            </p>
            <p>Authenticated User UID: <span className="font-mono text-zinc-300">{firebaseUser.uid}</span></p>
            <p>Email: {firebaseUser.email}</p>
          </div>

          <button
            onClick={onSignOut}
            className="bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-800 px-4 py-2 rounded-lg text-xs font-medium transition flex items-center gap-2"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out of Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
