// t_82c89141 / t_0a53fdbe — testes novos das 6 correções da Nicole + item 7 (juntar avisos do mesmo cliente).
// O caso do Afonso de ponta a ponta (3 eventos -> 1 lead, 1 conversa, <=1 primeira mensagem, sem nova fila) roda
// em PostgreSQL descartável: scripts/leads-ia-test/test_6_correcoes.sh (32/32). Aqui: travas, roteiro, espera,
// HTTP do "juntado" e o texto da migration.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FichaIa, ImovelParecido } from "./leads-ia";
import { permitidosDe, validarRedacao, visitaSemParenteses, type SaidaModelo } from "./leads-ia-redacao";
import { esperaUmaRodada } from "./leads-ia-retorno.server";
import { receberLeadGrupoOlx, STATUS_POR_RESULTADO, type RpcReceber } from "./leads-grupo-olx.server";

const MIG = readFileSync("supabase/migrations/20261027200000_leads_ia_6_correcoes.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261027200000_leads_ia_6_correcoes.rollback.sql", "utf8");

// Lead 12f005b4: casa 3975 em Sorocaba, IPTU anual no XML.
const FICHA: FichaIa = {
  tipo: "casa",
  bairro: "Jardim Novo Horizonte",
  cidade: "Sorocaba",
  quartos: "3",
  negocio: "venda",
  preco: "R$ 899.000",
  preco_valor: 899000,
  iptu: "R$ 167,00 por ano",
};
const CASA_COND: ImovelParecido = {
  codigo: "VIP0131",
  tipo: "casa-de-condominio",
  bairro: "Condominio Villagio Milano",
  cidade: "Sorocaba",
  quartos: "3",
  preco: "R$ 950.000",
  url: "https://vipsevenimoveis.com.br/imovel/VIP0131",
};
const APTO: ImovelParecido = {
  codigo: "VIP0200",
  tipo: "apartamento",
  bairro: "Campolim",
  cidade: "Sorocaba",
  quartos: "3",
  preco: "R$ 880.000",
  url: "https://vipsevenimoveis.com.br/imovel/VIP0200",
};
const VISITA = visitaSemParenteses(new Date("2026-10-27T13:00:00Z"));
const s = (mensagem: string, extra: Partial<SaidaModelo> = {}): SaidaModelo => ({
  mensagem,
  acao: "responder",
  codigo: null,
  registro: {},
  ...extra,
});

describe("item 3 — trava retorno (nunca prometer voltar com a resposta)", () => {
  const perm = permitidosDe(FICHA, [], VISITA);
  it.each([
    "Vou confirmar se aceita financiamento e já te falo!",
    "Deixa eu verificar isso e te retorno.",
    "Preciso confirmar com o proprietário, já te aviso.",
  ])("barra: %s", (m) => expect(validarRedacao(s(m), perm, "aceita financiamento?")).toBe("retorno"));
  it("deixa: o corretor confirma com você na visita ou no contato", () => {
    expect(
      validarRedacao(s("O corretor confirma o financiamento com você na visita ou no contato. Quer marcar uma visita?"), perm, ""),
    ).toBeNull();
  });
});

describe("item 1 — trava sem_opcao (\"não tenho outra\" só quando a busca rodou e voltou vazia)", () => {
  const msg = "No momento não tenho outras opções nessa faixa. Quer marcar uma visita?";
  it("com candidato ou sem a busca rodar: barra", () => {
    for (const estoque of ["com_candidatos", "nao_consultado"] as const)
      expect(validarRedacao(s(msg), { ...permitidosDe(FICHA, [CASA_COND], VISITA), estoque }, "tem mais opções?")).toBe(
        "sem_opcao",
      );
  });
  it("busca rodou e voltou vazia: deixa", () => {
    expect(validarRedacao(s(msg), { ...permitidosDe(FICHA, [], VISITA), estoque: "sem_resultado" }, "tem mais opções?")).toBeNull();
  });
});

describe("item 2 — trava iptu (unidade só pelo iptu_periodo do XML)", () => {
  it("XML anual: \"por ano\" passa, \"por mês\" é barrado", () => {
    const perm = permitidosDe(FICHA, [], VISITA);
    expect(perm.iptuPeriodo).toBe("ano");
    expect(validarRedacao(s("O IPTU é de R$ 167 por ano. Quer marcar uma visita?"), perm, "e o iptu?")).toBeNull();
    expect(validarRedacao(s("O IPTU é de R$ 167 por mês. Quer marcar uma visita?"), perm, "e o iptu?")).toBe("iptu");
  });
  it("XML sem período: só o valor; qualquer unidade é barrada", () => {
    const perm = permitidosDe({ ...FICHA, iptu: "R$ 167,00" }, [], VISITA);
    expect(perm.iptuPeriodo).toBeNull();
    expect(validarRedacao(s("O IPTU é de R$ 167. Quer marcar uma visita?"), perm, "e o iptu?")).toBeNull();
    expect(validarRedacao(s("O IPTU é de R$ 167 por ano. Quer marcar uma visita?"), perm, "e o iptu?")).toBe("iptu");
  });
});

describe("item 5 — trava tipo (oferecer outro tipo deixando o tipo claro)", () => {
  const perm = permitidosDe(FICHA, [APTO, CASA_COND], VISITA);
  it("apartamento a quem viu casa, sem dizer o tipo: barra", () => {
    expect(
      validarRedacao(s("Tenho uma opção no Campolim com 3 quartos por R$ 880.000: https://vipsevenimoveis.com.br/imovel/VIP0200 Quer ver?", { acao: "oferecer", codigo: "VIP0200" }), perm, "tem mais opções?"),
    ).toBe("tipo");
  });
  it("dizendo \"apartamento\": deixa", () => {
    expect(
      validarRedacao(
        s("Tenho um apartamento no Campolim com 3 quartos por R$ 880.000: https://vipsevenimoveis.com.br/imovel/VIP0200 Apartamento serve para você?", { acao: "oferecer", codigo: "VIP0200" }),
        perm,
        "tem mais opções?",
      ),
    ).toBeNull();
  });
  it("casa de condomínio a quem viu casa: mesmo tipo, não precisa avisar", () => {
    expect(
      validarRedacao(s("Tenho outra casa no Villagio Milano com 3 quartos por R$ 950.000: https://vipsevenimoveis.com.br/imovel/VIP0131 Quer ver?", { acao: "oferecer", codigo: "VIP0131" }), perm, "tem mais opções?"),
    ).toBeNull();
  });
});

describe("item 6b — resposta de espera depois do repasse", () => {
  const base = () => ({
    reservar: vi.fn(async () => ({ data: [], error: null })),
    resultado: vi.fn(async () => ({ data: null, error: null })),
    env: {} as Record<string, string | undefined>,
    linkAnuncio: vi.fn(async () => null),
  });
  it("nada a fazer: não envia", async () => {
    const d = { ...base(), esperaPreparar: vi.fn(async () => ({ data: [], error: null })) };
    expect(await esperaUmaRodada(d)).toEqual({ r: "nada" });
    expect(d.reservar).not.toHaveBeenCalled();
  });
  it("migration não aplicada (erro na RPC): só registra, não quebra", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = { ...base(), esperaPreparar: vi.fn(async () => ({ data: null, error: { code: "42883" } })) };
    expect(await esperaUmaRodada(d)).toEqual({ r: "erro" });
    vi.restoreAllMocks();
  });
  it("com espera preparada: envia pelo mesmo caminho (enviarPendentes), 1 vez por lead", async () => {
    const d = {
      ...base(),
      esperaPreparar: vi.fn(async () => ({ data: [{ lead_id: "l1" }, { lead_id: "l1" }, { lead_id: "l2" }], error: null })),
    };
    // Envio real desligado (sem LEADS_IA_ENVIO_REAL): prepara, mas não envia nada (mesma regra do canal).
    expect(await esperaUmaRodada(d)).toMatchObject({ r: "preparado", leads: 2, enviadas: 0 });
    expect(d.reservar).not.toHaveBeenCalled();
    // Envio ligado: reserva pelo mesmo caminho, uma vez por lead (sem fila nova, sem outro canal).
    const zion = vi.fn(async () => new Response("", { status: 201 }));
    const ligado = { ...d, env: { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "k" }, fetchFn: zion as unknown as typeof fetch };
    expect(await esperaUmaRodada(ligado)).toMatchObject({ r: "preparado", leads: 2 });
    expect(d.reservar).toHaveBeenCalledTimes(2);
    expect(d.reservar.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["l1", "l2"]);
  });
  it("migration: 10 min por imobiliária (0 = desligado), no máximo 1 a cada 2 h, sininho de novo", () => {
    expect(MIG).toMatch(/ia_espera_min integer NOT NULL DEFAULT 10/);
    expect(MIG).toMatch(/interval '2 hours'/);
    expect(MIG).toMatch(/lead_notificar/);
  });
});

describe("item 7 — juntar avisos do mesmo cliente (caso Afonso)", () => {
  it("banco \"juntado\" -> HTTP 200 (a OLX não reenvia)", async () => {
    expect(STATUS_POR_RESULTADO.juntado).toBe(200);
    const rpc: RpcReceber = vi.fn(async () => ({ data: { r: "juntado" }, error: null }));
    const TOKEN = "A".repeat(43);
    const res = await receberLeadGrupoOlx(
      new Request(`https://app/api/leads/grupo-olx/${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ originLeadId: "2", phone: "15999990000", clientListingId: "VIP0143" }),
      }),
      TOKEN,
      rpc,
    );
    expect(res.status).toBe(200);
  });
  it("migration: mesmo telefone + mesma org + lead aberto + janela (24 h); sem lead novo, sem 1ª mensagem, sem fila", () => {
    const corpo = MIG.slice(MIG.indexOf("FUNCTION public.lead_grupo_olx_receber"));
    expect(MIG).toMatch(/leads_juntar_horas integer NOT NULL DEFAULT 24/);
    expect(corpo).toMatch(/organization_id = _org/);
    expect(corpo).toMatch(/'aviso juntado'/);
    // A dedup por id do evento continua antes da junção.
    expect(corpo.indexOf("duplicado")).toBeLessThan(corpo.indexOf("juntado"));
  });
  it("rollback remove tudo o que a migration criou", () => {
    expect(RB).toMatch(/DROP FUNCTION IF EXISTS public\.lead_ia_espera_preparar/);
    expect(RB).toMatch(/DROP TABLE IF EXISTS public\.lead_portal_avisos/);
    expect(RB).toMatch(/leads_juntar_horas/);
  });
});

describe("achados do DeepSeek real (bloco 4)", () => {
  const perm = permitidosDe(FICHA, [CASA_COND], VISITA);
  it("\"vou separar mais opções e te mando por aqui\" é promessa de retorno", () => {
    expect(validarRedacao(s("Claro! Vou separar mais opções para você e te mando por aqui. Quer agendar uma visita?"), perm, "tem mais opções?")).toBe(
      "retorno",
    );
  });
  it("resposta em espanhol é barrada (trava firme idioma)", () => {
    expect(
      validarRedacao(s("Claro! También tengo otro apartamento en Parque Campolim, con 3 quartos. ¿Te gusta?"), perm, "tem mais opções?"),
    ).toBe("idioma");
    expect(validarRedacao(s("Claro! Tenho outra casa no Villagio Milano com 3 quartos por R$ 950.000. Gostou?"), perm, "tem mais opções?")).toBeNull();
  });
});
