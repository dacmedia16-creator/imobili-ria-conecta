// Conjunto de referência (t_a9f1b447): as conversas reais de Denis, com o roteiro fixo (plano B), sem modelo.
// O teste com o modelo real fica em scripts/leads-ia-test/referencia-modelo.ts (teto US$ 1).
import { describe, expect, it } from "vitest";
import { proximaResposta, type ContextoIa, type RespostaIa } from "./leads-ia";
import { buscasReferencia, ctxReferencia, REFERENCIA } from "./leads-ia-referencia.dados";

const AGORA = new Date("2026-10-27T13:00:00Z");

async function rodar(id: string): Promise<RespostaIa[]> {
  const conv = REFERENCIA.find((c) => c.id === id)!;
  const b = buscasReferencia(conv);
  let c: ContextoIa = ctxReferencia(conv);
  const out: RespostaIa[] = [];
  for (const f of conv.falas) {
    const r = await proximaResposta(c, f.cliente, undefined, { agora: AGORA, ...b });
    out.push(r);
    if (r.fim) break;
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
