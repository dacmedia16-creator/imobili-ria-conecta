import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIAS_ACOMPANHAMENTO,
  DIAS_RETORNO_VENDA,
  FUNIL,
  MOTIVO_ACOMPANHAMENTO,
  pedidoAoMover,
  sugestaoProximo,
  validarProximo,
  type Etapa,
} from "./crm";
import { ETAPA_LABEL, textoEvento, type Lead, type LeadEvento } from "./leads";

// t_ab39e04e (Denis 27/11, itens 1, 2 e 3): funil de captação no Método Denis, acompanhamento
// pós-dossiê de 7 em 7 dias e retorno sugerido (7/10/15 dias) no funil de venda.
// Na main (antes): não existe a etapa 'acompanhamento' nem sugestaoProximo → estes testes falham.
const V = "20270107120000_crm_captacao_metodo_denis";
const ler = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const MIG = ler(`supabase/migrations/${V}.sql`);
const RB = ler(`docs/sql/rollback/${V}.rollback.sql`);

const HOJE = "2026-11-27";
const lead = (p: Partial<Omit<Lead, "etapa">> & { etapa?: Etapa } = {}) =>
  ({
    etapa: "em_atendimento",
    funil: "captacao",
    proximo_contato_em: null,
    proximo_contato_motivo: null,
    ...p,
  }) as unknown as Pick<Lead, "etapa" | "funil" | "proximo_contato_em" | "proximo_contato_motivo">;
const o = { gestor: false, aguardandoAceite: false };

describe("Funil de Captação no Método Denis (item 1)", () => {
  it("etapas e rótulos na ordem do método", () => {
    const f = FUNIL.captacao;
    expect(f.etapas).toEqual([
      "novo",
      "em_atendimento",
      "avaliacao",
      "proposta",
      "acompanhamento",
      "ganho",
      "perdido",
    ]);
    expect(f.etapas.map((e) => f.label[e])).toEqual([
      "Novo contato",
      "Em contato",
      "1ª visita (conhecer o proprietário)",
      "2ª visita (dossiê)",
      "Acompanhamento pós-dossiê",
      "Captado",
      "Perdido",
    ]);
  });

  it("sem migrar dados: 1ª visita = avaliacao e 2ª visita = proposta (mesmo nome técnico)", () => {
    expect(FUNIL.captacao.label.avaliacao).toBe("1ª visita (conhecer o proprietário)");
    expect(FUNIL.captacao.label.proposta).toBe("2ª visita (dossiê)");
  });

  it("venda e locação ficam intactos", () => {
    expect(FUNIL.venda.etapas).toEqual([
      "novo",
      "em_atendimento",
      "visita_agendada",
      "proposta",
      "ganho",
      "perdido",
    ]);
    expect(FUNIL.venda.etapas.map((e) => FUNIL.venda.label[e])).toEqual([
      "Novo",
      "Em contato",
      "Visita",
      "Proposta",
      "Fechado",
      "Perdido",
    ]);
    expect(FUNIL.locacao.etapas).toEqual([
      "novo",
      "em_atendimento",
      "visita_agendada",
      "proposta",
      "ganho",
      "perdido",
    ]);
    expect(FUNIL.locacao.label.proposta).toBe("Ficha/Análise de crédito");
  });

  it("Acompanhamento pós-dossiê só existe no funil de captação", () => {
    expect(pedidoAoMover(lead({ etapa: "proposta" }), "acompanhamento", o)).toBe("proximo");
    expect(pedidoAoMover(lead({ funil: "venda", etapa: "proposta" }), "acompanhamento", o)).toBe(
      "bloqueado",
    );
    expect(
      pedidoAoMover(
        lead({ funil: "locacao" as Lead["funil"], etapa: "proposta" }),
        "acompanhamento",
        o,
      ),
    ).toBe("bloqueado");
  });

  it("linha do tempo e painel Leads mostram os nomes novos", () => {
    expect(ETAPA_LABEL.acompanhamento).toBe("Acompanhamento pós-dossiê");
    expect(ETAPA_LABEL.avaliacao).toBe("1ª visita (conhecer o proprietário)");
    const e = { tipo: "etapa", de: "proposta", para: "acompanhamento" } as LeadEvento;
    expect(textoEvento(e, () => "")).toContain("Acompanhamento pós-dossiê");
  });
});

describe("Acompanhamento pós-dossiê: +7 dias (item 2)", () => {
  it("ao mover para a etapa: hoje + 7 e motivo sugerido; data e motivo continuam obrigatórios", () => {
    expect(DIAS_ACOMPANHAMENTO).toBe(7);
    expect(MOTIVO_ACOMPANHAMENTO).toBe("Perguntar como está a procura pelo imóvel");
    const s = sugestaoProximo(lead({ etapa: "proposta" }), "acompanhamento", HOJE);
    expect(s).toEqual({ data: "2026-12-04", motivo: MOTIVO_ACOMPANHAMENTO, atalhos: [] });
    expect(validarProximo(s!.data, s!.motivo, HOJE)).toBeNull();
    expect(validarProximo(s!.data, "", HOJE)).toBe("Informe a data e o motivo do próximo contato.");
  });

  it("ao registrar o contato e continuar na etapa: sugere +7 de novo (a partir de hoje)", () => {
    const l = lead({
      etapa: "acompanhamento",
      proximo_contato_em: HOJE,
      proximo_contato_motivo: "x",
    });
    expect(sugestaoProximo(l, null, HOJE)).toEqual({
      data: "2026-12-04",
      motivo: MOTIVO_ACOMPANHAMENTO,
      atalhos: [],
    });
  });

  it("outras etapas da captação seguem sem sugestão (comportamento de antes)", () => {
    expect(sugestaoProximo(lead({ etapa: "em_atendimento" }), "avaliacao", HOJE)).toBeNull();
    expect(sugestaoProximo(lead({ etapa: "avaliacao" }), null, HOJE)).toBeNull();
  });
});

describe("Retorno sugerido no funil de venda: 7/10/15 dias (item 3)", () => {
  const venda = (etapa: Etapa) => lead({ funil: "venda", etapa: etapa as Lead["etapa"] });

  it("opções 7, 10 e 15 dias, padrão 7, sem motivo forçado", () => {
    expect(DIAS_RETORNO_VENDA).toEqual([7, 10, 15]);
    expect(sugestaoProximo(venda("proposta"), "em_atendimento", HOJE)).toEqual({
      data: "2026-12-04",
      motivo: "",
      atalhos: [7, 10, 15],
    });
  });

  it("proposta recusada (volta da Proposta) e visita não realizada (volta da Visita)", () => {
    expect(sugestaoProximo(venda("proposta"), "visita_agendada", HOJE)?.atalhos).toEqual([
      7, 10, 15,
    ]);
    expect(sugestaoProximo(venda("visita_agendada"), "em_atendimento", HOJE)?.atalhos).toEqual([
      7, 10, 15,
    ]);
  });

  it("registrar contato parado na Visita ou na Proposta também sugere", () => {
    expect(sugestaoProximo(venda("visita_agendada"), null, HOJE)?.data).toBe("2026-12-04");
    expect(sugestaoProximo(venda("proposta"), null, HOJE)?.data).toBe("2026-12-04");
  });

  it("avançar no funil ou outras etapas não sugere (nada muda)", () => {
    expect(sugestaoProximo(venda("visita_agendada"), "proposta", HOJE)).toBeNull();
    expect(sugestaoProximo(venda("em_atendimento"), "visita_agendada", HOJE)).toBeNull();
    expect(sugestaoProximo(venda("em_atendimento"), null, HOJE)).toBeNull();
  });

  it("locação fica de fora", () => {
    const l = lead({ funil: "locacao" as Lead["funil"], etapa: "proposta" });
    expect(sugestaoProximo(l, "em_atendimento", HOJE)).toBeNull();
  });
});

describe("Banco (migration " + V + ")", () => {
  it("etapa 'acompanhamento' aceita só no funil de captação, sem UPDATE em leads", () => {
    expect(MIG).toMatch(
      /CHECK \(etapa IN \('novo', 'em_atendimento', 'visita_agendada', 'avaliacao', 'proposta', 'acompanhamento', 'ganho', 'perdido'\)\)/,
    );
    expect(MIG).toMatch(/\(funil = 'venda' AND etapa NOT IN \('avaliacao', 'acompanhamento'\)\)/);
    expect(MIG).toMatch(/\(funil = 'locacao' AND etapa NOT IN \('avaliacao', 'acompanhamento'\)\)/);
    expect(MIG).toMatch(/\(funil = 'captacao' AND etapa <> 'visita_agendada'\)/);
    expect(MIG).toMatch(
      /_l\.funil IN \('venda', 'locacao'\) AND _etapa IN \('avaliacao', 'acompanhamento'\)/,
    );
    // Fora do corpo da função (que só roda quando alguém move um lead), nenhum UPDATE em registro.
    const foraDaFuncao = MIG.replace(/AS \$function\$[\s\S]*?END \$function\$;/g, "").replace(
      /--[^\n]*/g,
      "",
    );
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.lead_mudar_etapa/);
    expect(foraDaFuncao).not.toMatch(/UPDATE|DELETE|INSERT/i);
  });

  it("rollback devolve quem estiver em acompanhamento para a 2ª visita e restaura as travas", () => {
    expect(RB).toMatch(/UPDATE public\.leads SET etapa = 'proposta'/);
    expect(RB).toMatch(/\(funil = 'locacao' AND etapa <> 'avaliacao'\)/);
    expect(RB).toMatch(
      /DELETE FROM supabase_migrations\.schema_migrations WHERE version = '20270107120000'/,
    );
  });
});
