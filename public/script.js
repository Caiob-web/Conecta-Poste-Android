// ===== script.js — BBOX + 20k por página + zoom mínimo + progress =====

const ZOOM_MIN = 12;          // não carrega abaixo disso
const PAGE_LIMIT = 20000;     // 20k por requisição
let isLoading = false;
let lastToken = 0;

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
function getBBoxParams() {
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
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const ct = res.headers.get("content-type") || "";
  const txt = await res.text();
  if (!ct.includes("application/json")) throw new Error(`Resposta não-JSON: ${txt.slice(0,120)}…`);
  return JSON.parse(txt);
}
function addBatch(items, start = 0, batch = 1000) {
  const end = Math.min(start + batch, items.length);
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

  const base = getBBoxParams();
  let page = 1, total = null, loaded = 0;

  try {
    while (true) {
      if (token !== lastToken) break; // outro load começou

      const url = `/api/postes?${base}&page=${page}&limit=${PAGE_LIMIT}`;
      const data = await fetchJsonGuard(url); // se der 400 aqui, é porque faltou BBOX

      if (!data || !Array.isArray(data.data)) throw new Error("Estrutura inesperada da resposta");
      if (total == null) total = Number(data.total) || 0;

      addBatch(data.data);
      loaded += data.data.length;
      setStatus(`Carregando… ${loaded}/${total}`);

      if (loaded >= total || data.data.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
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
