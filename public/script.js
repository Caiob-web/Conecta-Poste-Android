// ------------------------------------------------------------
// MAPA LEAFLET
// ------------------------------------------------------------
const map = L.map("map").setView([-23.2237, -45.9009], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(map);

const markers = L.markerClusterGroup();
map.addLayer(markers);

// ------------------------------------------------------------
// PROGRESSO (criado dinamicamente)
// ------------------------------------------------------------
const progressDiv = document.createElement("div");
progressDiv.style.position = "absolute";
progressDiv.style.top = "12px";
progressDiv.style.left = "50%";
progressDiv.style.transform = "translateX(-50%)";
progressDiv.style.background = "rgba(0,0,0,.75)";
progressDiv.style.color = "#fff";
progressDiv.style.padding = "6px 12px";
progressDiv.style.borderRadius = "8px";
progressDiv.style.font = "14px system-ui, Arial";
progressDiv.style.zIndex = "9999";
progressDiv.textContent = "Carregando postes…";
document.body.appendChild(progressDiv);

let carregados = 0;
let totalEsperado = null;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function addMarkers(postes) {
  postes.forEach((p) => {
    const lat = p.latitude ?? (p.coordenadas ? parseFloat(p.coordenadas.split(",")[0]) : null);
    const lng = p.longitude ?? (p.coordenadas ? parseFloat(p.coordenadas.split(",")[1]) : null);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const m = L.marker([lat, lng]).bindPopup(`
      <b>ID:</b> ${p.id}<br>
      <b>Município:</b> ${p.nome_municipio ?? ""}<br>
      <b>Bairro:</b> ${p.nome_bairro ?? ""}<br>
      <b>Rua:</b> ${p.nome_logradouro ?? ""}<br>
      <b>Empresa:</b> ${p.empresa ?? "Nenhuma"}<br>
      <b>Material:</b> ${p.material ?? ""}<br>
      <b>Altura:</b> ${p.altura ?? ""}<br>
      <b>Tensão:</b> ${p.tensao_mecanica ?? ""}
    `);
    markers.addLayer(m);
  });
}

async function fetchJsonGuard(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!ct.includes("application/json")) {
    // provavelmente veio HTML (login/erro); mostra um pedaço para debug
    throw new Error(`Resposta não-JSON: ${text.slice(0, 120)}…`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Falha ao parsear JSON: ${e.message}`);
  }
}

// ------------------------------------------------------------
// Carregamento paginado (500 por vez)
// ------------------------------------------------------------
async function loadPostes(page = 1, limit = 500) {
  const url = `/api/postes?page=${page}&limit=${limit}`;
  try {
    const data = await fetchJsonGuard(url);

    if (Array.isArray(data)) {
      // backend antigo devolvendo array puro
      if (totalEsperado == null) totalEsperado = data.length;
      addMarkers(data);
      carregados += data.length;
    } else if (data && Array.isArray(data.data) && Number.isFinite(data.total)) {
      // backend novo: { total, data: [...] }
      if (totalEsperado == null) totalEsperado = data.total;
      addMarkers(data.data);
      carregados += data.data.length;
    } else {
      console.error("Estrutura inesperada:", data);
      progressDiv.textContent = "❌ Erro ao carregar postes (estrutura inesperada)";
      return;
    }

    const pct = totalEsperado ? Math.min((carregados / totalEsperado) * 100, 100) : 0;
    progressDiv.textContent = `Carregando postes… ${carregados}/${totalEsperado ?? "?"} (${pct.toFixed(1)}%)`;

    // continua enquanto houver mais
    if (totalEsperado && carregados < totalEsperado) {
      setTimeout(() => loadPostes(page + 1, limit), 200);
    } else {
      progressDiv.textContent = `✅ ${carregados} postes carregados`;
      setTimeout(() => (progressDiv.style.display = "none"), 2000);
    }
  } catch (err) {
    console.error("Erro ao carregar postes:", err);
    progressDiv.textContent = "❌ Erro ao carregar postes";
  }
}

loadPostes();
