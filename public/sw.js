// no topo
const TILE_HOSTS = ['tile.openstreetmap.org']; // cobre a,b,c.tile...
const isOSMTile = (url) =>
  TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));

// ...dentro do fetch
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) API: deixa seguir direto
  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  // 1.1) Tiles do OSM: cache-first, sem fallback para HTML
  if (req.destination === 'image' && isOSMTile(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req);          // vai ser "opaque", mas dá pra cachear
        if (net && (net.ok || net.type === 'opaque')) {
          cache.put(req, net.clone());
        }
        return net;
      } catch {
        // volta vazio (tile fica “cinza”), mas não quebra o app
        return new Response('', { status: 204 });
      }
    })());
    return;
  }

  // 2) Assets estáticos em geral: cache-first (stale-while-revalidate simples)
  if (['script', 'style', 'image', 'font'].includes(req.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await caches.match(req);
      const fetchPromise = fetch(req).then((networkResp) => {
        if (networkResp && networkResp.ok) cache.put(req, networkResp.clone());
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

  // 4) Outros GETs: network-first
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
      return cached || (sameOrigin ? await caches.match(OFFLINE_URL) : new Response('', { status: 504 }));
    }
  })());
});
