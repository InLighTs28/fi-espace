// Configuration publique de FI espace.
// 1. Copier ce fichier sous le nom config.js (même dossier que index.html).
// 2. Renseigner les valeurs de Supabase → Project Settings → API.
//
// Ces deux valeurs sont publiques par nature : la sécurité repose sur les règles RLS de la base.
// NE JAMAIS placer ici la clé « service_role » ni une clé « sb_secret_… » :
// l'application refuse de démarrer si une clé secrète est détectée.
window.FI_CONFIG = {
  supabaseUrl: '',      // ex. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: '',  // clé « anon public » (eyJ…) ou « publishable » (sb_publishable_…)
  siteUrl: ''           // URL publique du site pour les liens e-mail ; vide = adresse actuelle
};
