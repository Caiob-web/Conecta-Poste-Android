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

function parseBounds(query) {
  if (query.bbox) {
    const [west, south, east, north] = String(query.bbox).split(",").map(parseFloat);
    if ([west, south, east, north].some((n) => !Number.isFinite(n))) return null;
    return { minLat: south, maxLat: north, minLng: west, maxLng: east };
  }
  const minLat = parseFloat(query.minLat);
  const maxLat = parseFloat(query.maxLat);
  const minLng = parseFloat(query.minLng);
  const maxLng = parseFloat(query.maxLng);
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const db = getPool();
    const b = parseBounds(req.query);
    if (!b) {
      return res.status(400).json({
        error: "Parâmetros de bounds inválidos",
        exemplo: "/api/postes?bbox=-46.6,-23.3,-46.4,-23.2",
      });
    }

    // normaliza ranges
    let { minLat, maxLat, minLng, maxLng } = b;
    if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
    if (minLng > maxLng) [minLng, maxLng] = [maxLng, minLng];

    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "5000", 10), 100), 20000);
    const offset = (page - 1) * limit;

    // total de postes no BBOX
    const countSql = `
      SELECT COUNT(*)::int AS c
      FROM dados_poste d
      WHERE d.coordenadas IS NOT NULL AND TRIM(d.coordenadas) <> ''
        AND CAST(split_part(d.coordenadas, ',', 1) AS double precision) BETWEEN $1 AND $2
        AND CAST(split_part(d.coordenadas, ',', 2) AS double precision) BETWEEN $3 AND $4
    `;
    const { rows: countRows } = await db.query(countSql, [minLat, maxLat, minLng, maxLng]);
    const total = countRows?.[0]?.c ?? 0;

    // seleciona a página primeiro (CTE), depois agrega empresas por poste
    const pageSql = `
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
        LIMIT $5 OFFSET $6
      )
      SELECT
        b.*,
        COALESCE(emp.empresas, '[]'::jsonb)     AS empresas,      -- array de nomes
        COALESCE(emp.qtd, 0)                   AS qtd_empresas   -- quantidade
      FROM base b
      LEFT JOIN LATERAL (
        SELECT
          jsonb_agg(DISTINCT e.empresa ORDER BY e.empresa) AS empresas,
          COUNT(DISTINCT e.empresa)                        AS qtd
        FROM empresa_poste e
        WHERE e.id_poste = b.id
      ) emp ON TRUE
    `;
    const { rows } = await db.query(pageSql, [minLat, maxLat, minLng, maxLng, limit, offset]);

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({ total, page, limit, data: rows });
  } catch (err) {
    console.error("Erro em /api/postes:", err);
    return res.status(500).json({ error: "Erro ao buscar postes" });
  }
}
