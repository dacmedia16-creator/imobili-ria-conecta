// t_b832cf00 (Denis 22/11): não repetir aviso da mesma captação para a mesma procura repostada + quartos.
// Os dois primeiros blocos usam só a API pública que já existia (planAlerts / captureMatches / captureCandidate),
// para o mesmo teste rodar na main (falha) e com a correção (passa).
import { describe, expect, it } from "vitest";
import { planAlerts, type AlertRow } from "./oportunidades-alerts.server";
import {
  captureCandidate,
  captureMatches,
  mesmaProcura,
  quartosCaptacao,
  quartosPedidos,
  type CaptureCandidate,
  type OpportunityPost,
} from "./oportunidades";

const now = new Date("2026-11-22T15:00:00Z");
const procura = (id: string, extra: Partial<OpportunityPost> = {}): OpportunityPost => ({
  id,
  kind: "procura",
  tipo: "Casa",
  finalidade: "Venda",
  bairro: "Qualquer região",
  valor_min: null,
  valor_max: 800_000,
  valor: null,
  corretor: "Ana Corretora",
  texto: "Cliente procura casa em qualquer região até 800 mil",
  posted_at: "2026-11-22T12:00:00Z",
  author_profile_id: "u-ana",
  ...extra,
});
const cap = (id: string, extra: Partial<CaptureCandidate> = {}): CaptureCandidate => ({
  id,
  captor_id: "u-bruno",
  captor_nome: "Bruno Captador",
  tipo: "Casa",
  finalidade: "Venda",
  bairro: "Jardim Bom Sucesso",
  municipio: "Sorocaba",
  valor: 650_000,
  ...extra,
});
const avisado = (post: OpportunityPost, capture_id: string, created_at: string): AlertRow => ({
  post_id: post.id,
  capture_id,
  recipient_id: "u-bruno",
  status: "sent",
  created_at,
  post: {
    corretor: post.corretor,
    author_profile_id: post.author_profile_id ?? null,
    tipo: post.tipo,
    finalidade: post.finalidade,
    valor_max: post.valor_max,
  },
});

describe("aviso repetido: mesma procura repostada com outro texto (t_b832cf00)", () => {
  const p1 = procura("p1", { posted_at: "2026-11-18T12:00:00Z" });
  const p2 = procura("p2", { texto: "Bom dia! Ainda procuro casa até 800 mil, qualquer bairro" });

  it("não avisa de novo a mesma captação (falhava: o post novo gerava aviso repetido)", () => {
    const prev = [avisado(p1, "c1", "2026-11-18T13:00:00Z")];
    expect(planAlerts([p1, p2], [cap("c1")], new Set(), prev, now)).toEqual([]);
  });

  it("na mesma rodada, duas repostagens geram um aviso só por captação", () => {
    const plan = planAlerts(
      [p1, p2],
      [cap("c1"), cap("c2", { valor: 700_000 })],
      new Set(),
      [],
      now,
    );
    expect(plan.map((x) => [x.post.id, x.capture.id])).toEqual([
      ["p2", "c1"],
      ["p2", "c2"],
    ]);
  });

  it("captação NOVA para a mesma procura continua sendo avisada", () => {
    const prev = [avisado(p1, "c1", "2026-11-18T13:00:00Z")];
    const plan = planAlerts([p2], [cap("c1"), cap("c2")], new Set(), prev, now);
    expect(plan.map((x) => x.capture.id)).toEqual(["c2"]);
  });

  it("outra procura (outro corretor ou teto bem diferente) continua sendo avisada", () => {
    const prev = [avisado(p1, "c1", "2026-11-18T13:00:00Z")];
    for (const outra of [
      procura("p3", { corretor: "Carla Souza", author_profile_id: "u-carla" }),
      procura("p5", { valor_max: 700_000 }), // 12,5% menor
    ])
      expect(planAlerts([outra], [cap("c1")], new Set(), prev, now)).toHaveLength(1);
  });

  it("aviso com mais de 30 dias não segura a repostagem", () => {
    const prev = [avisado(p1, "c1", "2026-10-20T13:00:00Z")];
    expect(planAlerts([p2], [cap("c1")], new Set(), prev, now)).toHaveLength(1);
  });

  it("aviso que falhou não conta (tenta de novo)", () => {
    const prev = [{ ...avisado(p1, "c1", "2026-11-18T13:00:00Z"), status: "failed" }];
    expect(planAlerts([p2], [cap("c1")], new Set(), prev, now)).toHaveLength(1);
  });

  it("mesmaProcura: regra explicável", () => {
    expect(mesmaProcura(p1, p2)).toBe(true);
    expect(mesmaProcura(p1, { ...p2, valor_max: 850_000 })).toBe(true); // 5,9% de diferença
    expect(mesmaProcura(p1, { ...p2, valor_max: 900_000 })).toBe(false); // 11%
    expect(mesmaProcura(p1, { ...p2, finalidade: "Locação" })).toBe(false);
    expect(mesmaProcura(p1, { ...p2, tipo: "Apartamento" })).toBe(false);
    // sem cadastro ligado nos dois: vale o nome do grupo
    const semId = { ...p1, author_profile_id: null };
    expect(mesmaProcura(semId, { ...p2, author_profile_id: null })).toBe(true);
    expect(
      mesmaProcura(semId, { ...p2, author_profile_id: null, corretor: "ana  corretora " }),
    ).toBe(true);
    expect(mesmaProcura(semId, { ...p2, author_profile_id: null, corretor: "Ana Paula" })).toBe(
      false,
    );
    // cadastro ligado nos dois manda (mesmo nome, pessoas diferentes)
    expect(mesmaProcura(p1, { ...p2, author_profile_id: "u-outra-ana" })).toBe(false);
  });
});

describe("quartos (t_b832cf00)", () => {
  const row = (quartos: string | null) => ({
    id: "c1",
    captor_id: "u-bruno",
    captor_nome: "Bruno",
    tipo_imovel: "Casa",
    bairro: "Campolim",
    municipio: "Sorocaba",
    valor_imovel: "650.000",
    quartos,
  });
  const pede3 = procura("p1", { texto: "Cliente procura casa com 3 dormitórios até 800 mil" });

  it("captação com menos quartos que o pedido não encaixa (falhava: encaixava)", () => {
    expect(captureMatches([pede3], [captureCandidate(row("2"))], new Set(), now)).toEqual([]);
  });

  it("captação com quartos ≥ pedido encaixa", () => {
    expect(captureMatches([pede3], [captureCandidate(row("3"))], new Set(), now)).toHaveLength(1);
    expect(captureMatches([pede3], [captureCandidate(row("4"))], new Set(), now)).toHaveLength(1);
  });

  it("se um dos dois não informa, não barra", () => {
    for (const q of [null, "", "0"])
      expect(captureMatches([pede3], [captureCandidate(row(q))], new Set(), now)).toHaveLength(1);
    const semQuartos = procura("p2");
    expect(captureMatches([semQuartos], [captureCandidate(row("1"))], new Set(), now)).toHaveLength(
      1,
    );
  });

  it("quartosPedidos lê o texto da procura", () => {
    expect(quartosPedidos("casa 3 dormitórios")).toBe(3);
    expect(quartosPedidos("apto de 2 ou 3 quartos")).toBe(2);
    expect(quartosPedidos("2/3 dorms, até 500 mil")).toBe(2);
    expect(quartosPedidos("três quartos sendo 1 suíte")).toBe(3);
    expect(quartosPedidos("casa com 2 suítes")).toBe(2);
    expect(quartosPedidos("3+ dormitórios")).toBe(3);
    expect(quartosPedidos("casa 2/3/4 dorms")).toBe(2);
    expect(quartosPedidos("apto 3 qtos")).toBe(3);
    // teto de quartos não é mínimo: não barra
    expect(quartosPedidos("apto até 3 quartos")).toBeNull();
    expect(quartosPedidos("no máximo 2 dormitórios")).toBeNull();
    expect(quartosPedidos("casa térrea até 800 mil, 2 vagas")).toBeNull();
    expect(quartosPedidos("até 300 mil 2 quartos, 300m²")).toBe(2);
    expect(quartosPedidos("")).toBeNull();
  });

  it("quartosCaptacao: ficha válida ou tipo com quartos; vazio, 0 e absurdo = não informado", () => {
    expect(quartosCaptacao("02")).toBe(2);
    expect(quartosCaptacao(" 3 ")).toBe(3);
    expect(quartosCaptacao("0")).toBeNull();
    expect(quartosCaptacao("2025")).toBeNull();
    expect(quartosCaptacao("", "APARTAMENTO 2 QUARTOS")).toBe(2);
    expect(quartosCaptacao(null)).toBeNull();
  });
});
