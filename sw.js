// Keeps the app shell available offline. Data sync is handled by Firestore itself.
const CACHE = 'shopping-v1';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
const CACHE_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !CACHE_HOSTS.includes(url.hostname)) return;
  if (url.hostname === 'www.gstatic.com' && !url.pathname.startsWith('/firebasejs/')) return;
  // network first for our own files (so updates arrive), cache fallback offline; cache first for pinned libraries
  if (same) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
  } else {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
