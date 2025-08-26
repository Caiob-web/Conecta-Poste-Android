/* ===== Service Worker — versão somente visualização =====
 * AUMENTE ESTES NOMES ao alterar o arquivo para forçar atualização.
 */
const STATIC_CACHE  = 'static-v4';
const RUNTIME_CACHE = 'runtime-v4';
const OFFLINE_URL   = '/offline.html';

/* ----- Tiles do OpenStreetMap ----- */
// hosts (Leaflet usa a|b|c.tile.openstreetmap.org)
const TILE_HOSTS = ['tile.openstreetmap.org'];
const isOSMTile = (url) => TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
// limite simples para não deixar o cache de tiles crescer sem fim
const TILE_CACHE_LIMIT = 800; // ajuste se quiser (≈ várias áreas vistas)

/* Utilitário: enxuga cache (remove mais antigos) */
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  } catch (_) {}
}

/* ============ INSTALL ============ */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll([
      '/',               // se app for SPA; se não, mantenha mesmo assim
      OFFLINE_URL,
      '/manifest.json',
      '/favicon.ico',
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

    // navigation preload acelera primeira navegação
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

  // 0) NÃO interceptar API (rede direta sempre)
  if (sameOrigin && url.pathname.startsWith('/api/')) {
    return; // network-only
  }

  // 1) Tiles do OSM: cache-first (sem fallback HTML)
  if (req.destination === 'image' && isOSMTile(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        // tiles muitas vezes retornam opaque; tudo bem para cache
        const net = await fetch(req, { mode: 'no-cors' });
        if (net) {
          cache.put(req, net.clone());
          // dá uma “enxugada” de vez em quando
          trimCache(RUNTIME_CACHE, TILE_CACHE_LIMIT);
        }
        return net || new Response('', { status: 204 });
      } catch {
        return new Response('', { status: 204 }); // sem tile → responde vazio
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
      if (cached) return cached;
      const net = await update;
      return net || new Response('', { status: 204 });
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
