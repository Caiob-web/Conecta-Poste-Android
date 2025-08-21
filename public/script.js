// ===== script.js — Visualização mobile (BBOX + paginação + overlay) =====

const ZOOM_MIN = 12;          // não carrega abaixo disso
const PAGE_LIMIT = 20000;     // 20k por requisição
let isLoading = false;
let lastToken = 0;

// --- Mapa (Canvas ajuda no mobile) ---
const map = L.map("map", { preferCanvas: true }).setView([-23.2237, -45.9009], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

const markers = L.markerClusterGroup({
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,
  maxClusterRadius: 60,
  disableClusteringAtZoom: 17,
  chunkedLoading: true,       // melhora no mobile
});
map.addLayer(markers);

// --- Overlay de loading (já existe no HTML) ---
const overlay = document.getElementById("carregando");
const overlayText = overlay?.querySelector(".texto-loading");
function setLoading(show, msg) {
  if (overlayText) overlayText.textContent = msg || "Carregando postes…";
  if (overlay) overlay.style.display = show ? "flex" : "none";
}

// --- Helpers ---
function buildBBoxQS() {
  const b = map.getBounds();
  return new URLSearchParams({
    minLat: b.getSouth(),
    maxLat: b.getNorth(),
    minLng: b.getWest(),
    maxLng: b.getEast(),
  });
}

async function fetchJsonGuard(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}: ${text.slice(0,120)}…`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Resposta não-JSON: ${text.slice(0,120)}…`); }
}

// Normaliza para { items:Array, total:Number }
function normalizePayload(payload) {
  if (Array.isArray(payload)) return { items: payload, total: payload.length };
  if (Array.isArray(payload?.data)) {
    const total = Number(payload.total ?? payload.data.length ?? 0);
    return { items: payload.data, total };
  }
  if (payload?.type === "FeatureCollection" && Array.isArray(payload?.features)) {
    const items = payload.features.map(f => ({
      id: f.properties?.id ?? f.properties?.ID,
      latitude:  f.geometry?.coordinates?.[1],
      longitude: f.geometry?.coordinates?.[0],
      ...f.properties,
    }));
    const total = Number(payload.total ?? items.length ?? 0);
    return { items, total };
  }
  // última tentativa: primeira array encontrada
  const firstArray = Object.values(payload || {}).find(Array.isArray);
  const total = Number(payload?.total ?? firstArray?.length ?? 0);
  return { items: Array.isArray(firstArray) ? firstArray : [], total };
}

function parseLatLng(p) {
  // tenta latitude/longitude; se não, tenta string "lat,lon"
  let lat = p.latitude ?? p.Latitude ?? p.y;
  let lng = p.longitude ?? p.Longitude ?? p.x;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (p.coordenadas) {
      const [a, b] = String(p.coordenadas).split(",").map(s => parseFloat(s.trim()));
      lat = a; lng = b;
    }
  }
  return (Number.isFinite(lat) && Number.isFinite(lng)) ? [lat, lng] : null;
}

function addBatch(items, start = 0, batch = 1200) {
  const end = Math.min(start + batch, items.length);
  const toAdd = [];
  for (let i = start; i < end; i++) {
    const p = items[i];
    const ll = parseLatLng(p);
    if (!ll) continue;

    const marker = L.circleMarker(ll, {
      radius: 6, fillColor: "green", color: "#fff", weight: 2, fillOpacity: 0.8,
    }).bindPopup(`
      <b>ID:</b> ${p.id ?? ""}<br>
      <b>Coord:</b> ${ll[0].toFixed(6)}, ${ll[1].toFixed(6)}<br>
      <b>Município:</b> ${p.nome_municipio ?? ""}<br>
      <b>Bairro:</b> ${p.nome_bairro ?? ""}<br>
      <b>Logradouro:</b> ${p.nome_logradouro ?? ""}<br>
      <b>Material:</b> ${p.material ?? ""}<br>
      <b>Altura:</b> ${p.altura ?? ""}<br>
      <b>Tensão:</b> ${p.tensao_mecanica ?? ""}
    `);
    toAdd.push(marker);
  }
  if (toAdd.length) markers.addLayers(toAdd);
  if (end < items.length) {
    (self.requestIdleCallback || setTimeout)(() => addBatch(items, end, batch), 0);
  }
}

// --- Carrega apenas o que está visível ---
async function loadVisible() {
  if (isLoading) return;
  if (map.getZoom() < ZOOM_MIN) {
    markers.clearLayers();
    setLoading(true, `Aproxime o zoom (≥ ${ZOOM_MIN}) para carregar os postes.`);
    return;
  }

  isLoading = true;
  const token = ++lastToken;
  markers.clearLayers();
  setLoading(true, "Carregando…");

  let page = 1, total = null, loaded = 0;

  try {
    while (true) {
      if (token !== lastToken) break; // outro load começou

      const qs = buildBBoxQS();
      qs.set("page", String(page));
      qs.set("limit", String(PAGE_LIMIT));
      const url = `/api/postes?${qs.toString()}`;

      const payload = await fetchJsonGuard(url);
      const { items, total: reportedTotal } = normalizePayload(payload);

      if (total == null) total = Number.isFinite(reportedTotal) ? reportedTotal : 0;
      if (!Array.isArray(items) || items.length === 0) break;

      addBatch(items);
      loaded += items.length;
      setLoading(true, total ? `Carregando… ${loaded}/${total}` : `Carregando… ${loaded}`);

      if (total > 0 && loaded >= total) break;
      await new Promise((r) => setTimeout(r, 80)); // dá um respiro no mobile
      page++;
    }

    if (token === lastToken) {
      setLoading(false);
    }
  } catch (e) {
    console.error("Erro ao carregar BBOX:", e);
    setLoading(true, "❌ Erro ao carregar postes");
    setTimeout(() => setLoading(false), 2500);
  } finally {
    isLoading = false;
  }
}

// Debounce para evitar múltiplos loads seguidos no mobile
let moveendTimer = null;
map.on("moveend", () => {
  clearTimeout(moveendTimer);
  moveendTimer = setTimeout(loadVisible, 250);
});
map.on("zoomend", () => {
  clearTimeout(moveendTimer);
  moveendTimer = setTimeout(loadVisible, 250);
});

map.whenReady(loadVisible);

// --- Botões do seu HTML (somente os essenciais) ---
document.getElementById('togglePainel')?.addEventListener('click', () => {
  const p = document.getElementById('painelBusca');
  p.style.display = (p.style.display === 'none') ? 'block' : 'none';
});

document.getElementById('localizacaoUsuario')?.addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocalização não suportada');
  navigator.geolocation.getCurrentPosition(
    (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 16)),
    () => alert('Não foi possível obter sua localização')
  );
});
