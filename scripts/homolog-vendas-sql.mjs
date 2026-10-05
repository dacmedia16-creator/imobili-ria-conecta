// Aplicador isolado para o Supabase de homologação. Não imprime credenciais nem SQL com dados.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const ref = "qvhyepwduhlgqwpgmpvh";
const config = Object.fromEntries(readFileSync("/root/.config/max/adm-max-homolog.env", "utf8")
  .split("\n").filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
const host = config.HOMOLOG_POOLER_HOST;
if (config.HOMOLOG_REF !== ref || config.HOMOLOG_URL !== `https://${ref}.supabase.co` ||
    config.HOMOLOG_POOLER_USER !== `postgres.${ref}` ||
    !/^[\w.-]+\.pooler\.supabase\.com$/.test(host || "") || !config.HOMOLOG_DB_PASSWORD)
  throw Error("Identidade de homologação inválida; nada executado");
const env = { ...process.env, PGPASSWORD: config.HOMOLOG_DB_PASSWORD, PGSSLMODE: "require" };
const psql = (args, input) => {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-h", host,
    "-p", "5432", "-U", config.HOMOLOG_POOLER_USER, "-d", "postgres", ...args],
    { env, input, encoding: "utf8", timeout: 25000 });
  if (result.status !== 0) throw Error(`Consulta SQL de homologação falhou (${result.status}): ${result.error?.code ?? "sem detalhes"}`);
  return result.stdout.trim();
};
const identity = psql(["-t", "-A", "-c", "SELECT current_database() || '|' || current_user"]);
if (![`postgres|postgres.${ref}`, "postgres|postgres"].includes(identity)) throw Error(`Identidade inesperada do banco (${identity}); nada executado`);
console.log("Identidade do banco de homologação validada");
const command = process.argv[2];
if (command === "--probe") {
  const cols = psql(["-t", "-A", "-c", "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='sales' AND column_name='imovel_observacoes_origem'"]);
  console.log(`Trava da matrícula presente: ${cols === "1"}`);
} else if (command === "--apply") {
  const migrations = [
    "20261005120000_vendas_creci_conta_qualificacao.sql",
    "20261005121000_trava_descricao_matricula.sql",
  ];
  for (const migration of migrations) {
    const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
    psql(["-q", "--single-transaction"], sql);
    console.log(`${migration}: aplicada em homologação`);
  }
} else throw Error("Use --probe ou --apply");
