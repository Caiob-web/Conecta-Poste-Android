const STATIC_CACHE = 'static-v1';
const RUNTIME_CACHE = 'runtime-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then((c) =>
      c.addAll([
        '/',
        '/offline.html',
        '/manifest.json',
        '/favicon.ico'
        // adicione seus CSS/JS críticos e ícones aqui (build gerado pelo Vite)
      ])
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![STATIC_CACHE, RUNTIME_CACHE].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // cache-first para estáticos
  if (['script','style','image','font'].includes(req.destination)) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((net) => {
        const copy = net.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        return net;
      }).catch(() => caches.match(OFFLINE_URL)))
    );
    return;
  }

  // network-first para páginas/dados
  e.respondWith(
    fetch(req).then((net) => {
      const copy = net.clone();
      caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
      return net;
    }).catch(async () => (await caches.match(req)) || caches.match(OFFLINE_URL))
  );
});
