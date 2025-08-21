// Versões de cache (troque sempre que mudar o SW)
const STATIC_CACHE  = 'static-v2';
const RUNTIME_CACHE = 'runtime-v2';
const OFFLINE_URL   = '/offline.html';

// Pré-cache básico
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll([
        '/',               // se seu app é SPA, pode trocar por '/index.html'
        OFFLINE_URL,
        '/manifest.json',
        '/favicon.ico',
      ]))
      .then(() => self.skipWaiting())
  );
});

// Limpa caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![STATIC_CACHE, RUNTIME_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) NÃO INTERCEPTAR API (deixa ir direto pra rede)
  if (sameOrigin && url.pathname.startsWith('/api/')) {
    // Dica: se quiser, você pode fazer um "network-only" explícito:
    // event.respondWith(fetch(req));
    return; // não intercepta
  }

  // 2) Assets estáticos: cache-first (stale-while-revalidate simples)
  if (['script', 'style', 'image', 'font'].includes(req.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await caches.match(req);
      const fetchPromise = fetch(req).then((networkResp) => {
        if (networkResp && networkResp.ok) {
          cache.put(req, networkResp.clone());
        }
        return networkResp;
      }).catch(() => null);
      return cached || (await fetchPromise) || (await caches.match(OFFLINE_URL));
    })());
    return;
  }

  // 3) Navegações/páginas: network-first com fallback offline
  if (req.mode === 'navigate' || (sameOrigin && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        // opcional: cachear páginas navegadas
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, net.clone());
        return net;
      } catch (_) {
        const cached = await caches.match(req);
        return cached || (await caches.match(OFFLINE_URL));
      }
    })());
    return;
  }

  // 4) Demais GETs (ex.: JSON externo): network-first simples
  event.respondWith((async () => {
    try {
      const net = await fetch(req);
      // cacheia só se same-origin
      if (sameOrigin && net && net.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, net.clone());
      }
      return net;
    } catch (_) {
      const cached = await caches.match(req);
      return cached || (sameOrigin ? await caches.match(OFFLINE_URL) : new Response('', {status: 504}));
    }
  })());
});
