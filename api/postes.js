// /api/postes.js
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

  const db = getPool();

  try {
    // --- Bounds obrigatórios ---
    const minLat = parseFloat(req.query.minLat);
    const maxLat = parseFloat(req.query.maxLat);
    const minLng = parseFloat(req.query.minLng);
    const maxLng = parseFloat(req.query.maxLng);

    if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) {
      return res.status(400).json({ error: "Parâmetros de bounds inválidos" });
    }
    let a = minLat, b = maxLat, c = minLng, d = maxLng;
    if (a > b) [a, b] = [b, a];
    if (c > d) [c, d] = [d, c];

    // Proteção: BBOX muito grande (evita varredura acidental)
    const bboxArea = Math.abs((b - a) * (d - c));
    if (bboxArea > 0.30) {
      return res.status(400).json({ error: "Área muito grande. Aproxime o zoom." });
    }

    // --- Paginação ---
    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "5000", 10), 100), 20000);
    const offset = (page - 1) * limit;

    // Timeout por sessão (com transação p/ SET LOCAL)
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout = '8000ms'");

    // Base filtrada pelo BBOX (sem mexer no schema)
    // Depois agregamos empresas APENAS para os IDs da página.
    const sql = `
      WITH base AS (
        SELECT
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
      ),
      paged AS (
        SELECT *, COUNT(*) OVER()::int AS total
        FROM base
        LIMIT $5 OFFSET $6
      ),
      emp AS (
        SELECT
          e.id_poste,
          COUNT(DISTINCT e.empresa)::int                         AS qtd_empresas,
          jsonb_agg(DISTINCT e.empresa ORDER BY e.empresa) AS empresas
        FROM empresa_poste e
        WHERE e.id_poste IN (SELECT id FROM paged)
        GROUP BY e.id_poste
      )
      SELECT
        p.id, p.nome_municipio, p.nome_bairro, p.nome_logradouro,
        p.material, p.altura, p.tensao_mecanica, p.coordenadas,
        p.latitude, p.longitude,
        COALESCE(emp.qtd_empresas, 0)           AS qtd_empresas,
        COALESCE(emp.empresas, '[]'::jsonb)     AS empresas,
        p.total
      FROM paged p
      LEFT JOIN emp ON emp.id_poste = p.id
    `;

    const { rows } = await db.query(sql, [a, b, c, d, limit, offset]);
    await db.query("COMMIT");

    const total = rows[0]?.total ?? 0;
    for (const r of rows) delete r.total;

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({ total, page, limit, data: rows });
  } catch (err) {
    try { await db.query("ROLLBACK"); } catch {}
    const msg = String(err?.message || err);
    const isTimeout = /statement timeout/i.test(msg) || err?.code === "57014";
    console.error("Erro em /api/postes:", err);
    return res
      .status(isTimeout ? 504 : 500)
      .json({ error: isTimeout ? "Tempo excedido na consulta" : "Erro ao buscar postes", detail: msg });
  }
}
