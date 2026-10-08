// Preenchimento das vendas antigas a partir das leituras já gravadas (t_8be054a9, item 4).
//
// 1) Rode scripts/ficha-imovel-backfill.sql (somente leitura) e salve a coluna "vendas" em JSON.
// 2) node scripts/ficha-imovel-backfill.ts entrada.json [--sql saida.sql] [--aplicar]
//    Mostra o resumo (quantas preencheria, quantas ficam sem área, divergências IPTU x matrícula por
//    código e corretor) e, com --sql, escreve o SQL. Sem --aplicar o SQL termina em ROLLBACK (ensaio).
//    Rodar o SQL com COMMIT em produção exige o "sim" do Denis.
import { readFileSync, writeFileSync } from "node:fs";
import {
  planejarVenda,
  resumir,
  sqlPreenchimento,
  type VendaBackfill,
} from "../src/lib/ficha-imovel-backfill.ts";

const [entrada, ...resto] = process.argv.slice(2);
if (!entrada) {
  console.error("uso: node scripts/ficha-imovel-backfill.ts entrada.json [--sql saida.sql] [--aplicar]");
  process.exit(2);
}
const bruto = JSON.parse(readFileSync(entrada, "utf8"));
// Aceita a resposta da API ([{vendas:[...]}]) ou a lista direta.
const vendas: VendaBackfill[] = Array.isArray(bruto) && bruto[0]?.vendas ? bruto[0].vendas : bruto;
const planos = vendas.map(planejarVenda);
console.log(JSON.stringify(resumir(planos), null, 2));
const iSql = resto.indexOf("--sql");
if (iSql >= 0 && resto[iSql + 1]) {
  writeFileSync(resto[iSql + 1], sqlPreenchimento(planos, resto.includes("--aplicar")));
  console.error(`SQL escrito em ${resto[iSql + 1]} (${resto.includes("--aplicar") ? "COMMIT" : "ROLLBACK"})`);
}
