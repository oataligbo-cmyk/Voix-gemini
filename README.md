# VoxGemini Studio — version 3 (Cloudflare + Supabase)

Studio de voix off Gemini : voix off solo, profils de style vocal, dialogue multi-voix.
La clé Gemini n'est plus dans le navigateur : elle se colle dans `/admin`, elle est **chiffrée (AES-256-GCM)** puis stockée dans Supabase.

## Architecture
- **Cloudflare Workers** : sert le front (`dist/`) et l'API `/api/*` (`worker/index.js`, framework Hono).
- **Supabase** : table `settings` (clé chiffrée), table `usage` (journal), **Supabase Auth** (connexion admin).
- Le Worker est le seul à parler à Supabase (clé secrète) et à Google.

## Déploiement (une seule fois)

### 1. Supabase
1. Créer un projet sur supabase.com.
2. **SQL Editor** : coller et exécuter `supabase/schema.sql`.
3. **Authentication > Users > Add user** : ton e-mail + un mot de passe solide (cocher « Auto Confirm User »).
4. **Authentication > Sign In / Providers** : **désactiver « Allow new users to sign up »** (important).
5. **Project Settings > API Keys** : noter l'URL du projet, la clé **publishable** (publique) et la clé **secret** (jamais dans le code).

### 2. Configuration
Dans `wrangler.toml`, section `[vars]`, remplacer `SUPABASE_URL`, `SUPABASE_ANON_KEY` (= clé publishable) et `ADMIN_EMAIL` (= `o.ataligbo@gmail.com`, e-mail du compte créé à l'étape 1.3).
Réglages utiles : `PUBLIC_ACCESS` (`false` = réservé à l'admin connecté, `true` = ouvert à tous avec limites), `DAILY_LIMIT` (appels Gemini par jour), `ALLOWED_MODELS`.

### 3. Déployer
```bash
npm install
npx wrangler login
npm run deploy
npx wrangler secret put SUPABASE_SERVICE_KEY   # la clé secret Supabase
openssl rand -base64 32                         # génère une valeur, puis :
npx wrangler secret put MASTER_KEY              # colle la valeur (chiffrement de la clé Gemini)
openssl rand -base64 32
npx wrangler secret put SESSION_SECRET          # colle une 2e valeur (signature des sessions)
```
⚠️ Garde `MASTER_KEY` dans ton gestionnaire de mots de passe : si elle est perdue, il faudra ressaisir la clé Gemini dans `/admin`.

### 4. Configurer la clé Gemini
Ouvrir `https://<ton-worker>.workers.dev/admin`, se connecter, coller la clé Gemini (Google AI Studio), **Enregistrer**, puis **Tester la clé**.

## Développement local
```bash
cp .dev.vars.example .dev.vars    # remplir les valeurs
npm run dev                       # Vite sur :5173 + Worker sur :8787
```

## Sécurité en bref
- Clé Gemini : jamais dans le navigateur, jamais dans l'URL, chiffrée en base.
- Admin : cookie `HttpOnly` + `Secure` + `SameSite=Strict`, vérification de l'origine (CSRF), 5 tentatives de connexion/min/IP, un seul e-mail autorisé.
- Proxy : liste blanche de modèles et de champs (`contents`, `generationConfig`, `systemInstruction`), limites de taille, 8 requêtes/min/IP (Cloudflare), plafond quotidien, erreurs génériques.
- Pas de CORS ouvert : l'API répond uniquement au site lui-même.
- En-têtes (CSP avec `media-src blob:`, etc.) dans `public/_headers`.

## Modèles
Par défaut : `gemini-3.1-flash-tts-preview`, `gemini-2.5-flash-preview-tts` (voix), `gemini-3-flash-preview` et `gemini-flash-latest` (texte). Les noms évoluent : modifier `ALLOWED_MODELS` dans `wrangler.toml` sans toucher au code (et ajuster le menu dans `src/App.jsx`).
