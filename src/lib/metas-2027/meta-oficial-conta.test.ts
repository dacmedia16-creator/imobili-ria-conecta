/**
 * Meta oficial conta na meta da equipe/imobiliária a partir do clique "Usar como minha meta oficial" (cartão
 * t_bd480fee, Denis 23/11: "Passar a contar da minha meta oficial sim / Mostrar selo sim").
 *
 * Regra ÚNICA (consolidado.ts), usada pela lista da Equipe e pelos 3 painéis:
 * - assinado e com meta → "conta" (igual a antes: a meta do plano travado);
 * - NÃO assinado, mas com meta oficial GRAVADA no clique → "conta_falta_assinar": entra na soma com os valores
 *   GRAVADOS (não recalcula das respostas);
 * - sem meta oficial e sem assinatura → "falta_meta": não conta;
 * - plano reaberto: o banco apaga a meta oficial na reabertura (migration 20261228120000), então volta a
 *   "falta_meta" até o corretor gravar de novo ou assinar.
 */
import { describe, expect, it } from "vitest";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import {
  contarNaMeta,
  metaDaGravada,
  planoComSelo,
  seloMeta,
  somarPlanos,
  type MetaOficialGravada,
} from "./consolidado";
import { metaDoPlano, posicaoNoAno, somaMeses } from "./regra";
import { montarPainelGestor, type PessoaRpc, type PlanosRpc } from "./painel-gestor";
import { montarPainelCorretor } from "./painel-corretor";

// VGC R$ 120.000 no ano (R$ 10.000/mês), 24 transações, ticket 400 mil (mesmo plano de regra.test.ts).
const PLANO: Respostas = {
  "mt.creIni": "10",
  "mt.novas": "24",
  "mt.canc": "6",
  "mt.vendidas": "12",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "m.ticket": "400000",
};
// Gravada no clique com valores DIFERENTES das respostas de agora (o corretor mexeu depois): vale a gravada.
const GRAVADA: MetaOficialGravada = {
  meta_comissao: 150000,
  meta_vgv: 6000000,
  meta_vendas: 30,
  meta_captacoes: 20,
};
const QUANDO = "2026-11-20T12:00:00Z";

describe("selo e conta: meta oficial gravada conta mesmo sem assinatura", () => {
  it("não assinado + meta oficial gravada → conta (falta assinar), com os valores GRAVADOS", () => {
    const r = planoComSelo({
      assinadoEm: null,
      respostas: PLANO,
      metaOficial: GRAVADA,
      metaOficialEm: QUANDO,
    });
    expect(r.selo).toBe("conta_falta_assinar");
    expect(r.situacao).toBe("preenchimento"); // a assinatura continua separada
    expect(r.meta!.ano).toEqual({ comissao: 150000, vgv: 6000000, vendas: 30, captacoes: 20 });
    // Mês a mês: formato do próprio plano, fechando no ano gravado.
    expect(somaMeses(r.meta!.meses, "comissao", 12)).toBeCloseTo(150000, 2);
    expect(somaMeses(r.meta!.meses, "vendas", 12)).toBeCloseTo(30, 2);
    expect(r.meta!.meses[0].comissao).toBeCloseTo(12500, 2);
  });

  it("sem meta oficial e sem assinatura → não conta", () => {
    const r = planoComSelo({
      assinadoEm: null,
      respostas: PLANO,
      metaOficial: null,
      metaOficialEm: null,
    });
    expect(r.selo).toBe("falta_meta");
    const s = somarPlanos([{ userId: "x", ...r }]);
    expect(s.assinados).toBeNull();
    expect(s.qtdContam).toBe(0);
    expect(s.qtdPreenchimento).toBe(1);
  });

  it("assinado continua contando, com a meta do plano travado (igual a antes)", () => {
    const r = planoComSelo({
      assinadoEm: QUANDO,
      respostas: PLANO,
      metaOficial: GRAVADA,
      metaOficialEm: QUANDO,
    });
    expect(r.selo).toBe("conta");
    expect(r.meta).toEqual(metaDoPlano(PLANO));
    // Assinou, mas a meta oficial não foi gravada (falha logo após assinar): continua contando como hoje.
    expect(planoComSelo({ assinadoEm: QUANDO, respostas: PLANO }).selo).toBe("conta");
    expect(planoComSelo({ assinadoEm: QUANDO, respostas: { "pq.frase": "x" } }).selo).toBe(
      "assinado_sem_meta",
    );
  });

  it("plano reaberto (assinatura e meta oficial apagadas pela reabertura) → não conta", () => {
    const reaberto = planoComSelo({
      assinadoEm: null,
      respostas: PLANO,
      metaOficial: null,
      metaOficialEm: null,
    });
    expect(reaberto.selo).toBe("falta_meta");
    // Meta gravada sem a data (ou vice-versa) não é meta oficial válida: não conta.
    expect(planoComSelo({ assinadoEm: null, respostas: PLANO, metaOficial: GRAVADA }).selo).toBe(
      "falta_meta",
    );
    expect(planoComSelo({ assinadoEm: null, respostas: PLANO, metaOficialEm: QUANDO }).selo).toBe(
      "falta_meta",
    );
  });

  it("meta gravada sem VGC ou sem formato do plano: sem VGC não conta; sem formato divide o ano por 12", () => {
    expect(metaDaGravada({ ...GRAVADA, meta_comissao: null }, null)).toBeNull();
    const m = metaDaGravada(
      { meta_comissao: "120000", meta_vendas: 24, meta_vgv: null, meta_captacoes: null },
      null,
    )!;
    expect(m.ano).toEqual({ comissao: 120000, vendas: 24, vgv: null, captacoes: null });
    expect(m.meses[5]).toEqual({ comissao: 10000, vendas: 2, vgv: null, captacoes: null });
  });

  it("soma e contador: assinados + metas oficiais sem assinatura; pactos assinados contados à parte", () => {
    const planos = [
      {
        userId: "a",
        ...planoComSelo({
          assinadoEm: QUANDO,
          respostas: PLANO,
          metaOficial: GRAVADA,
          metaOficialEm: QUANDO,
        }),
      },
      {
        userId: "b",
        ...planoComSelo({
          assinadoEm: null,
          respostas: PLANO,
          metaOficial: GRAVADA,
          metaOficialEm: QUANDO,
        }),
      },
      { userId: "c", ...planoComSelo({ assinadoEm: null, respostas: PLANO }) },
      { userId: "d", ...planoComSelo(null) },
    ];
    for (const p of planos) expect(seloMeta(p)).toBe(p.selo);
    const s = somarPlanos(planos);
    expect(contarNaMeta(planos)).toBe(2);
    expect(s.qtdContam).toBe(2);
    expect(s.qtdFaltaAssinar).toBe(1);
    expect(s.qtdAssinados).toBe(1);
    expect(s.qtdPreenchimento).toBe(1);
    expect(s.qtdSemPlano).toBe(1);
    expect(s.assinados!.ano.comissao).toBe(120000 + 150000);
    expect(s.preenchimentoAno.comissao).toBe(120000); // só o "c" (sem meta oficial)
  });
});

describe("painéis usam a mesma regra", () => {
  const pessoa = (p: Partial<PessoaRpc> & { user_id: string }): PessoaRpc => ({
    nome: p.user_id.toUpperCase(),
    team_id: "t1",
    papeis: ["corretor"],
    tem_plano: true,
    respostas: PLANO,
    assinado_em: null,
    meta_oficial: null,
    meta_oficial_em: null,
    ...p,
  });
  const planos: PlanosRpc = {
    todas: true,
    modulo_plano: true,
    equipes: [{ id: "t1", nome: "Equipe Azul", lider_id: null, lider_nome: null }],
    pessoas: [
      pessoa({ user_id: "a", assinado_em: QUANDO, meta_oficial: GRAVADA, meta_oficial_em: QUANDO }),
      pessoa({ user_id: "b", meta_oficial: GRAVADA, meta_oficial_em: QUANDO }),
      pessoa({ user_id: "c" }),
    ],
  };
  const vazio = { captacoes_ligadas: true, vendas: [], captacoes: [] };

  it("painel da equipe/imobiliária: meta = assinado + meta oficial sem assinatura; cobertura segue só assinados", () => {
    const p = montarPainelGestor({
      hoje: "2027-03-15",
      planos,
      realizadoAno: {
        captacoes_ligadas: true,
        vendas: [
          {
            sale_id: "v1",
            user_id: "b",
            venda_em: "2027-02-10",
            comissao: 9000,
            vgv: 300000,
            lados: 1,
          },
          {
            sale_id: "v2",
            user_id: "c",
            venda_em: "2027-02-11",
            comissao: 4000,
            vgv: 200000,
            lados: 1,
          },
        ],
        captacoes: [],
      },
      ultimos12: vazio,
      anotacoes: [],
    });
    const g = p.grupos[0];
    expect(g.soma.assinados!.ano.comissao).toBe(120000 + 150000);
    expect(g.soma.qtdContam).toBe(2);
    expect(g.cobertura.assinados).toBe(1); // "Planos assinados" continua separado para cobrar a assinatura
    // Realizado comparado com a meta = de quem conta (b entra; c não).
    expect(g.realizadoAno.comissao).toBe(9000);
    expect(g.naoAssinados.realizado.comissao).toBe(4000);
    const b = g.pessoas.find((x) => x.userId === "b")!;
    expect(b.selo).toBe("conta_falta_assinar");
    expect(b.avaliacao.farol).not.toBe("cinza");
    expect(b.avaliacao.indicadores.comissao.metaAno).toBe(150000);
    const c = g.pessoas.find((x) => x.userId === "c")!;
    expect(c.selo).toBe("falta_meta");
    expect(c.avaliacao.farol).toBe("cinza");
    expect(c.avaliacao.indicadores.comissao.metaAno).toBeNull();
  });

  it("painel do corretor: meta oficial gravada sem assinatura já aparece como meta", () => {
    const base = {
      userId: "b",
      hoje: "2027-03-15",
      vendas: [],
      captacoesContagem: { ano: 0, mes: 0 },
      captacoes: [],
    };
    const com = montarPainelCorretor({
      ...base,
      plano: { respostas: PLANO, assinadoEm: null, metaOficial: GRAVADA, metaOficialEm: QUANDO },
    });
    expect(com.selo).toBe("conta_falta_assinar");
    expect(com.meta!.ano.comissao).toBe(150000);
    expect(com.avaliacao.farol).not.toBe("cinza");
    const sem = montarPainelCorretor({ ...base, plano: { respostas: PLANO, assinadoEm: null } });
    expect(sem.selo).toBe("falta_meta");
    expect(sem.meta).toBeNull();
    expect(sem.avaliacao.farol).toBe("cinza");
    expect(posicaoNoAno("2027-03-15").fase).toBe("durante");
  });
});
