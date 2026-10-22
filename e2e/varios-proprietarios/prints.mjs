// Teste de tela local com 4 proprietários fictícios (t_58effd65), contra o mock local (sem rede).
// Uso: node e2e/varios-proprietarios/mock-supabase.mjs &
//      SUPABASE_URL=http://127.0.0.1:54398 VITE_SUPABASE_URL=http://127.0.0.1:54398 vite dev --port 8095 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/varios-proprietarios/prints.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8095";
const MOCK = process.env.MOCK || "http://127.0.0.1:54398";
const CAPTURE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUT = process.env.OUT_DIR || ".";
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const session = {
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER, exp, role: "authenticated", session_id: "s1" })}.tok-corretor`,
  refresh_token: "r-tok-corretor",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: exp,
  user: { id: USER, email: "corretor@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
try {
  await fetch(`${MOCK}/__mock/reset`);
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "pt-BR", acceptDownloads: true });
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ["sb-127-auth-token", JSON.stringify(session)]);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));

  await page.goto(`${APP}/exclusividades/${CAPTURE}`);
  await page.getByText("Davi Proprietário Fictício").first().waitFor({ timeout: 120000 });
  for (const n of ["Ana Proprietária", "Bruno Proprietário", "Carla Proprietária", "Davi Proprietário"])
    check(`documentos: bloco de ${n}`, (await page.getByText(n, { exact: false }).count()) > 0);
  await page.screenshot({ path: `${OUT}/1-documentos-4-proprietarios.png`, fullPage: true });

  // Captação "enviada" = só leitura para edição de proprietários.
  check("enviada: sem botão Adicionar proprietário", (await page.getByRole("button", { name: /Adicionar proprietário/ }).count()) === 0);

  // Rascunho (corretor editando): adicionar o 5º e remover de novo.
  await fetch(`${MOCK}/__mock/reset?status=rascunho`);
  await page.reload();
  await page.getByText("Davi Proprietário Fictício").first().waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: /Dados do contrato/ }).first().click();
  const add = page.getByRole("button", { name: /Adicionar proprietário/ }).first();
  await add.waitFor({ timeout: 20000 });
  check("rascunho: botão Adicionar proprietário", true);
  await add.click();
  const rem = page.getByRole("button", { name: "Remover proprietário 5", exact: true });
  await rem.first().waitFor({ timeout: 10000 });
  check("rascunho: 5º proprietário adicionado", true);
  await page.screenshot({ path: `${OUT}/2-dados-5-proprietarios.png`, fullPage: true });
  page.once("dialog", (d) => d.accept());
  await rem.first().click();
  await page.waitForTimeout(800);
  check("rascunho: 5º removido", (await rem.count()) === 0);
  check("rascunho: 4º continua", (await page.getByText("Davi Proprietário Fictício").count()) > 0);
  await page.screenshot({ path: `${OUT}/2b-dados-apos-remover.png`, fullPage: true });

  await fetch(`${MOCK}/__mock/reset`);
  await page.reload();
  await page.getByText("Davi Proprietário Fictício").first().waitFor({ timeout: 120000 });

  await page.getByRole("button", { name: /Revisão|Envio/ }).first().click();
  const gerar = page.getByRole("button", { name: "Gerar PDF para assinatura" });
  await gerar.waitFor({ timeout: 30000 });
  const dl = page.waitForEvent("download", { timeout: 120000 });
  await gerar.click();
  const download = await dl;
  const file = `${OUT}/tela-contrato-4-proprietarios.pdf`;
  await download.saveAs(file);
  check("PDF gerado e baixado pela tela", true, file);
  const up = Buffer.from(await (await fetch(`${MOCK}/__mock/upload`)).arrayBuffer());
  check("PDF gerado também enviado ao storage (mock)", up.length > 1000, `${up.length} bytes`);
  writeFileSync(`${OUT}/tela-contrato-4-proprietarios-upload.bin`, up);
  await page.screenshot({ path: `${OUT}/3-revisao-pdf-gerado.png`, fullPage: true });
} catch (e) {
  falhas++;
  console.log("ERRO", e.message.split("\n")[0]);
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (pages[0]) {
    const btns = await pages[0].locator("button").allInnerTexts();
    console.log("botões:", btns.map((t) => t.trim()).filter(Boolean).slice(0, 60).join(" | "));
    await pages[0].screenshot({ path: `${OUT}/erro.png`, fullPage: true });
  }
} finally {
  await browser.close();
}
console.log(falhas ? `FALHOU (${falhas})` : "TUDO OK");
process.exit(falhas ? 1 : 0);
