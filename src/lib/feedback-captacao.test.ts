import { describe, expect, it } from "vitest";
import {
  agruparPendencias,
  checkState,
  codeKey,
  codigoValido,
  finalDigitado,
  montarCodigo,
  ownerPlan,
  ownerPlanText,
  planItemState,
  planSummary,
  portaisTexto,
  type Pendencia,
  type PlanItem,
} from "./feedback-captacao";

const item = (o: Partial<PlanItem>): PlanItem => ({
  action_id: o.label ?? "a",
  category: "Divulgação",
  label: "Ação",
  weight: "vital",
  sort: 1,
  in_plan: true,
  prazo: null,
  done_on: null,
  done_by_nome: null,
  proof_path: null,
  proof_name: null,
  ...o,
});

describe("código do anúncio", () => {
  it("normaliza hífen, x e zeros à esquerda como o banco", () => {
    expect(codeKey("630699001-114")).toBe("630699001-114");
    expect(codeKey("630699001x0114")).toBe("630699001-114");
    expect(codeKey(" 630699001XX114 ")).toBe("630699001-114");
  });
  it("valida formato", () => {
    expect(codigoValido("630699001-114")).toBe(true);
    expect(codigoValido("630699001x87")).toBe(true);
    expect(codigoValido("abc")).toBe(false);
    expect(codigoValido("63069900-114")).toBe(false);
  });
  it("prefixo travado: corretor digita só o final", () => {
    expect(finalDigitado("114", "630699001")).toBe("114");
    expect(finalDigitado("-114", "630699001")).toBe("114");
    expect(finalDigitado("630699001-114", "630699001")).toBe("114");
    expect(finalDigitado("1a4", "630699001")).toBe("14");
    expect(montarCodigo("630699001", "114")).toBe("630699001-114");
    expect(montarCodigo(null, "114")).toBe("");
    expect(montarCodigo("630699001", "")).toBe("");
  });
  it("estado da conferência", () => {
    expect(checkState(null)).toBe("invalido");
    expect(checkState({ valid: false })).toBe("invalido");
    expect(
      checkState({
        valid: true,
        conflict: { capture_id: "x", status: "ativo", label: null, aprovada_em: null },
      }),
    ).toBe("conflito");
    expect(
      checkState({
        valid: true,
        seen: {
          collected_on: "2026-10-05",
          listing_code: "c",
          portals: ["zap"],
          views: 1,
          contacts: 0,
        },
      }),
    ).toBe("encontrado");
    expect(checkState({ valid: true, seen: null })).toBe("nao_coletado");
  });
  it("lista portais em português", () => {
    expect(portaisTexto(["imovelweb", "zap"])).toBe("ZAP e Imovelweb");
    expect(portaisTexto(["zap"])).toBe("ZAP");
  });
});

describe("Plano de Marketing", () => {
  const hoje = "2026-10-08";
  const itens = [
    item({ label: "Placa no imóvel", done_on: "2026-10-02", prazo: "2026-10-05" }),
    item({ label: "Fotos profissionais", prazo: "2026-10-05", sort: 2 }),
    item({ label: "Vídeo", weight: "importante", prazo: "2026-10-20", sort: 3 }),
    item({ label: "Folder antigo", done_on: "2026-09-30", in_plan: false, sort: 4 }),
  ];
  it("estado por item", () => {
    expect(planItemState(itens[0], hoje)).toBe("feito");
    expect(planItemState(itens[1], hoje)).toBe("atrasada");
    expect(planItemState(itens[2], hoje)).toBe("no_prazo");
    expect(planItemState(item({}), hoje)).toBe("sem_prazo");
  });
  it("resumo conta só o plano atual", () => {
    expect(planSummary(itens, hoje)).toEqual({ total: 3, feitas: 1, atrasadas: 1, percent: 33 });
  });
  it("proprietário: feitas com data, atrasada vira 'esta semana'", () => {
    const p = ownerPlan(itens, hoje);
    expect(p.feitas).toEqual([
      { label: "Folder antigo", data: "30/09" },
      { label: "Placa no imóvel", data: "02/10" },
    ]);
    expect(p.proximos).toEqual([
      { label: "Fotos profissionais", quando: "esta semana" },
      { label: "Vídeo", quando: "20/10" },
    ]);
    const t = ownerPlanText(p);
    expect(t).toContain("O que já fizemos: folder antigo (30/09); placa no imóvel (02/10).");
    expect(t).toContain("Próximos passos: fotos profissionais (esta semana); vídeo (20/10).");
    expect(t.toLowerCase()).not.toContain("atras");
  });
  it("texto corta listas longas", () => {
    const muitos = Array.from({ length: 8 }, (_, i) =>
      item({ label: `Ação ${i}`, done_on: "2026-10-01", sort: i }),
    );
    expect(ownerPlanText(ownerPlan(muitos, hoje), 6)).toContain("e mais 2");
  });
});

describe("painel do gestor", () => {
  it("agrupa e ordena", () => {
    const p = (o: Partial<Pendencia>): Pendencia => ({
      kind: "sem_anuncio",
      capture_id: "c",
      imovel: null,
      corretor: null,
      aprovada_em: null,
      dias: null,
      listing_code: null,
      link_id: null,
      acao: null,
      prazo: null,
      ...o,
    });
    const g = agruparPendencias([
      p({ dias: 8 }),
      p({ dias: 30 }),
      p({ kind: "atrasada", prazo: "2026-10-05" }),
      p({ kind: "atrasada", prazo: "2026-10-01" }),
      p({ kind: "confirmar" }),
    ]);
    expect(g.sem_anuncio.map((x) => x.dias)).toEqual([30, 8]);
    expect(g.atrasada.map((x) => x.prazo)).toEqual(["2026-10-01", "2026-10-05"]);
    expect(g.confirmar).toHaveLength(1);
    expect(g.nao_coletado).toHaveLength(0);
  });
});
