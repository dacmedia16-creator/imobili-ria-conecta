// @vitest-environment jsdom
/**
 * Meu Plano 2027 · Equipe: selo "Conta na meta" por pessoa + contador no topo (cartões t_a4fff17e e t_bd480fee).
 * O selo usa a MESMA regra do somarPlanos (seloMeta): conta quem ASSINOU com meta (VGC) e quem gravou a meta
 * oficial ("Usar como minha meta oficial") sem assinar. Aqui provamos que o selo da lista, o somarPlanos e o
 * contador concordam em todos os casos.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";

const rpc = vi.fn();
const taxas = {
  select: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
};
// Meta oficial GRAVADA (carreira_plano.meta_oficial), lida à parte pela lista.
const GRAVADA = { meta_comissao: 150000, meta_vgv: 6000000, meta_vendas: 30, meta_captacoes: 20 };
const gravadas = vi.fn(async () => ({
  data: [{ user_id: "Pessoa F", meta_oficial: GRAVADA }],
  error: null,
}));
const planos = { select: () => ({ eq: () => ({ not: () => gravadas() }) }) };
vi.mock("@/lib/meu-plano-2027/modulo", async (orig) => ({
  ...(await orig<typeof import("@/lib/meu-plano-2027/modulo")>()),
  planoDb: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (t: string) => (t === "carreira_plano" ? planos : taxas),
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "admin-1" }, roles: ["admin"] }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EquipePlano } from "./Equipe";
import {
  contarNaMeta,
  planoComSelo,
  SELO_META,
  seloMeta,
  somarPlanos,
} from "@/lib/metas-2027/consolidado";
import { metaDoPlano } from "@/lib/metas-2027/regra";
import type { Respostas } from "@/lib/meu-plano-2027/regras";

afterEach(cleanup);

// Plano completo (o mesmo de regra.test.ts): fecha meta de comissão (VGC).
const COMPLETO: Respostas = {
  "mt.creIni": "10",
  "mt.novas": "24",
  "mt.canc": "6",
  "mt.vendidas": "12",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "m.ticket": "400000",
};
// Só o diagnóstico: tem respostas, mas não fecha meta.
const SEM_META: Respostas = { "pq.frase": "Dar segurança à minha família" };

const membro = (
  id: string,
  respostas: Respostas | null,
  assinado: boolean,
  metaEm: string | null = null,
) => ({
  user_id: id,
  nome: id,
  trilha: null,
  ativacao_inicio: null,
  respostas,
  assinado_corretor_em: assinado ? "2026-11-20T12:00:00Z" : null,
  assinado_broker_em: null,
  meta_oficial_em: metaEm,
  updated_at: respostas ? "2026-11-20T12:00:00Z" : null,
});

// Casos: assinado+meta (2 pessoas), assinado sem meta, preenchimento (plano completo, não clicou), sem plano e
// meta oficial gravada pelo clique SEM assinatura (Pessoa F: conta na meta, falta assinar).
const CASOS = [
  { m: membro("Pessoa A", COMPLETO, true), esperado: "conta" },
  { m: membro("Pessoa B", COMPLETO, true), esperado: "conta" },
  { m: membro("Pessoa C", SEM_META, true), esperado: "assinado_sem_meta" },
  { m: membro("Pessoa D", COMPLETO, false), esperado: "falta_meta" },
  { m: membro("Pessoa E", null, false), esperado: "falta_meta" },
  {
    m: membro("Pessoa F", COMPLETO, false, "2026-11-20T12:00:00Z"),
    esperado: "conta_falta_assinar",
  },
] as const;
const gravadaDe = (id: string) => (id === "Pessoa F" ? GRAVADA : null);

describe("selo 'Conta na meta' = regra do somarPlanos", () => {
  it("pré-condição: COMPLETO tem meta e SEM_META não", () => {
    expect(metaDoPlano(COMPLETO)).not.toBeNull();
    expect(metaDoPlano(SEM_META)).toBeNull();
  });

  it("selo e somarPlanos concordam em todos os casos; contador = assinados com meta + metas oficiais", () => {
    const planos = CASOS.map(({ m }) => ({
      userId: m.user_id,
      ...planoComSelo({
        assinadoEm: m.assinado_corretor_em,
        respostas: m.respostas,
        metaOficial: gravadaDe(m.user_id),
        metaOficialEm: m.meta_oficial_em,
      }),
    }));
    expect(planos.map((p) => p.selo)).toEqual(CASOS.map((c) => c.esperado));
    for (const p of planos) expect(seloMeta(p)).toBe(p.selo);

    const soma = somarPlanos(planos);
    // Contam = quem entra na soma oficial: 2 assinados com meta + 1 meta oficial sem assinatura.
    const contam = contarNaMeta(planos);
    expect(contam).toBe(3);
    expect(contam).toBe(soma.qtdContam);
    expect(soma.qtdFaltaAssinar).toBe(1);
    expect(soma.qtdAssinados).toBe(3); // pactos assinados (A, B e C) seguem contados à parte
    expect(soma.qtdPreenchimento).toBe(1);
    expect(soma.qtdSemPlano).toBe(1);
    // A soma oficial = meta dos 2 assinados + o valor GRAVADO da Pessoa F.
    expect(soma.assinados!.ano.comissao).toBe(metaDoPlano(COMPLETO)!.ano.comissao! * 2 + 150000);
  });

  it("a lista mostra o selo certo em cada linha e o contador 'X de N já contam na meta'", async () => {
    rpc.mockResolvedValue({ data: CASOS.map((c) => c.m), error: null });
    render(createElement(EquipePlano, { aberto: null, abrir: vi.fn(), broker: true }));
    const lista = await screen.findByTestId("broker-equipe");
    for (const c of CASOS) {
      const linha = within(lista).getByText(c.m.nome).closest("li")!;
      const selo = within(linha).getByTestId("selo-meta");
      expect(selo.getAttribute("data-selo")).toBe(c.esperado);
      expect(selo.textContent).toBe(SELO_META[c.esperado].texto);
    }
    expect(within(lista).getByTestId("contador-conta-meta").textContent).toMatch(
      /^3 de 6 já contam na meta/,
    );
    // Status atual da linha continua (assinado / em preenchimento).
    expect(within(lista).getAllByText(/assinado ·/).length).toBe(3);
    // Quem clicou em "Usar como minha meta oficial" e não assinou: selo âmbar "Conta na meta · falta assinar".
    const f = within(lista).getByText("Pessoa F").closest("li")!;
    expect(within(f).getByTestId("selo-meta").textContent).toBe("Conta na meta · falta assinar");
  });
});
