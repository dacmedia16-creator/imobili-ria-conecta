import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatBRL, formatBRLOu } from "./formato-moeda";
import {
  LINK_VENDAS_POR_CARTAO,
  painelComecaAberto,
  primeiraMaiuscula,
} from "./dashboard-links-vendas";
import { STATUS_LABEL } from "./status";

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("item 24 — formatador único de R$", () => {
  it("sempre 2 casas, nunca 3", () => {
    expect(formatBRL(1234.5)).toBe("R$ 1.234,50");
    expect(formatBRL(0.125)).toBe("R$ 0,13");
    expect(formatBRL(1000000)).toBe("R$ 1.000.000,00");
    expect(formatBRLOu(null, "—")).toBe("—");
  });

  it("os formatadores locais apontam para o único", () => {
    for (const f of [
      "routes/_authenticated/relatorios.tsx",
      "routes/_authenticated/visao-executiva.tsx",
      "routes/_authenticated/comissao-coordenador.tsx",
      "routes/_authenticated/equipe.tsx",
      "components/vendas/shared.tsx",
    ]) {
      expect(ler(f), f).toContain("@/lib/formato-moeda");
    }
  });

  it("modalidade padrão com o mesmo nome em todas as telas", () => {
    for (const f of [
      "components/financeiro/Filters.tsx",
      "components/comparativo-comissao/Filters.tsx",
      "components/comparativo-comissao/InconsistenciasIndicator.tsx",
      "components/comparativo-comissao/DetailTable.tsx",
    ]) {
      expect(ler(f), f).not.toContain("Venda tradicional");
    }
  });
});

describe("item 20 — Início", () => {
  it("cada link leva a um status que a lista de Vendas aceita, com período aberto", () => {
    for (const [cartao, busca] of Object.entries(LINK_VENDAS_POR_CARTAO)) {
      if (!busca) continue;
      expect(busca.status in STATUS_LABEL, cartao).toBe(true);
      expect(busca).toMatchObject({ filtros: 1, de: "", ate: "" });
    }
  });

  it("cartões que somam 2+ status ou dependem do papel continuam sem filtro", () => {
    for (const k of [
      "minhas_vendas",
      "minhas_pendencias",
      "meus_contratos_conferir",
      "meus_assinados",
      "gestor_contratos_conferir",
      "gestor_ocorrencias_enviar",
      "gestor_devolvidas",
      "occ_pendentes_total",
      "occ_concluidas_total",
    ]) {
      expect(LINK_VENDAS_POR_CARTAO[k], k).toBeUndefined();
    }
  });

  it("'Outubro de 2026' sem 'De' maiúsculo", () => {
    expect(primeiraMaiuscula("outubro de 2026")).toBe("Outubro de 2026");
  });

  it("painel abre sozinho com pendência e respeita a escolha salva", () => {
    expect(painelComecaAberto(null, true)).toBe(true);
    expect(painelComecaAberto(null, false)).toBe(false);
    expect(painelComecaAberto("0", true)).toBe(false);
    expect(painelComecaAberto("1", false)).toBe(true);
  });
});
