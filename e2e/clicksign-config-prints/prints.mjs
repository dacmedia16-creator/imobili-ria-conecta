// Prints da tela "Assinatura digital" contra o mock local (dados fictícios). Nada vai à Clicksign.
// Uso: node e2e/clicksign-config-prints/mock-supabase.mjs & vite dev (VITE_SUPABASE_URL=mock) &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/clicksign-config-prints/prints.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8131";
const MOCK = process.env.MOCK || "http://127.0.0.1:54431";
const OUT = process.env.OUT_DIR || ".";
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const sessionFor = (id, email, tok) => ({
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated", session_id: "s1" })}.${tok}`,
  refresh_token: `r-${tok}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: exp,
  user: {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
  },
});
const SUPER = sessionFor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "super@example.com", "tok-super");
const ADMIN = sessionFor("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "admin@example.com", "tok-admin");

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const open = async (session) => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "pt-BR",
  });
  await context.addInitScript(
    ([k, v]) => localStorage.setItem(k, v),
    ["sb-127-auth-token", JSON.stringify(session)],
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  return page;
};
const shot = async (page, file, full = true) => {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: full });
  console.log("print:", `${OUT}/${file}`);
};

try {
  await fetch(`${MOCK}/__mock/reset`);
  // 1) Admin (não super): não vê o item no menu e a rota não abre a tela.
  const pa = await open(ADMIN);
  await pa.goto(`${APP}/dashboard`);
  await pa.waitForTimeout(6000);
  check(
    "admin não vê 'Assinatura digital' no menu",
    (await pa.getByRole("link", { name: "Assinatura digital" }).count()) === 0,
  );
  await pa.goto(`${APP}/admin/assinatura-digital`);
  await pa.waitForTimeout(5000);
  check(
    "admin é redirecionado / não vê a tela",
    (await pa.getByTestId("clicksign-config").count()) === 0,
    pa.url(),
  );
  await shot(pa, "0-admin-sem-acesso.png", false);
  await pa.context().close();

  // 2) Super admin: tela vazia, tudo bloqueado.
  const p = await open(SUPER);
  await p.goto(`${APP}/admin/assinatura-digital`);
  await p.getByTestId("clicksign-config").waitFor({ timeout: 90000 });
  await p.waitForTimeout(800);
  const ligar = p.getByRole("button", { name: "Ligar assinatura digital" });
  check("org nova: Ligar bloqueado", await ligar.isDisabled());
  check(
    "menu do super admin tem 'Assinatura digital'",
    (await p.getByRole("link", { name: "Assinatura digital" }).count()) > 0,
  );
  await shot(p, "1-inicio-nada-configurado.png");

  // 3) Salva chave, testa (falha e depois ok), webhook, quem assina, prazo, e-mails de teste.
  await p.getByLabel("Colar chave").fill("chave-ficticia-de-teste-0001");
  await p.getByRole("button", { name: "Salvar" }).first().click();
  await p.getByText(/Chave configurada em/).waitFor();
  const corpo = await p.locator("body").innerText();
  check(
    "chave não aparece na tela depois de salva",
    !corpo.includes("chave-ficticia-de-teste-0001"),
  );
  check("campo da chave volta vazio", (await p.getByLabel("Trocar chave").inputValue()) === "");
  await fetch(`${MOCK}/__mock/fail-next`);
  await p.getByRole("button", { name: /Testar conexão/ }).click();
  await p
    .getByText(/A Clicksign recusou a chave/)
    .first()
    .waitFor();
  check("teste com falha mostra mensagem clara", true);
  await p
    .getByText(/A Clicksign recusou a chave/)
    .first()
    .scrollIntoViewIfNeeded();
  await shot(p, "2-teste-conexao-falhou.png", false);
  await p.getByRole("button", { name: /Testar conexão/ }).click();
  await p.getByText("Conexão com a Clicksign funcionando.").first().waitFor();
  await p.getByLabel("Colar segredo do webhook").fill("segredo-ficticio-webhook-0001");
  await p.getByRole("button", { name: "Salvar" }).first().click();
  await p.getByText(/Segredo do webhook configurada em/).waitFor();
  check("ainda bloqueado sem quem assina", await ligar.isDisabled());
  await p.getByLabel(/Diretora Fictícia/).click();
  await p.getByRole("button", { name: "Salvar quem assina" }).click();
  await p.waitForTimeout(500);
  await p.getByLabel("Prazo para assinar (dias, de 1 a 90)").fill("15");
  await p.getByRole("button", { name: "Salvar prazo" }).click();
  await p.waitForTimeout(400);
  await p
    .getByLabel("E-mails liberados no modo teste")
    .fill("teste1@example.com, teste2@example.com");
  await p.getByRole("button", { name: /Substituir lista/ }).click();
  await p.waitForTimeout(600);
  check("tudo pronto: Ligar liberado", !(await ligar.isDisabled()));
  await shot(p, "3-tudo-configurado-pronto-para-ligar.png");

  // 4) Liga (com confirmação) e mostra desligar com confirmação.
  await ligar.click();
  await p.getByRole("button", { name: "Sim, ligar" }).click();
  await p.getByText("Assinatura digital ligada (captação e venda)").waitFor();
  check("ligou", true);
  await p.getByRole("button", { name: "Desligar assinatura digital" }).click();
  await p.getByRole("alertdialog").waitFor();
  await shot(p, "4-desligar-pede-confirmacao.png", false);
  await p.getByRole("button", { name: "Cancelar" }).click();
  check(
    "cancelar mantém ligada",
    (await p.getByText("Assinatura digital ligada (captação e venda)").count()) > 0,
  );
  await p.getByText("Histórico de alterações").scrollIntoViewIfNeeded();
  const hist = await p.getByTestId("auditoria").innerText();
  check(
    "histórico com autor e sem segredo",
    /Super Admin Fictício/.test(hist) && !/ficticia-de-teste|ficticio-webhook|@/.test(hist),
  );
  await shot(p, "5-ligada-com-historico.png");
} catch (e) {
  falhas++;
  console.log("ERRO", e.message);
} finally {
  await browser.close();
}
console.log(falhas ? `FALHOU (${falhas})` : "TUDO OK");
process.exit(falhas ? 1 : 0);
