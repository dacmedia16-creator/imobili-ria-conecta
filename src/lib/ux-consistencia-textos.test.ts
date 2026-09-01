import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("consistência dos textos com a regra comercial", () => {
  it("não volta a chamar produção por pessoa de produção concluída", () => {
    expect(source("components/AppShell.tsx")).not.toContain("Produção concluída por pessoa");
  });

  it("não descreve Desempenho e Produção por pessoa pela regra financeira antiga", () => {
    expect(source("routes/_authenticated/visao-executiva.tsx")).not.toContain(
      "vendas distintas efetivamente enviadas ao Financeiro",
    );
    expect(source("routes/_authenticated/producao-por-pessoa.tsx")).not.toContain(
      "data do primeiro envio",
    );
  });

  it("diferencia os títulos administrativo e financeiro do painel do gestor", () => {
    const dashboard = source("routes/_authenticated/dashboard.tsx");
    expect(dashboard).toContain('"Painel administrativo"');
    expect(dashboard).toContain('"Painel financeiro"');
  });

  it("explica os perfis permitidos antes de criar vendas", () => {
    expect(source("routes/_authenticated/vendas.nova.tsx")).toContain(
      "Somente corretores, gestores e Team Leaders",
    );
    expect(source("routes/_authenticated/vendas.lancamento.nova.tsx")).toContain(
      "Você não possui um perfil autorizado para criar Lançamentos",
    );
  });
});
