// Prints da comissão em "análise do Financeiro" (t_59cb12e0 / t_a10304e6) contra o mock local
// (dados fictícios). Usuário Financeiro; computador (1366) e celular (390).
// Uso: node e2e/comissao-analise-financeiro-prints/mock-supabase.mjs &
//      VITE_SUPABASE_URL=http://127.0.0.1:54466 VITE_SUPABASE_PUBLISHABLE_KEY=mock vite dev --port 8166 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/comissao-analise-financeiro-prints/prints.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8166";
const MOCK = process.env.MOCK || "http://127.0.0.1:54466";
const OUT = process.env.OUT_DIR || ".";
const SALE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const tok = "tok-financeiro";
const session = {
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: FIN, exp, role: "authenticated", session_id: "s1" })}.${tok.padEnd(Math.ceil(tok.length / 4) * 4, "A")}`,
  refresh_token: "r-tok-financeiro",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: exp,
  user: {
    id: FIN,
    email: "financeiro@example.test",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
  },
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const telas = [
  { nome: "computador", viewport: { width: 1366, height: 900 } },
  { nome: "celular", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
const semRolagemHorizontal = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const abrirEtapa = async (page, rotulo) => {
  const btn = page.getByRole("button", { name: rotulo }).first();
  if (await btn.isVisible().catch(() => false)) await btn.click();
  else {
    // Celular: seletor de etapa (combobox "Etapa").
    await page.getByRole("combobox", { name: "Etapa" }).click();
    await page
      .getByRole("option", { name: new RegExp(rotulo.replace(/\./g, "\\.")) })
      .first()
      .click();
  }
  await page.waitForTimeout(1500);
};

try {
  for (const aceita of [false, true]) {
    for (const t of telas) {
      await fetch(`${MOCK}/__mock/reset${aceita ? "?aceita=1" : ""}`);
      const context = await browser.newContext({
        viewport: t.viewport,
        isMobile: !!t.isMobile,
        hasTouch: !!t.hasTouch,
        locale: "pt-BR",
      });
      await context.addInitScript(
        ([k, v]) => localStorage.setItem(k, v),
        ["sb-127-auth-token", JSON.stringify(session)],
      );
      const page = await context.newPage();
      page.on("pageerror", (e) => console.log("pageerror:", e.message));
      await page.goto(`${APP}/vendas/${SALE}`);
      await page.getByText("FICT-266").first().waitFor({ timeout: 90000 });
      const est = aceita ? "aceita" : "nao-aceita";

      // 5. Ocorrência
      await abrirEtapa(page, "5. Ocorrência");
      const avisoOcc = page.getByTestId("aviso-divergencia-comissao").first();
      await avisoOcc.waitFor({ timeout: 20000 });
      const txtOcc = (await avisoOcc.innerText()).replace(/\s+/g, " ");
      check(
        `[${t.nome}/${est}] Ocorrência: aviso de divergência visível`,
        /Venda: 6% = R\$\s?10\.800,00/.test(txtOcc) &&
          /Ocorrência: 3% = R\$\s?5\.400,00/.test(txtOcc),
        txtOcc.slice(0, 160),
      );
      check(
        `[${t.nome}/${est}] Ocorrência: texto ${aceita ? "congelada" : "não aceita"}`,
        aceita
          ? /já foi aceita pelo Financeiro/.test(txtOcc)
          : /Ao salvar a comissão na venda/.test(txtOcc),
      );
      await avisoOcc.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${t.nome}-ocorrencia-${est}.png`, fullPage: false });
      check(
        `[${t.nome}/${est}] Ocorrência sem rolagem horizontal`,
        await semRolagemHorizontal(page),
      );

      // 6. Revisão
      await abrirEtapa(page, "6. Revisão");
      const avisoRev = page.getByTestId("aviso-divergencia-comissao").first();
      await avisoRev.waitFor({ timeout: 20000 });
      const linha = page.getByTestId("linha-lado-remax").first();
      await linha.waitFor({ timeout: 20000 });
      const txtLinha = (await linha.innerText()).replace(/\s+/g, " ");
      check(
        `[${t.nome}/${est}] Revisão: linha "Lado REMAX (base)" 3% / R$ 5.400`,
        /Lado REMAX \(base\)/.test(txtLinha) && /3%/.test(txtLinha) && /5\.400,00/.test(txtLinha),
        txtLinha,
      );
      check(`[${t.nome}/${est}] Revisão: aviso visível`, await avisoRev.isVisible());
      await page.screenshot({ path: `${OUT}/${t.nome}-revisao-${est}-topo.png`, fullPage: false });
      await linha.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${OUT}/${t.nome}-revisao-${est}-lado-remax.png`,
        fullPage: false,
      });
      check(
        `[${t.nome}/${est}] Revisão sem rolagem horizontal da página`,
        await semRolagemHorizontal(page),
      );
      await context.close();
    }
  }

  // Estado DEPOIS da correção: ocorrência sincronizada (6% / R$ 10.800) → sem aviso, Nossa parte R$ 5.400.
  for (const t of telas) {
    await fetch(`${MOCK}/__mock/reset?sync=1`);
    const context = await browser.newContext({
      viewport: t.viewport,
      isMobile: !!t.isMobile,
      hasTouch: !!t.hasTouch,
      locale: "pt-BR",
    });
    await context.addInitScript(
      ([k, v]) => localStorage.setItem(k, v),
      ["sb-127-auth-token", JSON.stringify(session)],
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    await page.goto(`${APP}/vendas/${SALE}`);
    await page.getByText("FICT-266").first().waitFor({ timeout: 90000 });
    await abrirEtapa(page, "6. Revisão");
    const linha = page.getByTestId("linha-lado-remax").first();
    await linha.waitFor({ timeout: 20000 });
    check(
      `[${t.nome}/sincronizada] sem aviso de divergência`,
      (await page.getByTestId("aviso-divergencia-comissao").count()) === 0,
    );
    const nossa = page.getByText("Nossa parte (desconta parceria)").first();
    const linhaNossa = (await nossa.locator("xpath=ancestor::tr[1]").innerText()).replace(
      /\s+/g,
      " ",
    );
    check(
      `[${t.nome}/sincronizada] Nossa parte = R$ 5.400`,
      /5\.400,00/.test(linhaNossa),
      linhaNossa,
    );
    await nossa.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${OUT}/${t.nome}-revisao-sincronizada-nossa-parte.png`,
      fullPage: false,
    });
    await linha.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${OUT}/${t.nome}-revisao-sincronizada-lado-remax.png`,
      fullPage: false,
    });
    check(`[${t.nome}/sincronizada] sem rolagem horizontal`, await semRolagemHorizontal(page));
    await context.close();
  }
} catch (e) {
  falhas++;
  console.log("ERRO", e.message);
} finally {
  await browser.close();
}
console.log(falhas ? `FALHOU (${falhas})` : "TUDO OK");
process.exit(falhas ? 1 : 0);
