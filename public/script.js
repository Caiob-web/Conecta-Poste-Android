// script.js

// inicializa mapa
const map = L.map("map").setView([-23.1896, -45.8841], 13);

// tile layer
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(map);

const markers = L.markerClusterGroup();
map.addLayer(markers);

const progressDiv = document.getElementById("progress");
let carregados = 0;

// função para adicionar marcadores
function addMarkers(postes) {
  postes.forEach((p) => {
    if (!p.latitude || !p.longitude) return;

    const marker = L.marker([p.latitude, p.longitude]);
    marker.bindPopup(`
      <b>ID:</b> ${p.id}<br>
      <b>Município:</b> ${p.nome_municipio || ""}<br>
      <b>Bairro:</b> ${p.nome_bairro || ""}<br>
      <b>Rua:</b> ${p.nome_logradouro || ""}<br>
      <b>Empresa:</b> ${p.empresa || "Nenhuma"}<br>
      <b>Material:</b> ${p.material || ""}<br>
      <b>Altura:</b> ${p.altura || ""}<br>
      <b>Tensão:</b> ${p.tensao_mecanica || ""}<br>
    `);

    markers.addLayer(marker);
  });
}

// função para carregar postes com paginação
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

    // total de registros (só pega da primeira resposta)
    if (!total) total = data.total;

    carregados += data.data.length;
    const porcentagem = Math.min(
      (carregados / total) * 100,
      100
    ).toFixed(1);

    progressDiv.innerText = `⚡ Carregando postes... ${carregados}/${total} (${porcentagem}%)`;

    // continua carregando as próximas páginas
    if (carregados < total) {
      setTimeout(() => loadPostes(page + 1, limit, total), 200);
    } else {
      progressDiv.innerText = `✅ ${total} postes carregados`;
      setTimeout(() => {
        progressDiv.style.display = "none";
      }, 2000);
    }
  } catch (err) {
    console.error("Erro geral:", err);
    progressDiv.innerText = "❌ Erro ao carregar postes";
  }
}

// inicia carregamento
loadPostes();
