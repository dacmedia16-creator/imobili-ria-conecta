// Prints do "Você comemora aniversário?" (t_2d5f0ab6) contra o mock local (dados fictícios).
// Uso: node e2e/comemora-aniversario-prints/mock-supabase.mjs &
//      VITE_SUPABASE_URL=http://127.0.0.1:54441 ... vite dev --port 8141 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/comemora-aniversario-prints/prints.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8141";
const MOCK = process.env.MOCK || "http://127.0.0.1:54441";
const OUT = process.env.OUT_DIR || ".";
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const sessionFor = (id, email, tok, created_at) => ({
  // Assinatura fictícia com tamanho válido de base64url (o servidor decodifica antes de chamar o mock).
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated", session_id: "s1" })}.${tok.padEnd(Math.ceil(tok.length / 4) * 4, "A")}`,
  refresh_token: `r-${tok}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: exp,
  user: {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    created_at,
    app_metadata: {},
    user_metadata: {},
  },
});
const ADMIN = sessionFor(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "admin@example.com",
  "tok-admin",
  "2026-01-01T00:00:00Z",
);
const ANTIGO = sessionFor(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "corretor.antigo@example.com",
  "tok-antigo",
  "2026-09-01T12:00:00Z",
);
const NOVO = sessionFor(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "corretor.novo@example.com",
  "tok-novo",
  "2026-10-21T12:00:00Z",
);

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const open = async (session, viewport = { width: 1366, height: 900 }) => {
  const context = await browser.newContext({ viewport, locale: "pt-BR" });
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
const state = async () => (await fetch(`${MOCK}/__mock/state`)).json();
const toasts = async (page) =>
  (await page.locator("[data-sonner-toast]").allInnerTexts()).join(" | ") || "(sem aviso)";

const ANTIGO_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOVO_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const radio = (page, grupo, nome) => page.getByTestId(grupo).getByRole("radio", { name: nome });
const marcado = async (page, grupo, nome) =>
  (await radio(page, grupo, nome).getAttribute("aria-checked")) === "true";

try {
  await fetch(`${MOCK}/__mock/reset`);

  // 1) 1º acesso: a pergunta só aparece depois da data, já marcada em Sim.
  const pn = await open(NOVO, { width: 430, height: 932 });
  await pn.goto(`${APP}/dashboard`);
  await pn.getByTestId("completar-perfil").waitFor({ timeout: 60000 });
  check("1º acesso: sem data, sem a pergunta", (await pn.getByTestId("cp-comemora").count()) === 0);
  await pn.getByTestId("cp-nascimento").fill("1995-07-14");
  await pn.getByTestId("cp-comemora").waitFor({ timeout: 5000 });
  check(
    "1º acesso: com data, pergunta aparece marcada em Sim",
    await marcado(pn, "cp-comemora", "Sim"),
  );
  await pn.getByTestId("cp-comemora").scrollIntoViewIfNeeded();
  await shot(pn, "1-primeiro-acesso-pergunta-sim.png");
  await radio(pn, "cp-comemora", "Não").click();
  check(
    "1º acesso: Não mostra o aviso",
    (await pn.getByTestId("cp-comemora-aviso-nao").count()) === 1,
  );
  await shot(pn, "1b-primeiro-acesso-nao.png");
  await pn.context().close();

  // 2) Meu acesso: corretor com data (Sim) troca para Não e salva.
  const pa = await open(ANTIGO);
  await pa.goto(`${APP}/perfil`);
  await pa.getByTestId("perfil-comemora").waitFor({ timeout: 60000 });
  await pa.waitForTimeout(1200);
  check("Meu acesso: quem já tinha data vem como Sim", await marcado(pa, "perfil-comemora", "Sim"));
  await radio(pa, "perfil-comemora", "Não").click();
  await pa.getByTestId("perfil-nascimento").scrollIntoViewIfNeeded();
  await shot(pa, "2-meu-acesso-nao.png", false);
  await pa.getByTestId("perfil-salvar-contato").click();
  await pa.waitForTimeout(1500);
  const s1 = await state();
  check(
    "Meu acesso: gravou Não via profile_set_birthdate",
    s1.comemora[ANTIGO_ID] === false &&
      s1.calls.some((c) => c.fn === "profile_set_birthdate" && c.args._comemora === false),
    await toasts(pa),
  );

  // 3) Mural: quem disse Não não aparece; data continua com a pessoa.
  await pa.goto(`${APP}/mural-conquistas`);
  await pa.getByText("Aniversariantes do mês").first().waitFor({ timeout: 60000 });
  await pa.waitForTimeout(1500);
  const muralTxt = await pa.locator("body").innerText();
  check(
    "Mural: corretor que disse Não e admin que disse Não ficam fora",
    !muralTxt.includes("Carla Antiga Fictícia") && !muralTxt.includes("Admin Fictício"),
  );
  await shot(pa, "3-mural-sem-quem-nao-comemora.png", false);
  await pa.context().close();

  // 4) Gestão: Editar dados mostra a escolha (Não) e volta para Sim; Novo usuário com a pergunta.
  const pg = await open(ADMIN);
  await pg.goto(`${APP}/admin/usuarios`);
  await pg.getByText("Carla Antiga Fictícia").first().waitFor({ timeout: 60000 });
  await pg.waitForTimeout(1500);
  const linha = pg
    .locator("div", { hasText: "corretor.antigo@example.com" })
    .filter({ has: pg.getByRole("button", { name: "Editar dados" }) })
    .last();
  await linha.getByRole("button", { name: "Editar dados" }).click();
  await pg.getByTestId("eu-comemora").waitFor({ timeout: 15000 });
  check("Editar dados: gestão vê o Não da pessoa", await marcado(pg, "eu-comemora", "Não"));
  check(
    "Editar dados: gestão continua vendo a data",
    (await pg.locator("#eu-nascimento").inputValue()).length === 10,
  );
  await shot(pg, "4-usuarios-editar-nao.png", false);
  await radio(pg, "eu-comemora", "Sim").click();
  await pg.getByRole("button", { name: "Salvar" }).click();
  await pg.waitForTimeout(2500);
  const s2 = await state();
  check(
    "Editar dados: gravou Sim via profile_birthdate_set_for_user",
    s2.comemora[ANTIGO_ID] === true &&
      s2.calls.some((c) => c.fn === "profile_birthdate_set_for_user" && c.args._comemora === true),
    await toasts(pg),
  );
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(500);
  await pg
    .getByRole("button", { name: /Novo usuário/ })
    .first()
    .click();
  await pg.locator("#nu-nascimento").waitFor({ timeout: 10000 });
  await pg.locator("#nu-nome").fill("Corretor Teste Fictício");
  await pg.locator("#nu-email").fill("corretor.teste@example.com");
  await pg.locator("#nu-telefone").fill("(15) 99999-0000");
  await pg.locator("#nu-nascimento").fill("1995-07-14");
  await pg.getByTestId("nu-comemora").waitFor({ timeout: 5000 });
  check("Novo usuário: pergunta com Sim marcado", await marcado(pg, "nu-comemora", "Sim"));
  await shot(pg, "4b-usuarios-novo-usuario.png", false);
  await pg.context().close();

  // 5) Ficha do colaborador (no Meu acesso): pergunta junto da data.
  const pf = await open(NOVO);
  await fetch(`${MOCK}/__mock/reset`);
  await pf.goto(`${APP}/perfil`);
  await pf
    .getByTestId("fc-comemora")
    .waitFor({ timeout: 60000 })
    .catch(() => {});
  const temFicha = (await pf.getByTestId("fc-comemora").count()) === 1;
  check("Ficha: pergunta junto da data", temFicha);
  if (temFicha) {
    await pf.getByTestId("fc-comemora").scrollIntoViewIfNeeded();
    await shot(pf, "5-ficha-colaborador.png", false);
  }
  await pf.context().close();
  void NOVO_ID;
} catch (e) {
  falhas++;
  console.log("FAIL erro:", e.message);
} finally {
  await browser.close();
  console.log(falhas ? `FALHAS: ${falhas}` : "TODOS OS CHECKS PASSARAM");
  process.exit(falhas ? 1 : 0);
}
