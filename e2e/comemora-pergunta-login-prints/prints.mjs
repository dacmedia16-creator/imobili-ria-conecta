// Prints da pergunta "Comemora aniversário?" depois do login (t_05a37081) contra o mock local
// (dados fictícios, nenhuma chamada externa), no computador e no celular.
// Uso: MOCK_PORT=54451 node e2e/comemora-pergunta-login-prints/mock-supabase.mjs &
//      VITE_SUPABASE_URL=http://127.0.0.1:54451 ... vite dev --port 8151 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/comemora-pergunta-login-prints/prints.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8151";
const MOCK = process.env.MOCK || "http://127.0.0.1:54451";
const OUT = process.env.OUT_DIR || ".";
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const sessionFor = (id, email, tok, created_at, sid = "s1") => ({
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated", session_id: sid })}.${tok.padEnd(Math.ceil(tok.length / 4) * 4, "A")}`,
  refresh_token: `r-${tok}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: exp,
  user: { id, email, aud: "authenticated", role: "authenticated", created_at, app_metadata: {}, user_metadata: {} },
});
const ANTIGO_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ADMIN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANTIGO = (sid) =>
  sessionFor(ANTIGO_ID, "corretor.antigo@example.com", "tok-antigo", "2026-09-01T12:00:00Z", sid);
const ADMIN = sessionFor(ADMIN_ID, "admin@example.com", "tok-admin", "2026-01-01T00:00:00Z");
const NOVO = sessionFor(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "corretor.novo@example.com",
  "tok-novo",
  "2026-10-21T12:00:00Z",
);
const COMPUTADOR = { width: 1366, height: 900 };
const CELULAR = { width: 390, height: 844 };

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const erros = [];
const open = async (session, viewport) => {
  const context = await browser.newContext({ viewport, locale: "pt-BR", isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  await context.addInitScript(
    ([k, v]) => localStorage.setItem(k, v),
    ["sb-127-auth-token", JSON.stringify(session)],
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => erros.push(e.message));
  return page;
};
const shot = async (page, file) => {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log("print:", `${OUT}/${file}`);
};
const state = async () => (await fetch(`${MOCK}/__mock/state`)).json();
const toasts = async (page) =>
  (await page.locator("[data-sonner-toast]").allInnerTexts()).join(" | ") || "(sem aviso)";
const janela = (page) => page.getByTestId("comemora-pergunta");
const esperaApp = async (page) => {
  await page.getByText("Imobiliária Fictícia").first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
};

try {
  for (const [nome, vp] of [
    ["computador", COMPUTADOR],
    ["celular", CELULAR],
  ]) {
    await fetch(`${MOCK}/__mock/reset`);
    // 1) Corretor que já tinha data e nunca respondeu: janela depois do login.
    const p = await open(ANTIGO("login-1"), vp);
    await p.goto(`${APP}/dashboard`);
    await janela(p).waitFor({ timeout: 60000 });
    const txt = await janela(p).innerText();
    check(`${nome}: janela aparece depois do login`, txt.includes("Você comemora aniversário?"));
    check(
      `${nome}: aviso do mural`,
      txt.includes("Se marcar Não, seu nome não aparece no mural de aniversariantes."),
    );
    const caixa = await janela(p).boundingBox();
    check(
      `${nome}: janela cabe na tela`,
      caixa && caixa.x >= 0 && caixa.x + caixa.width <= vp.width && caixa.y >= 0 && caixa.y + caixa.height <= vp.height,
      caixa ? `${Math.round(caixa.width)}x${Math.round(caixa.height)}` : "sem caixa",
    );
    await shot(p, `${nome}-1-janela.png`);
    // Esc não fecha (só Sim/Não).
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    check(`${nome}: Esc não fecha sem responder`, (await janela(p).count()) === 1);

    // 2) Responde Não.
    await p.getByTestId("comemora-pergunta-nao").click();
    await janela(p).waitFor({ state: "detached", timeout: 10000 });
    const s1 = await state();
    check(
      `${nome}: Não gravado e marcado como respondido`,
      s1.comemora[ANTIGO_ID] === false && s1.respondido[ANTIGO_ID] === true &&
        s1.calls.some((c) => c.fn === "comemora_responder" && c.args._comemora === false),
      await toasts(p),
    );
    await shot(p, `${nome}-2-respondeu-nao.png`);
    // Mural: fora.
    await p.goto(`${APP}/mural-conquistas`);
    await p.getByText("Aniversariantes do mês").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(1500);
    check(`${nome}: depois do Não, fora do mural`, !(await p.locator("body").innerText()).includes("Carla Antiga Fictícia"));
    check(`${nome}: no mesmo login a janela não volta`, (await janela(p).count()) === 0);
    await p.context().close();

    // 3) Próximo login: não pergunta de novo.
    const p2 = await open(ANTIGO("login-2"), vp);
    await p2.goto(`${APP}/dashboard`);
    await esperaApp(p2);
    const nPend = (await state()).calls.filter((c) => c.fn === "comemora_pergunta_pendente").length;
    check(`${nome}: próximo login não pergunta de novo`, (await janela(p2).count()) === 0 && nPend >= 2);
    // 4) Muda depois em Meu acesso (como hoje).
    await p2.goto(`${APP}/perfil`);
    await p2.getByTestId("perfil-comemora").waitFor({ timeout: 60000 });
    await p2.waitForTimeout(1200);
    const naoMarcado =
      (await p2.getByTestId("perfil-comemora").getByRole("radio", { name: "Não" }).getAttribute("aria-checked")) === "true";
    check(`${nome}: Meu acesso mostra Não`, naoMarcado);
    await p2.getByTestId("perfil-comemora").getByRole("radio", { name: "Sim" }).click();
    await p2.getByTestId("perfil-salvar-contato").click();
    await p2.waitForTimeout(1500);
    const s2 = await state();
    check(`${nome}: trocou para Sim em Meu acesso`, s2.comemora[ANTIGO_ID] === true && s2.respondido[ANTIGO_ID] === true, await toasts(p2));
    await p2.context().close();

    // 5) Responde Sim (estado zerado).
    await fetch(`${MOCK}/__mock/reset`);
    const p3 = await open(ANTIGO("login-3"), vp);
    await p3.goto(`${APP}/dashboard`);
    await janela(p3).waitFor({ timeout: 60000 });
    await p3.getByTestId("comemora-pergunta-sim").click();
    await janela(p3).waitFor({ state: "detached", timeout: 10000 });
    const s3 = await state();
    check(`${nome}: Sim gravado e marcado`, s3.comemora[ANTIGO_ID] === true && s3.respondido[ANTIGO_ID] === true, await toasts(p3));
    await p3.goto(`${APP}/mural-conquistas`);
    await p3.getByText("Aniversariantes do mês").first().waitFor({ timeout: 60000 });
    await p3.waitForTimeout(1500);
    check(`${nome}: depois do Sim, no mural`, (await p3.locator("body").innerText()).includes("Carla Antiga Fictícia"));
    await p3.context().close();

    // 6) Falha ao gravar: mostra a mensagem e deixa seguir; pergunta de novo no próximo login.
    await fetch(`${MOCK}/__mock/reset`);
    await fetch(`${MOCK}/__mock/falhar?on=1`);
    const p4 = await open(ANTIGO("login-4"), vp);
    await p4.goto(`${APP}/dashboard`);
    await janela(p4).waitFor({ timeout: 60000 });
    await p4.getByTestId("comemora-pergunta-nao").click();
    await janela(p4).waitFor({ state: "detached", timeout: 10000 });
    await p4.waitForTimeout(500);
    const t4 = await toasts(p4);
    const s4 = await state();
    check(
      `${nome}: erro ao gravar mostra a mensagem e libera o sistema`,
      t4.includes("Não foi possível salvar sua resposta agora") && s4.comemora[ANTIGO_ID] === true && !s4.respondido[ANTIGO_ID],
      t4,
    );
    await shot(p4, `${nome}-3-erro-ao-gravar.png`);
    // Sistema segue usável: navega.
    await p4.goto(`${APP}/perfil`);
    await p4.getByTestId("perfil-comemora").waitFor({ timeout: 60000 });
    await p4.waitForTimeout(1500);
    check(`${nome}: depois do erro o sistema continua usável (sem a janela no mesmo login)`, (await janela(p4).count()) === 0);
    await p4.context().close();
    await fetch(`${MOCK}/__mock/falhar?on=0`);
    // Próximo login: como não gravou, pergunta de novo.
    const p5 = await open(ANTIGO("login-5"), vp);
    await p5.goto(`${APP}/dashboard`);
    await janela(p5).waitFor({ timeout: 60000 }).catch(() => {});
    check(`${nome}: depois da falha, pergunta de novo no próximo login`, (await janela(p5).count()) === 1);
    await p5.context().close();
  }

  // 7) Quem não vê: admin já com escolha feita pela tela nova? No mock o admin tem data e não respondeu,
  //    então serve para conferir que a janela vale para todos os papéis; o corretor novo sem data não vê.
  await fetch(`${MOCK}/__mock/reset`);
  const pn = await open(NOVO, CELULAR);
  await pn.goto(`${APP}/dashboard`);
  await pn.getByTestId("completar-perfil").waitFor({ timeout: 60000 });
  await pn.waitForTimeout(1500);
  check("sem data (1º acesso): não vê a janela por cima do cadastro", (await janela(pn).count()) === 0);
  await pn.context().close();
  const pg = await open(ADMIN, COMPUTADOR);
  await pg.goto(`${APP}/dashboard`);
  await janela(pg).waitFor({ timeout: 60000 }).catch(() => {});
  check("admin com data e sem resposta: também vê (vale para todos os papéis)", (await janela(pg).count()) === 1);
  await pg.context().close();

  // Nenhuma escrita fora das esperadas.
  const fns = new Set((await state()).calls.map((c) => c.fn));
  check("sem erro de JavaScript na página", erros.length === 0, erros.slice(0, 3).join(" | "));
  console.log("rpcs chamadas (última rodada):", [...fns].sort().join(","));
} catch (e) {
  falhas++;
  console.log("FAIL exceção:", e.message);
} finally {
  await browser.close();
}
console.log(`RESUMO: ${falhas === 0 ? "TUDO PASS" : `${falhas} FALHA(S)`}`);
process.exit(falhas ? 1 : 0);
