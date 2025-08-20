// api/postes/report.js
import { Pool } from "pg";
import ExcelJS from "exceljs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "IDs inválidos" });
  }
  const clean = ids.map((x) => String(x).trim()).filter(Boolean);
  if (!clean.length) return res.status(400).json({ error: "Nenhum ID válido" });

  try {
    const { rows } = await pool.query(
      `
      SELECT d.id, d.nome_municipio, d.nome_bairro, d.nome_logradouro,
             d.material, d.altura, d.tensao_mecanica, d.coordenadas,
             ep.empresa
      FROM dados_poste d
      LEFT JOIN empresa_poste ep ON d.id::text = ep.id_poste
      WHERE d.coordenadas IS NOT NULL AND TRIM(d.coordenadas)<>''  
        AND d.id::text = ANY($1)
    `,
      [clean]
    );
    if (!rows.length) return res.status(404).json({ error: "Nenhum poste encontrado" });

    // Monta o Excel
    const mapPostes = {};
    rows.forEach((r) => {
      if (!mapPostes[r.id]) mapPostes[r.id] = { ...r, empresas: new Set() };
      if (r.empresa) mapPostes[r.id].empresas.add(r.empresa);
    });

    const wb = new ExcelJS.Workbook();
    const sh = wb.addWorksheet("Relatório de Postes");
    sh.columns = [
      { header: "ID POSTE", key: "id", width: 15 },
      { header: "MUNICÍPIO", key: "nome_municipio", width: 20 },
      { header: "BAIRRO", key: "nome_bairro", width: 25 },
      { header: "LOGRADOURO", key: "nome_logradouro", width: 30 },
      { header: "MATERIAL", key: "material", width: 15 },
      { header: "ALTURA", key: "altura", width: 10 },
      { header: "TENSÃO", key: "tensao_mecanica", width: 18 },
      { header: "COORDENADAS", key: "coordenadas", width: 30 },
      { header: "EMPRESAS", key: "empresas", width: 40 },
    ];

    Object.values(mapPostes).forEach((info) => {
      sh.addRow({
        id: info.id,
        nome_municipio: info.nome_municipio,
        nome_bairro: info.nome_bairro,
        nome_logradouro: info.nome_logradouro,
        material: info.material,
        altura: info.altura,
        tensao_mecanica: info.tensao_mecanica,
        coordenadas: info.coordenadas,
        empresas: [...info.empresas].join(", "),
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=relatorio_postes.xlsx");
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Erro report:", err);
    res.status(500).json({ error: "Erro interno" });
  }
}
