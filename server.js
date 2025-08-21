import express from "express";
import pkg from "pg";
import cors from "cors";

const { Pool } = pkg;
const app = express();
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.get("/", (req, res) => {
  res.send("API de Postes rodando 🚀");
});

// rota para buscar postes por bounding box (visível no mapa)
app.get("/api/postes", async (req, res) => {
  try {
    const { north, south, east, west, limit } = req.query;
    const max = parseInt(limit) || 5000;

    const query = `
      SELECT id, municipio, bairro, logradouro, latitude, longitude
      FROM dados_poste
      WHERE latitude BETWEEN $1 AND $2
        AND longitude BETWEEN $3 AND $4
      LIMIT $5
    `;

    const result = await pool.query(query, [south, north, west, east, max]);
    res.json({ data: result.rows });
  } catch (err) {
    console.error("Erro no /api/postes:", err);
    res.status(500).json({ error: "Erro ao buscar postes" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
