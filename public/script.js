// =====================================================================
//  script.js — Mapa de Postes + Excel, PDF, Censo, Coordenadas
// =====================================================================

// Inicializa mapa e clusters
const map = L.map("map").setView([-23.2, -45.9], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
const markers = L.markerClusterGroup({
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,
  maxClusterRadius: 60,
  disableClusteringAtZoom: 17,
});
markers.on("clusterclick", (e) => e.layer.spiderfy());
map.addLayer(markers);

// Dados e sets para autocomplete
const todosPostes = [];
const empresasContagem = {};
const municipiosSet = new Set();
const bairrosSet = new Set();
const logradourosSet = new Set();
let censoMode = false, censoIds = null;

// Spinner overlay
const overlay = document.getElementById("carregando");
if (overlay) overlay.style.display = "flex";

// ---------------------------------------------------------------------
// Função que busca postes dentro do mapa atual (BBOX)
// ---------------------------------------------------------------------
async function carregarPostesVisiveis() {
  if (overlay) overlay.style.display = "flex";

  const bounds = map.getBounds();
  const params = new URLSearchParams({
    minLat: bounds.getSouth(),
    maxLat: bounds.getNorth(),
    minLng: bounds.getWest(),
    maxLng: bounds.getEast(),
  });

  try {
    const res = await fetch(`/api/postes?${params.toString()}`);
    if (res.status === 401) {
      window.location.href = "/login.html";
      throw new Error("Não autorizado");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (overlay) overlay.style.display = "none";

    // limpa e adiciona de novo
    markers.clearLayers();
    todosPostes.length = 0;
    municipiosSet.clear();
    bairrosSet.clear();
    logradourosSet.clear();
    Object.keys(empresasContagem).forEach((k) => delete empresasContagem[k]);

    const agrupado = {};
    data.forEach((p) => {
      if (!p.coordenadas) return;
      const [lat, lon] = p.coordenadas.split(/,\s*/).map(Number);
      if (isNaN(lat) || isNaN(lon)) return;
      if (!agrupado[p.id]) agrupado[p.id] = { ...p, empresas: new Set(), lat, lon };
      if (p.empresa && p.empresa.toUpperCase() !== "DISPONÍVEL")
        agrupado[p.id].empresas.add(p.empresa);
    });

    const postsArray = Object.values(agrupado).map((p) => ({
      ...p,
      empresas: [...p.empresas],
    }));

    postsArray.forEach((poste) => {
      todosPostes.push(poste);
      adicionarMarker(poste);
      municipiosSet.add(poste.nome_municipio);
      bairrosSet.add(poste.nome_bairro);
      logradourosSet.add(poste.nome_logradouro);
      poste.empresas.forEach(
        (e) => (empresasContagem[e] = (empresasContagem[e] || 0) + 1)
      );
    });

    preencherListas();
  } catch (err) {
    console.error("Erro ao carregar postes:", err);
    if (overlay) overlay.style.display = "none";
    if (err.message !== "Não autorizado")
      alert("Erro ao carregar dados dos postes.");
  }
}

// Carrega postes sempre que o mapa mudar
map.on("moveend", carregarPostesVisiveis);
// Primeira carga
carregarPostesVisiveis();

// ---------------------------------------------------------------------
// Preenche datalists de autocomplete
// ---------------------------------------------------------------------
function preencherListas() {
  const mount = (set, id) => {
    const dl = document.getElementById(id);
    dl.innerHTML = ""; // limpa antes
    Array.from(set)
      .sort()
      .forEach((v) => {
        const o = document.createElement("option");
        o.value = v;
        dl.appendChild(o);
      });
  };
  mount(municipiosSet, "lista-municipios");
  mount(bairrosSet, "lista-bairros");
  mount(logradourosSet, "lista-logradouros");
  // empresas com label
  const dlEmp = document.getElementById("lista-empresas");
  dlEmp.innerHTML = "";
  Object.keys(empresasContagem)
    .sort()
    .forEach((e) => {
      const o = document.createElement("option");
      o.value = e;
      o.label = `${e} (${empresasContagem[e]} postes)`;
      dlEmp.appendChild(o);
    });
}

// ---------------------------------------------------------------------
// Geração de Excel no cliente via SheetJS
// ---------------------------------------------------------------------
function gerarExcelCliente(filtroIds) {
  const dadosParaExcel = todosPostes
    .filter((p) => filtroIds.includes(p.id))
    .map((p) => ({
      "ID POSTE": p.id,
      Município: p.nome_municipio,
      Bairro: p.nome_bairro,
      Logradouro: p.nome_logradouro,
      Empresas: p.empresas.join(", "),
      Coordenadas: p.coordenadas,
    }));

  const ws = XLSX.utils.json_to_sheet(dadosParaExcel);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Filtro");
  XLSX.writeFile(wb, "relatorio_postes_filtrados.xlsx");
}

// ---------------------------------------------------------------------
// Modo Censo
// ---------------------------------------------------------------------
document.getElementById("btnCenso").addEventListener("click", async () => {
  censoMode = !censoMode;
  markers.clearLayers();
  if (!censoMode) return todosPostes.forEach(adicionarMarker);

  if (!censoIds) {
    try {
      const res = await fetch("/api/censo");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.json();
      censoIds = new Set(arr.map((i) => String(i.poste)));
    } catch {
      alert("Não foi possível carregar dados do censo.");
      censoMode = false;
      return todosPostes.forEach(adicionarMarker);
    }
  }
  todosPostes
    .filter((p) => censoIds.has(String(p.id)))
    .forEach((poste) => {
      const c = L.circleMarker([poste.lat, poste.lon], {
        radius: 6,
        color: "#666",
        fillColor: "#bbb",
        weight: 2,
        fillOpacity: 0.8,
      }).bindTooltip(`ID: ${poste.id}`, { direction: "top", sticky: true });
      c.on("click", () => abrirPopup(poste));
      markers.addLayer(c);
    });
});

// ---------------------------------------------------------------------
// Interações / filtros
// ---------------------------------------------------------------------
function buscarID() {
  const id = document.getElementById("busca-id").value.trim();
  const p = todosPostes.find((x) => x.id === id);
  if (!p) return alert("Poste não encontrado nesta área.");
  map.setView([p.lat, p.lon], 18);
  abrirPopup(p);
}

function buscarCoordenada() {
  const inpt = document.getElementById("busca-coord").value.trim();
  const [lat, lon] = inpt.split(/,\s*/).map(Number);
  if (isNaN(lat) || isNaN(lon)) return alert("Use o formato: lat,lon");
  map.setView([lat, lon], 18);
  L.popup()
    .setLatLng([lat, lon])
    .setContent(`<b>Coordenada:</b> ${lat}, ${lon}`)
    .openOn(map);
}

function filtrarLocal() {
  const getVal = (id) => document.getElementById(id).value.trim().toLowerCase();
  const [mun, bai, log, emp] = [
    "busca-municipio",
    "busca-bairro",
    "busca-logradouro",
    "busca-empresa",
  ].map(getVal);

  const filtro = todosPostes.filter(
    (p) =>
      (!mun || p.nome_municipio.toLowerCase() === mun) &&
      (!bai || p.nome_bairro.toLowerCase() === bai) &&
      (!log || p.nome_logradouro.toLowerCase() === log) &&
      (!emp || p.empresas.join(", ").toLowerCase().includes(emp))
  );
  if (!filtro.length)
    return alert("Nenhum poste encontrado com esses filtros nesta área.");
  markers.clearLayers();
  filtro.forEach(adicionarMarker);

  fetch("/api/postes/report", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: filtro.map((p) => p.id) }),
  })
    .then(async (res) => {
      if (res.status === 401) {
        window.location.href = "/login.html";
        throw new Error("Não autorizado");
      }
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      return res.blob();
    })
    .then((b) => {
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = u;
      a.download = "relatorio_postes_filtro_backend.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(u);
    })
    .catch((e) => {
      console.error("Erro exportar filtro:", e);
      alert("Falha ao gerar Excel backend:\n" + e.message);
    });

  gerarExcelCliente(filtro.map((p) => p.id));
}

function resetarMapa() {
  markers.clearLayers();
  todosPostes.forEach(adicionarMarker);
}

function adicionarMarker(p) {
  const cor = p.empresas.length >= 5 ? "red" : "green";
  const c = L.circleMarker([p.lat, p.lon], {
    radius: 6,
    fillColor: cor,
    color: "#fff",
    weight: 2,
    fillOpacity: 0.8,
  }).bindTooltip(
    `ID: ${p.id} — ${p.empresas.length} ${p.empresas.length === 1 ? "empresa" : "empresas"}`,
    { direction: "top", sticky: true }
  );
  c.on("click", () => abrirPopup(p));
  markers.addLayer(c);
}

function abrirPopup(p) {
  const list = p.empresas.map((e) => `<li>${e}</li>`).join("");
  const html = `
    <b>ID:</b> ${p.id}<br>
    <b>Coord:</b> ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}<br>
    <b>Município:</b> ${p.nome_municipio}<br>
    <b>Bairro:</b> ${p.nome_bairro}<br>
    <b>Logradouro:</b> ${p.nome_logradouro}<br>
    <b>Empresas:</b><ul>${list}</ul>
  `;
  L.popup().setLatLng([p.lat, p.lon]).setContent(html).openOn(map);
}

// ---------------------------------------------------------------------
// Minha localização
// ---------------------------------------------------------------------
document.getElementById("localizacaoUsuario").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Geolocalização não suportada.");
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const latlng = [coords.latitude, coords.longitude];
      L.marker(latlng).addTo(map).bindPopup("📍 Você está aqui!").openPopup();
      map.setView(latlng, 17);
      obterPrevisaoDoTempo(coords.latitude, coords.longitude);
    },
    () => alert("Erro ao obter localização."),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ---------------------------------------------------------------------
// Hora local
// ---------------------------------------------------------------------
function mostrarHoraLocal() {
  const s = document.querySelector("#hora span");
  if (!s) return;
  s.textContent = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
setInterval(mostrarHoraLocal, 60000);
mostrarHoraLocal();

// ---------------------------------------------------------------------
// Clima via OpenWeatherMap
// ---------------------------------------------------------------------
function obterPrevisaoDoTempo(lat, lon) {
  const API_KEY = "b93c96ebf4fef0c26a0caaacdd063ee0";
  fetch(
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&lang=pt_br&units=metric&appid=${API_KEY}`
  )
    .then((r) => r.json())
    .then((data) => {
      const url = `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`;
      const div = document.getElementById("tempo");
      div.querySelector("img").src = url;
      div.querySelector("span").textContent = `${data.weather[0].description}, ${data.main.temp.toFixed(1)}°C (${data.name})`;
    })
    .catch(() => {
      document.querySelector("#tempo span").textContent = "Erro ao obter clima.";
    });
}
navigator.geolocation.getCurrentPosition(
  ({ coords }) => obterPrevisaoDoTempo(coords.latitude, coords.longitude),
  () => {}
);
setInterval(
  () => navigator.geolocation.getCurrentPosition(
    ({ coords }) => obterPrevisaoDoTempo(coords.latitude, coords.longitude),
    () => {}
  ),
  600000
);

// ---------------------------------------------------------------------
// (Consulta massiva + traçado + intermediários)
// ---------------------------------------------------------------------
// ... mantém igual ao seu código anterior (consultarIDsEmMassa, adicionarNumerado, gerarPDFComMapa, etc.)
// ---------------------------------------------------------------------

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/logout", { method: "POST" });
  window.location.href = "/login.html";
});

// Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}
