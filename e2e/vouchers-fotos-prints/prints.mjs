// Prints do módulo "Agendar fotos" (t_d86ab990 / t_ee532309) contra o mock local (dados fictícios,
// nenhuma chamada externa; o servidor roda SEM ZIONTALK_API_KEY, então nenhum WhatsApp pode sair).
// Modelo: e2e/comemora-pergunta-login-prints. No computador e no celular.
// Uso: MOCK_PORT=54461 node e2e/vouchers-fotos-prints/mock-supabase.mjs &
//      VITE_SUPABASE_URL=http://127.0.0.1:54461 ... npx vite dev --port 8161 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/vouchers-fotos-prints/prints.mjs
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
const ANA = sessionFor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ana.corretora@example.com", "tok-ana");
const FABIO = sessionFor("ffffffff-ffff-4fff-8fff-ffffffffffff", "fabio.foto@example.com", "tok-fabio");
const ADMIN = sessionFor("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "admin@example.com", "tok-admin");
const FIN = sessionFor("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "financeiro@example.com", "tok-fin");
const CAP1 = "c1000000-0000-4000-8000-000000000001";
const COMPUTADOR = { width: 1366, height: 900 };
const CELULAR = { width: 390, height: 844 };

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
const shot = async (page, file, fullPage = true) => {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage });
  console.log("print:", `${OUT}/${file}`);
};
const state = async () => (await fetch(`${MOCK}/__mock/state`)).json();
const toasts = async (page) => (await page.locator("[data-sonner-toast]").allInnerTexts()).join(" | ") || "(sem aviso)";
const semEstouro = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  for (const [nome, vp] of [["computador", COMPUTADOR], ["celular", CELULAR]]) {
    await fetch(`${MOCK}/__mock/reset`);
    // 1) Corretora: Captações com o botão "Agendar fotos" nas aprovadas dela.
    const p = await open(ANA, vp);
    await p.goto(`${APP}/exclusividades`);
    await p.getByTestId("botao-agendar-fotos").first().waitFor({ timeout: 90000 });
    check(`${nome}: Captações mostra "Agendar fotos" nas 3 aprovadas`, (await p.getByTestId("botao-agendar-fotos").count()) === 3);
    await shot(p, `${nome}-1-captacoes-botao.png`, false);

    // 2) Clica no 1º: abre com o imóvel já escolhido e oferece o voucher.
    await p.getByTestId("botao-agendar-fotos").first().click();
    await p.waitForURL(/agendar-fotos\?captacao=/, { timeout: 30000 });
    await p.getByTestId("horarios-livres").waitFor({ timeout: 60000 });
    // Layout da Reserva de salas (t_9b79f000): tocar no horário livre abre o pedido.
    await p.getByTestId("horarios-livres").getByRole("button").first().click();
    await p.getByTestId("select-imovel").waitFor({ timeout: 15000 });
    const imovelTxt = await p.getByTestId("select-imovel").innerText();
    check(`${nome}: imóvel já escolhido pela captação`, imovelTxt.includes("Rua das Flores"), imovelTxt);
    const vTxt = await p.getByTestId("select-voucher").innerText();
    check(`${nome}: voucher disponível oferecido`, vTxt.includes("Usar voucher"), vTxt);
    check(`${nome}: barra "3 de 3 (+1)" na tela`, (await p.getByTestId("barra-meta").innerText()).includes("3 de 3"));
    check(`${nome}: sem estouro lateral (agendar)`, await semEstouro(p));
    await shot(p, `${nome}-2-agendar-com-voucher.png`, false);
    await p.getByTestId("botao-agendar").click();
    await p.waitForTimeout(2500);
    const s1 = await state();
    const nova = s1.sessoes.find((s) => s.capture_id === CAP1 && s.status === "aguardando");
    check(`${nome}: sessão criada "aguardando" com voucher`, !!nova && !!nova.voucher_id, await toasts(p));
    check(`${nome}: sino do fotógrafo gravado`, s1.notifications.some((n) => n.tipo === "foto_marcada"));
    check(`${nome}: WhatsApp pedido ao servidor (mock, sem chave = nada enviado)`, s1.calls.some((c) => c.fn === "photo_aviso_para_envio" && c.args._evento === "marcada"));

    // 3) Minha agenda.
    await p.getByRole("tab", { name: "Minha agenda" }).click();
    await p.getByTestId("minhas-sessoes").waitFor({ timeout: 30000 });
    check(`${nome}: Minha agenda mostra "Aguardando confirmação"`, (await p.getByTestId("minhas-sessoes").innerText()).includes("Aguardando confirmação"));
    await shot(p, `${nome}-3-minha-agenda.png`);

    // 4) Minha carreira: vouchers + barra.
    await p.goto(`${APP}/minha-carreira`);
    await p.getByTestId("meus-vouchers").waitFor({ timeout: 60000 });
    await p.getByTestId("meus-vouchers").scrollIntoViewIfNeeded();
    const mv = await p.getByTestId("meus-vouchers").innerText();
    check(`${nome}: Minha carreira com vouchers e barra x de 3`, mv.includes("3 de 3") && mv.includes("Agendado") && mv.includes("Vale até"), mv.slice(0, 80));
    await p.getByTestId("meus-vouchers").screenshot({ path: `${OUT}/${nome}-4-minha-carreira-vouchers.png` });
    console.log("print:", `${OUT}/${nome}-4-minha-carreira-vouchers.png`);
    await p.context().close();

    // 5) Fotógrafo: sessão aguardando → confirma.
    const f = await open(FABIO, vp);
    await f.goto(`${APP}/fotografo`);
    await f.getByTestId("botao-confirmar").first().waitFor({ timeout: 90000 });
    check(`${nome}: fotógrafo vê corretor, imóvel e endereço`, (await f.getByTestId("sessao-fotografo").first().innerText()).includes("Rua das Flores"));
    check(`${nome}: sem estouro lateral (fotógrafo)`, await semEstouro(f));
    await shot(f, `${nome}-5-fotografo-aguardando.png`);
    await f.getByTestId("botao-confirmar").first().click();
    await f.waitForTimeout(2000);
    const s2 = await state();
    check(`${nome}: confirmada + sino do corretor`, s2.sessoes.some((s) => s.id === nova?.id && s.status === "confirmada") && s2.notifications.some((n) => n.tipo === "foto_confirmada"), await toasts(f));
    await f.getByRole("tab", { name: "Dias e horários" }).click();
    await f.getByTestId("faixas-fotografo").waitFor({ timeout: 30000 });
    await shot(f, `${nome}-6-fotografo-faixas.png`);
    await f.getByRole("tab", { name: "Histórico" }).click();
    await f.getByTestId("historico-fotografo").waitFor({ timeout: 30000 });
    await shot(f, `${nome}-7-fotografo-historico.png`);
    await f.context().close();

    // 6) Financeiro: duas listas + "cobrado".
    const fi = await open(FIN, vp);
    await fi.goto(`${APP}/agendar-fotos`);
    await fi.getByRole("tab", { name: "Financeiro" }).click();
    await fi.getByTestId("lista-a-cobrar").waitFor({ timeout: 60000 });
    const fin = await fi.getByTestId("financeiro-fotos").innerText();
    check(`${nome}: Financeiro com RE/MAX paga e A cobrar (telefone)`, fin.includes("RE/MAX paga") && fin.includes("A cobrar dos corretores") && fin.includes("(15) 99111-0001"));
    check(`${nome}: sem estouro lateral (financeiro)`, await semEstouro(fi));
    await shot(fi, `${nome}-8-financeiro.png`);
    await fi.getByTestId("botao-cobrado").first().click();
    await fi.waitForTimeout(1500);
    check(`${nome}: botão "cobrado" grava`, (await state()).sessoes.some((s) => s.cobranca_status === "cobrado"), await toasts(fi));
    await fi.context().close();

    // 7) Admin: configurações (fotógrafo e valor).
    const ad = await open(ADMIN, vp);
    await ad.goto(`${APP}/agendar-fotos`);
    await ad.getByRole("tab", { name: "Configurações" }).click();
    await ad.getByTestId("config-fotos").waitFor({ timeout: 60000 });
    await ad.waitForTimeout(800);
    check(`${nome}: Configurações mostram o fotógrafo`, (await ad.getByTestId("config-fotos").innerText()).includes("Fábio Fotógrafo"));
    await shot(ad, `${nome}-9-configuracoes.png`);
    await ad.context().close();
  }

  // 8) Módulo desligado: nada aparece (menu, botão em Captações, bloco na Minha carreira, rota).
  await fetch(`${MOCK}/__mock/reset`);
  await fetch(`${MOCK}/__mock/modulo?on=0`);
  const off = await open(ANA, COMPUTADOR);
  await off.goto(`${APP}/exclusividades`);
  await off.getByTestId("captacao-cartao").first().waitFor({ timeout: 90000 });
  await off.waitForTimeout(1500);
  check("desligado: sem botão em Captações", (await off.getByTestId("botao-agendar-fotos").count()) === 0);
  check("desligado: sem item no menu", (await off.locator('a[href="/agendar-fotos"]').count()) === 0);
  await off.goto(`${APP}/agendar-fotos`);
  await off.waitForTimeout(3000);
  check("desligado: rota volta para o início", !off.url().includes("/agendar-fotos"), off.url());
  await off.goto(`${APP}/minha-carreira`);
  await off.waitForTimeout(3000);
  check("desligado: sem bloco de vouchers na Minha carreira", (await off.getByTestId("meus-vouchers").count()) === 0);
  await off.context().close();
  await fetch(`${MOCK}/__mock/modulo?on=1`);

  check("sem erro de JavaScript na página", erros.length === 0, erros.slice(0, 3).join(" | "));
} catch (e) {
  falhas++;
  console.log("FAIL exceção:", e.message);
} finally {
  await browser.close();
}
console.log(`RESUMO: ${falhas === 0 ? "TUDO PASS" : `${falhas} FALHA(S)`}`);
process.exit(falhas ? 1 : 0);
