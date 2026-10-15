import { describe, expect, it } from "vitest";
import {
  alternarCard,
  avisoSemAssinado,
  AVISO_SEM_ASSINADO,
  contarPainel,
  noCard,
  podeCaptadorInformarData,
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
    });
  });
  it("filtro do cartão bate com o contador", () => {
    expect(lista.filter((x) => noCard(x, "aguardando_gestor", HOJE))).toHaveLength(2);
    expect(lista.filter((x) => noCard(x, "aprovadas_mes", HOJE))).toHaveLength(1);
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
    expect(textoAprovacao([{ action: "aprovar", created_at: "2026-10-15T13:31:00Z", actor_nome: null }])).toBe(
      "Captação aprovada por gestor em 15/10/2026 às 10:31",
    );
    expect(textoAprovacao([])).toBe("Captação aprovada");
  });
});

describe("campo de data de assinatura do captador", () => {
  const cap = (status: string, extra: Record<string, unknown> = {}) =>
    ({ status, captor_id: "u1", archived_at: null, ...extra }) as never;
  it("aparece para o próprio captador antes da aprovação", () => {
    expect(podeCaptadorInformarData(cap("enviada"), "u1", false)).toBe(true);
    expect(podeCaptadorInformarData(cap("em_assinatura"), "u1", false)).toBe(true);
  });
  it("some depois de aprovada, para outro corretor, gestor, rascunho ou arquivada", () => {
    expect(podeCaptadorInformarData(cap("aprovada"), "u1", false)).toBe(false);
    expect(podeCaptadorInformarData(cap("enviada"), "u2", false)).toBe(false);
    expect(podeCaptadorInformarData(cap("enviada"), "u1", true)).toBe(false);
    expect(podeCaptadorInformarData(cap("rascunho"), "u1", false)).toBe(false);
    expect(podeCaptadorInformarData(cap("enviada", { archived_at: "x" }), "u1", false)).toBe(false);
    expect(podeCaptadorInformarData(cap("enviada"), undefined, false)).toBe(false);
  });
});

describe("recarregar ao voltar para a aba", () => {
  it("só com a aba visível e após o intervalo mínimo", () => {
    expect(deveRecarregar(true, INTERVALO_MIN_RECARGA_MS, 0)).toBe(true);
    expect(deveRecarregar(true, INTERVALO_MIN_RECARGA_MS - 1, 0)).toBe(false);
    expect(deveRecarregar(false, INTERVALO_MIN_RECARGA_MS * 2, 0)).toBe(false);
  });
});
