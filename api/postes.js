// api/postes.js
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }
  try {
    const { rows } = await pool.query(`
      SELECT d.id, d.nome_municipio, d.nome_bairro, d.nome_logradouro,
             d.material, d.altura, d.tensao_mecanica, d.coordenadas,
             ep.empresa
      FROM dados_poste d
      LEFT JOIN empresa_poste ep ON d.id::text = ep.id_poste
      WHERE d.coordenadas IS NOT NULL AND TRIM(d.coordenadas)<>''  
    `);
    res.status(200).json(rows);
  } catch (err) {
    console.error("Erro /api/postes:", err);
    res.status(500).json({ error: "Erro no servidor" });
  }
}
