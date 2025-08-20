// server.js
import express from "express";
import pkg from "pg";
import cors from "cors";

const { Pool } = pkg;
const app = express();
app.use(cors());

// conexão com o banco
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // importante pro Vercel/Neon
});

// rota principal de teste
app.get("/", (req, res) => {
  res.send("API de Postes rodando 🚀");
});

// rota para buscar postes com paginação
app.get("/api/postes", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 500;
    const offset = (page - 1) * limit;

    // total de registros
    const totalResult = await pool.query("SELECT COUNT(*) FROM dados_poste");
    const total = parseInt(totalResult.rows[0].count);

    // busca com paginação
    const result = await pool.query(
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
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      total,
      data: result.rows,
    });
  } catch (err) {
    console.error("Erro no /api/postes:", err);
    res.status(500).json({ error: "Erro ao buscar postes" });
  }
});

// porta
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
