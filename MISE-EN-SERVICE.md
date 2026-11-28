# Mise en service de FI espace — check-list (environ 30 minutes)

Tant que ces étapes ne sont pas faites, le site et les applications fonctionnent en **démonstration** (données fictives). Tout le reste est prêt.

## 1. Créer la base (Supabase, gratuit) — 5 min
1. Créer un compte sur [supabase.com](https://supabase.com) → **New project** : nom `fi-espace`, mot de passe de base (à conserver), région **Europe (Paris ou Francfort)**.
2. **Project Settings → API** : noter l’**URL du projet** et la clé **anon / publishable**. Ne jamais copier la clé `service_role` / `sb_secret_…` dans le site.

## 2. Installer la structure — 2 min
**SQL Editor → New query** : coller tout le fichier [`database/INSTALLATION-COMPLETE.sql`](database/INSTALLATION-COMPLETE.sql) → **Run**.
*(Facultatif : coller ensuite `database/tests/rls_checks.sql` → doit afficher « TOUS LES TESTS RLS SONT PASSÉS ».)*

## 3. Créer votre compte administrateur — 2 min
1. **Authentication → Users → Add user → Create new user** : votre e-mail, **votre** mot de passe, cocher **Auto Confirm User**.
2. **SQL Editor** :
   ```sql
   select public.bootstrap_first_admin('votre@adresse.fr', 'FI', 'Votre prénom');
   ```

## 4. Importer les membres réels — 1 min
**SQL Editor** : coller le fichier **`private/import-fi.sql`** (sur cet ordinateur uniquement, jamais publié) → **Run**. Les 27 membres, le planning, les suivis et le plan d’action sont importés.
*(Le nom d’organisation doit être le même qu’à l’étape 3 : « FI ». Pour un autre nom : `node scripts/seed-from-private.mjs "Autre nom"`.)*

## 5. Régler la connexion — 3 min
- **Authentication → Sign In / Providers** : Email activé, **décocher « Allow new users to sign up »**.
- **Authentication → URL Configuration** : Site URL = `https://inlights28.github.io/fi-espace/` ; Redirect URLs = la même adresse.
- **Authentication → Emails → SMTP** : brancher un envoi d’e-mails (Resend, Brevo…) pour les invitations ; l’envoi intégré de Supabase est limité à quelques e-mails par heure.

## 6. Déployer les fonctions serveur — 10 min
Dans un terminal, dans ce dossier :
```bash
npx supabase login
npx supabase link --project-ref VOTRE_REF_PROJET
npx supabase secrets set SITE_URL=https://inlights28.github.io/fi-espace/ ALLOWED_ORIGINS=https://inlights28.github.io,https://localhost,capacitor://localhost,http://localhost:5317
npx supabase functions deploy invite-user
npx supabase functions deploy send-reminders --no-verify-jwt
npx supabase functions deploy calendar-feed --no-verify-jwt
```
Rappels par e-mail : voir README, section « Rappels par e-mail » (clé Resend + planification horaire).

## 7. Brancher le site — 1 min
Remplir `config.js` (URL du projet + clé anon), puis publier :
```bash
git add config.js && git commit -m "Connexion Supabase" && git push
```
Le site se met à jour en une minute ; les applications de bureau suivent automatiquement. Les applications mobiles se mettent à jour à la version suivante (`git tag v1.0.3 && git push --tags`).

## 8. Inviter l’équipe
Se connecter sur le site → **Administration → Inviter une personne** : d’abord les responsables (rôle Responsable FI ou adjoint), puis chaque membre (rôle Membre, en choisissant sa fiche). Chacun reçoit un e-mail, choisit son mot de passe et retrouve son prochain rendez-vous et ses missions.

---

**Plus rapide :** faites les étapes 1 à 4 (copier-coller dans Supabase), lancez `npx supabase login` dans un terminal, puis donnez-moi l’URL du projet et la clé anon : je fais les étapes 6 et 7 (fonctions serveur, `config.js`, publication) et je vérifie la connexion.
