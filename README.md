# FI espace — application de coordination

Application pour la coordination d’une FI : responsables, adjoints et membres. Direction artistique chrétienne (vert profond, ivoire, doré, croix discrète), animations désactivées si le système demande de réduire les animations.

**Site : https://inlights28.github.io/fi-espace/** · Mise en service : **[MISE-EN-SERVICE.md](MISE-EN-SERVICE.md)** · Stores : **[store/FICHES-STORES.md](store/FICHES-STORES.md)** · Confidentialité : [confidentialite.html](confidentialite.html)

## Deux modes de fonctionnement

| Mode | Quand | Données |
|---|---|---|
| **Démonstration** | `config.js` vide (ou `?demo` dans l’URL) | Fictives ; le sélecteur en haut permet d’essayer chaque compte |
| **Connecté** | `config.js` rempli avec l’URL et la clé publique Supabase | Base Supabase ; connexion e-mail + mot de passe ; droits vérifiés par la base à chaque requête |

## Fonctionnalités

- **Pour chaque membre : un repère clair.** En tête de l’accueil :
  - le **prochain rendez-vous** (date, heure, lieu, compte à rebours) ;
  - la **prochaine mission**, avec le bouton « Mission accomplie » ;
  - l’agenda des événements qui le concernent ;
  - les échéances signalées (en retard, aujourd’hui, cette semaine).
- **Agenda du téléphone** :
  - « 📅 Mon agenda » ajoute un événement ;
  - « Tout ajouter à mon agenda » ajoute toutes les dates ;
  - « 🔄 S’abonner » donne un lien personnel : l’agenda de l’iPhone, d’Android, de Google ou d’Outlook se met alors à jour tout seul, avec un rappel 2 h avant.
- **Rappels par e-mail** : la veille des rencontres et des échéances, et un récapitulatif avant le bilan du dimanche.
- **Pour les responsables** :
  - membres (tuteur, photo, statut), présences, suivis ;
  - planning (planification du mois, événements ciblés : tous / équipe / membres choisis) ;
  - tâches, statistiques, alertes d’absences répétées, export CSV.
- **Administration façon Discord** :
  - rôles personnalisables (couleur, ordre, permissions), cumulables ;
  - invitations, lien entre un compte et sa fiche membre.
- **Suggestions de noms** dans les champs de saisie, avec alerte en cas de doublon.

## Fichiers

```
index.html, theme.css, app.js          Le site (statique, installable : manifest.webmanifest, sw.js, icons/)
confidentialite.html                   Politique de confidentialité (exigée par les stores)
config.js                              Configuration publique (vide = démonstration)
database/001…005_*.sql                 Migrations ; database/INSTALLATION-COMPLETE.sql = tout en un fichier
database/tests/rls_checks.sql          Vérification automatique de tous les droits
supabase/functions/                    invite-user, send-reminders, calendar-feed (fonctions serveur)
apps/desktop, apps/mobile              Applications Windows/macOS/Linux (Electron) et Android/iOS (Capacitor)
store/                                 Textes des fiches, captures d’écran, bannière Google Play
scripts/                               Copie du site pour le mobile, fichier d’installation, import des membres
private/                               Données réelles de la FI — exclu de Git, jamais publié
```

## Rôles et permissions

Chaque FI démarre avec 4 rôles de base, modifiables mais pas supprimables. L’administrateur peut en créer d’autres (ex. « Accueil », « Louange »). Un compte cumule les permissions de tous ses rôles.

| Permission | Admin | Resp. FI | Adjoint | Membre |
|---|:-:|:-:|:-:|:-:|
| Administrateur (comptes, rôles) | ✓ | | | |
| Gérer membres / présences / suivis / planning / tâches | ✓ | ✓ | | |
| Voir tous les événements (y compris « équipe ») | ✓ | ✓ | ✓ | |
| Statistiques, rappels manuels | ✓ | ✓ | | |
| Ses événements, ses missions, son compte, son agenda | ✓ | ✓ | ✓ | ✓ |

Garanties appliquées par la base, vérifiées par `database/tests/rls_checks.sql` et par injection volontaire de failles :
- aucune lecture sans connexion ;
- un compte désactivé perd l’accès immédiatement, flux d’agenda compris ;
- un membre ne voit que ses événements ;
- il reste toujours au moins un administrateur ;
- pas de mélange entre deux FI ;
- les photos sont en stockage privé ;
- le lien d’agenda est secret, personnel et renouvelable.

## Applications

| Plateforme | Tout de suite, gratuit | Fichiers (Releases GitHub) | Store |
|---|---|---|---|
| Windows | Edge/Chrome → ⋯ → **Installer FI espace** | `.exe` | Microsoft Store |
| macOS | Chrome → Installer ; Safari → **Ajouter au Dock** | `.dmg` | Mac App Store |
| Linux | Chrome/Edge → Installer | `.AppImage`, `.deb` | Flathub / Snap (facultatif) |
| Android | Chrome → **Installer l’application** | `.apk` | Google Play |
| iPhone / iPad | Safari → Partager → **Sur l’écran d’accueil** | — | App Store |

**Construction automatique** (`.github/workflows/apps.yml`), à chaque étiquette `vX.Y.Z` (`git tag v1.0.3 && git push --tags`) :
- installateurs de bureau ;
- APK Android ;
- vérification de la compilation iOS.

Dès que vos comptes développeur existent et que leurs clés sont enregistrées dans les secrets GitHub (liste en tête du workflow), il produit en plus :
- le `.aab` signé pour Google Play ;
- l’envoi sur TestFlight pour l’App Store, **sans Mac** grâce aux machines macOS de GitHub ;
- le paquet `.appx` pour le Microsoft Store.

L’application de bureau ouvre `https://inlights28.github.io/fi-espace/`. Si l’adresse change (compte GitHub renommé, nouveau domaine), modifiez `apps/desktop/main.js` et publiez une nouvelle version. Un nom de domaine personnalisé évite ce problème.

Les versions de bureau ne sont pas signées : Windows affiche « Informations complémentaires → Exécuter quand même », et macOS demande un clic droit → Ouvrir.

### Raccourci « FI espace » sur le Bureau
Il ouvre la version locale avec les membres réels (`private/donnees-fi.js`). Les modifications restent sur cet ordinateur ; « Recharger depuis le fichier privé » se trouve dans Mon compte. Une fois Supabase en place, la base remplace ce fichier : `private/import-fi.sql` y importe les mêmes données.

## Données et confidentialité

- Membres : nom court, disponibilité générale, statut, tuteur, et une photo seulement avec l’accord de la personne. Pas de coordonnées ni de notes.
- Suivis : libellé court et prochaine action, sans détail personnel ni spirituel.
- Aucune publicité, aucun traçage. Voir [confidentialite.html](confidentialite.html), section « Supprimer mon compte » comprise.
