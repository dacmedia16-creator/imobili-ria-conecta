// Prints da Clicksign na VENDA e na CAPTAÇÃO contra o mock local (dados fictícios @example.com).
// Uso: node e2e/clicksign-venda-prints/mock-supabase.mjs & vite dev (VITE_SUPABASE_URL=mock) &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/clicksign-venda-prints/prints.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8093";
const MOCK = process.env.MOCK || "http://127.0.0.1:54398";
const SALE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CAPTURE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GESTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUT = process.env.OUT_DIR || ".";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const session = {
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: GESTOR, exp, role: "authenticated", session_id: "s1" })}.tok-gestor`,
  refresh_token: "r-tok-gestor",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: exp,
  user: { id: GESTOR, email: "gestora@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "pt-BR" });
await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ["sb-127-auth-token", JSON.stringify(session)]);
const page = await context.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("dialog", (d) => d.dismiss());

const cenario = async (name) => {
  await fetch(`${MOCK}/__mock/scenario?name=${name}`);
  await page.goto(`${APP}/vendas/${SALE}`);
  await page.getByRole("heading", { name: "FICT-001" }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(1200);
};
const shot = async (file, locator) => {
  const path = `${OUT}/${file}`;
  if (locator) await locator.screenshot({ path });
  else await page.screenshot({ path });
  console.log("print:", path);
};
const want = (k) => !ONLY || ONLY.includes(k);

try {
  if (want("1") || want("2")) {
    await cenario("pronta");
    const btn = page.getByRole("button", { name: "Enviar pela Clicksign" }).first();
    await btn.waitFor({ timeout: 20000 });
    check("botão Enviar pela Clicksign visível", await btn.isVisible());
    await btn.scrollIntoViewIfNeeded();
    if (want("1")) await shot("1-venda-botao-enviar-pela-clicksign.png");

    await btn.click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    await dlg.getByLabel("Nome da testemunha 1").fill("Tânia Testemunha Fictícia");
    await dlg.getByLabel("E-mail da testemunha 1").fill("testemunha1@example.com");
    await dlg.getByLabel("Nome da testemunha 2").fill("Tiago Testemunha Fictício");
    await dlg.getByLabel("E-mail da testemunha 2").fill("testemunha2@example.com");
    await dlg.getByPlaceholder("Buscar pelo nome").fill("Renata");
    await dlg.getByRole("button", { name: "Buscar" }).click();
    await dlg.getByRole("button", { name: "Incluir" }).first().click();
    await dlg.getByLabel("Nome da pessoa de fora").fill("Ana Advogada Fictícia");
    await dlg.getByLabel("E-mail da pessoa de fora").fill("advogada@example.com");
    await dlg.getByRole("button", { name: "Incluir pessoa de fora" }).click();
    await page.waitForTimeout(300);
    const txt = await dlg.innerText();
    check("extra do sistema (do sistema) listado", /Renata Corretora Fictícia[\s\S]*do sistema/.test(txt));
    check("pessoa de fora com Advogado(a)", /Ana Advogada Fictícia[\s\S]*de fora/.test(txt) && /Advogado\(a\)/.test(txt));
    check("sem e-mail real no diálogo", !/@(?!example\.com)[a-z0-9.-]+\.[a-z]{2,}/i.test(txt));
    // Rola até a seção de extras para o print mostrar os dois.
    await dlg.getByText("Partes extras (opcional)").scrollIntoViewIfNeeded();
    if (want("2")) await shot("2-venda-dialogo-signatarios-extras.png");
    await page.keyboard.press("Escape");
  }

  if (want("3")) {
    await cenario("falta-email");
    await page.getByRole("button", { name: "Enviar pela Clicksign" }).first().click();
    const alerta = page.getByTestId("clicksign-faltam-emails");
    await alerta.waitFor();
    check("bloqueio por e-mail faltando", /Falta e-mail para enviar pela Clicksign/.test(await alerta.innerText()));
    check("botão Preencher na aba Partes", (await alerta.getByRole("button", { name: "Preencher na aba Partes" }).count()) === 1);
    check(
      "botão Enviar do diálogo desabilitado",
      await page.getByRole("dialog").getByRole("button", { name: "Enviar pela Clicksign" }).isDisabled(),
    );
    await shot("3-venda-bloqueio-email-faltando.png");
    await page.keyboard.press("Escape");
  }

  if (want("4")) {
    await cenario("em-assinatura");
    const gestao = page.getByTestId("clicksign-venda-gestao");
    await gestao.waitFor({ timeout: 20000 });
    await gestao.locator("[data-status]").first().waitFor({ timeout: 15000 });
    const t = await page.getByTestId("clicksign-venda").innerText();
    check("status Enviado / Abriu o contrato / Assinou", /Enviado/.test(t) && /Abriu o contrato/.test(t) && /Assinou/.test(t));
    check("botão Cancelar assinatura", (await page.getByRole("button", { name: "Cancelar assinatura" }).count()) > 0);
    await page.getByTestId("clicksign-venda").scrollIntoViewIfNeeded();
    await shot("4-venda-em-assinatura-status-por-pessoa.png");
  }

  if (want("5")) {
    await cenario("assinado");
    const box = page.getByTestId("documento-assinado");
    await box.waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const t = await box.innerText();
    check("Documento assinado com origem Clicksign", /Documento assinado/.test(t) && /Clicksign \(TESTE\)/.test(t));
    await page.getByTestId("clicksign-venda").scrollIntoViewIfNeeded();
    await shot("5-venda-documento-assinado.png");
  }

  if (want("7")) {
    await cenario("pronta");
    await page.getByRole("button", { name: /3\. Partes/ }).first().click();
    await page.waitForTimeout(800);
    const campo = page.locator('[id^="campo-parte-email-"]').first();
    await campo.waitFor({ timeout: 15000 });
    await campo.scrollIntoViewIfNeeded();
    check("e-mail da parte com *", /E-mail\s*\*/.test(await campo.innerText()));
    await shot("7a-partes-email-obrigatorio.png");
    // "E-mail do parceiro *" fica no Resumo, bloco Equipe (parceria externa ligada).
    await page.getByRole("button", { name: /2\. Resumo/ }).first().click();
    await page.waitForTimeout(600);
    const equipe = page.getByRole("button", { name: /Equipe/ }).first();
    if (await equipe.count()) await equipe.click().catch(() => {});
    const parc = page.locator("#campo-venda-parceria_email");
    await parc.waitFor({ timeout: 15000 });
    await parc.scrollIntoViewIfNeeded();
    check("E-mail do parceiro *", /E-mail do parceiro\s*\*/.test(await parc.innerText()));
    await shot("7b-resumo-email-do-parceiro-obrigatorio.png");
  }

  if (want("6")) {
    await page.goto(`${APP}/exclusividades/${CAPTURE}`);
    await page.waitForTimeout(3000);
    const passo = page.getByRole("button", { name: /Revisão e envio|Envio ao gestor/ }).first();
    await passo.waitFor({ timeout: 60000 });
    await passo.click();
    const card = page.getByTestId("clicksign-envio");
    await card.waitFor({ timeout: 20000 });
    await card.locator("[data-status]").first().waitFor({ timeout: 15000 });
    const t = await card.innerText();
    check("captação: selo por signatário", /Enviado/.test(t) && /Abriu o contrato/.test(t) && /Assinou/.test(t));
    await card.scrollIntoViewIfNeeded();
    await shot("6-captacao-selo-status-por-signatario.png");
  }
} catch (e) {
  falhas++;
  console.log("ERRO", e.message);
  await page.screenshot({ path: `${OUT}/_erro.png` }).catch(() => {});
} finally {
  await browser.close();
}
console.log(falhas ? `FALHOU (${falhas})` : "TUDO OK");
process.exit(falhas ? 1 : 0);
