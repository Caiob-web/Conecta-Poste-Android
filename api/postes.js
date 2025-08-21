// api/postes.js
import { Pool } from "pg";

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
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

  try {
    const db = getPool();

    // Bounds obrigatórios e paginação
    const minLat = parseFloat(req.query.minLat);
    const maxLat = parseFloat(req.query.maxLat);
    const minLng = parseFloat(req.query.minLng);
    const maxLng = parseFloat(req.query.maxLng);

    if (
      !Number.isFinite(minLat) || !Number.isFinite(maxLat) ||
      !Number.isFinite(minLng) || !Number.isFinite(maxLng)
    ) {
      return res.status(400).json({ error: "Parâmetros de bounds inválidos" });
    }

    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "5000", 10), 100), 20000); // 100–20k
    const offset = (page - 1) * limit;

    // Total no bbox
    const totalRes = await db.query(
      `SELECT COUNT(*) AS c
         FROM dados_poste
        WHERE coordenadas IS NOT NULL AND TRIM(coordenadas) <> ''
          AND CAST(split_part(coordenadas, ',', 1) AS double precision) BETWEEN $1 AND $2
          AND CAST(split_part(coordenadas, ',', 2) AS double precision) BETWEEN $3 AND $4`,
      [minLat, maxLat, minLng, maxLng]
    );
    const total = parseInt(totalRes.rows[0].c, 10);

    // Página no bbox
    const rowsRes = await db.query(
      `SELECT
          d.id,
          d.nome_municipio,
          d.nome_bairro,
          d.nome_logradouro,
          d.material,
          d.altura,
          d.tensao_mecanica,
          d.coordenadas,
          CAST(split_part(d.coordenadas, ',', 1) AS double precision) AS latitude,
          CAST(split_part(d.coordenadas, ',', 2) AS double precision) AS longitude
       FROM dados_poste d
      WHERE d.coordenadas IS NOT NULL AND TRIM(d.coordenadas) <> ''
        AND CAST(split_part(d.coordenadas, ',', 1) AS double precision) BETWEEN $1 AND $2
        AND CAST(split_part(d.coordenadas, ',', 2) AS double precision) BETWEEN $3 AND $4
      ORDER BY d.id
      LIMIT $5 OFFSET $6`,
      [minLat, maxLat, minLng, maxLng, limit, offset]
    );

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({ total, data: rowsRes.rows });
  } catch (err) {
    console.error("Erro em /api/postes:", err);
    return res.status(500).json({ error: "Erro ao buscar postes" });
  }
}
