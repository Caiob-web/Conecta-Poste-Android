// api/censo.js
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
      SELECT poste, cidade, coordenadas
      FROM censo_municipio
      WHERE coordenadas IS NOT NULL AND TRIM(coordenadas)<>''  
    `);
    res.status(200).json(rows);
  } catch (err) {
    console.error("Erro /api/censo:", err);
    res.status(500).json({ error: "Erro no servidor" });
  }
}
