// Prints do papel "Fotógrafo" (t_0666d3f0 / t_fb0f919b — PR #269) contra o mock local (dados
// fictícios, nenhuma chamada externa). Usuário tok-foto2 com SÓ o papel fotografo.
// Uso: igual ao prints.mjs (mock-supabase.mjs na porta do MOCK + vite dev apontando para ele).
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/vouchers-fotos-prints/prints-fotografo.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8161";
const MOCK = process.env.MOCK || "http://127.0.0.1:54461";
const OUT = process.env.OUT_DIR || ".";
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const sessionFor = (id, email, tok) => ({
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated", session_id: "s1" })}.${tok.padEnd(Math.ceil(tok.length / 4) * 4, "A")}`,
  refresh_token: `r-${tok}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: exp,
  user: { id, email, aud: "authenticated", role: "authenticated", created_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {} },
});
const FOTO2 = sessionFor("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "foto2@example.com", "tok-foto2");
const COMPUTADOR = { width: 1366, height: 900 };
const CELULAR = { width: 390, height: 844 };
const PROIBIDOS = ["/vendas", "/exclusividades", "/minha-carreira", "/reserva-salas", "/mural", "/dashboard", "/agendar-fotos"];

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const erros = [];
const open = async (session, viewport) => {
  const context = await browser.newContext({ viewport, locale: "pt-BR", timezoneId: "America/Sao_Paulo", isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ["sb-127-auth-token", JSON.stringify(session)]);
  const page = await context.newPage();
  page.on("pageerror", (e) => erros.push(e.message));
  return page;
};
const shot = async (page, file, fullPage = false) => {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage });
  console.log("print:", `${OUT}/${file}`);
};
const hrefs = (page) =>
  page.evaluate(() => [...document.querySelectorAll("nav a[href], aside a[href], [role=dialog] a[href]")].map((a) => a.getAttribute("href")));
const semEstouro = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  for (const [nome, vp] of [["computador", COMPUTADOR], ["celular", CELULAR]]) {
    await fetch(`${MOCK}/__mock/reset`);
    await fetch(`${MOCK}/__mock/fotografo?id=foto2`);
    const p = await open(FOTO2, vp);

    // 1) Abre /vendas → a guarda leva para /fotografo.
    await p.goto(`${APP}/vendas`);
    await p.waitForURL(/\/fotografo/, { timeout: 90000 });
    await p.getByRole("tab", { name: /Sessões/ }).waitFor({ timeout: 60000 });
    check(`${nome}: /vendas redireciona para /fotografo`, new URL(p.url()).pathname === "/fotografo", p.url());
    check(`${nome}: sem botão "Agendar fotos" no topo`, (await p.getByRole("link", { name: "Agendar fotos" }).count()) === 0);
    check(`${nome}: sem estouro lateral`, await semEstouro(p));
    await shot(p, `fotografo-${nome}-1-vendas-vira-fotografo.png`);

    // 2) Menu reduzido (no celular, abre o menu lateral).
    if (vp.width < 500) {
      const botao = p.getByRole("button", { name: /menu/i }).first();
      await botao.click();
      await p.waitForTimeout(800);
    }
    const links = await hrefs(p);
    const vaza = links.filter((h) => PROIBIDOS.some((x) => h === x || h.startsWith(`${x}?`) || h.startsWith(`${x}/`)));
    check(`${nome}: menu tem Agenda/Sessões/Histórico`, ["aba=faixas", "aba=sessoes", "aba=historico"].every((a) => links.some((h) => h.startsWith("/fotografo") && h.includes(a))), links.join(" "));
    check(`${nome}: menu sem Vendas/Captações/Carreira/Salas/Mural/Início`, vaza.length === 0, vaza.join(" "));
    await shot(p, `fotografo-${nome}-2-menu-reduzido.png`);

    // 3) Menu "Histórico" troca a aba pelo search (?aba=historico).
    await p.locator('a[href*="aba=historico"]:visible').first().click();
    await p.getByTestId("historico-fotografo").waitFor({ timeout: 30000 });
    check(`${nome}: Histórico abre pela URL ?aba=historico`, p.url().includes("aba=historico"), p.url());
    await shot(p, `fotografo-${nome}-3-historico.png`);
    await p.goto(`${APP}/fotografo?aba=faixas`);
    await p.getByTestId("liberar-bloquear").waitFor({ timeout: 60000 });
    check(`${nome}: ?aba=faixas abre Dias e horários`, true);
    await shot(p, `fotografo-${nome}-4-agenda.png`);
    await p.context().close();
  }

  // 4) Módulo desligado: o só-fotógrafo fica em /fotografo e vê o aviso (sem vaivém).
  await fetch(`${MOCK}/__mock/reset`);
  await fetch(`${MOCK}/__mock/fotografo?id=foto2`);
  await fetch(`${MOCK}/__mock/modulo?on=0`);
  const off = await open(FOTO2, COMPUTADOR);
  await off.goto(`${APP}/vendas`);
  await off.getByTestId("fotos-desativada").waitFor({ timeout: 90000 });
  await off.waitForTimeout(2000);
  check("desligado: fica em /fotografo com \"Agenda de fotos desativada\"", new URL(off.url()).pathname === "/fotografo", off.url());
  await shot(off, "fotografo-computador-5-modulo-desligado.png");
  await off.context().close();
  await fetch(`${MOCK}/__mock/modulo?on=1`);
  await fetch(`${MOCK}/__mock/fotografo?id=fabio`);

  check("sem erro de JavaScript na página", erros.length === 0, erros.slice(0, 3).join(" | "));
} catch (e) {
  falhas++;
  console.log("FAIL exceção:", e.message);
} finally {
  await browser.close();
}
console.log(`RESUMO: ${falhas === 0 ? "TUDO PASS" : `${falhas} FALHA(S)`}`);
process.exit(falhas ? 1 : 0);
