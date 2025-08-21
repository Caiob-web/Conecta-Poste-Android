// ============================================================
//  script.js  —  Carregamento em blocos de 20k + Cluster + Progresso
// ============================================================

// 1) Mapa Leaflet
const map = L.map("map").setView([-23.2237, -45.9009], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
const markers = L.markerClusterGroup({
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,
  maxClusterRadius: 60,
  disableClusteringAtZoom: 17,
});
markers.on("clusterclick", (e) => e.layer.spiderfy());
map.addLayer(markers);

// 2) Indicador de progresso (criado dinamicamente)
const progressDiv = document.createElement("div");
Object.assign(progressDiv.style, {
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
progressDiv.textContent = "Carregando postes…";
document.body.appendChild(progressDiv);

// 3) Helpers
function addMarkers(batch) {
  batch.forEach((p) => {
    const lat = p.latitude ?? (p.coordenadas ? parseFloat(p.coordenadas.split(",")[0]) : null);
    const lng = p.longitude ?? (p.coordenadas ? parseFloat(p.coordenadas.split(",")[1]) : null);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const cor = (Array.isArray(p.empresas) ? p.empresas.length : (p.empresa ? 1 : 0)) >= 5 ? "red" : "green";
    const marker = L.circleMarker([lat, lng], {
      radius: 6,
      fillColor: cor,
      color: "#fff",
      weight: 2,
      fillOpacity: 0.8,
    }).bindPopup(`
      <b>ID:</b> ${p.id}<br>
      <b>Coord:</b> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
      <b>Município:</b> ${p.nome_municipio ?? ""}<br>
      <b>Bairro:</b> ${p.nome_bairro ?? ""}<br>
      <b>Logradouro:</b> ${p.nome_logradouro ?? ""}<br>
      <b>Empresa(s):</b> ${
        Array.isArray(p.empresas) ? p.empresas.join(", ") : (p.empresa ?? "Nenhuma")
      }<br>
      <b>Material:</b> ${p.material ?? ""}<br>
      <b>Altura:</b> ${p.altura ?? ""}<br>
      <b>Tensão:</b> ${p.tensao_mecanica ?? ""}
    `);

    markers.addLayer(marker);
  });
}

// Garante que a resposta é JSON (evita parse de HTML vindo do SW/erro)
async function fetchJsonGuard(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!ct.includes("application/json")) {
    throw new Error(`Resposta não-JSON: ${text.slice(0, 120)}…`);
  }
  return JSON.parse(text);
}

// 4) Carregamento em blocos de 20.000
async function loadPostes20k() {
  const LIMIT = 20000;        // <<< aqui definimos 20k por requisição
  let page = 1;
  let total = null;
  let carregados = 0;

  try {
    while (true) {
      const url = `/api/postes?page=${page}&limit=${LIMIT}`;
      const data = await fetchJsonGuard(url);

      if (!data || !Array.isArray(data.data)) {
        console.error("Estrutura inesperada:", data);
        progressDiv.textContent = "❌ Erro: estrutura inesperada de resposta";
        return;
      }

      if (total == null) total = Number(data.total) || 0;

      addMarkers(data.data);
      carregados += data.data.length;

      const pct = total ? Math.min((carregados / total) * 100, 100) : 0;
      progressDiv.textContent = `Carregando postes… ${carregados}/${total} (${pct.toFixed(1)}%)`;

      // Termina quando trouxe tudo
      if (carregados >= total || data.data.length === 0) break;

      // Pequena pausa para não travar o navegador
      await new Promise((r) => setTimeout(r, 150));
      page += 1;
    }

    progressDiv.textContent = `✅ ${carregados} postes carregados`;
    setTimeout(() => (progressDiv.style.display = "none"), 2000);
  } catch (err) {
    console.error("Erro ao carregar postes:", err);
    progressDiv.textContent = "❌ Erro ao carregar postes";
  }
}

// 5) Inicia
loadPostes20k();

// ------------------------------------------------------------
// Observações importantes:
// - Garanta que o Service Worker NÃO intercepte '/api/*'.
//   No sw.js, no handler de 'fetch':
//     if (new URL(e.request.url).pathname.startsWith('/api/')) return;  // não intercepta
// - Teste a API no navegador: /api/postes?page=1&limit=10 deve retornar JSON.
// - O backend (api/postes.js) precisa usar split_part(coordenadas, ',')
//   para expor latitude/longitude.
// ------------------------------------------------------------
