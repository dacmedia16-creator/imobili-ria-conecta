// Teste de tela: na última etapa da venda, "Enviar ao gestor" com a Mídia (etapa 2) vazia deve
// abrir a etapa Resumo / bloco Imóvel, focar e destacar a Mídia; a faixa amarela leva ao mesmo campo.
// Mock: e2e/venda-campo-faltante/mock-supabase.mjs. Gera prints em OUT_DIR (opcional).
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8091";
const MOCK = process.env.MOCK || "http://127.0.0.1:54399";
const SALE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CORRETOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUT = process.env.OUT_DIR;
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const session = {
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: CORRETOR, exp, role: "authenticated", session_id: "s1" })}.tok-corretor`,
  refresh_token: "r-tok-corretor",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: exp,
  user: { id: CORRETOR, email: "corretor@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
try {
  await fetch(`${MOCK}/__mock/reset`);
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "pt-BR" });
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ["sb-127-auth-token", JSON.stringify(session)]);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(`${APP}/vendas/${SALE}`);
  await page.getByRole("heading", { name: "FICT-001" }).waitFor({ timeout: 60000 });

  // Faixa amarela
  const faixa = page.getByTestId("faixa-midia");
  await faixa.waitFor({ timeout: 15000 });
  check("faixa amarela aparece na venda sem Mídia", /Falta preencher a Mídia\. Sem ela, a venda não poderá avançar\./.test(await faixa.innerText()));

  // Vai até a última etapa (4. Pagamento — Ocorrência fica desabilitada no rascunho)
  await page.getByRole("button", { name: /4\. Pagamento/ }).first().click();
  await page.getByText("Forma de pagamento").first().waitFor();
  check("está na última etapa (Pagamento)", await page.locator("#campo-pagamento").isVisible());
  if (OUT) await page.screenshot({ path: `${OUT}/1-ultima-etapa.png` });

  // Clica no "Enviar ao gestor" do rodapé da última etapa
  await page.getByRole("button", { name: "Enviar ao gestor" }).last().click();
  const midia = page.locator("#campo-venda-midia");
  await midia.waitFor({ state: "visible", timeout: 10000 });
  check("abriu a etapa Resumo, bloco Imóvel, com o campo Mídia visível", await midia.isVisible());
  await page.waitForTimeout(700);
  check("Mídia destacada em vermelho", (await midia.getAttribute("data-campo-pendente")) === "true");
  const focoDentro = await page.evaluate(() => !!document.activeElement?.closest("#campo-venda-midia"));
  check("foco no campo Mídia", focoDentro);
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Falta preencher Mídia" });
  check(
    "mensagem diz o campo e onde fica",
    (await toast.count()) > 0 &&
      /Falta preencher Mídia, na etapa Resumo \(bloco Imóvel\)\. Já abrimos ela para você\./.test(await toast.first().innerText()),
  );
  check("não abriu a janela de conferência", (await page.getByRole("dialog").count()) === 0);
  check(
    "só a Mídia falta (sem lista de outros campos)",
    !/Também falta/.test(await toast.first().innerText()),
  );
  if (OUT) await page.screenshot({ path: `${OUT}/2-levou-a-midia.png` });

  // Item clicável da lista de pendências: volta à etapa 1 e clica em "Mídia" na lista
  await page.getByRole("button", { name: /1\. Documentos/ }).first().click();
  await page.waitForTimeout(400);
  const item = page.locator('[data-testid="pendencias-envio"] [data-pendencia="midia"]');
  check("pendência da Mídia aparece clicável na lista", (await item.count()) === 1);
  await item.click();
  await midia.waitFor({ state: "visible", timeout: 10000 });
  check("clicar na pendência leva ao campo", await midia.isVisible());

  // Botão "Preencher agora" da faixa, partindo de outra etapa
  await page.getByRole("button", { name: /3\. Partes/ }).first().click();
  await page.waitForTimeout(400);
  await faixa.getByRole("button", { name: "Preencher agora" }).click();
  await midia.waitFor({ state: "visible", timeout: 10000 });
  check('"Preencher agora" leva ao campo Mídia', await midia.isVisible());
} catch (e) {
  falhas++;
  console.log("ERRO", e.message);
} finally {
  await browser.close();
}
console.log(falhas ? `FALHOU (${falhas})` : "TUDO OK");
process.exit(falhas ? 1 : 0);
