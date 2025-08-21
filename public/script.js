// ============================================================
// script.js — BBOX + Zoom mínimo + Canvas + Lotes
// ============================================================

const ZOOM_MIN = 12;          // não carrega abaixo disso
const PAGE_LIMIT = 20000;     // 20k por requisição
const RENDER_BATCH = 1000;    // adiciona no mapa em lotes de 1000
let isLoading = false;
let lastLoadToken = 0;

// 1) Mapa (Canvas renderer melhora muito no mobile)
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

// 2) Indicador de status
const statusDiv = document.createElement("div");
Object.assign(statusDiv.style, {
  position: "absolute",
  top: "12px",
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(0,0,0,.75)",
  color: "#fff",
  padding: "6px 12px",
  borderRadius: "8px",
  font: "14px system-ui, Arial",
  zIndex: "9999",
});
document.body.appendChild(statusDiv);
function setStatus(t) { statusDiv.textContent = t; statusDiv.style.display = t ? "block" : "none"; }

// 3) Util
function boundsParams() {
  const b = map.getBounds();
  return new URLSearchParams({
    minLat: b.getSouth(),
    maxLat: b.getNorth(),
    minLng: b.getWest(),
    maxLng: b.getEast(),
  }).toString();
}
async function fetchJsonGuard(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  const txt = await res.text();
  if (!ct.includes("application/json")) throw new Error(`Resposta não-JSON: ${txt.slice(0,120)}…`);
  return JSON.parse(txt);
}

function addMarkersBatch(items, start = 0) {
  const end = Math.min(start + RENDER_BATCH, items.length);
  for (let i = start; i < end; i++) {
    const p = items[i];
    const lat = p.latitude ?? (p.coordenadas ? parseFloat(p.coordenadas.split(",")[0]) : null);
    const lng = p.longitude ?? (p.coordenadas ? parseFloat(p.coordenadas.split(",")[1]) : null);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const m = L.circleMarker([lat, lng], {
      radius: 6, fillColor: "green", color: "#fff", weight: 2, fillOpacity: 0.8,
    }).bindPopup(`
      <b>ID:</b> ${p.id}<br>
      <b>Coord:</b> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
      <b>Município:</b> ${p.nome_municipio ?? ""}<br>
      <b>Bairro:</b> ${p.nome_bairro ?? ""}<br>
      <b>Logradouro:</b> ${p.nome_logradouro ?? ""}<br>
      <b>Material:</b> ${p.material ?? ""}<br>
      <b>Altura:</b> ${p.altura ?? ""}<br>
      <b>Tensão:</b> ${p.tensao_mecanica ?? ""}
    `);
    markers.addLayer(m);
  }
  if (end < items.length) {
    // joga a continuação para o próximo frame
    requestIdleCallback
      ? requestIdleCallback(() => addMarkersBatch(items, end))
      : setTimeout(() => addMarkersBatch(items, end), 0);
  }
}

// 4) Carrega o que está visível (BBOX + paginação)
async function loadVisible() {
  if (isLoading) return;
  if (map.getZoom() < ZOOM_MIN) {
    markers.clearLayers();
    setStatus(`Aproxime o zoom (≥ ${ZOOM_MIN}) para carregar os postes.`);
    return;
  }

  isLoading = true;
  const token = ++lastLoadToken; // cancela cargas antigas
  markers.clearLayers();
  setStatus("Carregando…");

  const paramsBase = boundsParams();
  let page = 1, total = null, loaded = 0;

  try {
    while (true) {
      // se outra carga começou, aborta esta
      if (token !== lastLoadToken) break;

      const url = `/api/postes?${paramsBase}&page=${page}&limit=${PAGE_LIMIT}`;
      const data = await fetchJsonGuard(url);
      if (!data || !Array.isArray(data.data)) throw new Error("Estrutura inesperada da resposta");

      if (total == null) total = Number(data.total) || 0;
      loaded += data.data.length;

      setStatus(`Carregando… ${loaded}/${total}`);

      addMarkersBatch(data.data);

      if (loaded >= total || data.data.length === 0) break;

      // pequena pausa para não travar
      await new Promise(r => setTimeout(r, 100));
      page++;
    }

    setStatus(total ? `✅ ${loaded} de ${total} carregados` : `✅ ${loaded} carregados`);
    // some o banner depois de 2s
    setTimeout(() => { if (token === lastLoadToken) setStatus(""); }, 2000);
  } catch (e) {
    console.error("Erro ao carregar BBOX:", e);
    setStatus("❌ Erro ao carregar postes");
  } finally {
    isLoading = false;
  }
}

// 5) Eventos do mapa
map.on("moveend", loadVisible);
map.on("zoomend", loadVisible);

// 6) Primeira carga
loadVisible();
