// Teste de tela: lista de captações com etapas visíveis (t_abf93125), contra o mock local.
// Uso: MOCK_PORT=54397 node e2e/captacoes-etapas/mock-supabase.mjs &
//      SUPABASE_URL=http://127.0.0.1:54397 VITE_SUPABASE_URL=http://127.0.0.1:54397 \
//        VITE_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_PUBLISHABLE_KEY=x vite dev --port 8096 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/captacoes-etapas/prints.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8096";
const OUT = process.env.OUT_DIR || ".";
const IDS = {
  ana: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  gina: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  hugo: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sessao = (who) => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const id = IDS[who];
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated", session_id: "s-" + who })}.tok-${who}`,
    refresh_token: "r-tok-" + who,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: {
      id,
      email: `${who}@example.com`,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
    },
  };
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
async function abrir(who, viewport) {
  const ctx = await browser.newContext({ viewport, locale: "pt-BR", deviceScaleFactor: 1 });
  await ctx.addInitScript(
    ([k, v]) => localStorage.setItem(k, v),
    ["sb-127-auth-token", JSON.stringify(sessao(who))],
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", who, e.message));
  await page.goto(`${APP}/exclusividades`, { waitUntil: "networkidle" });
  // Corretor com perfil incompleto vê "Complete seu cadastro" antes; fecha com "Agora não".
  const agoraNao = page.getByRole("button", { name: "Agora não" });
  if (await agoraNao.isVisible().catch(() => false)) await agoraNao.click();
  await page.waitForSelector('[data-testid="captacao-cartao"]', { timeout: 60000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}
const suaVez = (page) =>
  page.$$eval('[data-minha-vez="sim"]', (els) =>
    els.map((e) => e.querySelector("p")?.textContent?.trim() ?? ""),
  );

const DESK = { width: 1440, height: 1000 };
const CEL = { width: 390, height: 844 };

// Gestora Gina (lidera Ana): Sua vez só na enviada da Ana; a enviada do Caio (equipe Hugo) não.
{
  const { ctx, page } = await abrir("gina", DESK);
  const v = await suaVez(page);
  check("gina: 1 'Sua vez'", v.length === 1, JSON.stringify(v));
  check("gina: Sua vez na captação da Ana", v.join(" ").includes("Acácias"));
  check(
    "gina: 6 barras de etapa",
    (await page.$$('[data-testid="captacao-stepper"]')).length === 6,
  );
  await page.screenshot({ path: `${OUT}/desktop-gestora-todas.png`, fullPage: true });
  await page.click('[data-testid="chip-etapa-minha_vez"]');
  await page.waitForTimeout(300);
  check(
    "gina: chip 'Aguardando minha ação' mostra 1",
    (await page.$$('[data-testid="captacao-cartao"]')).length === 1,
  );
  await page.screenshot({ path: `${OUT}/desktop-gestora-minha-vez.png`, fullPage: true });
  await ctx.close();
}
// Gestor Hugo (lidera Caio): Sua vez só na enviada do Caio.
{
  const { ctx, page } = await abrir("hugo", DESK);
  const v = await suaVez(page);
  check(
    "hugo: 1 'Sua vez' só na do Caio",
    v.length === 1 && v[0].includes("Modelo"),
    JSON.stringify(v),
  );
  await ctx.close();
}
// Corretora Ana: Sua vez na devolvida e no rascunho dela.
{
  const { ctx, page } = await abrir("ana", DESK);
  const v = await suaVez(page);
  check("ana: 2 'Sua vez' (devolvida + rascunho)", v.length === 2, JSON.stringify(v));
  await page.screenshot({ path: `${OUT}/desktop-corretora.png`, fullPage: true });
  await ctx.close();
}
// Celular: gestora e corretora; a barra precisa caber sem rolagem lateral.
for (const who of ["gina", "ana"]) {
  const { ctx, page } = await abrir(who, CEL);
  const larg = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${who} celular: sem rolagem lateral`, larg <= 390, `scrollWidth=${larg}`);
  await page.screenshot({
    path: `${OUT}/celular-${who === "gina" ? "gestora" : "corretora"}.png`,
    fullPage: true,
  });
  await ctx.close();
}
await browser.close();
console.log(falhas ? `${falhas} FALHA(S)` : "TUDO OK");
process.exit(falhas ? 1 : 0);
