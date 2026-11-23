/**
 * Metas 2027 · fonte ÚNICA = meta oficial GRAVADA (cartão t_91ec7aa3, Denis 23/11, tópico 6238).
 *
 * Decisões de Denis:
 * - "Conta na meta" = existe meta oficial gravada para 2027 (botão verde "Usar como minha meta oficial" ou a
 *   gravação da própria assinatura). Conta JÁ NO CLIQUE, mesmo sem assinatura.
 * - Soma oficial = soma das metas GRAVADAS, para todos (inclusive quem assinou: o painel não recalcula mais pelas
 *   respostas; era isso que inflava a soma, ex.: 21.655 vendas num plano cuja meta gravada é 21).
 * - Assinou e não tem meta gravada → não conta (aparece "Assinou, falta a meta").
 * - Meta gravada fora dos LIMITES de bloqueio (conferencia.ts) fica FORA da soma e aparece à parte, "a conferir".
 * - Selo e contador da lista Equipe = mesma regra dos 3 painéis.
 */
import { describe, expect, it } from "vitest";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import {
  contarNaMeta,
  metaGravadaForaDoLimite,
  planoComSelo,
  seloMeta,
  somarPlanos,
  type MetaOficialGravada,
} from "./consolidado";
import { montarPainelGestor, type PessoaRpc, type PlanosRpc } from "./painel-gestor";
import { montarPainelImobiliaria } from "./painel-imobiliaria";
import { montarPainelCorretor } from "./painel-corretor";

// Plano que fecha meta: VGC R$ 120.000, 24 transações (mesmo de regra.test.ts).
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
// Caso real sem nome: plano ASSINADO cujas respostas, recalculadas, dão milhares de vendas (ticket digitado como
// comissão), mas a meta GRAVADA no clique é a certa.
const INFLADO: Respostas = {
  "mt.novas": "36",
  "m.ticket": "800",
  "m.pct": "3",
  "e.renda": "15000",
};
const G = (c: number, n: number, k: number | null = 20, v: number | null = 6_000_000) =>
  ({
    meta_comissao: c,
    meta_vendas: n,
    meta_captacoes: k,
    meta_vgv: v,
  }) satisfies MetaOficialGravada;
const EM = "2026-11-20T12:00:00Z";

describe("regra única: conta na meta = tem meta oficial gravada", () => {
  it("meta gravada SEM assinatura conta (selo 'Conta na meta · falta assinar')", () => {
    const r = planoComSelo({
      assinadoEm: null,
      respostas: PLANO,
      metaOficial: G(150000, 30),
      metaOficialEm: EM,
    });
    expect(r.selo).toBe("conta_falta_assinar");
    expect(r.meta!.ano.comissao).toBe(150000);
  });

  it("SEM meta gravada não conta, nem assinado", () => {
    expect(planoComSelo({ assinadoEm: null, respostas: PLANO }).selo).toBe("falta_meta");
    const ass = planoComSelo({ assinadoEm: EM, respostas: PLANO });
    expect(ass.selo).toBe("assinado_sem_meta");
    const s = somarPlanos([{ userId: "a", ...ass }]);
    expect(s.qtdContam).toBe(0);
    expect(s.assinados).toBeNull();
    expect(s.qtdAssinados).toBe(1); // o pacto continua contado à parte
  });

  it("assinado com meta gravada conta pelo valor GRAVADO, não pelo recalculado das respostas", () => {
    const r = planoComSelo({
      assinadoEm: EM,
      respostas: INFLADO,
      metaOficial: G(504000, 21, 36, 8_400_000),
      metaOficialEm: EM,
    });
    expect(r.selo).toBe("conta");
    expect(r.meta!.ano).toEqual({ comissao: 504000, vendas: 21, captacoes: 36, vgv: 8_400_000 });
  });

  it("meta gravada fora dos limites de bloqueio: fica FORA da soma, à parte como 'a conferir'", () => {
    expect(metaGravadaForaDoLimite(G(5_040_000, 84))).toMatch(/comissão/);
    expect(metaGravadaForaDoLimite(G(1_071_000, 42, 840))).toMatch(/captações/);
    expect(metaGravadaForaDoLimite(G(600_000, 1001))).toMatch(/transações/);
    expect(metaGravadaForaDoLimite(G(5_000_000, 1000, 500))).toBeNull(); // no limite ainda vale
    const fora = planoComSelo({
      assinadoEm: null,
      respostas: PLANO,
      metaOficial: G(5_040_000, 84),
      metaOficialEm: EM,
    });
    expect(fora.selo).toBe("meta_a_conferir");
    const ok = planoComSelo({
      assinadoEm: null,
      respostas: PLANO,
      metaOficial: G(150000, 30),
      metaOficialEm: EM,
    });
    const s = somarPlanos([
      { userId: "fora", ...fora },
      { userId: "ok", ...ok },
    ]);
    expect(s.qtdContam).toBe(1);
    expect(s.assinados!.ano.comissao).toBe(150000);
    expect(s.qtdAConferir).toBe(1);
    expect(s.aConferirAno.comissao).toBe(5_040_000);
  });

  it("soma oficial = soma exata das metas gravadas (ano e meses fecham)", () => {
    const gs = [
      G(504000, 21, 36),
      G(1_657_782, 118, 61),
      G(150000, 30, 20),
      G(240000, 40, 36, null),
    ];
    const planos = gs.map((g, i) => ({
      userId: `p${i}`,
      ...planoComSelo({
        assinadoEm: i < 2 ? EM : null,
        respostas: i === 0 ? INFLADO : PLANO,
        metaOficial: g,
        metaOficialEm: EM,
      }),
    }));
    for (const p of planos) expect(seloMeta(p)).toBe(p.selo);
    const s = somarPlanos(planos);
    expect(contarNaMeta(planos)).toBe(4);
    expect(s.qtdContam).toBe(4);
    expect(s.qtdFaltaAssinar).toBe(2);
    expect(s.assinados!.ano.comissao).toBe(504000 + 1_657_782 + 150000 + 240000);
    expect(s.assinados!.ano.vendas).toBe(21 + 118 + 30 + 40);
    expect(s.assinados!.ano.captacoes).toBe(36 + 61 + 20 + 36);
    expect(s.assinados!.ano.vgv).toBe(6_000_000 * 3);
    const somaMes = s.assinados!.meses.reduce((t, m) => t + (m.comissao ?? 0), 0);
    expect(somaMes).toBeCloseTo(s.assinados!.ano.comissao!, 0);
  });
});

describe("os 3 painéis e o selo/contador da Equipe batem", () => {
  const pessoa = (p: Partial<PessoaRpc> & { user_id: string }): PessoaRpc => ({
    nome: p.user_id,
    team_id: "t1",
    papeis: ["corretor"],
    tem_plano: true,
    respostas: PLANO,
    assinado_em: null,
    meta_oficial: null,
    meta_oficial_em: null,
    ...p,
  });
  const pessoas = [
    pessoa({
      user_id: "ass_gravada",
      assinado_em: EM,
      respostas: INFLADO,
      meta_oficial: G(504000, 21, 36),
      meta_oficial_em: EM,
    }),
    pessoa({ user_id: "clique", meta_oficial: G(150000, 30), meta_oficial_em: EM }),
    pessoa({ user_id: "ass_sem_meta", assinado_em: EM }),
    pessoa({ user_id: "fora_limite", meta_oficial: G(5_040_000, 84), meta_oficial_em: EM }),
    pessoa({ user_id: "preench" }),
  ];
  const planos: PlanosRpc = {
    todas: true,
    modulo_plano: true,
    equipes: [{ id: "t1", nome: "Equipe Azul", lider_id: null, lider_nome: null }],
    pessoas,
  };
  const vendas = [
    {
      sale_id: "v1",
      user_id: "clique",
      venda_em: "2027-02-10",
      comissao: 9000,
      vgv: 300000,
      lados: 1,
    },
    {
      sale_id: "v2",
      user_id: "ass_sem_meta",
      venda_em: "2027-02-11",
      comissao: 4000,
      vgv: 200000,
      lados: 1,
    },
    {
      sale_id: "v3",
      user_id: "fora_limite",
      venda_em: "2027-02-12",
      comissao: 3000,
      vgv: 100000,
      lados: 1,
    },
  ];
  const entrada = {
    hoje: "2027-03-15",
    planos,
    realizadoAno: { captacoes_ligadas: true, vendas, captacoes: [] },
    ultimos12: { captacoes_ligadas: true, vendas: [], captacoes: [] },
    anotacoes: [],
  };

  it("equipe e imobiliária: soma = metas gravadas válidas; realizado comparado só de quem tem meta gravada", () => {
    const p = montarPainelGestor(entrada);
    const g = p.grupos[0];
    expect(g.soma.assinados!.ano.comissao).toBe(504000 + 150000);
    expect(g.soma.assinados!.ano.vendas).toBe(21 + 30);
    expect(g.soma.qtdContam).toBe(2);
    expect(g.soma.qtdAConferir).toBe(1);
    expect(g.realizadoAno.comissao).toBe(9000); // só "clique" vendeu entre quem conta
    expect(g.naoAssinados.realizado.comissao).toBe(4000 + 3000);
    const selo = Object.fromEntries(g.pessoas.map((c) => [c.userId, c.selo]));
    expect(selo).toEqual({
      ass_gravada: "conta",
      clique: "conta_falta_assinar",
      ass_sem_meta: "assinado_sem_meta",
      fora_limite: "meta_a_conferir",
      preench: "falta_meta",
    });
    expect(g.metaAConferir.nomes).toEqual(["fora_limite"]);
    // Imobiliária: mesma soma e o mesmo total que o selo/contador da lista Equipe.
    const i = montarPainelImobiliaria({ ...entrada, direcao: null, quebra: null, estoque: null });
    expect(i.comparacao.comissao.somaAssinados).toBe(504000 + 150000);
    expect(i.total.soma.qtdContam).toBe(contarNaMeta(g.pessoas));
  });

  it("selo da lista Equipe (planoComSelo da linha crua) = selo do painel, pessoa a pessoa", () => {
    const p = montarPainelGestor(entrada);
    for (const x of pessoas) {
      const lista = planoComSelo({
        assinadoEm: x.assinado_em,
        respostas: x.respostas,
        metaOficial: x.meta_oficial,
        metaOficialEm: x.meta_oficial_em,
      }).selo;
      expect(p.total.pessoas.find((c) => c.userId === x.user_id)!.selo).toBe(lista);
    }
  });

  it("Minha carreira: assinado sem meta gravada fica sem meta; com meta gravada usa o valor gravado", () => {
    const base = {
      userId: "u",
      hoje: "2027-03-15",
      vendas: [],
      captacoesContagem: { ano: 0, mes: 0 },
      captacoes: [],
    };
    const sem = montarPainelCorretor({ ...base, plano: { respostas: PLANO, assinadoEm: EM } });
    expect(sem.selo).toBe("assinado_sem_meta");
    expect(sem.meta).toBeNull();
    expect(sem.avaliacao.farol).toBe("cinza");
    const com = montarPainelCorretor({
      ...base,
      plano: {
        respostas: INFLADO,
        assinadoEm: EM,
        metaOficial: G(504000, 21, 36),
        metaOficialEm: EM,
      },
    });
    expect(com.meta!.ano.vendas).toBe(21);
    const fora = montarPainelCorretor({
      ...base,
      plano: {
        respostas: PLANO,
        assinadoEm: null,
        metaOficial: G(5_040_000, 84),
        metaOficialEm: EM,
      },
    });
    expect(fora.selo).toBe("meta_a_conferir");
    expect(fora.meta).toBeNull();
  });
});
