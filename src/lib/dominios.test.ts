import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  CONTA_MAX_ORIGENS_ACEITAS,
  DOMINIO_PRINCIPAL,
  DOMINIOS,
  contaMaxLoginUrl,
  contaMaxLogoutUrl,
  contaMaxOriginPara,
  isContaMaxLoginUrl,
} from "./dominios";

describe("dominios (somosmaxhub → somosunihub, t_a69e9d11)", () => {
  it("domínio principal vem da flag e o wrangler.toml (APP_URL) bate com ela", () => {
    expect(APP_ORIGIN).toBe(DOMINIOS[DOMINIO_PRINCIPAL].app);
    const toml = readFileSync("wrangler.toml", "utf8");
    expect(toml).toContain(`APP_URL = "${APP_ORIGIN}"`);
  });

  it("fora dos domínios oficiais (servidor, homologação) o login usa o domínio principal", () => {
    const conta = DOMINIOS[DOMINIO_PRINCIPAL].conta;
    expect(contaMaxLoginUrl("adm-max", undefined, undefined)).toBe(`${conta}/login?app=adm-max`);
    expect(
      contaMaxLoginUrl("adm-max", "/reservas-salas", "adm-max-homolog.dacmedia16.workers.dev"),
    ).toBe(`${conta}/login?app=adm-max&return_to=%2Freservas-salas`);
    expect(contaMaxLogoutUrl("localhost")).toBe(`${conta}/logout`);
  });

  it("login e sair seguem o domínio em que a pessoa está (convivência)", () => {
    expect(contaMaxOriginPara("app.somosunihub.com.br")).toBe("https://conta.somosunihub.com.br");
    expect(contaMaxOriginPara("APP.SOMOSUNIHUB.COM.BR")).toBe("https://conta.somosunihub.com.br");
    expect(contaMaxOriginPara("app.somosmaxhub.com.br")).toBe("https://conta.somosmaxhub.com.br");
    expect(contaMaxLoginUrl("adm-max", undefined, "app.somosunihub.com.br")).toBe(
      "https://conta.somosunihub.com.br/login?app=adm-max",
    );
    expect(contaMaxLogoutUrl("app.somosunihub.com.br")).toBe(
      "https://conta.somosunihub.com.br/logout",
    );
    // Endereço parecido não engana a escolha.
    expect(contaMaxOriginPara("app.somosunihub.com.br.evil.com")).toBe(
      DOMINIOS[DOMINIO_PRINCIPAL].conta,
    );
  });

  it("convite aceita as três origens da Conta MAX durante a convivência", () => {
    expect([...CONTA_MAX_ORIGENS_ACEITAS].sort()).toEqual(
      [
        "https://conta.somosmaxhub.com.br",
        "https://conta.somosunihub.com.br",
        "https://conta.unicaescolha.com.br",
      ].sort(),
    );
    expect(CONTA_MAX_ORIGENS_ACEITAS[0]).toBe(DOMINIOS[DOMINIO_PRINCIPAL].conta);
    for (const o of CONTA_MAX_ORIGENS_ACEITAS)
      expect(isContaMaxLoginUrl(new URL(`${o}/login?app=adm-max`))).toBe(true);
  });

  it("convite recusa outros endereços e outros caminhos", () => {
    expect(isContaMaxLoginUrl(new URL("https://app.somosmaxhub.com.br/login"))).toBe(false);
    expect(isContaMaxLoginUrl(new URL("https://app.somosunihub.com.br/login"))).toBe(false);
    expect(isContaMaxLoginUrl(new URL("https://conta.somosmaxhub.com.br/logout"))).toBe(false);
    expect(isContaMaxLoginUrl(new URL("https://conta.somosunihub.com.br.evil.com/login"))).toBe(
      false,
    );
    expect(isContaMaxLoginUrl(new URL("http://conta.somosunihub.com.br/login"))).toBe(false);
  });

  it("nenhum link fixo de app./conta. sobrou nas telas (todas usam dominios.ts)", () => {
    for (const f of [
      "src/routes/auth.tsx",
      "src/routes/index.tsx",
      "src/routes/conta-max-flow.ts",
      "src/routes/_authenticated/plataforma.imobiliarias.tsx",
      "src/components/AppShell.tsx",
      "src/routes/__root.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/https:\/\/(conta|app)\.somos(max|uni)hub\.com\.br/);
    }
  });
});
