// Offline support for the hosted version.
// App files: served from cache, refreshed in the background. Audio packs (large, never change
// without a new name): cache-first with no refresh, so they're downloaded once.
const CACHE = 'ripasso-v3';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'engine.js', 'data.js', 'words.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'audio/index.json'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const audio = /\/audio\/[^/]+\.mp3$/.test(new URL(e.request.url).pathname);
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    if (hit && audio) return hit;
    const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
