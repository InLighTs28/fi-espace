# FI espace — application de coordination

Application web responsive pour la coordination d’une FI : responsables, adjoints et membres. Direction artistique chrétienne (vert profond, ivoire, doré, croix discrète, citation courte), animations désactivées si le système demande de réduire les animations.

## Deux modes de fonctionnement

| Mode | Quand | Données | Sécurité |
|---|---|---|---|
| **Démonstration** | `config.js` vide, ou `?demo` ajouté à l’URL | Fictives, en mémoire, perdues au rechargement | Aucune : le sélecteur en haut permet d’essayer chaque compte (admin, responsable, adjoint, membre) |
| **Connecté** | `config.js` rempli avec l’URL et la clé publique Supabase | Base PostgreSQL Supabase | Connexion e-mail + mot de passe, droits vérifiés par la base (RLS) à chaque requête |

Toutes les personnes, dates et statistiques du mode démonstration sont **inventées**.

## Fichiers

```
index.html, theme.css, app.js      Le site (statique)
config.example.js / config.js      Configuration publique (config.js vide = démonstration)
database/001_schema.sql            Tables de base
database/002_auth_invitations.sql  Comptes invités, intégrité, durcissement
database/003_tuteurs_photos_notifications.sql  Tuteurs, photos (stockage privé), rappels e-mail
database/004_roles_membres_evenements.sql      Rôles façon Discord, espace membre, événements ciblés, premier admin
database/tests/rls_checks.sql      Vérification automatique de tous les droits (annulée en fin d’exécution)
supabase/functions/invite-user/    Fonction serveur d’invitation
supabase/functions/send-reminders/ Fonction serveur des rappels par e-mail
```

Les clés secrètes (`service_role`, clé du service d’e-mail) n’existent que dans les fonctions serveur.

## Fonctionnalités

- **Tableau de bord** : chiffres clés animés, prochaines rencontres, tâches, alerte « À surveiller » (membres absents aux 3 dernières rencontres, suivi créé en un clic avec le tuteur).
- **Espace membre** : un membre qui a un compte voit son propre tableau de bord, **ses événements** (ouverts à tous ou où il est invité), ses tâches et son compte. Rien d’autre.
- **Membres** : nom court, disponibilité, statut, **tuteur**, **photo de profil** (recadrée, métadonnées supprimées, stockage privé).
- **Présences** par rencontre, export **CSV**.
- **Suivis** avec tuteur, échéance et état.
- **Planning** : « Planifier le mois », **ciblage** de chaque événement (tout le monde / équipe uniquement / membres choisis), bouton « ✉ Rappel ».
- **Tâches** avec avancement.
- **Statistiques** : présence par rencontre, assiduité par membre, tâches par personne, membres par statut.
- **Suggestions de noms** : les champs où l’on tape un nom (membre, contact d’un suivi, invitation, recherche) proposent les noms déjà enregistrés ; un doublon de membre est signalé ; dans une invitation, choisir le nom d’un membre relie automatiquement sa fiche.
- **Mon compte** : mot de passe, rappels par e-mail, e-mail de test.
- **Administration façon Discord** : rôles personnalisables (nom, couleur, ordre, permissions), plusieurs rôles par compte, invitations, lien compte ↔ fiche membre, retrait d’accès.

## Rôles et permissions

Chaque FI démarre avec 4 rôles de base (modifiables, non supprimables) ; l’administrateur peut en créer d’autres (ex. « Accueil », « Louange », « Gestion des présences »). Un compte cumule les permissions de tous ses rôles.

| Permission | Ce qu’elle permet | Admin | Resp. FI | Adjoint | Membre |
|---|---|:-:|:-:|:-:|:-:|
| Administrateur | Tout, y compris rôles et comptes | ✓ | | | |
| Gérer les membres | Fiches, photos, tuteurs | ✓ | ✓ | | |
| Gérer les présences | Faire l’appel | ✓ | ✓ | | |
| Gérer les suivis | Prises de nouvelles | ✓ | ✓ | | |
| Gérer le planning | Créer, modifier, cibler les événements | ✓ | ✓ | | |
| Gérer les tâches | Créer et attribuer toutes les tâches | ✓ | ✓ | | |
| Voir tous les événements | Y compris « équipe uniquement » | ✓ | ✓ | ✓ | |
| Voir les statistiques | Graphiques, export | ✓ | ✓ | | |
| Envoyer des rappels | Bouton « ✉ Rappel » | ✓ | ✓ | | |
| *(sans permission)* | Ses événements, ses tâches (avancement), son compte | ✓ | ✓ | ✓ | ✓ |

Garanties appliquées par la base (vérifiées par `database/tests/rls_checks.sql`) :
- aucune lecture sans connexion ; un compte désactivé perd immédiatement l’accès ;
- un membre ne voit que les événements ouverts à tous et ceux où il est invité ;
- seul un administrateur crée des rôles, les attribue ou relie un compte à une fiche membre ;
- il reste **toujours au moins un administrateur actif** (impossible de retirer son rôle, sa permission ou son accès au dernier) ;
- impossible de mélanger les données de deux FI (rôles, membres, événements, photos, tâches) ;
- les photos sont dans un stockage **privé**, lisible uniquement par les comptes qui voient les membres ;
- l’auteur des modifications est fixé par le serveur ; textes courts imposés.

## Mise en service

### 1. Créer le projet Supabase
Sur [supabase.com](https://supabase.com), créer un projet (région UE conseillée). Noter dans **Project Settings → API** l’**URL du projet** et la clé **anon public** (ou **publishable**). La clé **service_role** / `sb_secret_…` ne doit jamais aller dans le site : l’application refuse de démarrer si elle la détecte.

### 2. Régler l’authentification
- **Authentication → Sign In / Providers** : Email activé, **désactiver « Allow new users to sign up »** (comptes sur invitation uniquement).
- **Authentication → URL Configuration** : **Site URL** et **Redirect URLs** = l’adresse du site (ex. `https://chris-git28.github.io/fi-espace/`), plus `http://localhost:5317` pour tester en local.
- **Authentication → Emails** : modèles en français ; pour un usage réel, configurer un **SMTP personnalisé**.

### 3. Appliquer le schéma
Dans **SQL Editor**, exécuter dans l’ordre `001`, `002`, `003`, `004`, puis *(conseillé)* `database/tests/rls_checks.sql`, qui doit afficher `TOUS LES TESTS RLS SONT PASSÉS`.

### 4. Créer le compte administrateur
Il n’y a volontairement **pas de compte admin avec un mot de passe fixé dans le code** : le dépôt étant public, n’importe qui pourrait l’utiliser. À la place :

1. **Authentication → Users → Add user → Create new user** : votre adresse e-mail, **le mot de passe de votre choix**, cocher **Auto Confirm User**.
2. **SQL Editor** — une seule commande, qui crée la FI, ses 4 rôles de base et vous en fait l’administrateur :

   ```sql
   select public.bootstrap_first_admin('votre@adresse.fr', 'Nom de votre FI', 'Votre prénom');
   ```

Vous pouvez ensuite vous connecter sur le site avec cet e-mail et ce mot de passe. Les autres comptes s’invitent depuis **Administration → Inviter une personne**. Cette fonction n’est utilisable que depuis le SQL Editor (le site ne peut pas l’appeler).

### 5. Déployer les fonctions serveur
Avec la [CLI Supabase](https://supabase.com/docs/guides/cli), depuis ce dossier :

```bash
supabase login
supabase link --project-ref VOTRE_REF_PROJET
supabase secrets set SITE_URL=https://chris-git28.github.io/fi-espace/ ALLOWED_ORIGINS=https://chris-git28.github.io,http://localhost:5317
supabase functions deploy invite-user
```

(Si la CLI demande un `supabase/config.toml`, lancer d’abord `supabase init` en gardant `supabase/functions`.) Sans CLI : **Edge Functions → Deploy a new function → Via editor**, coller le fichier `index.ts`, ajouter les secrets dans **Edge Functions → Secrets**.

### 5 bis. Rappels par e-mail
Avec [Resend](https://resend.com) (offre gratuite suffisante) : vérifier votre domaine, créer une clé API, puis :

```bash
supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="FI espace <rappels@votre-domaine.fr>" CRON_SECRET=une-longue-phrase-aleatoire
supabase functions deploy send-reminders --no-verify-jwt
```

`--no-verify-jwt` est voulu : la fonction vérifie elle-même le secret du planificateur ou la session de l’utilisateur. Planification horaire (activer **pg_cron** et **pg_net** dans Database → Extensions) :

```sql
select cron.schedule('fi-rappels', '0 * * * *', $$
  select net.http_post(
    url := 'https://VOTRE_REF_PROJET.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'MEME_VALEUR_QUE_CRON_SECRET'),
    body := '{}'::jsonb)
$$);
```

| Rappel | Quand | Destinataires |
|---|---|---|
| Rencontre | dans les 24 h avant chaque événement | les personnes qui peuvent voir l’événement (selon son ciblage) |
| Tâche | la veille de l’échéance | la personne à qui elle est attribuée |
| Suivi | la veille de la date prévue | le tuteur du suivi |
| Récapitulatif | dimanche à partir de 18 h, avant le bilan de 20 h | tous (événements qui les concernent ; chiffres de la FI pour qui voit les statistiques) |
| Rappel manuel | bouton « ✉ Rappel » | les personnes concernées par l’événement |

Chacun règle ses rappels dans **Mon compte** ; aucun rappel n’est envoyé deux fois.

### 6. Connecter le site
Renseigner `config.js` :

```js
window.FI_CONFIG = {
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'clé anon / publishable',
  siteUrl: 'https://chris-git28.github.io/fi-espace/'
};
```

### 7. Héberger
Site statique, publié ici sur GitHub Pages (`https://chris-git28.github.io/fi-espace/`) : chaque `git push` sur `main` met le site à jour. Pour un domaine personnalisé : Settings → Pages → Custom domain, puis reporter l’adresse dans Supabase et les secrets.

## Parcours des comptes

- **Invitation** : l’administrateur saisit le nom (les membres existants sont proposés), l’e-mail, les rôles et, pour un membre, sa fiche. La personne reçoit un lien, choisit son mot de passe (10 caractères minimum) et arrive dans son espace.
- **Connexion** : e-mail + mot de passe ; « Mot de passe oublié » sur l’écran de connexion.
- **Retrait d’accès** : Administration → Gérer → décocher « Accès actif ».
- **Plusieurs FI** : un sélecteur apparaît en haut de l’écran.

## Données et confidentialité

- Membres : nom court, disponibilité générale, statut, tuteur ; photo uniquement avec accord. Pas de coordonnées ni de notes.
- Suivis : libellé court et prochaine action, aucun détail personnel ou spirituel.
- E-mails de rappel : organisation pratique uniquement.
- À définir avec l’équipe : durée de conservation, sauvegardes, information des personnes concernées.

## Encore à faire

- Créer le projet Supabase et suivre les étapes 1 à 7.
- Liste des personnes à inviter et rôles de chacun.
- Facultatif : domaine personnalisé, journal des changements administratifs.
