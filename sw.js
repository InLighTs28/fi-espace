// FI espace — service worker : rend l'application installable et l'ouvre même hors connexion.
// Stratégie « réseau d'abord » : la version en ligne est toujours prioritaire, le cache ne sert qu'en secours.
// Seuls les fichiers du site sont mis en cache : jamais les données (Supabase) ni d'autres domaines.
const CACHE = 'fi-espace-v2';
const SHELL = ['./', 'index.html', 'theme.css', 'app.js', 'config.js', 'manifest.webmanifest', 'confidentialite.html', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/private/')) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
        return response;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('index.html'))),
  );
});
