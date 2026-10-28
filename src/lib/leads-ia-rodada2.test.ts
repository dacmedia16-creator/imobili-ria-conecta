// t_0c590c55: 2ª rodada da conversa de teste de Denis (d8907e38 / conversa F).
// 1. depois de "disse q quero casa", ela mostra uma casa parecida (com link);
// 2. toda oferta de imóvel leva o link do anúncio, se ele existir (trava "sem_link");
// 3. trava "sem_opcao" sem falso positivo (limite de 3 opções e mensagem que mostra imóvel).
import { describe, expect, it } from "vitest";
import { proximaResposta, type ContextoIa, type ImovelParecido } from "./leads-ia";
import { permitidosDe, TRAVAS_FIRMES, validarRedacao, explicarBloqueio, type SaidaModelo } from "./leads-ia-redacao";
import { buscasReferencia, ctxReferencia, REFERENCIA } from "./leads-ia-referencia.dados";

const AGORA = new Date("2026-10-27T13:00:00Z");
const s = (mensagem: string, extra: Partial<SaidaModelo> = {}): SaidaModelo => ({ mensagem, acao: "responder", codigo: null, registro: {}, ...extra });
const CASA: ImovelParecido = {
  codigo: "3885",
  tipo: "casa",
  bairro: "Horto Florestal",
  cidade: "Sorocaba",
  quartos: "3",
  preco: "R$ 695.000",
  url: "https://vipsevenimoveis.com.br/imovel/3885",
};
const SEM_URL: ImovelParecido = { ...CASA, codigo: "9001", url: undefined };

/** Roda a conversa F só no roteiro (sem modelo) até a fala pedida; devolve a resposta dela. */
async function roteiroF(ate: string) {
  const conv = REFERENCIA.find((x) => x.id === "F")!;
  const b = buscasReferencia(conv);
  let c: ContextoIa = ctxReferencia(conv);
  let juntas: string[] = [];
  for (const f of conv.falas) {
    if (f.junto) {
      juntas.push(f.cliente);
      continue;
    }
    const r = await proximaResposta(c, f.cliente, undefined, { agora: AGORA, ...b, falasAntes: juntas });
    juntas = [];
    if (f.cliente === ate) return r;
    c = { ...c, passo: r.passo, dados: r.dados, versao: c.versao + 1 };
  }
  throw new Error(`fala não encontrada: ${ate}`);
}

describe("1. depois de \"disse q quero casa\", mostra uma casa parecida com link", () => {
  it("ANTES: \"Combinado, casas então! Essas são as opções...\" (sem casa). DEPOIS: casa nova com link", async () => {
    const r = await roteiroF("disse q quero casa");
    expect(r.resposta).not.toMatch(/essas são as opções/i);
    expect(r.resposta).toMatch(/https:\/\/vipsevenimoveis\.com\.br\/imovel\//);
    expect(r.intencao).toBe("opcoes");
    // O modelo recebe essa casa como candidata (o roteiro manda o imóvel no campo busca).
    expect(r.busca?.itens.length).toBe(1);
    expect(r.busca?.itens[0].tipo).toMatch(/casa/);
    expect(r.resposta).toContain(r.busca!.itens[0].url!);
    // É uma casa ainda não mostrada.
    expect(r.dados.parecidos?.filter((x) => x === r.busca!.itens[0].codigo).length).toBe(1);
  });
  it("a casa mostrada depois da correção vira a do foco (fotos e \"qual casa vamos visitar\" seguem dela)", async () => {
    const r = await roteiroF("disse q quero casa");
    expect(r.dados.parecido_atual?.codigo).toBe(r.busca!.itens[0].codigo);
    expect(r.dados.ultimo_parecido?.codigo).toBe(r.busca!.itens[0].codigo);
  });
  it("a trava sem_oferta exige essa casa na resposta do modelo", () => {
    const perm = permitidosDe(null, [CASA], []);
    perm.pediuOpcoes = true;
    perm.estoque = "com_candidatos";
    expect(validarRedacao(s("Perdão, me confundi! Então, sobre a casa que você está vendo, quer agendar uma visita?"), perm, "disse q quero casa")).toBe("sem_oferta");
    expect(
      validarRedacao(
        s("Perdão, me confundi! Tenho outra casa no Horto Florestal, com 3 quartos, por R$ 695.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3885 Gostou?", { acao: "oferecer", codigo: "3885" }),
        perm,
        "disse q quero casa",
      ),
    ).toBeNull();
  });
});

describe("2. toda oferta leva o link do anúncio (trava sem_link)", () => {
  const perm = permitidosDe(null, [CASA, SEM_URL], []);
  it("ANTES passava: oferta da casa 3885 sem o link. DEPOIS: barra", () => {
    expect(
      validarRedacao(s("Tenho outra casa no Horto Florestal, com 3 quartos, por R$ 695.000. Te serve?", { acao: "oferecer", codigo: "3885" }), perm, "vc tem mais opções?"),
    ).toBe("sem_link");
  });
  it("com o link: passa", () => {
    expect(
      validarRedacao(
        s("Tenho outra casa no Horto Florestal, com 3 quartos, por R$ 695.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3885 Te serve?", { acao: "oferecer", codigo: "3885" }),
        perm,
        "vc tem mais opções?",
      ),
    ).toBeNull();
  });
  it("imóvel sem link no XML: não barra", () => {
    expect(
      validarRedacao(s("Tenho outra casa no Horto Florestal, com 3 quartos, por R$ 695.000. Te serve?", { acao: "oferecer", codigo: "9001" }), perm, "vc tem mais opções?"),
    ).toBeNull();
  });
  it("é trava firme e explica a correção ao modelo", () => {
    expect(TRAVAS_FIRMES.has("sem_link")).toBe(true);
    expect(explicarBloqueio({ motivo: "sem_link", trecho: "3885" })).toMatch(/link/);
  });
});

describe("3. trava sem_opcao sem falso positivo (e sem afrouxar o resto)", () => {
  it("já mostrou as 3 opções: \"essas são as opções que tenho\" passa (estoque sem_resultado)", () => {
    const perm = permitidosDe(null, [], []);
    perm.estoque = "sem_resultado";
    expect(validarRedacao(s("Entendi! Nessa faixa, essas são as opções que tenho agora. Qual te chamou mais a atenção?"), perm, "tem mais opções ?")).toBeNull();
  });
  it("busca não rodou: \"essas são as opções\" continua barrado", () => {
    const perm = permitidosDe(null, [], []);
    perm.estoque = "nao_consultado";
    expect(validarRedacao(s("Entendi! Essas são as opções que tenho agora. Quer agendar uma visita?"), perm, "tem mais opções ?")).toBe("sem_opcao");
  });
  it("mensagem que mostra outro imóvel (\"não temos outra com 3 suítes, mas tenho esta: <link>\") passa", () => {
    const perm = permitidosDe(null, [CASA], []);
    perm.estoque = "com_candidatos";
    expect(
      validarRedacao(
        s("Nessa faixa não temos outra casa com 3 quartos, mas tenho esta no Horto Florestal, por R$ 695.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3885 Te serve?", { acao: "oferecer", codigo: "3885" }),
        perm,
        "Não tem outra casa ?",
      ),
    ).toBeNull();
  });
  it("\"não tenho outra\" sem mostrar nada, havendo candidato: continua barrado", () => {
    const perm = permitidosDe(null, [CASA], []);
    perm.estoque = "com_candidatos";
    expect(validarRedacao(s("Nessa faixa não tenho outra casa. Quer agendar uma visita?"), perm, "Não tem outra casa ?")).toBe("sem_opcao");
  });
  it("idioma, promessa, preço, IPTU e fotos seguem barrando", () => {
    const perm = permitidosDe({ tipo: "casa", iptu: "R$ 153", link: "https://vipsevenimoveis.com.br/imovel/VIP0027" } as never, [CASA], []);
    perm.estoque = "com_candidatos";
    expect(validarRedacao(s("También tengo otra casa. ¿Te gusta?"), perm, "")).toBe("idioma");
    expect(validarRedacao(s("Garanto que fica pronto. Quer visitar?"), perm, "")).toBe("promessa");
    expect(validarRedacao(s("A casa custa R$ 600.000. Quer visitar?"), perm, "")).toBe("valor");
    expect(validarRedacao(s("O IPTU é R$ 153 por ano. Quer visitar?"), perm, "")).toBe("iptu");
    expect(validarRedacao(s("Claro, te mando mais fotos! Quer visitar?"), perm, "me manda mais fotos")).toBe("fotos");
  });
});
