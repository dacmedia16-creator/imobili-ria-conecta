// Conjunto de referência (t_a9f1b447): as conversas reais de Denis, com o roteiro fixo (plano B), sem modelo.
// O teste com o modelo real fica em scripts/leads-ia-test/referencia-modelo.ts (teto US$ 1).
import { describe, expect, it } from "vitest";
import { proximaResposta, type ContextoIa, type RespostaIa } from "./leads-ia";
import { buscasReferencia, ctxReferencia, REFERENCIA } from "./leads-ia-referencia.dados";

const AGORA = new Date("2026-10-27T13:00:00Z");

async function rodar(id: string, seguirFim = false): Promise<RespostaIa[]> {
  const conv = REFERENCIA.find((c) => c.id === id)!;
  const b = buscasReferencia(conv);
  let c: ContextoIa = ctxReferencia(conv);
  const out: RespostaIa[] = [];
  let juntas: string[] = [];
  for (const f of conv.falas) {
    if (f.junto) {
      juntas.push(f.cliente);
      continue;
    }
    const r = await proximaResposta(c, f.cliente, undefined, { agora: AGORA, ...b, falasAntes: juntas });
    juntas = [];
    out.push(r);
    // t_37cf21e3: na F, Denis seguiu conversando (ao vivo o modelo não passou); segue para testar os pontos.
    if (r.fim && !seguirFim) break;
    c = { ...c, passo: r.passo, dados: r.dados, versao: c.versao + 1 };
  }
  return out;
}

describe("referência B (lead 59538211, 3 suítes) — plano B", () => {
  it("responde todas as falas, sem passar ao corretor, sem 'mais algum detalhe?' sozinha", async () => {
    const rs = await rodar("B");
    if (process.env.REF_MOSTRAR) for (const r of rs) console.log(r.resposta);
    expect(rs).toHaveLength(8);
    for (const r of rs) {
      expect(r.resposta.trim()).not.toBe("");
      expect(r.fim).toBeNull();
      expect(r.resposta.trim()).not.toBe("Quer saber mais algum detalhe?");
    }
    // 3 suítes: honesto sobre a faixa e mostra o mais em conta, com preço e link.
    expect(rs[2].resposta).toMatch(/Com 3 suítes, nessa faixa não tenho/);
    expect(rs[2].resposta).toMatch(/R\$ 975\.000|R\$ 975 mil/);
    expect(rs[2].resposta).toMatch(/https:\/\/vipsevenimoveis\.com\.br\/imovel\/VIP0015/);
    expect(rs[2].resposta).toMatch(/2 suítes/);
    // Nunca oferece de novo um imóvel com 1 suíte depois do pedido.
    for (const r of rs.slice(2)) expect(r.resposta).not.toMatch(/imovel\/(3882|3879)\b/);
    // "Não" segue a conversa.
    expect(rs[7].resposta).toMatch(/^Tranquilo!/);
    // Nenhuma data antes de querer visitar.
    for (const r of rs) expect(r.resposta).not.toMatch(/\d{2}\/\d{2}/);
  });
});

describe("referência C (lead ac62b62c, 3 dormitórios + Alphaville) — plano B", () => {
  it("'legal' leva ao convite simples (sem datas); a busca para o filho recebe resposta", async () => {
    const rs = await rodar("C");
    if (process.env.REF_MOSTRAR) for (const r of rs) console.log(r.resposta);
    expect(rs).toHaveLength(6);
    expect(rs[2].resposta).toMatch(/imovel\/3965/);
    expect(rs[4].resposta).not.toMatch(/\d{2}\/\d{2}|manhã|tarde/);
    expect(rs[4].resposta).toMatch(/visita/);
    expect(rs[5].resposta.trim()).not.toBe("");
    expect(rs[5].fim).toBeNull();
  });
});

describe("referência A (lead 4c2e125f) — plano B", () => {
  it("responde todas, sem ficha repetida nem pagamento no meio do pedido", async () => {
    const rs = await rodar("A");
    if (process.env.REF_MOSTRAR) for (const r of rs) console.log(r.resposta);
    expect(rs.length).toBeGreaterThanOrEqual(7);
    expect(rs[0].resposta).toMatch(/R\$ 420/);
    for (const r of rs.slice(1, 4)) expect(r.resposta).not.toMatch(/pagamento|à vista|faixa de valor/);
    expect(rs[6].resposta).toMatch(/manhã|tarde/);
  });
});

// t_37cf21e3: conversa de teste de Denis d8907e38 (VIP0027) — os 6 pontos, com o roteiro (plano B).
describe("referência F (lead cc19ea1c, d8907e38) — plano B", () => {
  it("os 6 pontos", async () => {
    const rs = await rodar("F", true);
    if (process.env.REF_MOSTRAR) rs.forEach((r, i) => console.log(i, r.resposta));
    const [gostaria, mais, regiao, , , , filho, , , , , paraMim, ambigua, disse, , , fotos1, fotos2] = rs;
    // 5. "Gostaria" não é "gostei".
    expect(gostaria.resposta).not.toMatch(/que bom que gostou/i);
    expect(gostaria.resposta).toMatch(/gostaria de saber|agendar/);
    // 1. Outra opção parecida: casa de 2 a 4 quartos (nunca a VIP0141, de 1 quarto).
    expect(mais.resposta).not.toMatch(/VIP0141/);
    expect(mais.resposta).toMatch(/casa[^.]* com [234] quartos/);
    // 2. "nesta região": no Central Parque não tem; avisa antes de mostrar outro bairro.
    expect(regiao.resposta).toMatch(/^No Central Parque não tenho/);
    expect(regiao.resposta).toMatch(/outro bairro/);
    // 3. Filho: apartamento no Campolim com 3 suítes até R$ 1,2 mi (nunca o do Centro).
    expect(filho.resposta).toMatch(/imovel\/(VIP0036|VIP0034)\b/);
    expect(filho.resposta).not.toMatch(/VIP0015/);
    expect(filho.dados.filtro_pedido?.suites).toBeUndefined();
    expect(filho.dados.busca2?.faixa).toMatch(/1\.200\.000/);
    // 3. "sobre a casa q eu to vendo para mim / vc tem mais opções?" = CASA (perfil do cliente).
    expect(paraMim.resposta).toMatch(/imovel\/(3879|3881|3882|3885|VIP0137|VIP0048|3898)\b/);
    expect(paraMim.resposta).not.toMatch(/apartamento|VIP0047|VIP0036|VIP0034/);
    expect(paraMim.resposta).toMatch(/https:\/\/vipsevenimoveis\.com\.br\/imovel\//);
    // 3. A 2ª busca fica para o corretor no resumo (sem lead novo).
    expect(paraMim.dados.busca2?.tipo).toBe("apartamento");
    // 4. Frase ambígua: confirma em 1 pergunta curta.
    expect(ambigua.resposta).toMatch(/^Só para eu entender certo: você quer ver casas, certo\?$/);
    // 4. Depois da correção: mostra outra casa (ou diz que acabaram), nunca volta só para a do anúncio.
    expect(disse.resposta).toMatch(/casa|opções/i);
    expect(disse.resposta).not.toMatch(/apartamento/);
    // 6. Fotos: o link do anúncio, sem prometer mandar fotos.
    for (const r of [fotos1, fotos2]) {
      expect(r.resposta).toMatch(/As fotos estão todas no anúncio: https:\/\/vipsevenimoveis\.com\.br\/imovel\//);
      expect(r.resposta).not.toMatch(/te mando|vou (te )?mandar|corretor confirma/i);
    }
  });
});
