import { describe, expect, it } from "vitest";
import { descreverImovel, perguntouQualImovel, proximaResposta, type ContextoIa, type FichaIa } from "./leads-ia";

// t_79f3ebdc (regra de Denis, 19/11): quando o lead pergunta qual é o imóvel, a Nicole diz tipo, bairro, cidade e
// principais características do cadastro. Sem preço, sem condição fora do cadastro e sem link (só se pedir).
// Caso real: lead do piloto C2S perguntou "Qual imóvel foi" e recebeu só "Quer saber mais algum detalhe?".
const FICHA = {
  tipo: "casa", bairro: "Jardim dos Estados", cidade: "Sorocaba", quartos: "4", banheiros: "3", vagas: "5",
  negocio: "venda", preco: "R$ 330.000", preco_valor: 330000, link: "https://www.remax.com.br/630601201-106",
} as FichaIa;
const AGORA = new Date("2026-11-19T13:36:00Z");
const ctx = (p: Partial<ContextoIa> = {}): ContextoIa =>
  ({
    conversa_id: "c", estado: "ativa", versao: 3, passo: "interesse",
    dados: { aquecer: true, interesse: true, perguntas: [], repeticoes: {}, convite_aberto: "visita", convite_visita: true },
    ia_nome: "Nicole", lead_nome: "Alex", imovel: null, org_nome: "RE/MAX Única Escolha", transacao: "venda",
    anuncio_codigo: "630601201-106", tem_captacao: false, imovel_frase: null, ficha: FICHA, imovel_fonte: "xml", ...p,
  }) as ContextoIa;

describe("t_79f3ebdc — \"qual imóvel?\"", () => {
  it("reconhece as formas comuns da pergunta e não confunde com outras", () => {
    for (const t of ["Qual imóvel foi", "qual imovel?", "Que imóvel é esse?", "qual é a casa?", "q imovel?"]) expect(perguntouQualImovel(t)).toBe(true);
    for (const t of ["qual o valor?", "qual o bairro?", "gostei do imóvel", "tem outro imóvel?"]) expect(perguntouQualImovel(t)).toBe(false);
  });

  it("responde com tipo, bairro, cidade e características; sem preço e sem link", async () => {
    for (const fala of ["Qual imóvel foi", "Que imóvel é esse?"]) {
      const r = await proximaResposta(ctx(), fala, undefined, { agora: AGORA });
      expect(r.resposta).toBe("É uma casa no bairro Jardim dos Estados, em Sorocaba. A casa tem 4 quartos, 3 banheiros e 5 vagas de garagem. Quer saber mais algum detalhe?");
      expect(r.resposta).not.toMatch(/R\$|https?:|www\.|dispon/i);
      expect(r.fixo).toBe(true);
      expect(r.fim).toBeNull();
    }
  });

  it("sem ficha no cadastro: não inventa, segue o fluxo de antes", async () => {
    const r = await proximaResposta(ctx({ ficha: null, imovel_fonte: null }), "Qual imóvel foi", undefined, { agora: AGORA });
    expect(r.resposta).not.toMatch(/Jardim dos Estados|R\$|https?:/);
  });

  it("descreverImovel: só o que existe; apartamento no masculino; sem tipo = null", () => {
    expect(descreverImovel({ tipo: "apartamento", bairro: "Campolim" } as FichaIa)).toBe("É um apartamento no bairro Campolim.");
    expect(descreverImovel({ bairro: "Campolim" } as FichaIa)).toBeNull();
    expect(descreverImovel(null)).toBeNull();
  });
});
