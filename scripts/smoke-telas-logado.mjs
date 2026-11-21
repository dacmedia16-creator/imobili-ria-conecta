// Conferência pós-publicação logado (t_afb2ffe8). Chamado pelo deploy-safe.sh depois do smoke público.
// Abre as telas principais com a conta de TESTE (sessão já criada fora do repositório, em arquivo 600)
// e sai com código 1 se alguma tela quebrar. O deploy-safe faz o rollback nesse caso.
//
// Só leitura: toda escrita no banco (POST/PATCH/PUT/DELETE em /rest/v1 fora de /rpc/) é bloqueada no
// navegador, e o tour de primeiro acesso é dado como concluído só nesta aba.
//
// Uso: SESSAO=<arquivo.json> BASE_URL=https://app... PLAYWRIGHT_DIR=<pasta com node_modules/playwright>
//      [CHROME=/usr/bin/google-chrome] [OUT_DIR=<pasta para prints de falha>] node scripts/smoke-telas-logado.mjs
// O arquivo de sessão tem { storage_key, session } (formato do sessao_teste.py). Nada é impresso dele.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const SESSAO = process.env.SESSAO;
const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const PW_DIR = process.env.PLAYWRIGHT_DIR;
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const OUT = process.env.OUT_DIR || "";
if (!SESSAO || !BASE || !PW_DIR) {
  console.error("smoke-telas: faltam SESSAO, BASE_URL ou PLAYWRIGHT_DIR");
  process.exit(2);
}
const { chromium } = createRequire(path.join(PW_DIR, "package.json"))("playwright");
const { storage_key, session } = JSON.parse(fs.readFileSync(SESSAO, "utf8"));
const uid = session?.user?.id || "";

// Telas principais. `texto` = algo que só aparece quando a tela carregou de verdade.
export const TELAS = [
  { rota: "/dashboard", texto: /Vendas|Início/i },
  { rota: "/vendas", texto: /Vendas/i },
  { rota: "/exclusividades", texto: /Capta/i },
  { rota: "/painel-metas-imobiliaria", texto: /Meta/i },
  { rota: "/locacoes", texto: /Loca/i },
  { rota: "/financeiro", texto: /Financeiro|Comiss/i },
];

const TELA_DE_ERRO =
  /This page didn't load|Something went wrong|Algo deu errado|Application error/i;
const ESCRITA = /\/rest\/v1\/(?!rpc\/)/;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "pt-BR" });
await ctx.addInitScript(
  ([k, v, u]) => {
    if (!localStorage.getItem(k)) localStorage.setItem(k, v);
    if (u) {
      localStorage.setItem(`adm-max:tour:adm_inicio:${u}`, "concluido");
      sessionStorage.setItem(`adm-max:tour:adm_inicio:sessao:${u}`, "1");
    }
  },
  [storage_key, JSON.stringify(session), uid],
);
await ctx.route(/\/rest\/v1\//, (route) => {
  const req = route.request();
  // As contas de teste não têm a ficha pessoal preenchida e parariam em "Complete seu cadastro".
  // Só neste navegador a ficha é tratada como "não se aplica"; a conta não é alterada.
  if (/\/rest\/v1\/rpc\/ficha_minha_situacao/.test(req.url())) {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ aplica: false, motivo: "smoke" }),
    });
  }
  if (/\/rest\/v1\/user_tour_estado/.test(req.url())) {
    return req.method() === "GET"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: '[{"status":"concluido"}]',
        })
      : route.fulfill({ status: 204, body: "" });
  }
  if (req.method() !== "GET" && req.method() !== "HEAD" && ESCRITA.test(req.url())) {
    return route.fulfill({ status: 204, body: "" });
  }
  return route.continue();
});

async function conferir({ rota, texto }) {
  const page = await ctx.newPage();
  await page
    .addLocatorHandler(page.getByTestId("lembrete-agora-nao"), (b) => b.click())
    .catch(() => {});
  const erros = [];
  page.on("pageerror", (e) => erros.push(`JS: ${e.message.split("\n")[0].slice(0, 160)}`));
  page.on("response", (r) => {
    if (r.status() >= 500 && r.url().startsWith(BASE))
      erros.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  const inicio = Date.now();
  try {
    await page.goto(`${BASE}${rota}`, { waitUntil: "load", timeout: 45000 });
    // Menu com "Sem papel" = ainda carregando o papel do usuário (dá falso erro se conferir antes).
    await page
      .waitForFunction(
        (re) => {
          const b = document.body?.innerText || "";
          return b.length > 200 && !/Sem papel/.test(b) && new RegExp(re, "i").test(b);
        },
        texto.source,
        { timeout: 25000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1500);
    const corpo = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    if (new URL(page.url()).pathname.startsWith("/auth")) erros.push("caiu no login (/auth)");
    if (TELA_DE_ERRO.test(corpo)) erros.push("tela de erro na página");
    if (!texto.test(corpo)) erros.push(`não achou o texto esperado (${texto})`);
  } catch (e) {
    erros.push(`abrir: ${e.message.split("\n")[0].slice(0, 160)}`);
  }
  if (erros.length && OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    await page
      .screenshot({ path: path.join(OUT, `falha${rota.replace(/\W+/g, "_")}.png`) })
      .catch(() => {});
  }
  await page.close();
  return { rota, ok: erros.length === 0, ms: Date.now() - inicio, erros };
}

const t0 = Date.now();
// Em paralelo (3 de cada vez) para caber em ~1 minuto.
const resultados = [];
for (let i = 0; i < TELAS.length; i += 3) {
  resultados.push(...(await Promise.all(TELAS.slice(i, i + 3).map(conferir))));
}
await browser.close();
for (const r of resultados) {
  console.log(
    `${r.ok ? "PASS" : "FAIL"} ${r.rota} (${(r.ms / 1000).toFixed(1)}s)${r.ok ? "" : " — " + r.erros.join(" | ")}`,
  );
}
console.log(
  `smoke-telas: ${resultados.filter((r) => r.ok).length}/${resultados.length} telas ok em ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
process.exit(resultados.every((r) => r.ok) ? 0 : 1);
