/* ===== Service Worker — versão somente visualização =====
 * Troque os nomes dos caches quando alterar este arquivo.
 */
const STATIC_CACHE  = 'static-v3';
const RUNTIME_CACHE = 'runtime-v3';
const OFFLINE_URL   = '/offline.html';

// Hosts dos tiles do OpenStreetMap (a|b|c.tile.openstreetmap.org)
const TILE_HOSTS = ['tile.openstreetmap.org'];
const isOSMTile = (url) =>
  TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));

/* ============ INSTALL ============ */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll([
      '/',                // se for SPA, mantém
      OFFLINE_URL,        // página offline
      '/manifest.json',   // opcional, mas comum em PWA
      '/favicon.ico',     // opcional
    ]);
    await self.skipWaiting();
  })());
});

/* ============ ACTIVATE ============ */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // limpa caches antigos
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => ![STATIC_CACHE, RUNTIME_CACHE].includes(k))
        .map((k) => caches.delete(k))
    );

    // habilita navigation preload (melhora 3G/4G)
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }

    await self.clients.claim();
  })());
});

/* ============ Mensagens (atualização forçada opcional) ============ */
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ============ FETCH ============ */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) NÃO interceptar API (rede direta sempre)
  if (sameOrigin && url.pathname.startsWith('/api/')) {
    return; // network-only
  }

  // 1.1) Tiles do OSM: cache-first, sem fallback para HTML
  if (req.destination === 'image' && isOSMTile(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req, { mode: 'no-cors' }); // tiles costumam ser opaque
        if (net && (net.ok || net.type === 'opaque')) {
          cache.put(req, net.clone());
        }
        return net;
      } catch {
        // sem tile → devolve vazio (mapa fica “cinza”, mas o app não quebra)
        return new Response('', { status: 204 });
      }
    })());
    return;
  }

  // 2) Navegações/páginas: network-first com preload e fallback offline
  if (req.mode === 'navigate' || (sameOrigin && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith((async () => {
      try {
        // usa navigation preload se disponível
        const preload = await event.preloadResponse;
        if (preload) {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, preload.clone());
          return preload;
        }
        const net = await fetch(req);
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, net.clone());
        return net;
      } catch {
        const cached = await caches.match(req);
        return cached || (await caches.match(OFFLINE_URL));
      }
    })());
    return;
  }

  // 3) Assets estáticos (script, style, font, image não-OSM): cache-first (SWR simples)
  if (['script', 'style', 'image', 'font'].includes(req.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await caches.match(req);
      const update = fetch(req).then((net) => {
        if (net && net.ok) cache.put(req, net.clone());
        return net;
      }).catch(() => null);
      // para assets, evitar servir offline.html para não dar MIME mismatch
      const netOrNull = await update;
      if (cached) return cached;
      if (netOrNull) return netOrNull;
      // último recurso: retorna resposta vazia
      return new Response('', { status: 204 });
    })());
    return;
  }

  // 4) Demais GETs: network-first com fallback ao cache (e offline.html se same-origin)
  event.respondWith((async () => {
    try {
      const net = await fetch(req);
      if (sameOrigin && net && net.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, net.clone());
      }
      return net;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      return sameOrigin
        ? (await caches.match(OFFLINE_URL))
        : new Response('', { status: 504 });
    }
  })());
});
