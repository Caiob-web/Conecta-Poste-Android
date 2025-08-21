// ===== script.js — Versão Visualização (mobile/tablet) =====
// - BBOX com paginação
// - Overlay só no 1º load (e com atraso)
// - Sem overlay em pan/zoom
// - Debounce de eventos
// - Timeout de fetch
// - Limpa marcadores apenas quando chega o 1º lote novo
// - Cores por qtd de empresas: <4 = verde | 4–5 = amarelo | >5 = vermelho
// - Relógio e Clima (Open-Meteo) no canto esquerdo

/* ---------------------- Configuração ---------------------- */
const ZOOM_MIN = 12;                // não carrega abaixo disso
const PAGE_LIMIT = 20000;           // 20k por requisição
const FETCH_TIMEOUT_MS = 12000;

/* UX de carregamento */
const DEBOUNCE_MS = 400;            // reduz chamadas consecutivas no mobile
const FIRST_LOAD_OVERLAY = true;    // overlay só no 1º carregamento
const SLOW_FIRST_LOAD_MS = 700;     // mostra overlay do 1º load apenas se demorar mais que isso

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

/* ---------------------- Helpers comuns ---------------------- */
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

function escHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function empresasComoLista(empresas) {
  if (!Array.isArray(empresas) || empresas.length === 0) return "—";
  // tira vazios e duplicados mantendo ordem
  const clean = [];
  const seen = new Set();
  for (const e of empresas) {
    const v = String(e || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    clean.push(v);
  }
  const lis = clean.map((e) => `<li>${escHTML(e)}</li>`).join("");
  return `<ol style="margin:6px 0 0 18px;padding:0">${lis}</ol>`;
}

/* ----------- Cores por quantidade de empresas (regras) ----------- */
function corPorEmpresas(qtd) {
  // verde: <4 ; amarelo: 4–5 ; vermelho: >5
  if (Number(qtd) > 5) return "red";
  if (Number(qtd) >= 4) return "yellow";
  return "green";
}

/* ---------------------- Render em lotes ---------------------- */
function addBatch(items, start = 0, batch = 1200) {
  const end = Math.min(start + batch, items.length);
  const toAdd = [];
  for (let i = start; i < end; i++) {
    const p = items[i];
    const ll = parseLatLng(p);
    if (!ll) continue;

    const qtd = Number(p.qtd_empresas ?? 0);
    const fill = corPorEmpresas(qtd);

    const marker = L.circleMarker(ll, {
      radius: 6,
      fillColor: fill,
      color: "#fff",
      weight: 2,
      fillOpacity: 0.9,
    }).bindPopup(`
      <b>ID:</b> ${escHTML(p.id ?? "")}<br>
      <b>Coord:</b> ${ll[0].toFixed(6)}, ${ll[1].toFixed(6)}<br>
      <b>Município:</b> ${escHTML(p.nome_municipio ?? "")}<br>
      <b>Bairro:</b> ${escHTML(p.nome_bairro ?? "")}<br>
      <b>Logradouro:</b> ${escHTML(p.nome_logradouro ?? "")}<br>
      <b>Material:</b> ${escHTML(p.material ?? "")}<br>
      <b>Altura:</b> ${escHTML(p.altura ?? "")}<br>
      <b>Tensão:</b> ${escHTML(p.tensao_mecanica ?? "")}<br>
      <b>Empresas (${qtd}):</b>
      ${empresasComoLista(p.empresas)}
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

  // Aviso apenas quando o zoom está baixo
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

      if (total > 0 && loaded >= total) break;
      await new Promise((r) => setTimeout(r, 60)); // respiro
      page++;
    }

    // 1º carregamento concluído — some overlay, marque conclusão
    if (!firstLoadDone) {
      firstLoadDone = true;
      hideOverlay();
      // dispara o clima depois do 1º load
      initClockAndWeather();
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
function toast(msg) {
  try {
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

/* ---------------------- Relógio + Clima ---------------------- */
const horaSpan  = document.querySelector("#widget-clima #hora span");
const tempoWrap = document.querySelector("#widget-clima #tempo");
const tempoImg  = document.querySelector("#widget-clima #tempo img");
const tempoSpan = document.querySelector("#widget-clima #tempo span");

function startClock() {
  function tick() {
    try {
      const agora = new Date();
      const str = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      if (horaSpan) horaSpan.textContent = str;
    } catch {}
  }
  tick();
  setInterval(tick, 1000);
}

function wxDesc(code) {
  // tabela simplificada (Open-Meteo weather_code)
  const c = Number(code);
  if ([0].includes(c)) return "Céu limpo";
  if ([1, 2].includes(c)) return "Parcialmente nublado";
  if ([3].includes(c)) return "Nublado";
  if ([45, 48].includes(c)) return "Neblina";
  if ([51, 53, 55].includes(c)) return "Garoa";
  if ([61, 63, 65].includes(c)) return "Chuva";
  if ([80, 81, 82].includes(c)) return "Pancadas de chuva";
  if ([71, 73, 75, 77].includes(c)) return "Neve";
  if ([95, 96, 99].includes(c)) return "Tempestade";
  return "Tempo indefinido";
}

function wxIconDataURI(code, isDay) {
  // ícones SVG minimalistas embutidos (data URI)
  const c = Number(code);
  const sun = `<circle cx="16" cy="16" r="6" fill="${isDay ? '#FDB813' : '#B0C4DE'}"/>`;
  const cloud = `<ellipse cx="18" cy="18" rx="10" ry="6" fill="#cfd8dc"/>`;
  const drops = `<path d="M10 26 l2 -4 l2 4 z M18 26 l2 -4 l2 4 z M26 26 l2 -4 l2 4 z" fill="#4fc3f7"/>`;
  const bolt = `<polygon points="18,16 14,24 20,24 16,32 26,22 20,22 24,16" fill="#fdd835"/>`;
  let inner = '';
  if (c === 0) inner = sun;
  else if ([1,2].includes(c)) inner = `${sun}${cloud}`;
  else if ([3,45,48].includes(c)) inner = cloud;
  else if ([51,53,55,61,63,65,80,81,82].includes(c)) inner = `${cloud}${drops}`;
  else if ([95,96,99].includes(c)) inner = `${cloud}${bolt}`;
  else inner = `${cloud}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">${inner}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function refreshWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,is_day&timezone=auto`;
    const data = await fetchJsonGuard(url);
    const c = data?.current;
    if (!c) throw new Error("Sem dados de clima");
    const desc = wxDesc(c.weather_code);
    const temp = Math.round(c.temperature_2m);
    if (tempoSpan) tempoSpan.textContent = `${temp}°C — ${desc}`;
    if (tempoImg) {
      tempoImg.src = wxIconDataURI(c.weather_code, c.is_day === 1);
      tempoImg.alt = desc;
      tempoImg.style.display = "inline-block";
    }
  } catch (e) {
    if (tempoSpan) tempoSpan.textContent = "Clima indisponível";
    if (tempoImg) tempoImg.style.display = "none";
    console.warn("Falha ao obter clima:", e);
  }
}

function initClockAndWeather() {
  // Relógio
  startClock();

  // Clima inicial no centro do mapa
  const c = map.getCenter();
  refreshWeather(c.lat, c.lng);

  // Atualiza clima a cada 10 min
  setInterval(() => {
    const cc = map.getCenter();
    refreshWeather(cc.lat, cc.lng);
  }, 10 * 60 * 1000);

  // Clique no widget força atualização
  tempoWrap?.addEventListener("click", () => {
    const cc = map.getCenter();
    refreshWeather(cc.lat, cc.lng);
  });
}
