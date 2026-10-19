// Print do comprovante de residência POR PROPRIETÁRIO (t_8e496afb) contra o mock local.
// Uso: node e2e/residencia-proprietario/mock-supabase.mjs &
//      SUPABASE_URL=http://127.0.0.1:54397 VITE_SUPABASE_URL=http://127.0.0.1:54397 GEMINI_API_KEY=ficticia \
//      NODE_OPTIONS="--import ./e2e/residencia-proprietario/gemini-stub.mjs" vite dev --port 8094 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/residencia-proprietario/prints.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8094";
const MOCK = process.env.MOCK || "http://127.0.0.1:54397";
const CAPTURE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CORRETOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUT = process.env.OUT_DIR || ".";
const ENDERECO = "Rua das Acácias Fictícias, 321, apto 12, Jardim Exemplo, Sorocaba/SP, 18000-000";
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
  user: { id: CORRETOR, email: "corretor@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
};
const pdf = `${OUT}/comprovante-ficticio.pdf`;
writeFileSync(pdf, "%PDF-1.4\n% comprovante ficticio\n%%EOF\n");

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
  await page.goto(`${APP}/exclusividades/${CAPTURE}`);
  const campos = page.getByLabel("Enviar Comprovante de residência (opcional)");
  await campos.first().waitFor({ timeout: 90000 });
  // Ordem na tela: Proprietário 1, Proprietário 2, Documentos do imóvel.
  check("campo novo nos 2 proprietários + o do imóvel", (await campos.count()) === 3, `${await campos.count()} campos`);

  const card1 = page.locator("div.rounded-xl, div[class*='card']").filter({ has: page.getByText("Proprietário 1", { exact: false }) }).filter({ has: campos.nth(0) }).last();
  await campos.nth(0).setInputFiles(pdf);
  await page.getByText(/Documento lido • 1 campo preenchido/).waitFor({ timeout: 60000 });
  check("toast: 1 campo preenchido (só o endereço)", true);
  await page.waitForTimeout(800);
  await card1.scrollIntoViewIfNeeded();
  await card1.screenshot({ path: `${OUT}/1-proprietario-1-comprovante-anexado.png` });

  // Proprietário 2 já tem endereço digitado: lê, mas não sobrescreve.
  await campos.nth(1).setInputFiles(pdf);
  await page.getByText(/Os campos encontrados já estavam preenchidos/).waitFor({ timeout: 60000 });
  check("proprietário 2: não sobrescreve o que foi digitado", true);

  const state = await (await fetch(`${MOCK}/__mock/state`)).json();
  check("endereço do proprietário 1 gravado", state.proprietario_1.endereco_completo === ENDERECO);
  check("nome do proprietário 1 não trocado pelo titular da conta", state.proprietario_1.nome_completo === "Paula Proprietária Fictícia");
  check("endereço do proprietário 2 mantido", state.proprietario_2.endereco_completo === "Endereço digitado pelo corretor, 50");
  check("imóvel intocado", state.imovel.endereco === "Rua do Imóvel Fictício, 200");

  await page.getByRole("button", { name: /Dados do contrato/ }).first().click();
  const endereco = page.locator(`input[value="${ENDERECO}"]`);
  await endereco.waitFor({ timeout: 20000 });
  const dados1 = page.locator("div.rounded-xl, div[class*='card']").filter({ has: endereco }).last();
  await dados1.scrollIntoViewIfNeeded();
  await dados1.screenshot({ path: `${OUT}/2-dados-proprietario-1-endereco-preenchido.png` });
  console.log("prints:", OUT);
} catch (e) {
  falhas++;
  console.log("ERRO", e.message);
} finally {
  await browser.close();
}
console.log(falhas ? `FALHOU (${falhas})` : "TUDO OK");
process.exit(falhas ? 1 : 0);
