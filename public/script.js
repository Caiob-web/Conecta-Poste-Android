// ===== script.js — Visualização, FIX TDZ + requestIdleCallback =====
const ZOOM_MIN = 12;
const PAGE_LIMIT = 20000;
const FETCH_TIMEOUT_MS = 12000;

const DEBOUNCE_MS = 400;
const FIRST_LOAD_OVERLAY = true;
const SLOW_FIRST_LOAD_MS = 700;

let isLoading = false;
let lastToken = 0;
let firstLoadDone = false;
let overlayTimer = null;
let widgetStarted = false;

/* ---------------------- Mapa ---------------------- */
const map = L.map("map", { preferCanvas: true }).setView([-23.2237, -45.9009], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const markers = L.markerClusterGroup({
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,
  maxClusterRadius: 60,
  disableClusteringAtZoom: 17,
  chunkedLoading: true,
});
map.addLayer(markers);

/* ---------------------- Overlay ---------------------- */
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
    try { return JSON.parse(text); } catch { throw new Error(`Resposta não-JSON: ${text.slice(0, 120)}…`); }
  } finally {
    clearTimeout(to);
  }
}
function parseLatLng(p) {
  let lat = p.latitude ?? p.Latitude ?? p.y;
  let lng = p.longitude ?? p.Longitude ?? p.x;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (p.coordenadas) {
      const [a, b] = String(p.coordenadas).split(",").map(s => parseFloat(s.trim()));
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
  const clean = [], seen = new Set();
  for (const e of empresas) {
    const v = String(e || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v); clean.push(v);
  }
  const lis = clean.map((e) => `<li>${escHTML(e)}</li>`).join("");
  return `<ol style="margin:6px 0 0 18px;padding:0">${lis}</ol>`;
}
function corPorEmpresas(qtd) {
  if (Number(qtd) > 5) return "red";
  if (Number(qtd) >= 4) return "yellow";
  return "green";
}

/* ---------------------- Criação de marker ---------------------- */
function makeMarkerForPoste(p) {
  const ll = parseLatLng(p);
  if (!ll) return null;

  const qtd = Number(p.qtd_empresas ?? 0);
  const marker = L.circleMarker(ll, {
    radius: 6,
    fillColor: corPorEmpresas(qtd),
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
  return marker;
}

/* ---------------------- Render em lotes ---------------------- */
function addBatch(items, start = 0, batch = 1200) {
  const end = Math.min(start + batch, items.length);
  const toAdd = [];

  for (let i = start; i < end; i++) {
    const p = items[i];
    const marker = makeMarkerForPoste(p);
    if (marker) toAdd.push(marker);
  }

  if (toAdd.length) markers.addLayers(toAdd);

  if (end < items.length) {
    const ric = self.requestIdleCallback;
    if (typeof ric === "function") {
      ric(() => addBatch(items, end, batch), { timeout: 50 });
    } else {
      setTimeout(() => addBatch(items, end, batch), 0);
    }
  }
}

/* ---------------------- Carregamento BBOX ---------------------- */
async function loadVisible() {
  if (isLoading) return;

  if (map.getZoom() < ZOOM_MIN) {
    markers.clearLayers();
    hideOverlay(); // sem mensagem travando
    return;
  }

  hideOverlay();
  isLoading = true;
  const token = ++lastToken;
  let cleared = false;

  if (!firstLoadDone && FIRST_LOAD_OVERLAY) showOverlayDeferred("Carregando…");

  let page = 1, total = null, loaded = 0;

  try {
    while (true) {
      if (token !== lastToken) break;

      const qs = buildBBoxQS(); qs.set("page", String(page)); qs.set("limit", String(PAGE_LIMIT));
      const payload = await fetchJsonGuard(`/api/postes?${qs.toString()}`);
      const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
      const got = items.length;

      if (total == null) total = Number(payload?.total ?? got ?? 0);
      if (!got) break;

      if (!cleared && token === lastToken) { markers.clearLayers(); cleared = true; }
      addBatch(items);
      loaded += got;

      if (total > 0 && loaded >= total) break;
      await new Promise(r => setTimeout(r, 60));
      page++;
    }

    if (!firstLoadDone) {
      firstLoadDone = true;
      hideOverlay();
      initClockAndWeather(); // agora seguro
    }
  } catch (e) {
    console.error("Erro ao carregar BBOX:", e);
    hideOverlay();
  } finally {
    isLoading = false;
  }
}

/* ---------------------- Eventos do mapa ---------------------- */
let moveendTimer = null;
map.on("moveend", () => { clearTimeout(moveendTimer); moveendTimer = setTimeout(loadVisible, DEBOUNCE_MS); });
map.on("zoomend",  () => { clearTimeout(moveendTimer); moveendTimer = setTimeout(loadVisible, DEBOUNCE_MS); });
map.whenReady(() => { loadVisible(); initClockAndWeather(); }); // init moveu variáveis para dentro

/* ---------------------- Painel: somente Buscar ID ---------------------- */
function toast(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)",
    background: "rgba(0,0,0,.8)", color: "#fff", padding: "8px 12px",
    borderRadius: "8px", font: "14px system-ui, Arial", zIndex: "9999",
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// Buscar por ID (única função de busca mantida)
async function buscarID() {
  const campo = document.getElementById("campoID");
  const id = campo?.value?.trim();

  if (!id) {
    toast("Digite um ID válido.");
    campo?.focus();
    return;
  }

  // cancela carregamentos BBOX em andamento
  ++lastToken;

  try {
    setLoading(true, "Buscando poste…");

    const qs = new URLSearchParams({ id });
    const payload = await fetchJsonGuard(`/api/postes?${qs.toString()}`);
    const itemsRaw = Array.isArray(payload?.data) ? payload.data
                    : (Array.isArray(payload) ? payload
                    : (payload ? [payload] : []));
    const items = itemsRaw.filter(Boolean);

    if (!items.length) {
      toast("Poste não encontrado.");
      return;
    }

    // desenha somente o(s) resultado(s) da busca
    markers.clearLayers();

    const layers = [];
    for (const p of items) {
      const m = makeMarkerForPoste(p);
      if (m) layers.push(m);
    }
    if (layers.length) {
      markers.addLayers(layers);

      // centraliza/abre popup do primeiro
      const first = items[0];
      const ll = parseLatLng(first);
      if (ll) {
        map.setView(ll, Math.max(map.getZoom(), 18));
        let opened = false;
        markers.eachLayer((ly) => {
          if (!opened && ly.getLatLng) {
            const { lat, lng } = ly.getLatLng();
            if (Math.abs(lat - ll[0]) < 1e-7 && Math.abs(lng - ll[1]) < 1e-7) {
              ly.openPopup();
              opened = true;
            }
          }
        });
      }

      // se houver mais de um, ajusta para ver todos
      if (layers.length > 1) {
        const g = L.featureGroup(layers);
        map.fitBounds(g.getBounds().pad(0.2));
      }
    }
  } catch (e) {
    console.error(e);
    toast("Erro ao buscar poste.");
  } finally {
    hideOverlay();
  }
}

// Expor para o HTML e suportar clique/Enter
function resetarMapa(){ map.setView([-23.2237, -45.9009], 13); }
Object.assign(window,{ buscarID, resetarMapa });

document.getElementById("campoID")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarID();
});
document.getElementById("btnBuscarID")?.addEventListener("click", (e) => {
  e.preventDefault();
  buscarID();
});

/* ---------------------- Botões flutuantes ---------------------- */
document.getElementById("togglePainel")?.addEventListener("click", (e) => {
  e.preventDefault(); e.stopPropagation();
  const p = document.getElementById("painelBusca");
  if (p) p.classList.toggle("hidden");
});

let myLocMarker = null, myLocCircle = null;
document.getElementById("localizacaoUsuario")?.addEventListener("click", (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!navigator.geolocation) return alert("Geolocalização não suportada");

  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const ll = [lat, lng];

    if (!myLocMarker) {
      const blueIcon = L.divIcon({
        className: "user-loc",
        html: `<div style="width:14px;height:14px;background:#2196f3;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 2px rgba(33,150,243,.3)"></div>`,
        iconSize: [18,18], iconAnchor: [9,9]
      });
      myLocMarker = L.marker(ll, { icon: blueIcon }).bindPopup("Você está aqui");
      myLocMarker.addTo(map);
    } else {
      myLocMarker.setLatLng(ll);
    }

    if (!myLocCircle) {
      myLocCircle = L.circle(ll, { radius: accuracy || 30, color: "#2196f3", fillColor: "#2196f3", fillOpacity: .15, weight: 1 });
      myLocCircle.addTo(map);
    } else {
      myLocCircle.setLatLng(ll).setRadius(accuracy || 30);
    }

    map.setView(ll, Math.max(map.getZoom(), 16));
    myLocMarker.openPopup();
  }, (err) => {
    console.warn(err);
    alert("Não foi possível obter sua localização.");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
});

/* ---------------------- Relógio + Clima + Cidade (SEM TDZ) ---------------------- */
function initClockAndWeather() {
  if (widgetStarted) return;
  widgetStarted = true;

  // Seletores dentro da função (evita TDZ)
  const horaDiv  = document.querySelector("#widget-clima #hora");
  const horaSpan = document.querySelector("#widget-clima #hora span");
  let dataSmall  = document.querySelector("#widget-clima #hora small");
  if (!dataSmall && horaDiv) {
    dataSmall = document.createElement("small");
    Object.assign(dataSmall.style, { marginLeft: "6px", fontSize: "12px", opacity: "0.8", fontWeight: "normal" });
    horaDiv.appendChild(dataSmall);
  }
  const tempoWrap = document.querySelector("#widget-clima #tempo");
  const tempoImg  = document.querySelector("#widget-clima #tempo img");
  const tempoSpan = document.querySelector("#widget-clima #tempo span");

  function formatShortDate(d){
    let s = d.toLocaleDateString("pt-BR", { weekday:"short", day:"2-digit", month:"2-digit" });
    return s.replace(/\.$/,"").toLowerCase();
  }
  function startClock(){
    function tick(){
      const now = new Date();
      if (horaSpan) horaSpan.textContent = now.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
      if (dataSmall) dataSmall.textContent = ` ${formatShortDate(now)}`;
    }
    tick(); setInterval(tick, 1000);
  }
  function wxDesc(code){
    const c=+code;
    if ([0].includes(c)) return "Céu limpo";
    if ([1,2].includes(c)) return "Parcialmente nublado";
    if ([3].includes(c)) return "Nublado";
    if ([45,48].includes(c)) return "Neblina";
    if ([51,53,55].includes(c)) return "Garoa";
    if ([61,63,65].includes(c)) return "Chuva";
    if ([80,81,82].includes(c)) return "Pancadas de chuva";
    if ([71,73,75,77].includes(c)) return "Neve";
    if ([95,96,99].includes(c)) return "Tempestade";
    return "Tempo indefinido";
  }
  function wxIconDataURI(code,isDay){
    const c=+code;
    const sun=`<circle cx="16" cy="16" r="6" fill="${isDay?'#FDB813':'#B0C4DE'}"/>`;
    const cloud=`<ellipse cx="18" cy="18" rx="10" ry="6" fill="#cfd8dc"/>`;
    const drops=`<path d="M10 26 l2 -4 l2 4 z M18 26 l2 -4 l2 4 z M26 26 l2 -4 l2 4 z" fill="#4fc3f7"/>`;
    const bolt=`<polygon points="18,16 14,24 20,24 16,32 26,22 20,22 24,16" fill="#fdd835"/>`;
    let inner='';
    if (c===0) inner=sun;
    else if ([1,2].includes(c)) inner=`${sun}${cloud}`;
    else if ([3,45,48].includes(c)) inner=cloud;
    else if ([51,53,55,61,63,65,80,81,82].includes(c)) inner=`${cloud}${drops}`;
    else if ([95,96,99].includes(c)) inner=`${cloud}${bolt}`;
    else inner=`${cloud}`;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">${inner}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
  const geoCache = new Map();
  async function reverseGeocodeName(lat, lon){
    const key=`${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (geoCache.has(key)) return geoCache.get(key);
    const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&accept-language=pt-BR`;
    try{
      const data=await fetchJsonGuard(url);
      const a=data?.address || {};
      const city=a.city || a.town || a.village || a.municipality || a.city_district || a.suburb || a.county;
      const state=a.state || a.region;
      const place = city ? (state ? `${city} - ${state}` : city) : (state || (data?.display_name?.split(",")[0] || "Local"));
      geoCache.set(key, place);
      return place;
    }catch{
      geoCache.set(key, "");
      return "";
    }
  }
  async function refreshWeather(lat, lon){
    try{
      const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,is_day&timezone=auto`;
      const data=await fetchJsonGuard(url);
      const c=data?.current; if(!c) throw new Error("Sem dados de clima");
      const desc=wxDesc(c.weather_code);
      const temp=Math.round(c.temperature_2m);
      const place=await reverseGeocodeName(lat,lon);
      if (tempoSpan) tempoSpan.textContent = `${place ? place + " — " : ""}${temp}°C — ${desc}`;
      if (tempoImg) { tempoImg.src = wxIconDataURI(c.weather_code, c.is_day===1); tempoImg.alt = desc; tempoImg.style.display="inline-block"; }
    }catch(e){
      if (tempoSpan) tempoSpan.textContent = "Clima indisponível";
      if (tempoImg) tempoImg.style.display = "none";
      console.warn("Falha ao obter clima:", e);
    }
  }

  // iniciar
  startClock();
  const c = map.getCenter();
  refreshWeather(c.lat, c.lng);
  setInterval(() => { const cc = map.getCenter(); refreshWeather(cc.lat, cc.lng); }, 10*60*1000);
  tempoWrap?.addEventListener("click", () => { const cc = map.getCenter(); refreshWeather(cc.lat, cc.lng); });
}
