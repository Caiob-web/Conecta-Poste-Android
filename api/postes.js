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
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "500", 10);
    const offset = (page - 1) * limit;

    const db = getPool();

    const totalResult = await db.query(
      `SELECT COUNT(*) AS c 
         FROM dados_poste 
        WHERE coordenadas IS NOT NULL 
          AND TRIM(coordenadas) <> ''`
    );
    const total = parseInt(totalResult.rows[0].c, 10);

    const result = await db.query(
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
          CAST(split_part(d.coordenadas, ',', 2) AS double precision) AS longitude,
          ep.empresa
       FROM dados_poste d
       LEFT JOIN empresa_poste ep
              ON d.id::text = ep.id_poste
      WHERE d.coordenadas IS NOT NULL 
        AND TRIM(d.coordenadas) <> ''
      ORDER BY d.id
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ total, data: result.rows });
  } catch (err) {
    console.error("Erro em /api/postes:", err);
    return res.status(500).json({ error: "Erro ao buscar postes" });
  }
}
