// Teste de tela do "Mapa de captações": menu lateral, tela para corretor, gestor e admin, preço e
// contato do captador para todos, filtros (bairro/cidade, tipo, preço, captador, equipe), lista ao
// lado, nada do proprietário, Vendas por região sem o mapa e REMAX-TESTE com 0 da Única.
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
    user: {
      id,
      email: `${who}@example.test`,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
    },
  };
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
async function pageAs(who) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
  });
  await context.addInitScript(
    ([k, v]) => localStorage.setItem(k, v),
    ["sb-127-auth-token", JSON.stringify(session(who))],
  );
  // Sem geocodificação externa no teste (dados fictícios): a tela trata a falha e segue.
  await context.route("**/nominatim.openstreetmap.org/**", (r) => r.abort());
  const page = await context.newPage();
  page.on("pageerror", (e) =>
    console.log("pageerror:", e.message, process.env.E2E_STACK ? "\n" + e.stack : ""),
  );
  return page;
}
const itens = (p) => p.getByTestId("item-captacao");

try {
  for (const who of ["corretor", "gestor", "admin"]) {
    const p = await pageAs(who);
    await p.goto(`${APP}/mapa-captacoes`);
    await p.getByRole("heading", { name: "Mapa de captações" }).waitFor({ timeout: 60000 });
    check(`${who}: tela /mapa-captacoes abre`, p.url().endsWith("/mapa-captacoes"));
    check(
      `${who}: item "Mapa de captações" no menu lateral`,
      (await p.getByRole("link", { name: "Mapa de captações" }).count()) > 0,
    );
    await p.getByText(/3 captações assinadas/).waitFor({ timeout: 15000 });
    check(`${who}: vê só as 3 assinadas (rascunho fora)`, (await itens(p).count()) === 3);

    const body = await p.locator("main").innerText();
    check(
      `${who}: preço na lista`,
      /850\.000/.test(body) && /420\.000/.test(body) && /610\.000/.test(body),
    );
    check(`${who}: nada do proprietário nem rascunho`, !/PROPRIETARIO|CAP-003/.test(body));
    const wa = p.getByRole("link", { name: "WhatsApp" });
    check(
      `${who}: botão WhatsApp do captador`,
      (await wa.count()) === 3 &&
        /^https:\/\/wa\.me\/5515900000001\?text=/.test(
          (await wa.first().getAttribute("href")) || "",
        ),
    );
    check(
      `${who}: e-mail do captador`,
      (await p.getByRole("link", { name: "corretor@example.test" }).count()) === 1,
    );

    // Clique na lista abre o balão do pino com preço e contato
    await itens(p).first().getByRole("button").click();
    const pop = p.locator(".leaflet-popup-content");
    await pop.waitFor({ timeout: 10000 });
    const popTxt = await pop.innerText();
    check(
      `${who}: balão com preço e contato do captador`,
      /850\.000/.test(popTxt) &&
        /Tel\.: \(15\) 90000-0001/.test(popTxt) &&
        /WhatsApp do captador/.test(popTxt),
      popTxt.replace(/\n/g, " | "),
    );
    // c1 é do corretor (captador) e gestor/admin têm detalhe: os três veem o endereço dela.
    check(`${who}: endereço no balão de quem tem detalhe`, /Rua Fictícia, 100/.test(popTxt));
    if (who === "corretor") {
      // c2 é de outro corretor: sem endereço por escrito, mas com preço e contato
      await itens(p).nth(1).getByRole("button").click();
      await p.waitForTimeout(500);
      const t2 = await p.locator(".leaflet-popup-content").innerText();
      check(
        "corretor: captação de outro sem endereço, com preço e contato",
        !/Av\. Exemplo/.test(t2) && /420\.000/.test(t2) && /90000-0002/.test(t2),
        t2.replace(/\n/g, " | "),
      );
    }

    // Filtros
    const sel = (label) => p.locator("label", { hasText: label }).locator("select");
    await sel("Tipo de imóvel").selectOption("Apartamento");
    check(`${who}: filtro tipo (APARTAMENTO + apartamento)`, (await itens(p).count()) === 2);
    await p.getByLabel("Preço máximo").fill("500000");
    check(`${who}: filtro preço máx 500 mil`, (await itens(p).count()) === 1);
    await p.getByRole("button", { name: /Limpar filtros/ }).click();
    check(`${who}: limpar filtros`, (await itens(p).count()) === 3);
    await p.getByPlaceholder("Ex.: Campolim, Sorocaba").fill("vergueiro");
    check(`${who}: busca por bairro`, (await itens(p).count()) === 1);
    await p.getByRole("button", { name: /Limpar filtros/ }).click();
    await sel("Captador").selectOption("Outro Corretor");
    check(`${who}: filtro captador`, (await itens(p).count()) === 2);
    await sel("Captador").selectOption("");
    await sel("Equipe").selectOption("Equipe Azul");
    check(`${who}: filtro equipe`, (await itens(p).count()) === 1);
    await p.getByLabel("Preço mínimo").fill("100000");
    await p.waitForTimeout(300);

    if (OUT && who === "corretor") {
      await p.getByRole("button", { name: /Limpar filtros/ }).click();
      await itens(p).first().getByRole("button").click();
      await p.waitForTimeout(2500); // tiles do mapa
      await p.screenshot({ path: `${OUT}/1-mapa-captacoes-preco-contato.png` });
      await sel("Tipo de imóvel").selectOption("Apartamento");
      await p.getByLabel("Preço máximo").fill("700000");
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `${OUT}/2-mapa-captacoes-filtros.png` });
    }

    // Vendas por região sem o mapa de captações
    await p.goto(`${APP}/vendas-por-regiao`);
    await p.getByRole("heading", { name: "Vendas por região" }).waitFor({ timeout: 60000 });
    await p.waitForTimeout(800);
    check(
      `${who}: Vendas por região sem "Mapa das captações"`,
      (await p.getByText("Mapa das captações").count()) === 0,
    );
    await p.context().close();
  }

  // REMAX-TESTE: 0 captações da Única
  const t = await pageAs("teste");
  await t.goto(`${APP}/mapa-captacoes`);
  await t.getByRole("heading", { name: "Mapa de captações" }).waitFor({ timeout: 60000 });
  await t.getByText(/0 captações assinadas/).waitFor({ timeout: 15000 });
  check("REMAX-TESTE: 0 captações da Única", (await itens(t).count()) === 0);
  await t.context().close();
} catch (e) {
  falhas++;
  console.log("ERRO", e.message);
} finally {
  await browser.close();
}
console.log(falhas ? `FALHOU (${falhas})` : "TUDO OK");
process.exit(falhas ? 1 : 0);
