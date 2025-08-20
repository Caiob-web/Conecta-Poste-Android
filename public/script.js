// ------------------------------------------------------------
// MAPA LEAFLET
// ------------------------------------------------------------
const map = L.map("map").setView([-23.2237, -45.9009], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

// Grupo de clusters para otimizar
const markers = L.markerClusterGroup();
map.addLayer(markers);

// ------------------------------------------------------------
// ELEMENTOS DE STATUS (barra de progresso)
// ------------------------------------------------------------
const progressDiv = document.createElement("div");
progressDiv.style.position = "absolute";
progressDiv.style.top = "10px";
progressDiv.style.left = "50%";
progressDiv.style.transform = "translateX(-50%)";
progressDiv.style.background = "rgba(0,0,0,0.7)";
progressDiv.style.color = "white";
progressDiv.style.padding = "6px 12px";
progressDiv.style.borderRadius = "8px";
progressDiv.style.fontSize = "14px";
progressDiv.style.fontFamily = "Arial, sans-serif";
progressDiv.style.zIndex = "9999";
progressDiv.innerText = "Carregando postes...";
document.body.appendChild(progressDiv);

// ------------------------------------------------------------
// FUNÇÃO: Adicionar marcadores
// ------------------------------------------------------------
function addMarkers(postes) {
  postes.forEach((p) => {
    if (!p.coordenadas) return;

    const [lat, lng] = p.coordenadas.split(",").map((c) => parseFloat(c.trim()));
    if (!lat || !lng) return;

    const marker = L.marker([lat, lng]).bindPopup(`
      <b>ID:</b> ${p.id}<br>
      <b>Município:</b> ${p.nome_municipio || ""}<br>
      <b>Bairro:</b> ${p.nome_bairro || ""}<br>
      <b>Rua:</b> ${p.nome_logradouro || ""}<br>
      <b>Empresa:</b> ${p.empresa || "Nenhuma"}<br>
      <b>Material:</b> ${p.material || ""}<br>
      <b>Altura:</b> ${p.altura || ""}<br>
      <b>Tensão:</b> ${p.tensao_mecanica || ""}
    `);
    markers.addLayer(marker);
  });
}

// ------------------------------------------------------------
// FUNÇÃO: Carregar postes com paginação
// ------------------------------------------------------------
async function loadPostes(page = 1, limit = 500, total = null) {
  try {
    const res = await fetch(`/api/postes?page=${page}&limit=${limit}`);
    const data = await res.json();

    if (!data || !data.data) {
      console.error("Erro ao carregar postes:", data);
      progressDiv.innerText = "❌ Erro ao carregar postes";
      return;
    }

    addMarkers(data.data);

    // total de registros
    if (!total) total = data.total;
    const carregados = Math.min(page * limit, total);
    const porcentagem = ((carregados / total) * 100).toFixed(1);

    progressDiv.innerText = `Carregando postes... ${carregados}/${total} (${porcentagem}%)`;

    // continua carregando as próximas páginas
    if (carregados < total) {
      console.log(`Carregando página ${page + 1}...`);
      setTimeout(() => loadPostes(page + 1, limit, total), 300); // 300ms de intervalo
    } else {
      progressDiv.innerText = `✅ ${total} postes carregados com sucesso!`;
      setTimeout(() => {
        progressDiv.style.display = "none";
      }, 3000);
    }
  } catch (err) {
    console.error("Erro no fetch:", err);
    progressDiv.innerText = "❌ Erro de conexão";
  }
}

// ------------------------------------------------------------
// INÍCIO DO CARREGAMENTO
// ------------------------------------------------------------
loadPostes();
