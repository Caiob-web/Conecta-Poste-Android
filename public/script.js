// ===== script.js — Versão Visualização (mobile/tablet) =====
// - BBOX com paginação
// - Overlay só no 1º load (com atraso)
// - Sem overlay em pan/zoom
// - Debounce de eventos
// - Timeout de fetch
// - Limpa marcadores apenas quando chega o 1º lote novo

/* ---------------------- Configuração ---------------------- */
const ZOOM_MIN = 12;          // não carrega abaixo disso (ajuste para 13/14 se quiser menos dados)
const PAGE_LIMIT = 20000;     // 20k por requisição
const FETCH_TIMEOUT_MS = 12000;

/* UX de carregamento */
const DEBOUNCE_MS = 400;      // reduz chamadas consecutivas no mobile
const FIRST_LOAD_OVERLAY = true;     // overlay só no 1º carregamento
const SLOW_FIRST_LOAD_MS = 700;      // mostra overlay do 1º load apenas se demorar mais que isso

/* ---------------------- Estado global ---------------------- */
let isLoading = false;
let lastToken = 0;
let firstLoadDone = false;
let overlayTimer = null;

/* ---------------------- Mapa ---------------------- */
const map = L.map("map", { preferCanvas: true }).setView([-23.2237, -45.9009], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const markers = L.markerClusterGroup({
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,
  maxClusterRadius: 60,
  disableClusteringAtZoom: 17,
  chunkedLoading: true, // melhora muito no mobile
});
map.addLayer(markers);

/* ---------------------- Overlay helpers ---------------------- */
const overlay = document.getElementById("carregando");
const overlayText = overlay?.querySelector(".texto-loading");

function setLoading(show, msg) {
  if (overlayText) overlayText.textContent = msg || "Carregando postes…";
  if (overlay) overlay.style.display = show ? "flex" : "none";
}
function showOverlayDeferred(msg, delay = SLOW_FIRST_LOAD_MS) {
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => setLoading(true, msg), delay);
}
function hideOverlay() {
  clearTimeout(overlayTimer);
  setLoading(false);
}

/* ---------------------- Helpers ---------------------- */
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
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort("timeout"), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}: ${text.slice(0, 120)}…`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Resposta não-JSON: ${text.slice(0, 120)}…`);
    }
  } finally {
    clearTimeout(to);
  }
}

function parseLatLng(p) {
  // tenta latitude/longitude; senão, tenta "lat,lon" na string coordenadas
  let lat = p.latitude ?? p.Latitude ?? p.y;
  let lng = p.longitude ?? p.Longitude ?? p.x;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (p.coordenadas) {
      const [a, b] = String(p.coordenadas).split(",").map((s) => parseFloat(s.trim()));
      lat = a; lng = b;
    }
  }
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

function addBatch(items, start = 0, batch = 1200) {
  const end = Math.min(start + batch, items.length);
  const toAdd = [];
  for (let i = start; i < end; i++) {
    const p = items[i];
    const ll = parseLatLng(p);
    if (!ll) continue;

    const marker = L.circleMarker(ll, {
      radius: 6,
      fillColor: "green",
      color: "#fff",
      weight: 2,
      fillOpacity: 0.8,
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

/* ---------------------- Carregamento BBOX ---------------------- */
async function loadVisible() {
  if (isLoading) return;

  // Mensagem somente quando o zoom está baixo
  if (map.getZoom() < ZOOM_MIN) {
    markers.clearLayers();
    setLoading(true, `Aproxime o zoom (≥ ${ZOOM_MIN}) para carregar os postes.`);
    return;
  } else {
    hideOverlay();
  }

  isLoading = true;
  const token = ++lastToken;

  // Não limpamos marcadores aqui; só após chegar o 1º lote novo
  let cleared = false;

  // Overlay apenas no 1º carregamento (se demorar)
  if (!firstLoadDone && FIRST_LOAD_OVERLAY) {
    showOverlayDeferred("Carregando…");
  }

  let page = 1, total = null, loaded = 0;

  try {
    while (true) {
      if (token !== lastToken) break; // outra carga começou

      const qs = buildBBoxQS();
      qs.set("page", String(page));
      qs.set("limit", String(PAGE_LIMIT));
      const url = `/api/postes?${qs.toString()}`;

      const payload = await fetchJsonGuard(url);
      const items = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
        ? payload
        : [];
      const got = items.length;

      if (total == null) total = Number(payload?.total ?? got ?? 0);

      if (!got) break;

      // chegou conteúdo novo: limpamos uma única vez
      if (!cleared && token === lastToken) {
        markers.clearLayers();
        cleared = true;
      }

      addBatch(items);
      loaded += got;

      // sem overlay de progresso (evitar “telão” a cada pan)
      if (total > 0 && loaded >= total) break;

      await new Promise((r) => setTimeout(r, 60)); // respiro pro main thread
      page++;
    }

    // 1º carregamento concluído — some overlay, marque conclusão
    if (!firstLoadDone) {
      firstLoadDone = true;
      hideOverlay();
    }
  } catch (e) {
    console.error("Erro ao carregar BBOX:", e);
    // em erro, mantemos os marcadores antigos e não mostramos overlay
    hideOverlay();
  } finally {
    isLoading = false;
  }
}

/* ---------------------- Eventos do mapa (debounced) ---------------------- */
let moveendTimer = null;
map.on("moveend", () => {
  clearTimeout(moveendTimer);
  moveendTimer = setTimeout(loadVisible, DEBOUNCE_MS);
});
map.on("zoomend", () => {
  clearTimeout(moveendTimer);
  moveendTimer = setTimeout(loadVisible, DEBOUNCE_MS);
});
map.whenReady(loadVisible);

/* ---------------------- Botões essenciais ---------------------- */
document.getElementById("togglePainel")?.addEventListener("click", () => {
  const p = document.getElementById("painelBusca");
  p.style.display = p.style.display === "none" ? "block" : "none";
});

document.getElementById("localizacaoUsuario")?.addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Geolocalização não suportada");
  navigator.geolocation.getCurrentPosition(
    (pos) =>
      map.setView(
        [pos.coords.latitude, pos.coords.longitude],
        Math.max(map.getZoom(), 16)
      ),
    () => alert("Não foi possível obter sua localização")
  );
});

/* ---------------------- Stubs (versão visualização) ---------------------- */
// Evitam erros se alguém clicar nos botões desta versão
function toast(msg) {
  try {
    // micro-toast simples
    const el = document.createElement("div");
    el.textContent = msg;
    Object.assign(el.style, {
      position: "fixed",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0,0,0,.8)",
      color: "#fff",
      padding: "8px 12px",
      borderRadius: "8px",
      font: "14px system-ui, Arial",
      zIndex: "9999",
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  } catch {
    alert(msg);
  }
}

function buscarID() { toast("Função indisponível nesta versão (visualização)."); }
function buscarCoordenada() { toast("Função indisponível nesta versão (visualização)."); }
function filtrarLocal() { toast("Função indisponível nesta versão (visualização)."); }
function consultarIDsEmMassa() { toast("Função indisponível nesta versão (visualização)."); }
function resetarMapa() { map.setView([-23.2237, -45.9009], 13); }
function gerarPDFComMapa() { toast("Função indisponível nesta versão (visualização)."); }

// Exporta no escopo global (por segurança com onclicks inline)
Object.assign(window, {
  buscarID,
  buscarCoordenada,
  filtrarLocal,
  consultarIDsEmMassa,
  resetarMapa,
  gerarPDFComMapa,
});
