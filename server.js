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

/**
 * GET /api/postes
 * - Se vier ?id=123  -> busca direta por ID (não precisa bounds)
 * - Caso contrário   -> busca por BBOX
 *   Aceita bounds em dois formatos:
 *     (north,south,east,west) OU (minLat,maxLat,minLng,maxLng)
 */
app.get("/api/postes", async (req, res) => {
  try {
    const { id } = req.query;
    const max = Math.min(parseInt(req.query.limit) || 5000, 50000);

    // --- Busca por ID (sem bounds) ---
    if (id != null) {
      const q = `
        SELECT id, municipio, bairro, logradouro, latitude, longitude
        FROM dados_poste
        WHERE CAST(id AS TEXT) = $1
        LIMIT $2
      `;
      const r = await pool.query(q, [String(id), max]);
      return res.json({ data: r.rows, total: r.rowCount });
    }

    // --- Bounds (aceita dois formatos de nomes) ---
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

    const q = `
      SELECT id, municipio, bairro, logradouro, latitude, longitude
      FROM dados_poste
      WHERE latitude BETWEEN $1 AND $2
        AND longitude BETWEEN $3 AND $4
      LIMIT $5
    `;
    const r = await pool.query(q, [s, n, w, e, max]);
    return res.json({ data: r.rows, total: r.rowCount });
  } catch (err) {
    console.error("Erro no /api/postes:", err);
    res.status(500).json({ error: "Erro ao buscar postes" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
