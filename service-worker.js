const CACHE = 'travel-league-live-v1';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./firebase-config.js','./manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', event => event.respondWith(fetch(event.request).catch(() => caches.match(event.request))));
