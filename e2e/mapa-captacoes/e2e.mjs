// Teste de tela: item "Mapa de captações" no menu lateral, tela própria /mapa-captacoes para
// corretor, gestor e admin, Vendas por região sem o mapa de captações e REMAX-TESTE com 0 da Única.
// Mock: e2e/mapa-captacoes/mock-supabase.mjs. Gera prints em OUT_DIR (opcional).
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8091";
const OUT = process.env.OUT_DIR;
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const IDS = {
  corretor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  gestor: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  admin: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  teste: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
};
function session(who) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const id = IDS[who];
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated", session_id: "s-" + who })}.tok-${who}`,
    refresh_token: "r-" + who,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id, email: `${who}@example.test`, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  };
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
async function pageAs(who) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: "pt-BR" });
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ["sb-127-auth-token", JSON.stringify(session(who))]);
  // Sem geocodificação externa no teste (dados fictícios): a tela trata a falha e segue.
  await context.route("**/nominatim.openstreetmap.org/**", (r) => r.abort());
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  return page;
}

try {
  for (const who of ["corretor", "gestor", "admin"]) {
    const p = await pageAs(who);
    await p.goto(`${APP}/mapa-captacoes`);
    await p.getByRole("heading", { name: "Mapa de captações" }).waitFor({ timeout: 60000 });
    check(`${who}: tela /mapa-captacoes abre`, p.url().endsWith("/mapa-captacoes"));
    const item = p.getByRole("link", { name: "Mapa de captações" });
    check(`${who}: item "Mapa de captações" no menu lateral`, (await item.count()) > 0);
    await p.getByText(/2 captações assinadas/).waitFor({ timeout: 15000 });
    check(`${who}: vê só as 2 assinadas (rascunho fora)`, true);
    await p.waitForTimeout(2500); // tiles do mapa
    if (OUT && who === "admin") {
      await p.screenshot({ path: `${OUT}/1-menu-mapa-captacoes.png`, clip: { x: 0, y: 0, width: 300, height: 860 } });
      await p.screenshot({ path: `${OUT}/2-tela-mapa-captacoes.png` });
    }
    // Vendas por região sem o mapa de captações
    await p.goto(`${APP}/vendas-por-regiao`);
    await p.getByRole("heading", { name: "Vendas por região" }).waitFor({ timeout: 60000 });
    await p.waitForTimeout(800);
    check(`${who}: Vendas por região sem "Mapa das captações"`, (await p.getByText("Mapa das captações").count()) === 0);
    check(`${who}: Vendas por região continua com filtro de período`, (await p.getByText("Todo o período").count()) > 0);
    await p.context().close();
  }

  // REMAX-TESTE: 0 captações da Única
  const t = await pageAs("teste");
  await t.goto(`${APP}/mapa-captacoes`);
  await t.getByRole("heading", { name: "Mapa de captações" }).waitFor({ timeout: 60000 });
  await t.getByText(/0 captações assinadas/).waitFor({ timeout: 15000 });
  check("REMAX-TESTE: 0 captações da Única", true);
  await t.context().close();
} catch (e) {
  falhas++;
  console.log("ERRO", e.message);
} finally {
  await browser.close();
}
console.log(falhas ? `FALHOU (${falhas})` : "TUDO OK");
process.exit(falhas ? 1 : 0);
