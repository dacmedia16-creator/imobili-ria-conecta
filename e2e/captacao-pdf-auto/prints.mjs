// Teste de tela do PDF para assinatura automático (t_ef7dc621), contra o mock local (sem rede).
// Uso: MOCK_PORT=54399 node e2e/captacao-pdf-auto/mock-supabase.mjs &
//      SUPABASE_URL=http://127.0.0.1:54399 VITE_SUPABASE_URL=http://127.0.0.1:54399 vite dev --port 8096 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/captacao-pdf-auto/prints.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8096";
const MOCK = process.env.MOCK || "http://127.0.0.1:54399";
const CAPTURE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const IDS = { gestor: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", corretor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const OUT = process.env.OUT_DIR || ".";
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sessao = (quem) => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const id = IDS[quem];
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated", session_id: "s-" + quem })}.tok-${quem}`,
    refresh_token: `r-tok-${quem}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id, email: `${quem}@example.com`, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  };
};
const gerados = async () => (await (await fetch(`${MOCK}/__mock/gerado`)).json()).calls;

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function abrir(quem, scenario) {
  await fetch(`${MOCK}/__mock/reset?scenario=${scenario}`);
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "pt-BR", acceptDownloads: true });
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ["sb-127-auth-token", JSON.stringify(sessao(quem))]);
  // Guarda todo toast exibido (sonner) para conferir depois, mesmo que já tenha sumido.
  await context.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      document.querySelectorAll("[data-sonner-toast]").forEach((t) => {
        const s = t.textContent || "";
        if (s && !window.__toasts.includes(s)) window.__toasts.push(s);
      });
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  await page.goto(`${APP}/exclusividades/${CAPTURE}`);
  await page.getByText("Davi Proprietário Fictício").first().waitFor({ timeout: 120000 }).catch(() => undefined);
  return { context, page, downloads };
}
try {
  // 1) Gestor abre captação enviada pelo corretor, sem PDF → gera 1x sozinho e vai para a revisão.
  {
    const { context, page, downloads } = await abrir("gestor", "sem-pdf");
    await page.getByText("PDF para assinatura já gerado", { exact: false }).first().waitFor({ timeout: 120000 });
    const toasts = await page.evaluate(() => window.__toasts);
    console.log("toasts:", JSON.stringify(toasts));
    check("gestor/sem PDF: toast 'PDF para assinatura gerado'", toasts.some((t) => t.includes("PDF para assinatura gerado")));
    check("gestor/sem PDF: etapa Revisão com cartão Gerar PDF", (await page.getByText("Gerar PDF para assinatura", { exact: true }).count()) >= 2);
    check("gestor/sem PDF: botão manual continua (regerar)", (await page.getByRole("button", { name: "Gerar PDF para assinatura" }).count()) > 0);
    await page.waitForTimeout(3000); // re-render/StrictMode/recarregar não podem gerar de novo
    check("gestor/sem PDF: gerou exatamente 1x", (await gerados()) === 1, `chamadas=${await gerados()}`);
    check("gestor/sem PDF: sem download forçado (fica salvo)", downloads.length === 0);
    await page.screenshot({ path: `${OUT}/1-gestor-abre-pdf-gerado-auto.png`, fullPage: true });
    // Recarregar a página: já tem PDF → não gera de novo.
    await page.reload();
    await page.getByText("Davi Proprietário Fictício").first().waitFor({ timeout: 120000 });
    await page.waitForTimeout(4000);
    check("gestor/recarregou: não gera de novo", (await gerados()) === 1, `chamadas=${await gerados()}`);
    await context.close();
  }
  // 2) Já com PDF salvo → não gera.
  {
    const { context, page } = await abrir("gestor", "com-pdf");
    await page.waitForTimeout(5000);
    check("gestor/com PDF: não gera", (await gerados()) === 0, `chamadas=${await gerados()}`);
    await page.screenshot({ path: `${OUT}/2-gestor-ja-com-pdf.png`, fullPage: true });
    await context.close();
  }
  // 3) Corretor abre a própria captação enviada → comportamento inalterado.
  {
    const { context, page } = await abrir("corretor", "sem-pdf");
    await page.waitForTimeout(5000);
    check("corretor: não gera", (await gerados()) === 0, `chamadas=${await gerados()}`);
    check("corretor: sem cartão Gerar PDF", (await page.getByText("Gerar PDF para assinatura", { exact: true }).count()) === 0);
    await page.screenshot({ path: `${OUT}/3-corretor-inalterado.png`, fullPage: true });
    await context.close();
  }
  // 4) Falha (Plano de Marketing sem ação) → toast com motivo, fica na revisão, botão disponível, sem loop.
  {
    const { context, page } = await abrir("gestor", "falha");
    await page.waitForFunction(() => window.__toasts.some((t) => t.includes("não foi gerado automaticamente")), null, { timeout: 120000 });
    const toasts = await page.evaluate(() => window.__toasts);
    console.log("toasts:", JSON.stringify(toasts));
    check("falha: toast com o motivo", toasts.some((t) => t.includes("automaticamente") && t.includes("Plano de Marketing")));
    const btn = page.getByRole("button", { name: "Gerar PDF para assinatura" });
    await btn.waitFor({ timeout: 20000 });
    check("falha: botão manual disponível", await btn.isEnabled());
    await page.waitForTimeout(4000);
    check("falha: nada gravado e sem nova tentativa", (await gerados()) === 0);
    await page.screenshot({ path: `${OUT}/4-falha-plano-botao-manual.png`, fullPage: true });
    await context.close();
  }
} catch (e) {
  falhas++;
  console.log("ERRO", e.message.split("\n")[0]);
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (pages[0]) {
    console.log("texto:", (await pages[0].locator("body").innerText()).slice(0, 1500));
    await pages[0].screenshot({ path: `${OUT}/erro.png`, fullPage: true });
  }
} finally {
  await browser.close();
}
console.log(falhas ? `FALHOU (${falhas})` : "TUDO OK");
process.exit(falhas ? 1 : 0);
