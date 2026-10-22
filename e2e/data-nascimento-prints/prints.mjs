// Prints da "Data de nascimento" (t_dff88e75) contra o mock local (dados fictícios).
// Uso: node e2e/data-nascimento-prints/mock-supabase.mjs &
//      VITE_SUPABASE_URL=http://127.0.0.1:54441 ... vite dev --port 8141 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/data-nascimento-prints/prints.mjs
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

try {
  await fetch(`${MOCK}/__mock/reset`);

  // 1) Corretor NOVO (1º acesso): tela obrigatória com Data de nascimento obrigatória.
  const pn = await open(NOVO, { width: 430, height: 932 });
  await pn.goto(`${APP}/dashboard`);
  await pn.getByTestId("completar-perfil").waitFor({ timeout: 30000 });
  check("1º acesso: tela obrigatória aparece", true);
  check(
    "1º acesso: campo de nascimento sem '(opcional)'",
    (await pn.getByText("Data de nascimento (opcional)").count()) === 0 &&
      (await pn.getByTestId("cp-nascimento").count()) === 1,
  );
  await pn.getByRole("button", { name: "Salvar e entrar" }).click();
  await pn.waitForTimeout(800);
  check(
    "1º acesso: sem data aparece 'obrigatório' no campo",
    (await pn.getByText("Data de nascimento — obrigatório").count()) === 1,
  );
  await shot(pn, "1-primeiro-acesso-obrigatorio.png");
  await pn.getByTestId("cp-nascimento").fill("2015-01-01");
  await pn.waitForTimeout(300);
  // A dica do campo troca para o erro (a tela já tentou salvar uma vez).
  await pn
    .getByText("A idade mínima é 16 anos.")
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  check(
    "1º acesso: menor de 16 mostra aviso",
    (await pn.getByText("A idade mínima é 16 anos.").count()) >= 1,
    await pn.locator("#cp-nascimento").inputValue(),
  );
  await shot(pn, "1b-primeiro-acesso-menor-16.png");
  await pn.context().close();

  // 2) Corretor ANTIGO: Meu acesso com o campo em destaque (vazio, opcional) e gravando.
  const pa = await open(ANTIGO);
  await pa.goto(`${APP}/perfil`);
  await pa.locator("#perfil-nascimento").waitFor({ timeout: 30000 });
  await pa.waitForTimeout(1500);
  check(
    "conta antiga com perfil completo e SEM data entra direto (sem tela/lembrete)",
    (await pa.getByTestId("lembrete-perfil").count()) === 0 &&
      (await pa.getByTestId("completar-perfil").count()) === 0,
  );
  check(
    "Meu acesso: aviso de destaque com campo vazio",
    (await pa.getByText("Preencha sua data de nascimento").count()) === 1,
  );
  await shot(pa, "2-meu-acesso-destaque.png", false);
  await pa.locator("#perfil-nascimento").fill("1990-05-07");
  await pa.getByTestId("perfil-nascimento").getByRole("button", { name: "Salvar" }).click();
  await pa.waitForTimeout(1200);
  const s1 = await state();
  check(
    "Meu acesso: gravou via profile_set_birthdate",
    s1.birth["cccccccc-cccc-4ccc-8ccc-cccccccccccc"] === "1990-05-07" &&
      s1.calls.some((c) => c.fn === "profile_set_birthdate"),
  );
  await shot(pa, "2b-meu-acesso-salvo.png", false);
  await pa.context().close();

  // 3) Admin: Usuários → Editar dados do corretor (vê e grava) + Novo usuário com o campo.
  const pg = await open(ADMIN);
  await pg.goto(`${APP}/admin/usuarios`);
  await pg.getByText("Carla Antiga Fictícia").first().waitFor({ timeout: 30000 });
  await pg.waitForTimeout(1500);
  const linha = pg
    .locator("div", { hasText: "corretor.antigo@example.com" })
    .filter({
      has: pg.getByRole("button", { name: "Editar dados" }),
    })
    .last();
  await linha.getByRole("button", { name: "Editar dados" }).click();
  await pg.getByTestId("eu-nascimento-campo").waitFor({ timeout: 15000 });
  check(
    "Editar dados: mostra a data completa do corretor",
    (await pg.locator("#eu-nascimento").inputValue()) === "1990-05-07",
  );
  await pg.locator("#eu-nascimento").fill("1989-12-25");
  await shot(pg, "3-usuarios-editar-dados.png", false);
  await pg.getByRole("button", { name: "Salvar" }).click();
  await pg.waitForTimeout(2500);
  const aviso = await toasts(pg);
  const s2 = await state();
  check(
    "Editar dados: gravou via profile_birthdate_set_for_user",
    s2.birth["cccccccc-cccc-4ccc-8ccc-cccccccccccc"] === "1989-12-25" &&
      s2.calls.some(
        (c) =>
          c.fn === "profile_birthdate_set_for_user" &&
          c.by === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ),
    aviso,
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
  check(
    "Novo usuário: campo Data de nascimento (opcional)",
    (await pg.getByText("Data de nascimento (opcional)").count()) === 1,
  );
  await shot(pg, "3b-usuarios-novo-usuario.png", false);
  await pg.context().close();
} catch (e) {
  falhas++;
  console.log("FAIL erro:", e.message);
} finally {
  await browser.close();
  console.log(falhas ? `FALHAS: ${falhas}` : "TODOS OS CHECKS PASSARAM");
  process.exit(falhas ? 1 : 0);
}
