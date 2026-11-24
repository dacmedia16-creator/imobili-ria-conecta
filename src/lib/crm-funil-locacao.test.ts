import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FUNIL, FUNIS, funilDe, pedidoAoMover } from "./crm";
import { textoEvento, type Lead, type LeadEvento } from "./leads";

// t_d4c8b724 (Denis 24/11): "preciso de um funil apenas de locação e os leads de locação têm que ir para
// lá automaticamente". Etapas aprovadas ("1 ok sem contrato"): Novo → Em contato → Visita →
// Ficha/Análise de crédito → Fechado → Perdido, reaproveitando as etapas internas do banco.
// Na main (antes): não existe o funil 'locacao' nem a migration → estes testes falham.
const V = "20270105120000_crm_funil_locacao";
const MIG_PATH = `supabase/migrations/${V}.sql`;
const RB_PATH = `docs/sql/rollback/${V}.rollback.sql`;
const ler = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const MIG = ler(MIG_PATH);
const RB = ler(RB_PATH);

const lead = (p: Partial<Lead> = {}) =>
  ({ etapa: "em_atendimento", funil: "venda", ...p }) as Pick<Lead, "etapa" | "funil">;

describe("Funil de Locação na tela (t_d4c8b724)", () => {
  it("existe a aba Funil de Locação com as etapas aprovadas", () => {
    expect(FUNIS).toContain("locacao");
    const f = FUNIL["locacao" as keyof typeof FUNIL];
    expect(f?.nome).toBe("Funil de Locação");
    expect(f.etapas).toEqual([
      "novo",
      "em_atendimento",
      "visita_agendada",
      "proposta",
      "ganho",
      "perdido",
    ]);
    expect(f.etapas.map((e) => f.label[e])).toEqual([
      "Novo",
      "Em contato",
      "Visita",
      "Ficha/Análise de crédito",
      "Fechado",
      "Perdido",
    ]);
    expect(f.etapas).not.toContain("avaliacao");
  });

  it("lead com funil 'locacao' fica na aba de locação (não cai em Venda)", () => {
    expect(funilDe({ funil: "locacao" } as Pick<Lead, "funil">)).toBe("locacao");
    expect(funilDe({ funil: "captacao" })).toBe("captacao");
    expect(funilDe({ funil: "venda" })).toBe("venda");
  });

  it("no quadro de locação, Avaliação é bloqueada; Ficha e Fechado seguem as regras de sempre", () => {
    const o = { gestor: false, aguardandoAceite: false };
    const l = lead({ funil: "locacao" as Lead["funil"] });
    expect(pedidoAoMover(l, "avaliacao", o)).toBe("bloqueado");
    expect(pedidoAoMover(l, "proposta", o)).toBe("proximo");
    expect(pedidoAoMover(l, "ganho", o)).toBe("fechar");
    expect(pedidoAoMover(l, "perdido", o)).toBe("perda");
  });

  it("linha do tempo mostra a troca para Locação", () => {
    const e = { tipo: "funil", de: "venda", para: "locacao" } as LeadEvento;
    expect(textoEvento(e, () => "")).toBe("Funil: Locação");
  });
});

describe("Funil de Locação no banco (migration " + V + ")", () => {
  it("aceita funil 'locacao' com as etapas da venda (sem avaliação)", () => {
    expect(MIG).toMatch(/CHECK \(funil IN \('venda', 'captacao', 'locacao'\)\)/);
    expect(MIG).toMatch(/\(funil = 'locacao' AND etapa <> 'avaliacao'\)/);
    expect(MIG).toMatch(/_l\.funil IN \('venda', 'locacao'\) AND _etapa = 'avaliacao'/);
    expect(MIG).toMatch(/_funil NOT IN \('venda', 'captacao', 'locacao'\)/);
  });

  it("C2S: negotiation_name Aluguel → locação e grava portal_transacao; Compra/Indefinido → venda", () => {
    expect(MIG).toMatch(/lead_transacao_c2s\(_p->'real_estate_detail'->>'negotiation_name'\)/);
    expect(MIG).toMatch(
      /portal_transacao = _tran, funil = public\.lead_funil_da_transacao\(_tran\)/,
    );
    expect(MIG).toMatch(/IN \('aluguel', 'locacao', 'locação'\) THEN 'aluguel'/);
    expect(MIG).toMatch(/IN \('compra', 'venda'\) THEN 'venda'/);
    expect(MIG).toMatch(/CASE WHEN _tran = 'aluguel' THEN 'locacao' ELSE 'venda' END/);
  });

  it("Portais (Grupo OLX/ZAP): portal_transacao aluguel → locação", () => {
    const olx = MIG.split("FUNCTION public.lead_grupo_olx_receber(")[1] ?? "";
    expect(olx).toMatch(
      /portal_transacao = _tran, funil = public\.lead_funil_da_transacao\(_tran\)/,
    );
  });

  it("não move lead existente, não muda a assinatura do C2S nem a Nicole", () => {
    // o único UPDATE de funil é o do crm_definir_funil (troca manual pelo corretor, 1 lead)
    expect(MIG.match(/UPDATE public\.leads SET funil/g) ?? []).toHaveLength(1);
    expect(MIG).toMatch(
      /UPDATE public\.leads SET funil = _funil, updated_at = now\(\) WHERE id = _l\.id/,
    );
    expect(MIG).not.toMatch(/SET funil = 'locacao'/);
    // assinatura do C2S e Nicole ficam em lead_config: a migration não altera essa tabela nem a 1ª mensagem
    expect(MIG).not.toMatch(
      /UPDATE public\.lead_config|ALTER TABLE public\.lead_config|ia_ativa|lead_ia_primeira_msg\(/,
    );
    expect(MIG).not.toMatch(/lead_c2s_token_gerar|lead_c2s_desligar/);
  });

  it("rollback devolve locação para venda antes do CHECK antigo e apaga o registro", () => {
    expect(RB).toMatch(/UPDATE public\.leads SET funil = 'venda'.*WHERE funil = 'locacao'/);
    expect(RB.indexOf("WHERE funil = 'locacao'")).toBeLessThan(
      RB.indexOf("CHECK (funil IN ('venda', 'captacao'))"),
    );
    expect(RB).toMatch(/DROP FUNCTION IF EXISTS public\.lead_funil_da_transacao/);
    expect(RB).toMatch(/schema_migrations WHERE version = '20270105120000'/);
  });
});
