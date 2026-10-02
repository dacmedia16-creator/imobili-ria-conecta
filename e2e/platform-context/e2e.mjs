// Teste de telas da Parte 2/3 contra mock local (mock-supabase.mjs). Gera até 3 prints.
import { createRequire } from "node:module";
const require = createRequire("/data/hermes-workspaces/max/visitaprova-ui-fix/package.json");
const { chromium } = require("playwright");

const APP = "http://127.0.0.1:8091";
const MOCK = "http://127.0.0.1:54399";
const OUT = process.env.OUT_DIR;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok: Boolean(ok), extra });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function session(tok, id, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated", session_id: "s-" + tok })}.${tok}`;
  return {
    access_token,
    refresh_token: "r-" + tok,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  };
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});

async function newPage(tok, id, email) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: "pt-BR" });
  const s = session(tok, id, email);
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ["sb-127-auth-token", JSON.stringify(s)]);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  return page;
}
const banner = (p) => p.locator('[data-testid="platform-context-banner"]');
const reset = () => fetch(`${MOCK}/__mock/reset`);

try {
  await reset();
  // (a) dacmedia abre direto no Painel
  const p = await newPage("tok-dac", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "dacmedia@example.test");
  await p.goto(`${APP}/dashboard`);
  await p.waitForURL("**/plataforma/imobiliarias", { timeout: 30000 });
  await p.getByRole("heading", { name: "Painel da Plataforma" }).waitFor({ timeout: 30000 });
  await p.getByText("Imobiliária Fictícia Teste").first().waitFor();
  check("(a) dacmedia abre direto no Painel da Plataforma", p.url().endsWith("/plataforma/imobiliarias"));
  check("(a) Painel sem faixa fora do contexto", (await banner(p).count()) === 0);
  await p.screenshot({ path: `${OUT}/1-painel-plataforma.png`, fullPage: false });

  // (b) entra na Única
  const cardOf = (name) => p.locator("div.rounded-xl, div[class*='card']").filter({ hasText: name }).filter({ has: p.getByRole("button", { name: /Entrar como administrador|reentrar/ }) }).last();
  await cardOf("Única Escolha").getByRole("button", { name: /Entrar como administrador/ }).click();
  await p.waitForURL(/\/dashboard(\?|$)/, { timeout: 30000 });
  await banner(p).waitFor({ timeout: 30000 });
  const t1 = await banner(p).innerText();
  check("(b) faixa aparece ao entrar na Única", /Você está vendo a Única Escolha/.test(t1), t1.replace(/\s+/g, " "));

  // (c) Sair volta ao Painel
  await banner(p).getByRole("button", { name: "Sair" }).click();
  await p.waitForURL("**/plataforma/imobiliarias", { timeout: 30000 });
  await p.getByRole("heading", { name: "Painel da Plataforma" }).waitFor();
  check("(c) Sair volta ao Painel e a faixa some", (await banner(p).count()) === 0);

  // (b') entra na 2ª imobiliária fictícia
  await p.getByText("Imobiliária Fictícia Teste").first().waitFor();
  await cardOf("Imobiliária Fictícia Teste").getByRole("button", { name: /Entrar como administrador/ }).click();
  await p.waitForURL(/\/dashboard(\?|$)/, { timeout: 30000 });
  await banner(p).waitFor({ timeout: 30000 });
  const t2 = await banner(p).innerText();
  check("(b) faixa com o nome da 2ª imobiliária fictícia", /Você está vendo a Imobiliária Fictícia Teste/.test(t2), t2.replace(/\s+/g, " "));
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/2-faixa-contexto.png`, fullPage: false });
  await banner(p).getByRole("button", { name: "Sair" }).click();
  await p.waitForURL("**/plataforma/imobiliarias", { timeout: 30000 });

  // (d) contexto expira → volta ao Painel com aviso
  await fetch(`${MOCK}/__mock/expire-soon?ms=6000`);
  await p.getByText("Imobiliária Fictícia Teste").first().waitFor();
  await cardOf("Imobiliária Fictícia Teste").getByRole("button", { name: /Entrar como administrador/ }).click();
  await p.waitForURL(/\/dashboard(\?|$)/, { timeout: 30000 });
  await banner(p).waitFor({ timeout: 30000 });
  await p.waitForURL("**/plataforma/imobiliarias", { timeout: 20000 });
  const aviso = p.getByRole("alert").filter({ hasText: /expirou/ });
  await aviso.waitFor({ timeout: 20000 });
  check("(d) contexto expirado volta ao Painel com aviso", /Imobiliária Fictícia Teste expirou/.test(await aviso.innerText()));
  check("(d) sem faixa após expirar", (await banner(p).count()) === 0);
  await p.screenshot({ path: `${OUT}/3-aviso-expirado.png`, fullPage: false });
  await p.context().close();

  // (e) usuário comum: sem faixa, sem Painel
  await reset();
  const c = await newPage("tok-comum", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "corretor@example.test");
  await c.goto(`${APP}/dashboard`);
  await c.waitForTimeout(5000);
  check("(e) usuário comum fica no dashboard", /\/dashboard(\?|$)/.test(c.url()), c.url());
  check("(e) usuário comum não vê faixa", (await banner(c).count()) === 0);
  check("(e) usuário comum não vê menu Plataforma", (await c.getByRole("link", { name: /Imobiliárias|Plataforma/ }).count()) === 0);
  await c.goto(`${APP}/plataforma/imobiliarias`);
  await c.waitForTimeout(4000);
  check("(e) usuário comum barrado no Painel", !c.url().includes("/plataforma"), c.url());
  await c.context().close();
} catch (e) {
  check("execução sem exceção", false, e.message.split("\n")[0]);
  for (const ctx of browser.contexts())
    for (const pg of ctx.pages()) {
      console.log("URL na falha:", pg.url());
      await pg.screenshot({ path: `${OUT}/../debug-falha.png` }).catch(() => {});
    }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`RESUMO: ${results.length - failed}/${results.length} passaram`);
process.exit(failed ? 1 : 0);
