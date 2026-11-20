# VoxGemini Studio — déploiement Cloudflare

Le projet est déjà relié au projet Supabase `ubhyyqigptldattyjbdw` (URL et clé publishable préconfigurées). **Ne mettez jamais la clé Supabase `service_role`/secret ou la clé Gemini dans le code, dans `wrangler.toml`, ni dans le navigateur.**

## Pré-requis
- Node.js LTS installé sur ordinateur
- Compte Cloudflare
- Projet Supabase déjà créé (VoxGemini Studio)

## 1. Créer le compte admin Supabase Auth
Dans Supabase > Authentication > Users > Add user, créez l'utilisateur `o.ataligbo@gmail.com` avec un mot de passe solide et confirmez son compte. N'utilisez pas un mot de passe déjà divulgué dans un chat. Désactivez les inscriptions publiques dans Authentication > Settings.

## 2. Déployer le Worker
Dans ce dossier de projet, ouvrez un terminal et exécutez :

```bash
npm install
npx wrangler login
npm run deploy
```

## 3. Ajouter les secrets Worker
Dans le même terminal, exécutez ces commandes et saisissez les secrets demandés :

```bash
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put MASTER_KEY
npx wrangler secret put SESSION_SECRET
```

- `SUPABASE_SERVICE_KEY` : clé secrète/service Supabase (server-only)
- `MASTER_KEY` : secret aléatoire long pour chiffrer la clé Gemini dans Supabase. Générer avec un gestionnaire de mots de passe ou `openssl rand -base64 32`.
- `SESSION_SECRET` : secret différent pour signer les sessions admin. Générer avec `openssl rand -base64 32`.

Après avoir ajouté les secrets, redéployez : `npm run deploy`.


## 4. Ouvrir l'administration
Cloudflare affichera l'URL Worker, du type `https://voxgemini-studio.<subdomain>.workers.dev`. Ouvrez `/admin`, connectez-vous avec l'utilisateur Auth créé à l'étape 1, ajoutez votre clé API Gemini, puis utilisez **Tester la clé** et **Enregistrer**.

## 5. Vérification
- `/api/health` doit renvoyer `{ "ok": true }`.
- `/admin` doit afficher l'écran de connexion.
- Après connexion, l'administration doit pouvoir afficher l'état de la clé et les statistiques.
- Testez la génération d'une voix après avoir enregistré une clé valide.

## Sécurité
- Le Worker ne doit jamais exposer `SUPABASE_SERVICE_KEY`, `MASTER_KEY`, `SESSION_SECRET` ou la clé Gemini au navigateur.
- L'admin est limité à l'e-mail configuré dans `wrangler.toml`.
- La clé Gemini est chiffrée côté Worker avant d'être stockée dans Supabase.
