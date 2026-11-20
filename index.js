import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODELS = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-3-flash-preview',
  'gemini-flash-latest'
];
const SESSION_COOKIE = 'vox_session';
const SESSION_TTL = 8 * 3600; // 8 h
const MAX_BODY = 12 * 1024 * 1024;
const MAX_TEXT = 16_000;
const MAX_INLINE = 8_000_000; // base64 d'un échantillon audio de 5 Mo ≈ 6,7 M caractères
const GEN_CONFIG_KEYS = ['responseModalities', 'speechConfig', 'responseMimeType', 'responseSchema', 'temperature'];

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------- Utilitaires ---------- */
const fail = (c, status, message) => c.json({ error: { message } }, status);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clientIp = (c) => c.req.header('CF-Connecting-IP') || 'local';
const isHttps = (c) => new URL(c.req.url).protocol === 'https:';

const b64 = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (ch) => ch.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

function getModels(env) {
  const custom = (env.ALLOWED_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(custom.length ? custom : DEFAULT_MODELS);
}

async function limited(binding, key) {
  if (!binding) return false; // binding absent (ex. test local) : pas de limite
  const { success } = await binding.limit({ key });
  return !success;
}

async function ipHash(env, ip) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${ip}|${env.MASTER_KEY || ''}`));
  return Array.from(new Uint8Array(digest).slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- Session admin (cookie signé HMAC) ---------- */
const adminEmail = (env) => (env.ADMIN_EMAIL || '').trim().toLowerCase();
const hmacKey = (secret, usages) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);

async function signSession(env, email) {
  const payload = b64url(enc.encode(JSON.stringify({ sub: email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET, ['sign']), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

async function readSession(c) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !c.env.SESSION_SECRET) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC', await hmacKey(c.env.SESSION_SECRET, ['verify']), unb64url(sig), enc.encode(payload)
    );
    if (!ok) return null;
    const data = JSON.parse(dec.decode(unb64url(payload)));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    if (data.sub !== adminEmail(c.env)) return null;
    return data;
  } catch {
    return null;
  }
}

/* ---------- Chiffrement de la clé API (AES-256-GCM) ---------- */
async function aesKey(env, usages) {
  const raw = unb64((env.MASTER_KEY || '').trim());
  if (raw.length !== 32) throw new Error('MASTER_KEY doit contenir 32 octets (base64).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
}
async function encryptSecret(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env, ['encrypt']), enc.encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64(out);
}
async function decryptSecret(env, stored) {
  const buf = unb64(stored);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, await aesKey(env, ['decrypt']), buf.slice(12));
  return dec.decode(pt);
}

/* ---------- Supabase (API REST, clé secrète côté Worker uniquement) ---------- */
function sb(env, path, init = {}) {
  const key = env.SUPABASE_SERVICE_KEY || '';
  const headers = { apikey: key, 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // ancienne clé service_role (JWT)
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

async function readSettings(env) {
  const res = await sb(env, 'settings?select=key,value,updated_at&key=in.(gemini_key_enc,gemini_key_hint)');
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const map = {};
  for (const row of await res.json()) map[row.key] = row;
  return map;
}

async function countSince(env, sinceIso) {
  const res = await sb(env, `usage?select=id&created_at=gte.${encodeURIComponent(sinceIso)}`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' }
  });
  const total = Number((res.headers.get('content-range') || '').split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

async function logUsage(env, row) {
  try {
    await sb(env, 'usage', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  } catch (e) {
    console.error('usage log failed', e.message);
  }
}

/* ---------- Clé Gemini : base de données d'abord, variable d'environnement en secours ---------- */
let keyCache = { value: '', at: 0 };
async function resolveApiKey(env) {
  if (keyCache.value && Date.now() - keyCache.at < 60_000) return keyCache.value;
  let key = '';
  try {
    const s = await readSettings(env);
    if (s.gemini_key_enc) key = await decryptSecret(env, s.gemini_key_enc.value);
  } catch (e) {
    console.error('key lookup failed:', e.message);
  }
  if (!key) key = (env.GEMINI_API_KEY || '').trim();
  if (key) keyCache = { value: key, at: Date.now() };
  return key;
}

async function testGeminiKey(key) {
  try {
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=1`, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(15_000)
    });
    if (res.ok) return { ok: true, message: 'Clé valide.' };
    const data = await res.json().catch(() => ({}));
    return { ok: false, message: data?.error?.message || `Clé refusée (${res.status}).` };
  } catch {
    return { ok: false, message: 'Impossible de joindre Google.' };
  }
}

const validKey = (k) => typeof k === 'string' && /^[A-Za-z0-9._-]{20,256}$/.test(k);

/* ---------- Validation du corps envoyé à Gemini (liste blanche des champs) ---------- */
function sanitizeBody(body) {
  const invalid = { error: 'Corps de requête invalide.' };
  if (!isObj(body) || !Array.isArray(body.contents) || body.contents.length === 0 || body.contents.length > 20) return invalid;

  let textLen = 0;
  let inlineLen = 0;
  const clean = { contents: [] };

  for (const content of body.contents) {
    if (!isObj(content) || !Array.isArray(content.parts) || content.parts.length === 0 || content.parts.length > 10) return invalid;
    if (content.role !== undefined && !['user', 'model'].includes(content.role)) return invalid;
    const parts = [];
    for (const part of content.parts) {
      if (!isObj(part)) return invalid;
      if (typeof part.text === 'string') {
        textLen += part.text.length;
        parts.push({ text: part.text });
      } else if (
        isObj(part.inlineData) &&
        typeof part.inlineData.data === 'string' &&
        /^audio\/[\w.+-]+/.test(String(part.inlineData.mimeType))
      ) {
        inlineLen += part.inlineData.data.length;
        parts.push({ inlineData: { mimeType: String(part.inlineData.mimeType).slice(0, 100), data: part.inlineData.data } });
      } else {
        return invalid;
      }
    }
    clean.contents.push(content.role ? { role: content.role, parts } : { parts });
  }

  if (body.systemInstruction !== undefined) {
    const si = body.systemInstruction;
    if (!isObj(si) || !Array.isArray(si.parts) || si.parts.length > 5 || !si.parts.every((p) => isObj(p) && typeof p.text === 'string')) return invalid;
    si.parts.forEach((p) => { textLen += p.text.length; });
    clean.systemInstruction = { parts: si.parts.map((p) => ({ text: p.text })) };
  }

  if (body.generationConfig !== undefined) {
    if (!isObj(body.generationConfig)) return invalid;
    const gc = {};
    for (const k of GEN_CONFIG_KEYS) if (body.generationConfig[k] !== undefined) gc[k] = body.generationConfig[k];
    if (JSON.stringify(gc).length > 20_000) return invalid;
    clean.generationConfig = gc;
  }

  if (textLen > MAX_TEXT) return { error: 'Le texte dépasse la limite autorisée.', status: 413 };
  if (inlineLen > MAX_INLINE) return { error: 'L’échantillon audio est trop volumineux.', status: 413 };
  return { clean, chars: textLen };
}

function mapUpstreamError(status) {
  if (status === 400) return [400, 'Gemini a refusé la requête (paramètres invalides).'];
  if (status === 401 || status === 403) return [502, 'Clé API Gemini invalide ou non autorisée. Contactez l’administrateur.'];
  if (status === 429) return [429, 'Quota Gemini atteint. Réessayez plus tard.'];
  return [502, 'Le service Gemini est indisponible. Réessayez.'];
}

/* ---------- Application ---------- */
const app = new Hono();

app.use('/api/*', secureHeaders());
app.use('/api/*', async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
});

// Protection CSRF : toute requête qui modifie quelque chose doit venir de notre propre site.
app.use('/api/*', async (c, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
    const allowed = new Set([new URL(c.req.url).origin]);
    (c.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((o) => allowed.add(o));
    if (!allowed.has(c.req.header('Origin') || '')) return fail(c, 403, 'Origine non autorisée.');
  }
  await next();
});

// Toutes les routes /api/admin/* exigent une session, sauf login / me / logout.
app.use('/api/admin/*', async (c, next) => {
  const p = new URL(c.req.url).pathname;
  if (['/api/admin/login', '/api/admin/me', '/api/admin/logout'].includes(p)) return next();
  if (!(await readSession(c))) return fail(c, 401, 'Session expirée. Reconnectez-vous.');
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/status', async (c) => {
  const session = await readSession(c);
  const key = await resolveApiKey(c.env);
  return c.json({ ready: Boolean(key), generationAllowed: c.env.PUBLIC_ACCESS === 'true' || Boolean(session) });
});

/* --- Admin : session --- */
app.post('/api/admin/login', async (c) => {
  if (await limited(c.env.LIMITER_LOGIN, clientIp(c))) return fail(c, 429, 'Trop de tentatives. Réessayez dans une minute.');
  let body;
  try { body = await c.req.json(); } catch { return fail(c, 400, 'Requête invalide.'); }
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!email || !password || password.length > 200) return fail(c, 400, 'Requête invalide.');

  const denied = () => fail(c, 401, 'Identifiants invalides.');
  if (!adminEmail(c.env) || email !== adminEmail(c.env)) return denied();

  const res = await fetch(`${c.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: c.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) return denied();

  setCookie(c, SESSION_COOKIE, await signSession(c.env, email), {
    httpOnly: true, secure: isHttps(c), sameSite: 'Strict', path: '/', maxAge: SESSION_TTL
  });
  return c.json({ ok: true });
});

app.get('/api/admin/me', async (c) => c.json({ authenticated: Boolean(await readSession(c)) }));

app.post('/api/admin/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/* --- Admin : clé API --- */
app.get('/api/admin/key', async (c) => {
  const s = await readSettings(c.env);
  const inDb = Boolean(s.gemini_key_enc);
  const inEnv = Boolean((c.env.GEMINI_API_KEY || '').trim());
  return c.json({
    configured: inDb || inEnv,
    source: inDb ? 'database' : inEnv ? 'env' : 'none',
    hint: s.gemini_key_hint?.value || null,
    updatedAt: s.gemini_key_enc?.updated_at || null
  });
});

app.put('/api/admin/key', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return fail(c, 400, 'Requête invalide.'); }
  const apiKey = String(body?.apiKey || '').trim();
  if (!validKey(apiKey)) return fail(c, 400, 'Format de clé invalide.');

  const now = new Date().toISOString();
  const res = await sb(c.env, 'settings?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([
      { key: 'gemini_key_enc', value: await encryptSecret(c.env, apiKey), updated_at: now },
      { key: 'gemini_key_hint', value: apiKey.slice(-4), updated_at: now }
    ])
  });
  if (!res.ok) {
    console.error('settings upsert failed', res.status, await res.text());
    return fail(c, 502, 'Enregistrement impossible (base de données).');
  }
  keyCache = { value: '', at: 0 };
  return c.json({ ok: true, hint: apiKey.slice(-4) });
});

app.delete('/api/admin/key', async (c) => {
  const res = await sb(c.env, 'settings?key=in.(gemini_key_enc,gemini_key_hint)', { method: 'DELETE' });
  if (!res.ok) return fail(c, 502, 'Suppression impossible (base de données).');
  keyCache = { value: '', at: 0 };
  return c.json({ ok: true });
});

app.post('/api/admin/key/test', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch { /* corps vide accepté : on teste la clé enregistrée */ }
  let key = '';
  if (body?.apiKey) {
    key = String(body.apiKey).trim();
    if (!validKey(key)) return fail(c, 400, 'Format de clé invalide.');
  } else {
    key = await resolveApiKey(c.env);
    if (!key) return fail(c, 400, 'Aucune clé enregistrée.');
  }
  return c.json(await testGeminiKey(key));
});

app.get('/api/admin/usage', async (c) => {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const res = await sb(c.env, `usage?select=created_at,model,ok&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=5000`);
  if (!res.ok) return fail(c, 502, 'Lecture impossible (base de données).');
  const rows = await res.json();
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const byModel = {};
  let today = 0, errors = 0;
  for (const r of rows) {
    byModel[r.model] = (byModel[r.model] || 0) + 1;
    if (!r.ok) errors++;
    if (new Date(r.created_at) >= startOfDay) today++;
  }
  return c.json({ today, last7days: rows.length, errors7days: errors, byModel, dailyLimit: Number(c.env.DAILY_LIMIT || 0) });
});

/* --- Proxy Gemini --- */
app.post('/api/gemini/:model', async (c) => {
  const env = c.env;
  const model = c.req.param('model');
  if (!getModels(env).has(model)) return fail(c, 400, 'Modèle non autorisé.');

  if (env.PUBLIC_ACCESS !== 'true' && !(await readSession(c))) {
    return fail(c, 401, 'Accès réservé : connectez-vous sur /admin.');
  }
  if (await limited(env.LIMITER_GEN, clientIp(c))) return fail(c, 429, 'Trop de requêtes. Réessayez dans une minute.');

  if (Number(c.req.header('content-length') || 0) > MAX_BODY) return fail(c, 413, 'La requête est trop volumineuse.');
  let body;
  try {
    const raw = await c.req.text();
    if (raw.length > MAX_BODY) return fail(c, 413, 'La requête est trop volumineuse.');
    body = JSON.parse(raw);
  } catch {
    return fail(c, 400, 'Requête invalide.');
  }
  const checked = sanitizeBody(body);
  if (checked.error) return fail(c, checked.status || 400, checked.error);

  const dailyLimit = Number(env.DAILY_LIMIT || 0);
  if (dailyLimit > 0) {
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await countSince(env, startOfDay.toISOString()).catch(() => 0);
    if (used >= dailyLimit) return fail(c, 429, 'Limite quotidienne atteinte. Réessayez demain.');
  }

  const apiKey = await resolveApiKey(env);
  if (!apiKey) return fail(c, 503, 'Service non configuré. Contactez l’administrateur.');

  const log = async (ok, status) =>
    c.executionCtx.waitUntil(logUsage(env, { model, ok, status, chars: checked.chars, ip_hash: await ipHash(env, clientIp(c)) }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const upstream = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(checked.clean),
      signal: controller.signal
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      await log(false, upstream.status);
      const [status, message] = mapUpstreamError(upstream.status);
      return fail(c, status, message);
    }
    await log(true, 200);
    return new Response(upstream.body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const timeout = e?.name === 'AbortError';
    await log(false, timeout ? 504 : 502);
    return timeout
      ? fail(c, 504, 'Gemini met trop de temps à répondre. Réessayez.')
      : fail(c, 502, 'Impossible de joindre le service Gemini.');
  } finally {
    clearTimeout(timer);
  }
});

app.notFound((c) => fail(c, 404, 'Introuvable.'));
app.onError((err, c) => {
  console.error('unhandled', err?.message);
  return fail(c, 500, 'Erreur interne.');
});

export default app;
