// api/postes.js
import { Pool } from "pg";

// Reutiliza a conexão entre invocações
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
  // Apenas GET
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
      "SELECT COUNT(*) FROM dados_poste WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
    );
    const total = parseInt(totalResult.rows[0].count, 10);

    const result = await db.query(
      `SELECT id,
              nome_municipio,
              nome_bairro,
              nome_logradouro,
              empresa,
              latitude,
              longitude,
              material,
              altura,
              tensao_mecanica
       FROM dados_poste
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Cache na edge do Vercel (opcional)
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ total, data: result.rows });
  } catch (err) {
    console.error("Erro em /api/postes:", err);
    res.status(500).json({ error: "Erro ao buscar postes" });
  }
}
