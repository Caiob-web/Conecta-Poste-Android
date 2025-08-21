// ===== script.js — BBOX + 20k por página + zoom mínimo + progress (robusto) =====

const ZOOM_MIN = 12;          // não carrega abaixo disso
const PAGE_LIMIT = 20000;     // 20k por requisição
let isLoading = false;
let lastToken = 0;

// >>> Ajuste aqui conforme sua API <<<
// "bbox"  => usa /api/postes?bbox=west,south,east,north
// "params"=> usa /api/postes?minLat=..&maxLat=..&minLng=..&maxLng=..
const BBOX_MODE = "bbox"; // "bbox" | "params"

// Mapa (Canvas ajuda no mobile)
const map = L.map("map", { preferCanvas: true }).setView([-23.2237, -45.9009], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
const markers = L.markerClusterGroup({
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,
  maxClusterRadius: 60,
  disableClusteringAtZoom: 17,
});
map.addLayer(markers);

// Banner de status
const statusDiv = document.createElement("div");
Object.assign(statusDiv.style, {
  position: "absolute", top: "12px", left: "50%", transform: "translateX(-50%)",
  background: "rgba(0,0,0,.75)", color: "#fff", padding: "6px 12px",
  borderRadius: "8px", font: "14px system-ui, Arial", zIndex: "9999",
});
document.body.appendChild(statusDiv);
const setStatus = (t) => { statusDiv.textContent = t || ""; statusDiv.style.display = t ? "block" : "none"; };

// Helpers
function buildBBoxQS() {
  const b = map.getBounds();
  if (BBOX_MODE === "bbox") {
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const qs = new URLSearchParams({ bbox });
    return qs;
  } else {
    return new URLSearchParams({
      minLat: b.getSouth(),
      maxLat: b.getNorth(),
      minLng: b.getWest(),
      maxLng: b.getEast(),
    });
  }
}

async function fetchJsonGuard(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  const txt = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}: ${txt.slice(0,120)}…`);
  let json;
  try { json = JSON.parse(txt); } catch {
    throw new Error(`Resposta não-JSON: ${txt.slice(0,120)}…`);
  }
  return json;
}

// Converte qualquer forma comum em { items:Array, total:Number }
function normalizePayload(payload) {
  // 1) Array direto
  if (Array.isArray(payload)) return { items: payload, total: payload.length };

  // 2) Chaves comuns
  const candidates = ["data", "rows", "postes", "items", "result", "results"];
  for (const k of candidates) {
    if (Array.isArray(payload?.[k])) {
      const total = Number(payload.total ?? payload.count ?? payload[k].length ?? 0);
      return { items: payload[k], total };
    }
  }

  // 3) GeoJSON
  if (payload?.type === "FeatureCollection" && Array.isArray(payload?.features)) {
    const items = payload.features.map(f => ({
      id: f.properties?.id ?? f.properties?.ID ?? f.properties?.id_poste,
      lat: f.geometry?.coordinates?.[1],
      lng: f.geometry?.coordinates?.[0],
      ...f.properties,
    }));
    const total = Number(payload.total ?? payload.count ?? items.length ?? 0);
    return { items, total };
  }

  // 4) Última tentativa: objeto com uma única array
  const firstArray = Object.values(payload || {}).find(Array.isArray);
  if (Array.isArray(firstArray)) {
    const total = Number(payload.total ?? payload.count ?? firstArray.length ?? 0);
    return { items: firstArray, total };
  }

  return { items: [], total: 0 };
}

function addBatch(items, start = 0, batch = 1000) {
  const end = Math.min(start + batch, items.length);
  for (let i = start; i < end; i++) {
    const p = items[i];

    // tenta várias convenções de nome
    const lat = p.lat ?? p.latitude ?? p.Latitude ?? p.y ?? (
      p.coordenadas ? parseFloat(String(p.coordenadas).split(",")[0]) : undefined
    );
    const lng = p.lng ?? p.lon ?? p.longitude ?? p.Longitude ?? p.x ?? (
      p.coordenadas ? parseFloat(String(p.coordenadas).split(",")[1]) : undefined
    );

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const m = L.circleMarker([lat, lng], {
      radius: 6, fillColor: "green", color: "#fff", weight: 2, fillOpacity: 0.8,
    }).bindPopup(`
      <b>ID:</b> ${p.id ?? p.ID ?? ""}<br>
      <b>Coord:</b> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
      <b>Município:</b> ${p.nome_municipio ?? p.municipio ?? ""}<br>
      <b>Bairro:</b> ${p.nome_bairro ?? p.bairro ?? ""}<br>
      <b>Logradouro:</b> ${p.nome_logradouro ?? p.logradouro ?? ""}<br>
      <b>Material:</b> ${p.material ?? ""}<br>
      <b>Altura:</b> ${p.altura ?? ""}<br>
      <b>Tensão:</b> ${p.tensao_mecanica ?? ""}
    `);
    markers.addLayer(m);
  }
  if (end < items.length) {
    (self.requestIdleCallback || setTimeout)(() => addBatch(items, end, batch), 0);
  }
}

// Carrega apenas o que está visível
async function loadVisible() {
  if (isLoading) return;
  if (map.getZoom() < ZOOM_MIN) {
    markers.clearLayers();
    setStatus(`Aproxime o zoom (≥ ${ZOOM_MIN}) para carregar os postes.`);
    return;
  }

  isLoading = true;
  const token = ++lastToken;
  markers.clearLayers();
  setStatus("Carregando…");

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
      setStatus(`Carregando… ${loaded}/${total || "?"}`);

      if (loaded >= total && total > 0) break;
      await new Promise((r) => setTimeout(r, 80));
      page++;
    }

    if (token === lastToken) {
      setStatus(total ? `✅ ${loaded} de ${total} carregados` : `✅ ${loaded} carregados`);
      setTimeout(() => { if (token === lastToken) setStatus(""); }, 2000);
    }
  } catch (e) {
    console.error("Erro ao carregar BBOX:", e);
    setStatus("❌ Erro ao carregar postes");
  } finally {
    isLoading = false;
  }
}

map.on("moveend", loadVisible);
map.on("zoomend", loadVisible);
loadVisible();
