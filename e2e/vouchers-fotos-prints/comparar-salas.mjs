// Prints lado a lado: Reserva de salas × Agendar fotos (t_9b79f000), no computador e no celular,
// com o calendário colorido (verde = disponível, azul = reservado, neutro = sem horário liberado).
// Mesmo mock de prints.mjs (dados fictícios, nenhuma chamada externa).
// Uso: igual a prints.mjs (MOCK_PORT / APP / PLAYWRIGHT_FROM / OUT_DIR).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
const ANA = sessionFor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ana.corretora@example.com", "tok-ana");
const FABIO = sessionFor("ffffffff-ffff-4fff-8fff-ffffffffffff", "fabio.foto@example.com", "tok-fabio");
const TELAS = [["computador", { width: 1366, height: 900 }], ["celular", { width: 390, height: 844 }]];

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const erros = [];
const open = async (session, viewport) => {
  const context = await browser.newContext({ viewport, locale: "pt-BR", timezoneId: "America/Sao_Paulo", isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ["sb-127-auth-token", JSON.stringify(session)]);
  const page = await context.newPage();
  page.on("pageerror", (e) => erros.push(e.message));
  return page;
};
const semEstouro = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// Corta do título da página até o fim da agenda (o que interessa comparar).
const recorte = async (page, file, ateSeletor) => {
  const topo = await page.locator("main h1, h1").first().boundingBox();
  const fim = await page.locator(ateSeletor).first().boundingBox();
  const y = Math.max(0, (topo?.y ?? 0) - 16);
  const vw = page.viewportSize().width;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true, clip: { x: 0, y, width: vw, height: Math.min(fim.y + fim.height + 16 - y, 2600) } });
  console.log("print:", `${OUT}/${file}`);
};
const ladoALado = async (a, b, file, legendas) => {
  const img = (f) => `data:image/png;base64,${readFileSync(`${OUT}/${f}`).toString("base64")}`;
  const p = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await p.setContent(`<body style="margin:0;font-family:sans-serif;background:#e5e7eb"><div style="display:flex;gap:24px;padding:16px;align-items:flex-start">
    ${[a, b].map((f, i) => `<figure style="margin:0;background:#fff;padding:8px;border-radius:8px"><figcaption style="font-weight:600;margin:4px 0 8px">${legendas[i]}</figcaption><img src="${img(f)}" style="display:block;max-width:${a.startsWith("celular") ? 390 : 760}px"></figure>`).join("")}
  </div></body>`);
  await p.waitForTimeout(300);
  await p.locator("body > div").screenshot({ path: `${OUT}/${file}` });
  console.log("print:", `${OUT}/${file}`);
  await p.context().close();
};

try {
  await fetch(`${MOCK}/__mock/reset`);
  await fetch(`${MOCK}/__mock/cenario`);
  for (const [nome, vp] of TELAS) {
    const s = await open(ANA, vp);
    await s.goto(`${APP}/reservas-salas`);
    await s.getByTestId("escolha-data").waitFor({ timeout: 90000 });
    await s.waitForTimeout(1500);
    await recorte(s, `${nome}-A-reserva-salas.png`, nome === "celular" ? '[data-testid="salas-lista-celular"]' : '[data-testid="escolha-data"] >> xpath=..');
    check(`${nome}: Reserva de salas segue com "Filtrar sala"`, (await s.getByTestId("escolha-data").innerText()).includes("Filtrar sala"));
    await s.context().close();

    const f = await open(ANA, vp);
    await f.goto(`${APP}/agendar-fotos`);
    await f.getByTestId("horarios-livres").waitFor({ timeout: 90000 });
    await f.waitForTimeout(800);
    const card = await f.getByTestId("escolha-data").innerText();
    check(`${nome}: cartão "Escolha a data" no Agendar fotos`, card.includes("Escolha a data") && card.includes("Veja a agenda do dia selecionado."));
    check(`${nome}: sem filtro de sala; mostra o fotógrafo`, !card.includes("Filtrar sala") && card.includes("Fábio Fotógrafo"));
    check(`${nome}: legenda de cores`, card.includes("Verde = disponível") && card.includes("Azul = reservado"));
    const contar = (cls) => f.locator(`[data-slot="calendar"] td.${cls}`).count();
    const verdes = await f.locator('[data-slot="calendar"] td[class*="bg-emerald-100"]').count();
    const azuis = await f.locator('[data-slot="calendar"] td[class*="bg-blue-100"]').count();
    const ponto = await f.locator('[data-slot="calendar"] td[class*="after:bg-blue-600"]').count();
    check(`${nome}: calendário com 4 dias verdes, 1 azul e 1 pontinho azul`, verdes === 4 && azuis === 1 && ponto === 1, `verdes=${verdes} azuis=${azuis} ponto=${ponto}`);
    void contar;
    check(`${nome}: sem estouro lateral`, await semEstouro(f));
    await recorte(f, `${nome}-B-agendar-fotos.png`, nome === "celular" ? '[data-testid="agenda-do-dia"]' : '[data-testid="escolha-data"] >> xpath=..');
    // Dia verde com reserva: agenda mostra reservado (azul) + livres (verde).
    const diaComReserva = f.locator('[data-slot="calendar"] td[class*="after:bg-blue-600"] button');
    await diaComReserva.click();
    await f.waitForTimeout(500);
    const ag = await f.getByTestId("agenda-do-dia").innerText();
    check(`${nome}: dia com reserva mostra reservado e livres`, ag.includes("Reservados") && ag.includes("Horários livres"), ag.slice(0, 120));
    await recorte(f, `${nome}-C-agendar-dia-com-reserva.png`, '[data-testid="agenda-do-dia"]');
    // Dia azul (lotado): sem horário livre, não dá para reservar.
    await f.locator('[data-slot="calendar"] td[class*="bg-blue-100"] button').click();
    await f.waitForTimeout(500);
    const az = await f.getByTestId("agenda-do-dia").innerText();
    check(`${nome}: dia azul sem horário livre`, az.includes("Sem horário livre neste dia") && (await f.getByTestId("horarios-livres").count()) === 0);
    // Tocar num horário livre abre o pedido com imóvel e voucher.
    await f.locator('[data-slot="calendar"] td[class*="bg-emerald-100"] button').first().click();
    await f.getByTestId("horarios-livres").getByRole("button").first().click();
    await f.getByTestId("select-voucher").waitFor({ timeout: 15000 });
    check(`${nome}: pedido abre com imóvel e voucher`, (await f.getByTestId("select-voucher").innerText()).length > 0);
    await f.waitForTimeout(400);
    await f.screenshot({ path: `${OUT}/${nome}-D-agendar-pedido.png` });
    console.log("print:", `${OUT}/${nome}-D-agendar-pedido.png`);
    await f.context().close();

    await ladoALado(`${nome}-A-reserva-salas.png`, `${nome}-B-agendar-fotos.png`, `${nome}-lado-a-lado.png`, ["Reserva de salas (hoje)", "Agendar fotos (novo)"]);

    const fo = await open(FABIO, vp);
    await fo.goto(`${APP}/fotografo`);
    await fo.getByRole("tab", { name: "Dias e horários" }).waitFor({ timeout: 90000 });
    await fo.getByRole("tab", { name: "Dias e horários" }).click();
    await fo.getByTestId("liberar-bloquear").waitFor({ timeout: 30000 });
    await fo.waitForTimeout(600);
    const fv = await fo.locator('[data-slot="calendar"] td[class*="bg-emerald-100"]').count();
    const fa = await fo.locator('[data-slot="calendar"] td[class*="bg-blue-100"]').count();
    check(`${nome}: /fotografo usa o mesmo calendário colorido`, fv === 4 && fa === 1, `verdes=${fv} azuis=${fa}`);
    check(`${nome}: sem estouro lateral (fotógrafo)`, await semEstouro(fo));
    await fo.screenshot({ path: `${OUT}/${nome}-E-fotografo-calendario.png`, fullPage: true });
    console.log("print:", `${OUT}/${nome}-E-fotografo-calendario.png`);
    await fo.context().close();
  }
  check("sem erro de JavaScript na página", erros.length === 0, erros.slice(0, 3).join(" | "));
} catch (e) {
  falhas++;
  console.log("FAIL exceção:", e.message);
} finally {
  await browser.close();
}
console.log(`RESUMO: ${falhas === 0 ? "TUDO PASS" : `${falhas} FALHA(S)`}`);
process.exit(falhas ? 1 : 0);
