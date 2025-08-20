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
// Carrega /api/postes, trata 401 redirecionando
// ---------------------------------------------------------------------
fetch("/api/postes")
  .then((res) => {
    if (res.status === 401) {
      window.location.href = "/login.html";
      throw new Error("Não autorizado");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then((data) => {
    if (overlay) overlay.style.display = "none";
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

    // Render em batches
    function addBatch(i = 0, batchSize = 500) {
      const slice = postsArray.slice(i, i + batchSize);
      slice.forEach((poste) => {
        todosPostes.push(poste);
        adicionarMarker(poste);
        municipiosSet.add(poste.nome_municipio);
        bairrosSet.add(poste.nome_bairro);
        logradourosSet.add(poste.nome_logradouro);
        poste.empresas.forEach(
          (e) => (empresasContagem[e] = (empresasContagem[e] || 0) + 1)
        );
      });
      if (i + batchSize < postsArray.length)
        setTimeout(() => addBatch(i + batchSize, batchSize), 0);
      else preencherListas();
    }
    addBatch();
  })
  .catch((err) => {
    console.error("Erro ao carregar postes:", err);
    if (overlay) overlay.style.display = "none";
    if (err.message !== "Não autorizado")
      alert("Erro ao carregar dados dos postes.");
  });

// ---------------------------------------------------------------------
// Preenche datalists de autocomplete
// ---------------------------------------------------------------------
function preencherListas() {
  const mount = (set, id) => {
    const dl = document.getElementById(id);
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
  // monta dados
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

  // cria planilha
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

// Busca por ID
function buscarID() {
  const id = document.getElementById("busca-id").value.trim();
  const p = todosPostes.find((x) => x.id === id);
  if (!p) return alert("Poste não encontrado.");
  map.setView([p.lat, p.lon], 18);
  abrirPopup(p);
}

// Busca por coordenada
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

// Filtro Município/Bairro/Logradouro/Empresa
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
    return alert("Nenhum poste encontrado com esses filtros.");
  markers.clearLayers();
  filtro.forEach(adicionarMarker);

  // exporta back-end
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

  // Gera também no cliente
  gerarExcelCliente(filtro.map((p) => p.id));
}

// Reset mapa
function resetarMapa() {
  markers.clearLayers();
  todosPostes.forEach(adicionarMarker);
}

// Adiciona marker padrão
function adicionarMarker(p) {
  const cor = p.empresas.length >= 5 ? "red" : "green";
  const c = L.circleMarker([p.lat, p.lon], {
    radius: 6,
    fillColor: cor,
    color: "#fff",
    weight: 2,
    fillOpacity: 0.8,
  }).bindTooltip(
    `ID: ${p.id} — ${p.empresas.length} ${
      p.empresas.length === 1 ? "empresa" : "empresas"
    }`,
    { direction: "top", sticky: true }
  );
  c.on("click", () => abrirPopup(p));
  markers.addLayer(c);
}

// Abre popup
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
      div.querySelector("span").textContent = `${
        data.weather[0].description
      }, ${data.main.temp.toFixed(1)}°C (${data.name})`;
    })
    .catch(() => {
      document.querySelector("#tempo span").textContent =
        "Erro ao obter clima.";
    });
}
navigator.geolocation.getCurrentPosition(
  ({ coords }) => obterPrevisaoDoTempo(coords.latitude, coords.longitude),
  () => {}
);
setInterval(
  () =>
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => obterPrevisaoDoTempo(coords.latitude, coords.longitude),
      () => {}
    ),
  600000
);

// ---------------------------------------------------------------------
// Verificar (Consulta massiva + traçado + intermediários)
// ---------------------------------------------------------------------
function consultarIDsEmMassa() {
  const ids = document
    .getElementById("ids-multiplos")
    .value.split(/[^0-9]+/)
    .filter(Boolean);
  if (!ids.length) return alert("Nenhum ID fornecido.");
  markers.clearLayers();
  if (window.tracadoMassivo) map.removeLayer(window.tracadoMassivo);
  window.intermediarios?.forEach((m) => map.removeLayer(m));
  window.numeroMarkers = [];

  const encontrados = ids
    .map((id) => todosPostes.find((p) => p.id === id))
    .filter(Boolean);
  if (!encontrados.length) return alert("Nenhum poste encontrado.");
  encontrados.forEach((p, i) => adicionarNumerado(p, i + 1));

  // intermediários e traçado
  window.intermediarios = [];
  encontrados.slice(0, -1).forEach((a, i) => {
    const b = encontrados[i + 1];
    const d = getDistanciaMetros(a.lat, a.lon, b.lat, b.lon);
    if (d > 50) {
      todosPostes
        .filter((p) => !ids.includes(p.id))
        .filter(
          (p) =>
            getDistanciaMetros(a.lat, a.lon, p.lat, p.lon) +
              getDistanciaMetros(b.lat, b.lon, p.lat, p.lon) <=
            d + 20
        )
        .forEach((p) => {
          const m = L.circleMarker([p.lat, p.lon], {
            radius: 6,
            color: "gold",
            fillColor: "yellow",
            fillOpacity: 0.8,
          })
            .bindTooltip(`ID: ${p.id}<br>Empresas: ${p.empresas.join(", ")}`, {
              direction: "top",
              sticky: true,
            })
            .on("click", () => abrirPopup(p))
            .addTo(map);
          window.intermediarios.push(m);
        });
    }
  });
  map.addLayer(markers);
  const coords = encontrados.map((p) => [p.lat, p.lon]);
  if (coords.length >= 2) {
    window.tracadoMassivo = L.polyline(coords, {
      color: "blue",
      weight: 3,
      dashArray: "4,6",
    }).addTo(map);
    map.fitBounds(L.latLngBounds(coords));
  } else {
    map.setView(coords[0], 18);
  }

  window.ultimoResumoPostes = {
    total: ids.length,
    disponiveis: encontrados.filter((p) => p.empresas.length <= 4).length,
    ocupados: encontrados.filter((p) => p.empresas.length >= 5).length,
    naoEncontrados: ids.filter((id) => !todosPostes.some((p) => p.id === id)),
    intermediarios: window.intermediarios.length,
  };
}

// Adiciona marcador numerado
function adicionarNumerado(p, num) {
  const cor = p.empresas.length >= 5 ? "red" : "green";
  const html = `<div style="
      background:${cor};color:white;width:22px;height:22px;
      border-radius:50%;display:flex;align-items:center;
      justify-content:center;font-size:12px;border:2px solid white
    ">${num}</div>`;
  const mk = L.marker([p.lat, p.lon], { icon: L.divIcon({ html }) });
  mk.bindTooltip(`${p.id}`, { direction: "top", sticky: true });
  mk.bindPopup(
    `<b>ID:</b> ${p.id}<br><b>Município:</b> ${
      p.nome_municipio
    }<br><b>Empresas:</b><ul>${p.empresas
      .map((e) => `<li>${e}</li>`)
      .join("")}</ul>`
  );
  mk.addTo(markers);
  window.numeroMarkers.push(mk);
}

function gerarPDFComMapa() {
  if (!window.tracadoMassivo) return alert("Gere primeiro um traçado.");

  leafletImage(map, (err, canvas) => {
    if (err) return alert("Erro ao capturar imagem.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape" });

    // adiciona o mapa
    doc.addImage(canvas.toDataURL("image/png"), "PNG", 10, 10, 270, 120);

    // dados do resumo
    const resumo = window.ultimoResumoPostes || {
      disponiveis: 0,
      ocupados: 0,
      naoEncontrados: [],
      intermediarios: 0,
    };

    let y = 140;
    doc.setFontSize(12);
    doc.text("Resumo da Verificação:", 10, y);

    doc.text(`✔️ Disponíveis: ${resumo.disponiveis}`, 10, y + 10);
    doc.text(`❌ Indisponíveis: ${resumo.ocupados}`, 10, y + 20);

    // linha que lista os IDs não encontrados
    if (resumo.naoEncontrados.length) {
      const textoIds = resumo.naoEncontrados.join(", ");
      doc.text(
        [`⚠️ Não encontrados (${resumo.naoEncontrados.length}):`, textoIds],
        10,
        y + 30
      );
    } else {
      doc.text("⚠️ Não encontrados: 0", 10, y + 30);
    }

    doc.text(`🟡 Intermediários: ${resumo.intermediarios}`, 10, y + 50);
    doc.save("tracado_postes.pdf");
  });
}

// Distância em metros (haversine)
function getDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000,
    toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1),
    dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Limpa campos e layers auxiliares
function limparTudo() {
  if (window.tracadoMassivo) {
    map.removeLayer(window.tracadoMassivo);
    window.tracadoMassivo = null;
  }
  window.intermediarios?.forEach((m) => map.removeLayer(m));
  [
    "ids-multiplos",
    "busca-id",
    "busca-coord",
    "busca-municipio",
    "busca-bairro",
    "busca-logradouro",
    "busca-empresa",
  ].forEach((id) => {
    document.getElementById(id).value = "";
  });
  resetarMapa();
}

// Exporta Excel genérico
function exportarExcel(ids) {
  fetch("/api/postes/report", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  })
    .then(async (res) => {
      if (res.status === 401) {
        window.location.href = "/login.html";
        throw new Error("Não autorizado");
      }
      if (!res.ok) {
        let err;
        try {
          err = (await res.json()).error;
        } catch {}
        throw new Error(err || `HTTP ${res.status}`);
      }
      return res.blob();
    })
    .then((b) => {
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = u;
      a.download = "relatorio_postes.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(u);
    })
    .catch((e) => {
      console.error("Erro Excel:", e);
      alert("Falha ao gerar Excel:\n" + e.message);
    });
}

// Botão Excel
document.getElementById("btnGerarExcel").addEventListener("click", () => {
  const ids = document
    .getElementById("ids-multiplos")
    .value.split(/[^0-9]+/)
    .filter(Boolean);
  if (!ids.length) return alert("Informe ao menos um ID.");
  exportarExcel(ids);
});

// Toggle painel
document.getElementById("togglePainel").addEventListener("click", () => {
  const p = document.querySelector(".painel-busca");
  p.style.display = p.style.display === "none" ? "block" : "none";
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/logout", { method: "POST" });
  window.location.href = "/login.html";
});
