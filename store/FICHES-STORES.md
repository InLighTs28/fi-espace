# FI espace — fiches des stores (prêtes à copier)

Visuels : `store/captures/` (téléphone 1290×2796, tablette 2064×2752, ordinateur 2880×1800), `store/banniere-google-play-1024x500.png`, icône `icons/icon-1024.png` (512 px : `icons/icon-512.png`). Données affichées sur les captures : **fictives**.

| Information | Valeur |
|---|---|
| Nom de l’application | FI espace |
| Identifiant (Android / iOS) | `fr.fiespace.app` |
| Catégorie | Productivité (Google Play, App Store, Microsoft Store) |
| Langue | Français |
| Prix | Gratuit, sans achat intégré, sans publicité |
| Site / assistance | https://inlights28.github.io/fi-espace/ · https://github.com/InLighTs28/fi-espace/issues |
| Politique de confidentialité | https://inlights28.github.io/fi-espace/confidentialite.html |
| Classification | Tout public (PEGI 3 / 4+ / IARC « Tous ») — pas de contenu sensible, pas d’achat, pas de chat public |

## Textes

**Sous-titre App Store (30 caractères max)** :
> Rencontres et missions de la FI

**Description courte Google Play (80 caractères max)** :
> Vos rencontres, vos missions et le suivi de votre FI, au même endroit.

**Mots-clés App Store (100 caractères max)** :
> FI,famille d'impact,église,planning,agenda,rencontres,missions,suivi,présences,communauté

**Description complète** :
> FI espace aide les familles d’impact (FI) à rester unies et organisées.
>
> POUR CHAQUE MEMBRE
> • Votre prochain rendez-vous en un coup d’œil : date, heure, lieu, compte à rebours.
> • Vos missions, avec leurs échéances : cochez-les en un geste quand c’est fait.
> • Votre agenda : les rencontres ouvertes à tous et celles où vous êtes invité.
> • Ajout en un clic à l’agenda de votre téléphone, ou abonnement qui se met à jour tout seul.
> • Rappels par e-mail la veille, et récapitulatif avant le bilan du dimanche.
>
> POUR LES RESPONSABLES
> • Membres, tuteurs, présences par rencontre et prises de nouvelles.
> • Planning du mois en un clic, sorties fraternelles, événements réservés à l’équipe ou à certains membres.
> • Tâches attribuées, statistiques de présence et alertes en cas d’absences répétées.
> • Rôles personnalisables : chacun ne voit que ce qui le concerne.
>
> RESPECT DE LA VIE PRIVÉE
> Accès sur invitation uniquement. Aucune publicité, aucun traçage. Seules les informations utiles à l’organisation sont enregistrées.
>
> FI espace s’utilise avec un compte fourni par l’administrateur de votre FI.

**Notes pour la vérification (App Store / Google Play)** : l’application est réservée aux personnes invitées. Fournir aux vérificateurs un **compte de test** (créé dans Supabase, rôle Membre + données d’exemple) : adresse et mot de passe dans le champ « Informations de connexion pour la vérification ».

## Questionnaires de confidentialité

**Google Play — Sécurité des données**
- Données collectées : *Informations personnelles → Nom, Adresse e-mail* ; *Photos* (facultatif, photo de profil ajoutée par un responsable) ; *Activité dans l’appli → Autres actions* (présences, missions).
- Finalité : *Fonctionnement de l’appli*, *Gestion du compte*. Aucune donnée partagée avec des tiers à des fins publicitaires ou commerciales.
- Données chiffrées en transit : **oui**. Suppression possible sur demande : **oui** (lien : page de confidentialité, section « Supprimer mon compte »).
- Collecte obligatoire : nom et e-mail (compte) ; photo facultative.

**App Store — Confidentialité (« étiquette nutritionnelle »)**
- *Coordonnées* : nom, adresse e-mail — liées à l’utilisateur — finalité : fonctionnalités de l’app.
- *Contenu utilisateur* : photos (facultatif), autre contenu (missions, présences) — liés à l’utilisateur — fonctionnalités de l’app.
- *Suivi (tracking)* : **non**. Pas de publicité, pas d’analyse tierce.

**Microsoft Store** : mêmes réponses ; renseigner l’URL de la politique de confidentialité.

## Comptes à ouvrir (à faire par vous)

| Store | Inscription | Coût | Délai habituel |
|---|---|---|---|
| Google Play | play.google.com/console | 25 $ une fois | Vérification d’identité ; nouveaux comptes personnels : test fermé de 14 jours avec 12 testeurs avant la publication |
| App Store + Mac App Store | developer.apple.com/programs | 99 $ / an | Vérification 1 à 2 jours ; examen de chaque version 1 à 3 jours |
| Microsoft Store | partner.microsoft.com (compte particulier) | Gratuit pour les particuliers (à vérifier à l’inscription) | Examen de quelques jours |
| Linux (Flathub, Snap Store) | Facultatif | Gratuit | — (les fichiers `.AppImage` / `.deb` de la Release suffisent) |

Une fois un compte ouvert, me le dire : la construction signée et l’envoi automatique sont déjà prévus dans `.github/workflows/apps.yml` (voir README, « Publier sur les stores »).
