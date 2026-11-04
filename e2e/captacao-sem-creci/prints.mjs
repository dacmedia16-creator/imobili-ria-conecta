// Teste de tela: captador SEM CRECI (t_e75b58c5), contra o mock local (sem rede, dados fictícios).
// Uso: MOCK_PORT=54398 node e2e/captacao-sem-creci/mock-supabase.mjs &
//      SUPABASE_URL=http://127.0.0.1:54398 VITE_SUPABASE_URL=http://127.0.0.1:54398 vite dev --port 8097 &
//      PLAYWRIGHT_FROM=<package.json com playwright> OUT_DIR=<pasta> node e2e/captacao-sem-creci/prints.mjs
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP || "http://127.0.0.1:8097";
const MOCK = process.env.MOCK || "http://127.0.0.1:54398";
const CAPTURE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GESTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OUT = process.env.OUT_DIR || ".";
let falhas = 0;
const check = (name, ok, extra = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sessao = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: GESTOR, exp, role: "authenticated", session_id: "s-g" })}.tok-gestor`,
    refresh_token: "r-tok-gestor",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: {
      id: GESTOR,
      email: "gestor@example.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
    },
  };
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
async function abrir(scenario, viewport) {
  await fetch(`${MOCK}/__mock/reset?scenario=${scenario}`);
  const context = await browser.newContext({
    viewport,
    locale: "pt-BR",
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
  });
  await context.addInitScript(
    ([k, v]) => localStorage.setItem(k, v),
    ["sb-127-auth-token", JSON.stringify(sessao())],
  );
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
  await page.goto(`${APP}/exclusividades/${CAPTURE}`);
  // O card fica na etapa "Dados do contrato".
  const etapa = page.getByRole("button", { name: /Dados do contrato/ }).first();
  await etapa.waitFor({ timeout: 120000 });
  await page.waitForTimeout(2000);
  await etapa.click();
  const card = page.getByTestId("card-contrato-sem-creci");
  await card.waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  return { context, page, card };
}
const shot = async (card, nome) => {
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/${nome}.png` });
};

const DESK = { width: 1366, height: 900 };
const CEL = { width: 390, height: 844 };
try {
  for (const [vp, tag] of [
    [DESK, "desktop"],
    [CEL, "celular"],
  ]) {
    // 1) Padrão: líder da equipe no contrato, captador testemunha 1, testemunha 2 pedida.
    {
      const { context, page, card } = await abrir("lider", vp);
      const txt = await card.innerText();
      check(
        `${tag}: corretor do contrato = líder da equipe com CRECI`,
        /Gina Gestora Fictícia · CRECI 12345-F \(gestor da equipe\)/.test(txt),
      );
      check(
        `${tag}: captador como testemunha 1`,
        /Testemunha 1 \(captador\)/.test(txt) && txt.includes("Corretor Fictício"),
      );
      check(
        `${tag}: pede a testemunha 2`,
        txt.includes("Testemunha 2: não informada") && txt.includes("Informe nome, CPF e e-mail"),
      );
      await shot(card, `1-${tag}-lider-equipe`);

      // 2) Testemunha 2 com erro: CPF inválido (tela) e depois o CPF do corretor do contrato (recusa).
      await page.fill("#t2-nome", "Paula");
      await page.fill("#t2-cpf", "123");
      await page.fill("#t2-email", "paula");
      await page.getByRole("button", { name: "Salvar testemunha 2" }).click();
      await page.waitForTimeout(500);
      const alerta = await card.getByRole("alert").innerText();
      check(
        `${tag}: erro da testemunha 2 na tela`,
        alerta.includes("nome com sobrenome") &&
          alerta.includes("CPF válido") &&
          alerta.includes("e-mail válido"),
        alerta,
      );
      await shot(card, `2-${tag}-testemunha2-erro`);
      await page.fill("#t2-nome", "Gina Gestora Fictícia");
      await page.fill("#t2-cpf", "529.982.247-25");
      await page.fill("#t2-email", "gina@example.com");
      await page.waitForTimeout(300);
      const alerta2 = await card.getByRole("alert").innerText();
      check(
        `${tag}: testemunha 2 = corretor do contrato → recusa`,
        alerta2.includes("não pode ser o corretor do contrato"),
        alerta2,
      );
      await shot(card, `3-${tag}-testemunha2-igual-corretor`);

      // 3) Troca do corretor do contrato pelo staff (Hugo) e testemunha 2 válida.
      await page.getByRole("button", { name: "Trocar corretor do contrato" }).click();
      await page.locator("#contrato-corretor-escolha").click();
      await page.getByRole("option", { name: /Hugo Gestor Fictício/ }).click();
      await page.getByRole("button", { name: "Usar no contrato" }).click();
      await card
        .getByText(/Hugo Gestor Fictício · CRECI 67890-F \(escolhido\)/)
        .waitFor({ timeout: 15000 });
      check(`${tag}: troca do corretor do contrato`, true);
      await page.fill("#t2-nome", "Paula Exemplo Fictícia");
      await page.fill("#t2-cpf", "987.654.321-00");
      await page.fill("#t2-email", "paula@example.com");
      await page.getByRole("button", { name: "Salvar testemunha 2" }).click();
      await card.getByText(/Testemunha 2 \(digitada\)/).waitFor({ timeout: 15000 });
      const txt3 = await card.innerText();
      check(
        `${tag}: testemunha 2 salva, sem pendências`,
        txt3.includes("Paula Exemplo Fictícia") && !txt3.includes("Informe nome, CPF e e-mail"),
      );
      check(
        `${tag}: botão voltar para o gestor da equipe`,
        txt3.includes("Voltar para o gestor da equipe (Gina Gestora Fictícia)"),
      );
      await shot(card, `4-${tag}-trocado-e-testemunha2-ok`);
      await context.close();
    }
    // 4) Nenhum gestor/TL com CRECI → bloqueio com mensagem clara.
    {
      const { context, page, card } = await abrir("sem-gestor", vp);
      const txt = await card.innerText();
      check(
        `${tag}: sem gestor/TL com CRECI → bloqueio`,
        txt.includes("O contrato não pode ser gerado sem CRECI") && txt.includes("Não definido"),
      );
      await page.getByRole("button", { name: "Escolher corretor do contrato" }).click();
      await page.locator("#contrato-corretor-escolha").click();
      const opt = page.getByRole("option", { name: /Tito TL Fictício/ });
      check(
        `${tag}: TL sem CRECI aparece desabilitado`,
        (await opt.getAttribute("aria-disabled")) === "true" ||
          (await opt.getAttribute("data-disabled")) !== null,
      );
      await page.keyboard.press("Escape");
      await shot(card, `5-${tag}-sem-gestor-com-creci-bloqueio`);
      await context.close();
    }
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
