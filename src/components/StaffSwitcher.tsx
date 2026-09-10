import { useState } from 'react';
import { User, X } from 'lucide-react';
import type { StaffMember } from '../types';

interface StaffSwitcherProps {
  staff: StaffMember[];
  mandatory: boolean;
  verifying: boolean;
  error: string | null;
  onVerify: (id: string, pin: string) => void;
  onClose: () => void;
}

// "Who is selling?" — PIN-checked identity switch. Shown mandatorily when
// staff logins exist and nobody is clocked in, or on demand from the till.
export default function StaffSwitcher({ staff, mandatory, verifying, error, onVerify, onClose }: StaffSwitcherProps) {
  const [selectedId, setSelectedId] = useState<string>(staff[0]?.id || '');
  const [pin, setPin] = useState('');

  const submit = () => {
    if (!selectedId || pin.length !== 4 || verifying) return;
    onVerify(selectedId, pin);
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[120] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
            <User className="w-4 h-4 text-gold-brand" /> Who is selling?
          </h3>
          {!mandatory && (
            <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-4 max-h-[32vh] overflow-y-auto">
          {staff.map((s) => (
            <button key={s.id} onClick={() => { setSelectedId(s.id); setPin(''); }}
              className={`h-14 rounded-xl border text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                selectedId === s.id
                  ? 'border-gold-brand bg-gold-brand/10 text-white'
                  : 'border-white/5 bg-[#0A0A0A] text-zinc-400 hover:text-zinc-200'
              }`}>
              <div>{s.name}</div>
              <div className={`text-[9px] mt-0.5 ${selectedId === s.id ? 'text-gold-brand' : 'text-zinc-600'}`}>
                {s.role === 'manager' ? 'Manager' : 'Cashier'}
              </div>
            </button>
          ))}
        </div>
        <input
          type="password" inputMode="numeric" maxLength={4} value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="4-digit PIN"
          className="w-full h-14 bg-[#0A0A0A] border border-white/10 rounded-xl text-center text-2xl font-black tracking-[0.5em] text-white outline-none focus:border-gold-brand mb-3"
        />
        {error && <p className="text-xs text-rose-400 font-bold text-center mb-3">{error}</p>}
        <button onClick={submit} disabled={verifying || pin.length !== 4}
          className="w-full h-12 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl hover:opacity-90 transition-all disabled:opacity-40 cursor-pointer">
          {verifying ? 'Checking…' : 'Start selling'}
        </button>
        {mandatory && (
          <p className="text-[10px] text-zinc-600 text-center mt-3">This till uses staff logins — pick who is selling to continue.</p>
        )}
      </div>
    </div>
  );
}
