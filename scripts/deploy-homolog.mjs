#!/usr/bin/env node
// Deploy deliberadamente separado. Não usa npm run deploy:safe nem o Worker de produção.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = join(ROOT, ".output", "server");
const HOMOLOG = "qvhyepwduhlgqwpgmpvh";
const PROD = "xvvymgurpchhlmbpjbgc";
const WORKER = "adm-max-homolog";
const URL = "https://adm-max-homolog.dacmedia16.workers.dev";
const publish = process.argv.length === 3 && process.argv[2] === "--publish";
if (!publish && (process.argv.length !== 3 || process.argv[2] !== "--build-only")) {
  throw new Error("Uso: node scripts/deploy-homolog.mjs --build-only|--publish");
}
if (process.cwd() !== ROOT) throw new Error("Execute na raiz do repositório");
const vars = Object.fromEntries(
  readFileSync("/root/.config/max/adm-max-homolog.env", "utf8")
    .split("\n").filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }),
);
if (vars.HOMOLOG_REF !== HOMOLOG || vars.HOMOLOG_URL !== `https://${HOMOLOG}.supabase.co` ||
    !vars.HOMOLOG_ANON_KEY || !vars.HOMOLOG_SERVICE_ROLE_KEY) {
  throw new Error("Identidade ou credenciais da homologação inválidas");
}
const environment = {
  ...process.env,
  VITE_SUPABASE_URL: vars.HOMOLOG_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: vars.HOMOLOG_ANON_KEY,
  SUPABASE_URL: vars.HOMOLOG_URL,
  SUPABASE_PUBLISHABLE_KEY: vars.HOMOLOG_ANON_KEY,
  VITE_HOMOLOG_ONLY: "true",
  APP_URL: URL,
};
// A homologação não recebe nenhuma credencial de integração externa do shell.
for (const name of Object.keys(environment)) {
  if (/ZIONTALK|GEMINI|LOVABLE_API|RESEND|SMTP|SUPABASE_SERVICE_ROLE/i.test(name)) delete environment[name];
}
function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: options.cwd ?? ROOT, env: environment,
    input: options.input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    // Wrangler exibe bindings (inclusive chave pública) na saída de deploy.
    // Não transportar a saída para logs nem para o cartão.
    throw new Error(`${program} falhou (${result.status}); confira o log local protegido`);
  }
  if (!options.quiet) console.log(options.label || `${program}: OK`);
}
run("npm", ["run", "build"]);
const generated = JSON.parse(readFileSync(join(OUTPUT, "wrangler.json"), "utf8"));
if (generated.name !== "imobili-ria-conecta" || !generated.main || !generated.assets) {
  throw new Error("Configuração gerada inesperada; deploy bloqueado");
}
const safe = {
  ...generated, name: WORKER, keep_vars: false, workers_dev: true, preview_urls: false,
  vars: { SUPABASE_URL: vars.HOMOLOG_URL, SUPABASE_PUBLISHABLE_KEY: vars.HOMOLOG_ANON_KEY,
          APP_URL: URL },
};
delete safe.triggers; // jamais executar lembretes agendados na homologação
for (const k of ["routes", "route", "custom_domain", "env", "unsafe"]) delete safe[k];
const config = join(OUTPUT, "wrangler.homolog.json");
writeFileSync(config, JSON.stringify(safe, null, 2));
// Remova a configuração original de produção também do artefato, para impedir
// que uma publicação prebuilt acidental escolha o Worker ou as vars errados.
writeFileSync(join(OUTPUT, "wrangler.json"), JSON.stringify(safe, null, 2));
let files = 0;
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (entry.isFile()) {
      files++;
      if (entry.name.match(/\.(mjs|js|json|html|css|map|txt|svg)$/) &&
          readFileSync(path).includes(Buffer.from(PROD))) {
        throw new Error(`Referência à produção no artefato: ${path.slice(ROOT.length + 1)}`);
      }
    }
  }
}
scan(join(ROOT, ".output", "server"));
scan(join(ROOT, ".output", "public"));
if (!JSON.stringify(safe.vars).includes(HOMOLOG) || safe.name !== WORKER || safe.triggers) {
  throw new Error("Configuração da homologação inválida");
}
console.log(`Artefato isolado aprovado: ${files} arquivos, nome ${WORKER}, sem ref de produção, sem cron`);
if (publish) {
  const wrangler = join(ROOT, "node_modules", ".bin", "wrangler");
  run(wrangler, ["deploy", "--config", "wrangler.homolog.json"], { cwd: OUTPUT });
  run(wrangler, ["secret", "put", "SUPABASE_SERVICE_ROLE_KEY", "--config", "wrangler.homolog.json"],
    { cwd: OUTPUT, input: `${vars.HOMOLOG_SERVICE_ROLE_KEY}\n`, quiet: true });
  console.log(`Worker publicado (confira por leitura independente): ${URL}`);
}
