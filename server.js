import express from "express";
import pkg from "pg";
import cors from "cors";

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.get("/", (req, res) => {
  res.send("API de Postes rodando 🚀");
});

/** Util: busca por uma lista de IDs (texto) */
async function queryByIds(idList, limit = 50) {
  const ids = Array.from(new Set(
    (idList || []).map((s) => String(s ?? "").trim()).filter(Boolean)
  ));
  const max = Math.min(parseInt(limit) || 50, 1000);

  if (ids.length === 0) return { rows: [], rowCount: 0 };

  const sql = `
    SELECT id, municipio, bairro, logradouro, latitude, longitude
    FROM dados_poste
    WHERE CAST(id AS TEXT) = ANY ($1::text[])
    LIMIT $2
  `;
  const r = await pool.query(sql, [ids, max]);
  return r;
}

/** GET /api/postes/:id  -> busca por ID sem bounds */
app.get("/api/postes/:id", async (req, res) => {
  try {
    const r = await queryByIds([req.params.id], req.query.limit);
    res.json({ data: r.rows, total: r.rowCount });
  } catch (err) {
    console.error("Erro no /api/postes/:id:", err);
    res.status(500).json({ error: "Erro ao buscar poste por ID" });
  }
});

/**
 * GET /api/postes
 * - Se tiver id ou ids: busca por ID(s) (sem bounds)
 * - Senão: busca por BBOX (aceita north/south/east/west OU minLat/maxLat/minLng/maxLng)
 */
app.get("/api/postes", async (req, res) => {
  try {
    const { id, ids, limit } = req.query;

    // ---- Busca por ID(s) sem bounds ----
    if (id != null || ids != null) {
      const list = [];
      if (id != null) list.push(String(id));
      if (ids != null) list.push(...String(ids).split(","));
      const r = await queryByIds(list, limit);
      return res.json({ data: r.rows, total: r.rowCount });
    }

    // ---- BBOX ----
    let { north, south, east, west, minLat, maxLat, minLng, maxLng } = req.query;
    if (north == null && maxLat != null) north = maxLat;
    if (south == null && minLat != null) south = minLat;
    if (east  == null && maxLng != null) east  = maxLng;
    if (west  == null && minLng != null) west  = minLng;

    if (north == null || south == null || east == null || west == null) {
      return res.status(400).json({ error: "Parâmetros de bounds inválidos" });
    }

    const n = Number(north), s = Number(south), e = Number(east), w = Number(west);
    if (![n, s, e, w].every(Number.isFinite)) {
      return res.status(400).json({ error: "Bounds devem ser números" });
    }

    // (opcional) limitar área máxima para proteger o DB
    const area = Math.abs((n - s) * (e - w));
    const MAX_AREA = 50; // latitude*longitude (~bem grande). Ajuste se quiser restringir.
    if (area > MAX_AREA) {
      return res.status(400).json({ error: "Área muito grande. Aproxime o zoom." });
    }

    const max = Math.min(parseInt(limit) || 5000, 50000);
    const query = `
      SELECT id, municipio, bairro, logradouro, latitude, longitude
      FROM dados_poste
      WHERE latitude BETWEEN $1 AND $2
        AND longitude BETWEEN $3 AND $4
      LIMIT $5
    `;
    const result = await pool.query(query, [s, n, w, e, max]);
    res.json({ data: result.rows, total: result.rowCount });
  } catch (err) {
    console.error("Erro no /api/postes:", err);
    res.status(500).json({ error: "Erro ao buscar postes" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
