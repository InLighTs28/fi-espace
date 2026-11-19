# FI espace — application de coordination

Application web responsive pour la coordination d’une FI, réservée aux responsables. Direction artistique chrétienne sobre (vert profond, ivoire, doré, croix discrète, citation courte) avec des animations légères, désactivées si le système demande de réduire les animations.

## Deux modes de fonctionnement

| Mode | Quand | Données | Sécurité |
|---|---|---|---|
| **Démonstration** | `config.js` vide, ou `?demo` ajouté à l’URL | Fictives, en mémoire, perdues au rechargement | Aucune : le sélecteur de rôle n’est qu’un aperçu |
| **Connecté** | `config.js` rempli avec l’URL et la clé publique Supabase | Base PostgreSQL Supabase | Connexion obligatoire, droits vérifiés par la base (RLS) à chaque requête |

Toutes les personnes, dates et statistiques du mode démonstration sont **inventées**.

## Fichiers

```
index.html                         Interface (structure + styles de base)
theme.css                          Direction artistique, animations, mobile, écran de connexion
app.js                             Logique : authentification, chargement des données, formulaires
config.example.js                  Modèle de configuration publique (à copier en config.js)
config.js                          Configuration active (vide = mode démonstration)
database/001_schema.sql            Tables, rôles, politiques RLS par organisation et par rôle
database/002_auth_invitations.sql  Comptes invités, annuaire interne, intégrité, durcissement
database/tests/rls_checks.sql      Vérification automatique des droits de chaque rôle (annulée en fin d’exécution)
supabase/functions/invite-user/    Fonction serveur d’invitation (seul endroit utilisant la clé secrète)
```

## Qui peut faire quoi (appliqué par la base)

| | Administrateur | Responsable FI | Responsable adjoint |
|---|:-:|:-:|:-:|
| Planning (lecture) | ✓ | ✓ | ✓ |
| Planning (création, modification) | ✓ | ✓ | — |
| Membres, présences, suivis | ✓ | ✓ | — |
| Tâches : toutes, création, attribution | ✓ | ✓ | — |
| Tâches attribuées : lecture + **avancement uniquement** | ✓ | ✓ | ✓ |
| Comptes : inviter, changer un rôle, retirer l’accès | ✓ | — | — |

Garanties supplémentaires ajoutées par `002` :
- aucune lecture possible sans connexion (droits du rôle `anon` retirés) ;
- un compte désactivé perd immédiatement l’accès ;
- impossible de lier une présence, une tâche, un référent ou un suivi à une autre organisation ou à un compte révoqué ;
- l’auteur (`created_by`, `recorded_by`) est fixé par le serveur ;
- une organisation garde toujours au moins un administrateur actif ;
- longueur des textes limitée (pas de notes détaillées) ; l’e-mail des comptes n’est visible que des administrateurs.

## Mise en service

### 1. Créer le projet Supabase
Sur [supabase.com](https://supabase.com), créer un projet (région UE conseillée). Noter dans **Project Settings → API** :
- l’**URL du projet** (`https://xxxx.supabase.co`) ;
- la clé **anon public** (ou **publishable**, `sb_publishable_…`).

La clé **service_role** (ou `sb_secret_…`) ne doit jamais être copiée dans un fichier du site. Si `config.js` contient une telle clé, l’application refuse de démarrer.

### 2. Régler l’authentification
**Authentication → Sign In / Providers** :
- Email : activé ; **désactiver « Allow new users to sign up »** : seuls les comptes invités pourront exister.

**Authentication → URL Configuration** :
- **Site URL** : l’adresse publique du site (ex. `https://fi.exemple.org`) ;
- **Redirect URLs** : la même adresse (et `http://localhost:5317` pour tester en local).

**Authentication → Emails** : personnaliser au besoin les modèles « Invite user » et « Reset password » (en français). Pour un usage réel, configurer un **SMTP personnalisé** (Authentication → Emails → SMTP), car l’envoi intégré de Supabase est très limité.

### 3. Appliquer le schéma
Dans **SQL Editor**, exécuter dans l’ordre :
1. `database/001_schema.sql`
2. `database/002_auth_invitations.sql`
3. *(conseillé)* `database/tests/rls_checks.sql` : doit afficher `TOUS LES TESTS RLS SONT PASSÉS`. Le script crée des comptes et données fictifs dans une transaction, puis annule tout (`ROLLBACK`).

### 4. Créer le premier administrateur
1. **Authentication → Users → Add user → Send invitation** (ou *Create new user*) avec votre adresse.
2. Copier l’UUID du compte créé, puis dans **SQL Editor** :

   ```sql
   insert into public.organizations (name) values ('Nom de votre FI') returning id;

   -- Avec l'ID renvoyé ci-dessus et l'UUID de votre compte :
   insert into public.user_roles (user_id, organization_id, role, display_name, email)
   values ('UUID_DU_COMPTE', 'UUID_ORGANISATION', 'admin', 'Votre prénom', 'votre@adresse');
   ```

Les responsables suivants s’invitent depuis l’application (**Administration → Inviter**).

### 5. Déployer la fonction d’invitation
Avec la [CLI Supabase](https://supabase.com/docs/guides/cli), depuis ce dossier :

```bash
supabase login
supabase link --project-ref VOTRE_REF_PROJET
supabase secrets set SITE_URL=https://fi.exemple.org ALLOWED_ORIGINS=https://fi.exemple.org,http://localhost:5317
supabase functions deploy invite-user
```

(Si la CLI demande un `supabase/config.toml`, lancer d’abord `supabase init` en conservant le dossier `supabase/functions` existant.)

Sans CLI, possible aussi depuis le tableau de bord : **Edge Functions → Deploy a new function → Via editor**, nommer la fonction `invite-user`, coller `supabase/functions/invite-user/index.ts`, puis ajouter les secrets `SITE_URL` et `ALLOWED_ORIGINS` dans **Edge Functions → Secrets**. Laisser **« Verify JWT »** activé.

La fonction vérifie la session de l’appelant, demande à la base s’il est administrateur de l’organisation (`is_fi_admin`), puis seulement envoie l’invitation et attribue le rôle.

### 6. Connecter le site
Copier `config.example.js` en `config.js` et renseigner :

```js
window.FI_CONFIG = {
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'clé anon / publishable',
  siteUrl: 'https://fi.exemple.org'
};
```

### 7. Héberger
Le site est entièrement statique (`index.html`, `theme.css`, `app.js`, `config.js`) : Netlify, Vercel, Cloudflare Pages, GitHub Pages ou tout hébergement HTTPS conviennent. Ensuite :
- pointer le domaine vers l’hébergeur (HTTPS obligatoire) ;
- reporter l’adresse finale dans **Site URL**, **Redirect URLs** et les secrets `SITE_URL` / `ALLOWED_ORIGINS`.

Pour tester en local : servir le dossier avec n’importe quel serveur statique sur `http://localhost:5317` (par exemple `npx serve -l 5317`). Ouvrir `index.html` directement en `file://` ne permet pas la connexion.

## Pourquoi la sécurité ne dépend pas de l’interface

Le navigateur ne reçoit que du code et la clé publique. Chaque lecture ou écriture est vérifiée par PostgreSQL à partir du jeton de session : un adjoint qui modifierait le JavaScript ou appellerait l’API directement ne pourrait toujours lire que le planning et ses tâches, et ne changer que leur avancement. Masquer les boutons n’est qu’un confort d’affichage. Les seules opérations qui exigent des droits étendus (inviter un compte) passent par la fonction serveur.

## Parcours des comptes

- **Invitation** : l’administrateur saisit nom, e-mail et rôle. La personne reçoit un e-mail, clique sur le lien, choisit son mot de passe (10 caractères minimum) et arrive dans l’espace. Si l’adresse a déjà un compte (par exemple dans une autre FI), seul le rôle est ajouté.
- **Mot de passe oublié** : lien sur l’écran de connexion. Le message est identique que le compte existe ou non.
- **Retrait d’accès** : Administration → décocher « Actif ». Le compte ne voit plus aucune donnée dès sa requête suivante. Pour supprimer définitivement la personne : Authentication → Users → Delete user.
- **Plusieurs FI** : un même compte peut avoir un rôle dans plusieurs organisations ; un sélecteur apparaît alors en haut de l’écran.

## Données et confidentialité

- Membres : nom affiché court, disponibilité générale, statut, référent. Pas de coordonnées, pas de notes.
- Suivis : libellé court (« Contact A. ») et prochaine action. Aucun détail personnel ou spirituel.
- Prévoir avec l’équipe : durée de conservation, suppression des anciens membres et suivis terminés, sauvegardes (incluses dans les offres payantes Supabase), mention d’information pour les personnes concernées.

## Encore à faire

- Fournir l’URL du projet Supabase et la clé publique, puis suivre les étapes 1 à 7.
- Liste des responsables à inviter et rôles initiaux.
- Hébergeur et nom de domaine.
- Politique de conservation et de confidentialité retenue par l’équipe.
- Facultatif : journal des changements administratifs, export des présences.
