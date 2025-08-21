// /api/postes.js
import { Pool } from "pg";

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL, // use o pooler da Neon
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getPool();

  try {
    const minLat = parseFloat(req.query.minLat);
    const maxLat = parseFloat(req.query.maxLat);
    const minLng = parseFloat(req.query.minLng);
    const maxLng = parseFloat(req.query.maxLng);

    if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) {
      return res.status(400).json({ error: "Parâmetros de bounds inválidos" });
    }

    // Normaliza ranges
    let a = minLat, b = maxLat, c = minLng, d = maxLng;
    if (a > b) [a, b] = [b, a];
    if (c > d) [c, d] = [d, c];

    // Proteção: BBOX muito grande (evita varreduras acidentais)
    const bboxArea = Math.abs((b - a) * (d - c));
    if (bboxArea > 1.0) { // ~1 grau² já é enorme
      return res.status(400).json({ error: "Área muito grande. Aproxime o zoom." });
    }

    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "5000", 10), 100), 20000);
    const offset = (page - 1) * limit;

    // Garante que consultas longas não travem seu lambda
    await db.query("SET LOCAL statement_timeout = '8000ms'");

    // COUNT usando colunas geradas indexadas
    const totalRes = await db.query(
      `SELECT COUNT(*)::int AS c
         FROM dados_poste
        WHERE latitude  BETWEEN $1 AND $2
          AND longitude BETWEEN $3 AND $4`,
      [a, b, c, d]
    );
    const total = totalRes.rows[0].c;

    // Página dos registros (sem CAST no WHERE)
    const rowsRes = await db.query(
      `SELECT
         id, nome_municipio, nome_bairro, nome_logradouro,
         material, altura, tensao_mecanica, coordenadas,
         latitude, longitude
       FROM dados_poste
       WHERE latitude  BETWEEN $1 AND $2
         AND longitude BETWEEN $3 AND $4
       ORDER BY id
       LIMIT $5 OFFSET $6`,
      [a, b, c, d, limit, offset]
    );

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({ total, page, limit, data: rowsRes.rows });
  } catch (err) {
    console.error("Erro em /api/postes:", err);
    const isTimeout = /statement timeout/i.test(String(err?.message || err));
    return res
      .status(isTimeout ? 504 : 500)
      .json({ error: isTimeout ? "Tempo excedido na consulta" : "Erro ao buscar postes" });
  }
}
