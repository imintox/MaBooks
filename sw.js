const CACHE = 'mabooks-v10';
const FILES = ['./', './index.html', './manifest.webmanifest', './style.css', './app.js', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  // cache:'reload' skips the browser's HTTP cache, so a new version never stores stale copies of its own files
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;   // never touch other sites
  e.respondWith(
    caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req).then(r => {
      if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }   // only cache good responses
      return r;
    }).catch(() => req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
