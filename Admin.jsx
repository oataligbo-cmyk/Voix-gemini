import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, LogOut, Loader2, CheckCircle2, AlertCircle, Trash2, ArrowLeft } from 'lucide-react';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Erreur (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const card = 'bg-slate-900 border border-slate-800 rounded-2xl p-5';
const input = 'w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500';
const btn = 'px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2';

export default function Admin() {
  const [phase, setPhase] = useState('loading'); // loading | login | panel
  const [notice, setNotice] = useState(null); // { type: 'ok' | 'error', text }
  const [busy, setBusy] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [keyInfo, setKeyInfo] = useState(null);
  const [usage, setUsage] = useState(null);
  const [newKey, setNewKey] = useState('');

  const say = (type, text) => setNotice({ type, text });

  const loadPanel = useCallback(async () => {
    try {
      const [k, u] = await Promise.all([api('/api/admin/key'), api('/api/admin/usage')]);
      setKeyInfo(k);
      setUsage(u);
      setPhase('panel');
    } catch (e) {
      if (e.status === 401) setPhase('login');
      else { say('error', e.message); setPhase('panel'); }
    }
  }, []);

  useEffect(() => {
    api('/api/admin/me')
      .then((d) => (d.authenticated ? loadPanel() : setPhase('login')))
      .catch(() => setPhase('login'));
  }, [loadPanel]);

  const run = async (name, fn) => {
    setBusy(name);
    setNotice(null);
    try { await fn(); } catch (e) {
      if (e.status === 401 && name !== 'login') setPhase('login');
      say('error', e.message);
    } finally { setBusy(''); }
  };

  const login = (e) => {
    e.preventDefault();
    run('login', async () => {
      await api('/api/admin/login', { method: 'POST', body: { email, password } });
      setPassword('');
      await loadPanel();
    });
  };

  const logout = () => run('logout', async () => {
    await api('/api/admin/logout', { method: 'POST' });
    setPhase('login');
  });

  const saveKey = () => run('save', async () => {
    await api('/api/admin/key', { method: 'PUT', body: { apiKey: newKey.trim() } });
    setNewKey('');
    say('ok', 'Clé enregistrée (chiffrée).');
    await loadPanel();
  });

  const testKey = () => run('test', async () => {
    const r = await api('/api/admin/key/test', { method: 'POST', body: newKey.trim() ? { apiKey: newKey.trim() } : {} });
    say(r.ok ? 'ok' : 'error', r.ok ? 'Clé valide : Google l’accepte.' : `Clé refusée : ${r.message}`);
  });

  const removeKey = () => {
    if (!window.confirm('Supprimer la clé enregistrée ? Le studio cessera de fonctionner tant qu’aucune clé n’est configurée.')) return;
    run('delete', async () => {
      await api('/api/admin/key', { method: 'DELETE' });
      say('ok', 'Clé supprimée.');
      await loadPanel();
    });
  };

  const sourceLabel = { database: 'enregistrée dans la base (chiffrée)', env: 'variable d’environnement du serveur', none: 'aucune' };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="max-w-xl mx-auto px-4 py-10 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">
            <ShieldCheck className="w-5 h-5 text-emerald-400" /> Administration VoxGemini
          </h1>
          <a href="/" className="text-xs text-slate-400 hover:text-white flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Studio</a>
        </div>

        {notice && (
          <div className={`p-3 rounded-xl text-sm flex items-start gap-2 border ${notice.type === 'ok'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-200'}`}>
            {notice.type === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}

        {phase === 'loading' && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>}

        {phase === 'login' && (
          <form onSubmit={login} className={`${card} space-y-3`}>
            <h2 className="text-sm font-semibold text-white">Connexion</h2>
            <input className={input} type="email" autoComplete="username" placeholder="E-mail administrateur" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className={input} type="password" autoComplete="current-password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit" disabled={busy === 'login'} className={`${btn} w-full bg-indigo-600 hover:bg-indigo-500 text-white`}>
              {busy === 'login' && <Loader2 className="w-4 h-4 animate-spin" />} Se connecter
            </button>
          </form>
        )}

        {phase === 'panel' && (
          <>
            <div className={`${card} space-y-4`}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><KeyRound className="w-4 h-4 text-indigo-400" /> Clé API Gemini</h2>
              <p className="text-sm text-slate-400">
                État : {keyInfo?.configured
                  ? <span className="text-emerald-300">configurée — {sourceLabel[keyInfo.source]}{keyInfo.hint ? ` · ••••••••${keyInfo.hint}` : ''}</span>
                  : <span className="text-amber-300">aucune clé</span>}
                {keyInfo?.updatedAt && <span className="block text-xs text-slate-500 mt-1">Dernière modification : {new Date(keyInfo.updatedAt).toLocaleString('fr-FR')}</span>}
              </p>
              <input className={input} type="password" autoComplete="off" spellCheck="false" placeholder="Coller une nouvelle clé API Gemini" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button onClick={saveKey} disabled={!newKey.trim() || busy === 'save'} className={`${btn} bg-indigo-600 hover:bg-indigo-500 text-white`}>
                  {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
                </button>
                <button onClick={testKey} disabled={busy === 'test' || (!newKey.trim() && !keyInfo?.configured)} className={`${btn} bg-slate-800 hover:bg-slate-700 text-white`}>
                  {busy === 'test' && <Loader2 className="w-4 h-4 animate-spin" />} Tester la clé
                </button>
                {keyInfo?.source === 'database' && (
                  <button onClick={removeKey} disabled={busy === 'delete'} className={`${btn} bg-rose-500/15 hover:bg-rose-500/25 text-rose-300`}>
                    <Trash2 className="w-4 h-4" /> Supprimer
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500">La clé est chiffrée avant d’être stockée et n’est jamais renvoyée au navigateur. « Tester » vérifie la clé saisie, ou à défaut la clé enregistrée.</p>
            </div>

            {usage && (
              <div className={`${card} space-y-2`}>
                <h2 className="text-sm font-semibold text-white">Utilisation</h2>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div><div className="text-xl font-bold text-white">{usage.today}{usage.dailyLimit ? <span className="text-xs text-slate-500"> / {usage.dailyLimit}</span> : null}</div><div className="text-[11px] text-slate-500">aujourd’hui (UTC)</div></div>
                  <div><div className="text-xl font-bold text-white">{usage.last7days}</div><div className="text-[11px] text-slate-500">7 derniers jours</div></div>
                  <div><div className="text-xl font-bold text-white">{usage.errors7days}</div><div className="text-[11px] text-slate-500">erreurs (7 j)</div></div>
                </div>
                {Object.keys(usage.byModel).length > 0 && (
                  <ul className="text-xs text-slate-400 pt-2 space-y-1">
                    {Object.entries(usage.byModel).map(([m, n]) => <li key={m} className="flex justify-between"><span>{m}</span><span>{n}</span></li>)}
                  </ul>
                )}
              </div>
            )}

            <button onClick={logout} disabled={busy === 'logout'} className={`${btn} bg-slate-900 border border-slate-800 text-slate-300 hover:text-white`}>
              <LogOut className="w-4 h-4" /> Se déconnecter
            </button>
          </>
        )}
      </div>
    </div>
  );
}
