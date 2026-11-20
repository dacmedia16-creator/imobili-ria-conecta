import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { aplicarModoEquipe, EQUIPE_RECLAMACAO, textoModoEquipe } from "./leads-ia-equipe";
import {
  imoveisSegurosPiloto, normalizarCaracteristica, partesRegiao, proximaResposta, regiaoDaConversa,
  type ContextoIa, type FichaIa, type ImovelParecido, type FiltroCaracteristicaBusca,
} from "./leads-ia";
import { modoEquipeDb } from "./leads-ia-retorno.server";

const FICHA: FichaIa = {
  tipo: "apartamento", bairro: "Sorocaba", cidade: "Sorocaba", quartos: "3", negocio: "venda",
  preco_valor: 9500, preco: "R$ 9.500", link: "https://example.org/348",
};
const ctx = (): ContextoIa => ({
  conversa_id: "c", estado: "ativa", versao: 1, passo: "interesse", dados: { interesse: true }, ia_nome: "Nicole",
  lead_nome: "", org_nome: "Piloto", transacao: "venda", anuncio_codigo: "x", imovel_frase: null,
  ficha: FICHA, imovel_fonte: "xml",
}) as ContextoIa;
const p = (codigo: string, quartos: string, preco: string, bairro = "Sorocaba"): ImovelParecido =>
  ({ codigo, tipo: "apartamento", cidade: "Sorocaba", bairro, quartos, preco });
const hist = [
  { autor: "ia", texto: "E qual região ou bairro você está procurando?" },
  { autor: "cliente", texto: "Horto/Caguaçu, São Bento" },
];

describe("piloto C2S: imóvel do pedido (sem usar lead real, rede nem PII)", () => {
  it("XML: preço de venda suspeito e bairro=cidade são filtrados apenas quando a chave está ligada", () => {
    const bruto = normalizarCaracteristica({ itens: [p("baixo", "3", "R$ 9.500"), p("bom", "2", "R$ 350.000")] })!;
    expect(bruto.itens).toHaveLength(2); // ZIP/ZZ e demais orgs continuam como antes
    const seguro = imoveisSegurosPiloto(bruto.itens);
    expect(seguro.map((i) => i.codigo)).toEqual(["bom"]);
    expect(seguro[0].bairro).toBeUndefined();
    expect(imoveisSegurosPiloto([p("aluguel", "2", "R$ 9.500", "Horto")], "locacao")).toHaveLength(1);
    expect(imoveisSegurosPiloto([p("aluguel", "2", "", "Horto")])[0].codigo).toBe("aluguel");
  });
  it("usa bairros que a cliente informou; não diz 'Tenho sim' por 3 quartos quando pediu 2", async () => {
    expect(regiaoDaConversa(hist)).toBe("Horto/Caguaçu, São Bento");
    expect(partesRegiao(regiaoDaConversa(hist))).toEqual(["Horto", "Caguaçu", "São Bento"]);
    const buscar = vi.fn(async (f: FiltroCaracteristicaBusca) => {
      expect(f.negocio).toBe("venda");
      return { itens: f.bairro === "Horto" ? [p("exato", "2", "R$ 350.000", "Horto")] : [], proximo: null };
    });
    const r = await proximaResposta(ctx(), "Quero comprar um imóvel de 2 quartos", undefined, {
      pedidoSeguro: true, regiaoConversa: regiaoDaConversa(hist), buscarCaracteristica: buscar,
    });
    expect([...new Set(buscar.mock.calls.map(([f]) => f.bairro))]).toEqual(["Horto", "Caguaçu", "São Bento"]);
    expect(buscar.mock.calls.every(([f]) => f.preco_min == null && f.preco_max == null)).toBe(true);
    expect(r.resposta).toMatch(/2 quartos.*Horto/);
    expect(r.resposta).not.toContain("3 quartos");
  });
  it("o 3-quartos do mesmo tipo não esconde 2-quartos de outro tipo", async () => {
    const buscar = vi.fn(async (f: FiltroCaracteristicaBusca) => ({
      itens: f.tipo === "apartamento" ? [p("tres", "3", "R$ 350.000", "Horto")] :
        [{ ...p("dois", "2", "R$ 350.000", "Horto"), tipo: "casa" }],
      proximo: null,
    }));
    const r = await proximaResposta(ctx(), "Quero comprar imóvel de 2 quartos", undefined, {
      pedidoSeguro: true, regiaoConversa: regiaoDaConversa(hist), buscarCaracteristica: buscar,
    });
    expect(buscar.mock.calls.some(([f]) => !f.tipo)).toBe(true);
    expect(r.resposta).toMatch(/casa.*2 quartos/);
    expect(r.resposta).not.toMatch(/3 quartos|R\$ 9\.500/);
  });
  it("sem imóvel exato, não oferta incompatível nem o valor de aluguel como compra", async () => {
    const buscar = vi.fn(async () => ({ itens: imoveisSegurosPiloto([p("erro", "3", "R$ 9.500"), p("tres", "3", "R$ 350.000")]), proximo: null }));
    const r = await proximaResposta(ctx(), "Quero comprar imóvel de 2 quartos", undefined, {
      pedidoSeguro: true, regiaoConversa: regiaoDaConversa(hist), buscarCaracteristica: buscar,
    });
    expect(r.resposta).toMatch(/Não encontrei uma opção.*exatamente/);
    expect(r.resposta).not.toMatch(/Tenho sim|R\$ 9\.500|3 quartos|bairro Sorocaba/);
    expect(r.dados.pendentes?.length).toBeGreaterThan(0);
  });
  it("'qual imóvel foi?' continua identificado sem preço/link", async () => {
    const r = await proximaResposta(ctx(), "Qual imóvel foi?", undefined, { pedidoSeguro: true });
    expect(r.fixo).toBe(true);
    expect(r.resposta).toMatch(/apartamento.*3 quartos/);
    expect(r.resposta).not.toMatch(/R\$|https?:/);
  });
});

describe("piloto C2S: reclamação e visita sem compromisso indevido", () => {
  it("passa reclamação ao humano via fim=sensivel, com fallback se a gravação falhar", () => {
    const base = { passo: "interesse" as const, dados: {}, resposta: "O corretor confirma o horário com você. Qual dia e período ficam melhores?", resposta_falha: null, fim: null, resumo: null };
    const r = aplicarModoEquipe(base, "Marquei visita e ninguém apareceu");
    expect(r.resposta).toBe(EQUIPE_RECLAMACAO);
    expect(r.fim).toBe("sensivel");
    expect(r.resposta_falha).not.toMatch(/passar|corretor|confirm/);
    expect(r.resposta).not.toMatch(/corretor|confirm|prazo/);
    expect(r.dados.pendentes).toContain("reclamou: visita marcada antes não aconteceu");
  });
  it("resposta de visita aceita não promete confirmação; desliga sem alterar a ZZ", () => {
    const original = "Sábado de manhã anotado! Já pedi para {corretor} continuar seu atendimento por aqui para confirmar o horário.";
    const r = aplicarModoEquipe({ passo: "fim", dados: { visita: "sábado de manhã" }, resposta: original, resposta_falha: "Um corretor vai continuar", fim: "visita", resumo: "visita" }, "sábado de manhã");
    expect(r.resposta).toBe("Anotei sua preferência: sábado de manhã. Vou passar seu pedido de visita para a equipe.");
    expect(r.resposta_falha).not.toMatch(/corretor|confirm|passar/);
    expect(original).toContain("{corretor}"); // flag desligada: texto original não é mutado
    expect(textoModoEquipe("O corretor confirma o horário com você. Qual dia e período ficam melhores?")).not.toMatch(/corretor|confirma o horário/);
  });
  it("remove promessas diretas de agenda e prazo sem a palavra corretor", () => {
    expect(textoModoEquipe("Sua visita está confirmada para amanhã.")).not.toMatch(/confirmad|amanhã/);
    expect(textoModoEquipe("Te retorno ainda hoje.")).not.toMatch(/retorno|hoje/);
  });
  it("chave ausente/erro = desligado; migration não a liga para ninguém", async () => {
    const db = (data: unknown, error: unknown = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }) });
    expect(await modoEquipeDb(db({ ia_modo_equipe: true }) as never, "piloto")).toBe(true);
    expect(await modoEquipeDb(db({ ia_modo_equipe: false }) as never, "zz")).toBe(false);
    expect(await modoEquipeDb(db(null, { code: "42703" }) as never, "piloto")).toBe(false);
    const m = readFileSync("supabase/migrations/20261213120000_leads_ia_modo_equipe.sql", "utf8");
    expect(m).toContain("DEFAULT false");
    expect(m.replace(/^--.*$/gm, "")).not.toMatch(/UPDATE public\.lead_config/);
  });
});
