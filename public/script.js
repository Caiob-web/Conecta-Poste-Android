const map = L.map("map").setView([-23.18, -45.88], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(map);

const layerGroup = L.layerGroup().addTo(map);

const loadingDiv = document.getElementById("loading");
const statusText = document.getElementById("status");

// função para buscar postes visíveis no mapa
async function fetchPostes() {
  loadingDiv.style.display = "block";
  statusText.innerText = "Carregando postes visíveis...";

  const bounds = map.getBounds();
  const north = bounds.getNorth();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const west = bounds.getWest();

  try {
    const res = await fetch(
      `/api/postes?north=${north}&south=${south}&east=${east}&west=${west}&limit=5000`
    );
    const json = await res.json();

    layerGroup.clearLayers();
    json.data.forEach((p) => {
      if (p.latitude && p.longitude) {
        L.circleMarker([p.latitude, p.longitude], {
          radius: 4,
          color: "#007bff",
          fillOpacity: 0.7,
        }).bindPopup(`
          <b>ID:</b> ${p.id}<br>
          <b>Município:</b> ${p.municipio}<br>
          <b>Bairro:</b> ${p.bairro}<br>
          <b>Rua:</b> ${p.logradouro}
        `).addTo(layerGroup);
      }
    });

    statusText.innerText = `Postes carregados: ${json.data.length}`;
  } catch (err) {
    console.error(err);
    statusText.innerText = "Erro ao carregar postes.";
  } finally {
    setTimeout(() => (loadingDiv.style.display = "none"), 1500);
  }
}

// busca inicial
fetchPostes();

// recarregar ao mover ou dar zoom
map.on("moveend", fetchPostes);
