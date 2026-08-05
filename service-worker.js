// v3 removes the old offline cache because it could keep serving an outdated blank app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
