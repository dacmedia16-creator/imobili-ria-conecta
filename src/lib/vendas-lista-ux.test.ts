// Tela Vendas (lista): 8 melhorias de interface aprovadas por Denis em 31/10 (t_9a7afb5a).
// Só interface: os filtros, a URL e a consulta continuam os mesmos.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tela = readFileSync("src/routes/_authenticated/vendas.index.tsx", "utf8");

describe("tela Vendas — melhorias de interface (t_9a7afb5a)", () => {
  it("1. celular: botão mostra quantos filtros estão ligados e há Limpar filtros", () => {
    expect(tela).toContain("`Filtros (${filtrosLigados})`");
    expect(tela).toContain("Limpar filtros");
    expect(tela).toContain('aria-controls="vendas-filtros"');
  });

  it("2. celular: texto curto na busca", () => {
    expect(tela).toContain('"Código, imóvel ou pessoa…"');
  });

  it("3. lista vazia fala Registrar venda e traz o botão", () => {
    expect(tela).not.toContain("Nova Venda");
    expect(tela).not.toContain("Novo Lançamento");
    expect(tela).toContain("action={registrarVendaButton}");
  });

  it("4. vermelho só para atraso e exclusão: Sua vez no azul, sem faixa lateral", () => {
    expect(tela).not.toContain("border-l-destructive");
    expect(tela).not.toContain('"bg-destructive hover:bg-destructive/90"');
    expect(tela).toMatch(/bg-primary\/10[^"]*text-primary">\s*Sua vez/);
  });

  it("5. cartões com nome curto, aviso dentro e botão i acessível", () => {
    expect(tela).toContain('titulo="Efetivadas"');
    expect(tela).toContain('titulo="Lançadas"');
    expect(tela).toContain('aviso="Não segue o filtro de status."');
    expect(tela).toContain("aria-label={`O que entra em ${titulo}`}");
  });

  it("6. computador: Mais filtros (n) guarda equipe, mídia e pagamento", () => {
    expect(tela).toContain("`Mais filtros (${maisFiltrosAtivos})`");
    const bloco = tela.slice(tela.indexOf('id="vendas-mais-filtros"'));
    expect(bloco.indexOf('aria-label="Equipe"')).toBeGreaterThan(0);
    expect(bloco.indexOf('aria-label="Mídia"')).toBeGreaterThan(0);
    expect(bloco.indexOf('aria-label="Pagamento"')).toBeGreaterThan(0);
  });

  it("7. contagem, Valor à direita em negrito e ordenação por valor e dias", () => {
    expect(tela).toContain('"vendas encontradas"');
    expect(tela).toContain("whitespace-nowrap text-right tabular-nums");
    expect(tela).toContain('aria-label="Ordenar por valor"');
    expect(tela).toContain('aria-label="Ordenar por dias nesta etapa"');
    expect(tela).toContain('aria-sort={ariaSort("valor")}');
  });

  it("8. código do imóvel é link de verdade com seta", () => {
    expect(tela).toMatch(/<Link\s+to="\/vendas\/\$id"\s+params=\{\{ id: s\.id \}\}/);
    expect(tela).toContain("aria-label={`Abrir venda ${codigo}`}");
    expect(tela).toContain("<ChevronRight");
  });
});
