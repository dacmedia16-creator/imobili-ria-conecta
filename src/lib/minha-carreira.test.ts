import { describe, expect, it } from "vitest";
import {
  filtrarCaptacoes,
  oportunidadesParaMim,
  ordenarPendencias,
  textoDias,
  textoNumerosPortal,
  type MinhaCaptacao,
  type Pendencia,
} from "./minha-carreira";
import type { CaptureCandidate, OpportunityPost } from "./oportunidades";

const p = (kind: Pendencia["kind"], dias: number | null, id: string = kind): Pendencia => ({
  kind,
  capture_id: id,
  imovel: "Casa — Centro",
  detalhe: kind,
  prazo: null,
  dias,
});

describe("O que fazer hoje", () => {
  it("ordena por tipo e, dentro do tipo, pelo mais urgente", () => {
    const out = ordenarPendencias([
      p("sem_anuncio", 30),
      p("documentos", null),
      p("atrasada", 2, "a2"),
      p("atrasada", 9, "a9"),
      p("vencendo", 20, "v20"),
      p("vencendo", -3, "v-3"),
      p("devolvida", null),
    ]);
    expect(out.map((x) => x.capture_id)).toEqual([
      "devolvida",
      "v-3",
      "v20",
      "a9",
      "a2",
      "documentos",
      "sem_anuncio",
    ]);
  });

  it("textos de prazo", () => {
    expect(textoDias(p("vencendo", 10))).toBe("faltam 10 dias");
    expect(textoDias(p("vencendo", 1))).toBe("faltam 1 dia");
    expect(textoDias(p("vencendo", 0))).toBe("vence hoje");
    expect(textoDias(p("vencendo", -2))).toBe("venceu há 2 dias");
    expect(textoDias(p("atrasada", 1))).toBe("1 dia de atraso");
    expect(textoDias(p("sem_anuncio", 12))).toBe("aprovada há 12 dias");
    expect(textoDias(p("devolvida", null))).toBeNull();
  });
});

const cap = (over: Partial<MinhaCaptacao>): MinhaCaptacao => ({
  capture_id: "c",
  imovel: null,
  status: "aprovada",
  listing_code: "111-1",
  coletado_em: null,
  views: 10,
  contacts: 0,
  parado: true,
  vence_em: null,
  dias_restantes: null,
  ...over,
});

describe("Minhas captações", () => {
  it("filtro só paradas ignora 'sem dado'", () => {
    const lista = [
      cap({ capture_id: "a" }),
      cap({ capture_id: "b", parado: false }),
      cap({ capture_id: "c", parado: null }),
    ];
    expect(filtrarCaptacoes(lista, true).map((c) => c.capture_id)).toEqual(["a"]);
    expect(filtrarCaptacoes(lista, false)).toHaveLength(3);
  });

  it("nunca mostra número inventado", () => {
    expect(textoNumerosPortal(cap({ listing_code: null }))).toBe("Sem anúncio ligado");
    expect(textoNumerosPortal(cap({ views: null, contacts: null }))).toMatch(/Sem dado/);
    expect(textoNumerosPortal(cap({ views: 1, contacts: 1 }))).toBe("1 visualização · 1 contato");
    expect(textoNumerosPortal(cap({ views: 30, contacts: 0 }))).toBe(
      "30 visualizações · 0 contatos",
    );
  });
});

describe("Oportunidades para mim", () => {
  const agora = new Date("2026-10-15T12:00:00Z");
  const post: OpportunityPost = {
    id: "p1",
    kind: "procura",
    tipo: "Casa",
    finalidade: "Venda",
    bairro: "Centro",
    valor_min: 400_000,
    valor_max: 600_000,
    valor: null,
    corretor: "Fulano",
    texto: "procuro casa no centro",
    posted_at: "2026-10-14T12:00:00Z",
  };
  const c = (id: string, captor_id: string, nome: string): CaptureCandidate => ({
    id,
    captor_id,
    captor_nome: nome,
    tipo: "Casa",
    finalidade: "Venda",
    bairro: "Centro",
    municipio: null,
    valor: 500_000,
  });

  it("só encaixa nas captações do próprio usuário", () => {
    const out = oportunidadesParaMim(
      [post],
      [c("minha", "eu", "Eu Mesmo"), c("colega", "outro", "Colega")],
      new Set(),
      "eu",
      agora,
    );
    expect(out.map((x) => x.capture.id)).toEqual(["minha"]);
  });

  it("respeita par escondido e pedido do próprio corretor", () => {
    expect(
      oportunidadesParaMim([post], [c("minha", "eu", "Eu")], new Set(["p1|minha"]), "eu", agora),
    ).toHaveLength(0);
    expect(
      oportunidadesParaMim([post], [c("minha", "eu", "Fulano")], new Set(), "eu", agora),
    ).toHaveLength(0);
  });
});
