/**
 * "Plano com valor a conferir" nos 3 painéis (t_125c4dd3). Mesma regra (conferirPlano) do Meu Plano 2027.
 * O plano marcado CONTINUA na soma e no farol (nada muda nas contas); plano antigo assinado acima do limite
 * continua assinado e aparece marcado.
 */
import { describe, expect, it } from "vitest";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import {
  montarPainelGestor,
  type PessoaRpc,
  type PlanosRpc,
  type RealizadoRpc,
} from "./painel-gestor";
import { montarPainelImobiliaria } from "./painel-imobiliaria";
import { montarPainelCorretor } from "./painel-corretor";

const BOM: Respostas = {
  "mt.novas": "24",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "m.ticket": "400000",
};
// Plano antigo ASSINADO com transações digitadas como reais (caso real, sem nome): VGC R$ 680,4 mi.
const ERRADO: Respostas = {
  "mt.novas": "24",
  "mt.tCapt": "42.000,00",
  "mt.tVenda": "42.000,00",
  "mt.comMedia": "8100,00",
  "m.ticket": "600.000",
};
// Em preenchimento com VGC R$ 1,4 mi (só aviso).
const ALTO: Respostas = {
  "mt.novas": "40",
  "mt.tCapt": "30",
  "mt.tVenda": "26",
  "mt.comMedia": "25000",
  "m.ticket": "800000",
};

const p = (id: string, r: Respostas | null, assinado: boolean): PessoaRpc => ({
  user_id: id,
  nome: id,
  team_id: "eq",
  papeis: ["corretor"],
  tem_plano: r != null,
  respostas: r,
  assinado_em: assinado ? "2026-11-10T12:00:00Z" : null,
});
const planos = (ps: PessoaRpc[]): PlanosRpc => ({
  todas: true,
  modulo_plano: true,
  equipes: [{ id: "eq", nome: "Equipe", lider_id: null, lider_nome: null }],
  pessoas: ps,
});
const vazio: RealizadoRpc = { captacoes_ligadas: true, vendas: [], captacoes: [] };
const entrada = (ps: PessoaRpc[]) => ({
  hoje: "2027-03-16",
  planos: planos(ps),
  realizadoAno: vazio,
  ultimos12: vazio,
  anotacoes: [],
});

describe("painel das equipes", () => {
  const ps = [
    p("bom", BOM, true),
    p("errado", ERRADO, true),
    p("alto", ALTO, false),
    p("sem", null, false),
  ];
  const r = montarPainelGestor(entrada(ps));
  const g = r.grupos.find((x) => x.id === "eq")!;
  it("marca só os planos fora da faixa, assinados e em preenchimento", () => {
    const marca = Object.fromEntries(g.pessoas.map((c) => [c.userId, c.aConferir]));
    expect(marca).toEqual({ bom: false, errado: true, alto: true, sem: false });
    expect(g.aConferir).toEqual({
      assinados: 1,
      preenchimento: 1,
      nomes: expect.arrayContaining(["errado", "alto"]),
    });
  });
  it("o plano antigo acima do limite continua assinado e DENTRO da soma (contas iguais a antes)", () => {
    const c = g.pessoas.find((x) => x.userId === "errado")!;
    expect(c.situacao).toBe("assinado");
    expect(g.soma.qtdAssinados).toBe(2);
    expect(g.soma.assinados?.ano.comissao).toBe(120000 + 680400000);
    expect(g.soma.preenchimentoAno.comissao).toBe(1400000);
  });
  it("sem nenhum plano fora da faixa: nada marcado", () => {
    const g2 = montarPainelGestor(entrada([p("bom", BOM, true)])).grupos[0];
    expect(g2.aConferir).toEqual({ assinados: 0, preenchimento: 0, nomes: [] });
  });
});

describe("painel da imobiliária", () => {
  it("total e ranking mostram a marca; a soma dos assinados não muda", () => {
    const ps = [p("bom", BOM, true), p("errado", ERRADO, true), p("alto", ALTO, false)];
    const i = montarPainelImobiliaria({
      ...entrada(ps),
      direcao: null,
      quebra: null,
      estoque: null,
    });
    expect(i.total.aConferir.assinados).toBe(1);
    expect(i.total.aConferir.preenchimento).toBe(1);
    expect(i.comparacao.comissao.somaAssinados).toBe(680520000);
    expect(i.rankingCorretores.find((l) => l.id === "errado")?.aConferir).toBe(1);
    expect(i.rankingCorretores.find((l) => l.id === "bom")?.aConferir).toBe(0);
    expect(i.rankingEquipes[0].aConferir).toBe(2);
  });
});

describe("painel do corretor", () => {
  const base = {
    userId: "u",
    hoje: "2027-03-16",
    vendas: [],
    captacoesContagem: { ano: 0, mes: 0 },
    captacoes: [],
  };
  it("plano antigo assinado acima do limite: meta igual, com o aviso", () => {
    const c = montarPainelCorretor({
      ...base,
      plano: { respostas: ERRADO, assinadoEm: "2026-11-10T12:00:00Z" },
    });
    expect(c.situacao).toBe("assinado");
    expect(c.meta?.ano.comissao).toBe(680400000);
    expect(c.aConferir.map((a) => a.campo)).toEqual(["mt.tCapt", "mt.tVenda", "vgc"]);
  });
  it("plano bom: sem aviso", () => {
    expect(
      montarPainelCorretor({
        ...base,
        plano: { respostas: BOM, assinadoEm: "2026-11-10T12:00:00Z" },
      }).aConferir,
    ).toEqual([]);
  });
});
