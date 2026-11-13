import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alternarCard,
  avisoSemAssinado,
  AVISO_SEM_ASSINADO,
  contarPainel,
  noCard,
  podeCaptadorInformarData,
  PREFIXO_APROVACAO_AUTOMATICA,
  textoAprovacao,
} from "./captacoes-painel";
import { deveRecarregar, INTERVALO_MIN_RECARGA_MS } from "./use-recarregar-ao-focar";

const HOJE = "2026-10-15";
const c = (status: string, extra: Record<string, unknown> = {}) =>
  ({ status, archived_at: null, signed_on: null, ...extra }) as never;

describe("painel de contadores", () => {
  const lista = [
    c("enviada"),
    c("enviada"),
    c("em_assinatura"),
    c("devolvida"),
    c("aprovada", { signed_on: "2026-10-02" }),
    c("aprovada", { signed_on: "2026-09-30" }),
    c("aprovada"),
    c("enviada", { archived_at: "2026-10-01T00:00:00Z" }),
    c("enviada", { discarded_at: "2026-10-01T00:00:00Z" }),
    c("rascunho"),
  ];
  it("conta só ativas, por status, e aprovadas no mês de São Paulo", () => {
    expect(contarPainel(lista, HOJE)).toEqual({
      aguardando_gestor: 2,
      em_assinatura: 1,
      devolvidas: 1,
      aprovadas_mes: 1,
      aprovadas_total: 3,
    });
  });
  it("aprovadas (total) ignora data e exclui arquivadas/descartadas", () => {
    const l = [
      ...lista,
      c("aprovada", { archived_at: "2026-10-01T00:00:00Z" }),
      c("aprovada", { discarded_at: "2026-10-01T00:00:00Z" }),
    ];
    expect(contarPainel(l, HOJE).aprovadas_total).toBe(3);
  });
  it("filtro do cartão bate com o contador", () => {
    expect(lista.filter((x) => noCard(x, "aguardando_gestor", HOJE))).toHaveLength(2);
    expect(lista.filter((x) => noCard(x, "aprovadas_mes", HOJE))).toHaveLength(1);
    expect(lista.filter((x) => noCard(x, "aprovadas_total", HOJE))).toHaveLength(3);
  });
  it("clicar de novo limpa o filtro", () => {
    expect(alternarCard(null, "devolvidas")).toBe("devolvidas");
    expect(alternarCard("devolvidas", "devolvidas")).toBeNull();
    expect(alternarCard("devolvidas", "em_assinatura")).toBe("em_assinatura");
  });
});

describe("avisos de aprovação", () => {
  it("sem contrato assinado mostra o aviso exato", () => {
    expect(avisoSemAssinado([{ kind: "gerado" }])).toBe(AVISO_SEM_ASSINADO);
    expect(AVISO_SEM_ASSINADO).toBe("Anexe o contrato assinado (PDF) para liberar a aprovação.");
    expect(avisoSemAssinado([{ kind: "gerado" }, { kind: "assinado" }])).toBeNull();
  });
  it("texto de aprovação usa o último evento, com nome e horário de Brasília", () => {
    const h = [
      { action: "aprovar", created_at: "2026-10-10T12:00:00Z", actor_nome: "Ana" },
      { action: "aprovar", created_at: "2026-10-15T13:31:00Z", actor_nome: "Bruno" },
      { action: "enviar", created_at: "2026-10-16T00:00:00Z", actor_nome: "Carla" },
    ];
    expect(textoAprovacao(h)).toBe("Captação aprovada por Bruno em 15/10/2026 às 10:31");
    expect(
      textoAprovacao([{ action: "aprovar", created_at: "2026-10-15T13:31:00Z", actor_nome: null }]),
    ).toBe("Captação aprovada por gestor em 15/10/2026 às 10:31");
    expect(textoAprovacao([])).toBe("Captação aprovada");
  });
  it("aprovação automática (captação do próprio gestor/TL) aparece como automática (t_e433a198)", () => {
    const auto = {
      action: "aprovar",
      created_at: "2026-11-13T13:31:00Z",
      actor_nome: "Gestor Exemplo",
      detail: `${PREFIXO_APROVACAO_AUTOMATICA} contrato assinado pela Clicksign e Plano de Marketing marcado`,
    };
    expect(textoAprovacao([auto])).toBe(
      "Captação aprovada automaticamente em 13/11/2026 às 10:31 (contrato assinado pela Clicksign)",
    );
    // Devolvida e aprovada de novo pelo botão: vale a última (manual).
    const manual = { ...auto, created_at: "2026-11-14T13:31:00Z", detail: null };
    expect(textoAprovacao([auto, manual])).toBe(
      "Captação aprovada por Gestor Exemplo em 14/11/2026 às 10:31",
    );
  });
  it("o prefixo é o mesmo que a migration grava no histórico", () => {
    const mig = readFileSync(
      resolve(__dirname, "../../supabase/migrations/20261123120000_captacao_autoaprovacao_gestor.sql"),
      "utf8",
    );
    expect(mig).toContain(`'${PREFIXO_APROVACAO_AUTOMATICA} contrato assinado pela Clicksign`);
  });
});

describe("campo de data de assinatura do captador", () => {
  const cap = (status: string, extra: Record<string, unknown> = {}) =>
    ({ status, captor_id: "u1", archived_at: null, ...extra }) as never;
  it("aparece para o próprio captador antes da aprovação", () => {
    expect(podeCaptadorInformarData(cap("enviada"), "u1", false, true)).toBe(true);
    expect(podeCaptadorInformarData(cap("em_assinatura"), "u1", false, true)).toBe(true);
  });
  it("some depois de aprovada, para outro corretor, gestor, rascunho ou arquivada", () => {
    expect(podeCaptadorInformarData(cap("aprovada"), "u1", false, true)).toBe(false);
    expect(podeCaptadorInformarData(cap("enviada"), "u2", false, true)).toBe(false);
    expect(podeCaptadorInformarData(cap("enviada"), "u1", true, true)).toBe(false);
    expect(podeCaptadorInformarData(cap("rascunho"), "u1", false, true)).toBe(false);
    expect(podeCaptadorInformarData(cap("enviada", { archived_at: "x" }), "u1", false, true)).toBe(
      false,
    );
    expect(podeCaptadorInformarData(cap("enviada"), undefined, false, true)).toBe(false);
  });
  it("não aparece sem o contrato assinado anexado (t_77132312)", () => {
    expect(podeCaptadorInformarData(cap("enviada"), "u1", false, false)).toBe(false);
    expect(podeCaptadorInformarData(cap("em_assinatura"), "u1", false, false)).toBe(false);
  });
});

describe("recarregar ao voltar para a aba", () => {
  it("só com a aba visível e após o intervalo mínimo", () => {
    expect(deveRecarregar(true, INTERVALO_MIN_RECARGA_MS, 0)).toBe(true);
    expect(deveRecarregar(true, INTERVALO_MIN_RECARGA_MS - 1, 0)).toBe(false);
    expect(deveRecarregar(false, INTERVALO_MIN_RECARGA_MS * 2, 0)).toBe(false);
  });
});
