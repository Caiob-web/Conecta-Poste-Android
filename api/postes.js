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

let hasLatLonCols = null;
async function ensureLatLonMeta(db) {
  if (hasLatLonCols !== null) return;
  const q = await db.query(`
    SELECT COUNT(*) = 2 AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dados_poste'
      AND column_name IN ('latitude','longitude')
  `);
  hasLatLonCols = Boolean(q.rows?.[0]?.ok);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = getPool();

  try {
    await ensureLatLonMeta(db);

    // Bounds
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

    // Paginação
    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "5000", 10), 100), 20000);
    const offset = (page - 1) * limit;

    // Timeout por sessão (NÃO use SET LOCAL fora de transação)
    await db.query(`SET statement_timeout = '8000ms'`);

    // Monta SQL conforme existência das colunas indexadas
    const where = hasLatLonCols
      ? `latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4`
      : `CAST(split_part(coordenadas, ',', 1) AS double precision) BETWEEN $1 AND $2
         AND CAST(split_part(coordenadas, ',', 2) AS double precision) BETWEEN $3 AND $4`;

    const selectCols = hasLatLonCols
      ? `id, nome_municipio, nome_bairro, nome_logradouro, material, altura, tensao_mecanica, coordenadas, latitude, longitude`
      : `id, nome_municipio, nome_bairro, nome_logradouro, material, altura, tensao_mecanica, coordenadas,
         CAST(split_part(coordenadas, ',', 1) AS double precision) AS latitude,
         CAST(split_part(coordenadas, ',', 2) AS double precision) AS longitude`;

    // Total
    const totalSql = `SELECT COUNT(*)::int AS c FROM dados_poste WHERE ${where}`;
    const totalRes = await db.query(totalSql, [a, b, c, d]);
    const total = totalRes.rows?.[0]?.c ?? 0;

    // Página
    const pageSql = `
      SELECT ${selectCols}
      FROM dados_poste
      WHERE ${where}
      ORDER BY id
      LIMIT $5 OFFSET $6
    `;
    const rowsRes = await db.query(pageSql, [a, b, c, d, limit, offset]);

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({ total, page, limit, data: rowsRes.rows });
  } catch (err) {
    console.error("Erro em /api/postes:", err);
    const msg = String(err?.message || err);
    const isTimeout = /statement timeout/i.test(msg) || err?.code === '57014';
    return res
      .status(isTimeout ? 504 : 500)
      .json({ error: isTimeout ? "Tempo excedido na consulta" : "Erro ao buscar postes", detail: msg });
  }
}
