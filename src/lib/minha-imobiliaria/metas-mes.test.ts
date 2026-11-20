/**
 * Bloco "Metas do mês" da Minha imobiliária (t_f7f1b3e4). Regras de Denis (20/11): meta só com plano assinado
 * (também V1/V2), admin que vende sem meta e "fora da %", captação pela aprovação, vendas em pontas, filtro
 * Empresa → Equipe → Corretor, selo "valor a conferir".
 */
import { describe, expect, it } from "vitest";
import { calc, type Respostas } from "@/lib/meu-plano-2027/regras";
import { metaDoPlano } from "@/lib/metas-2027/regra";
import type { PessoaRpc, PlanosRpc, RealizadoRpc } from "@/lib/metas-2027/painel-gestor";
import {
  metaMesDoPlano,
  montarBaseMetasMes,
  montarMetasMes,
  normalizarAtividadesRpc,
  respostasDoFunil,
  textoMotivos,
  tomRitmo,
  type AtividadesRpc,
} from "./metas-mes";

// Plano completo (com despesas, para a conta do funil passar pelo estilo de vida).
const PLANO: Respostas = {
  "op.0": "6.000",
  "op.1": "2000",
  "on.0": "1500",
  "so.0.v": "30000",
  "es.aliq": "15",
  "m.faixa": "50",
  "m.ticket": "400000",
  "m.pct": "5",
  "m.conv": "25",
  "mt.novas": "24",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "d.observacao": "não sai",
  "fu.v2cre": "50",
  "fu.v1v2": "60",
};
// Plano assinado com transações absurdas (conferirPlano marca): 250 transações no ano.
const ABSURDO: Respostas = { ...PLANO, "mt.tCapt": "125", "mt.tVenda": "125", "mt.novas": "200" };

const HOJE = "2027-03-16";
const pessoa = (
  id: string,
  team: string | null,
  r: Respostas | null,
  assinado: boolean,
  papeis = ["corretor"],
): PessoaRpc => ({
  user_id: id,
  nome: id.toUpperCase(),
  team_id: team,
  papeis,
  tem_plano: r != null,
  respostas: r,
  assinado_em: assinado ? "2026-12-10T12:00:00Z" : null,
});
const planos = (ps: PessoaRpc[]): PlanosRpc => ({
  todas: true,
  modulo_plano: true,
  equipes: [
    { id: "t-b", nome: "Equipe Beta", lider_id: null, lider_nome: "Líder B" },
    { id: "t-a", nome: "Equipe Alfa", lider_id: null, lider_nome: "Líder A" },
  ],
  pessoas: ps,
});
const V = (s: string, u: string, d: string, lados: number) => ({
  sale_id: s,
  user_id: u,
  venda_em: d,
  comissao: 1000,
  vgv: 300000,
  lados,
  conta_equipe: true,
  ponta: lados > 0,
});
const REAL: RealizadoRpc = {
  captacoes_ligadas: true,
  vendas: [
    V("s1", "ana", "2027-03-02", 2), // captou e vendeu: 2 pontas, 1 venda
    V("s2", "ana", "2027-03-10", 1),
    V("s2", "bia", "2027-03-10", 1), // mesma venda, outra ponta
    V("s3", "caio", "2027-03-05", 1), // plano não assinado → fora da %
    V("s4", "dono", "2027-03-07", 2), // admin que vende → fora da %
    V("s5", "ex", "2027-03-08", 1), // já saiu → fora da % só na empresa
    V("s6", "ana", "2027-02-27", 1), // mês passado: não conta
    { ...V("s7", "ana", "2027-03-11", 0), ponta: false }, // repasse de líder: 0 pontas
  ],
  captacoes: [
    { capture_id: "c1", user_id: "ana", aprovada_em: "2027-03-03" },
    { capture_id: "c1", user_id: "ana", aprovada_em: "2027-03-03" }, // repetida: conta 1
    { capture_id: "c2", user_id: "bia", aprovada_em: "2027-03-15" },
    { capture_id: "c3", user_id: "caio", aprovada_em: "2027-03-01" },
    { capture_id: "c4", user_id: "bia", aprovada_em: "2027-02-28" }, // aprovada mês passado
  ],
};
const ATIV: AtividadesRpc = {
  inicio: "2027-03-01",
  fim: HOJE,
  atividades: [
    { user_id: "ana", v1: 10, v2: 5 },
    { user_id: "bia", v1: 4, v2: 2 },
    { user_id: "caio", v1: 7, v2: 3 },
  ],
  funil: [
    { user_id: "ana", respostas: respostasDoFunil(PLANO) },
    { user_id: "bia", respostas: respostasDoFunil(ABSURDO) },
    { user_id: "caio", respostas: respostasDoFunil(PLANO) },
  ],
  admins: [
    { user_id: "dono", nome: "Dono Vendedor", team_id: null, papeis: ["super_admin"] },
    { user_id: "adm2", nome: "Admin Parado", team_id: null, papeis: ["admin"] },
  ],
};
// O banco manda só a parte da meta das respostas (metas_respostas_meta) e o funil à parte.
const soMeta = (r: Respostas) =>
  Object.fromEntries(
    Object.entries(r).filter(([k]) => /^(mt\.|m\.(ticket|pct)|d\.ticket)/.test(k)),
  );
const PESSOAS = [
  pessoa("ana", "t-a", soMeta(PLANO), true),
  pessoa("bia", "t-a", soMeta(ABSURDO), true),
  pessoa("caio", "t-b", soMeta(PLANO), false),
  pessoa("duda", "t-b", null, false),
  pessoa("edu", null, soMeta(PLANO), true),
];
const base = () =>
  montarBaseMetasMes({ hoje: HOJE, planos: planos(PESSOAS), realizadoMes: REAL, atividades: ATIV });
const linha = (m: ReturnType<typeof montarMetasMes>, k: string) =>
  m.linhas.find((l) => l.linha === k)!;

describe("respostasDoFunil (espelho de minha_imobiliaria_respostas_funil)", () => {
  it("V1/V2 saem iguais ao plano inteiro, sem despesas item a item", () => {
    const f = respostasDoFunil(PLANO);
    expect(Object.keys(f).some((k) => /^op\.[1-7]$|^on\.[1-5]$|^so\.[12]/.test(k))).toBe(false);
    expect(f["op.0"]).toBe(8000);
    expect(f["d.observacao"]).toBeUndefined();
    const inteiro = calc(PLANO);
    const recorte = calc({ ...f, ...soMeta(PLANO) });
    expect(recorte.v1Mes).toBe(inteiro.v1Mes);
    expect(recorte.v2Mes).toBe(inteiro.v2Mes);
    expect(Number.isFinite(inteiro.v1Mes)).toBe(true);
  });
});

describe("metaMesDoPlano", () => {
  it("V1/V2 do funil (calc) e captação/vendas do mês do plano (metaDoPlano)", () => {
    const m = metaMesDoPlano(PLANO, 3)!;
    const C = calc(PLANO);
    const mp = metaDoPlano(PLANO)!;
    expect(m).toEqual({
      v1: C.v1Mes,
      v2: C.v2Mes,
      captacoes: Math.round(mp.meses[2].captacoes!),
      vendas: Math.round(mp.meses[2].vendas!),
    });
    expect(metaMesDoPlano(null, 3)).toBeNull();
    expect(metaMesDoPlano({ "mt.novas": "2" }, 3)).toBeNull(); // incompleto
  });
});

describe("montarBaseMetasMes", () => {
  it("quem tem meta: só plano ASSINADO; admin que vende entra sem meta; admin parado fica fora", () => {
    const b = base();
    const por = Object.fromEntries(b.pessoas.map((p) => [p.userId, p]));
    expect(por.ana.temMeta).toBe(true);
    expect(por.bia.temMeta).toBe(true);
    expect(por.caio).toMatchObject({ temMeta: false, motivo: "preenchimento" });
    expect(por.duda).toMatchObject({ temMeta: false, motivo: "sem_plano" });
    expect(por.dono).toMatchObject({ temMeta: false, motivo: "admin", admin: true });
    expect(por.adm2).toBeUndefined();
    // ordem alfabética, sem ranking
    expect(b.pessoas.map((p) => p.nome)).toEqual(
      [...b.pessoas.map((p) => p.nome)].sort((x, y) => x.localeCompare(y, "pt-BR")),
    );
    expect(b.equipes.map((e) => e.nome)).toEqual(["Equipe Alfa", "Equipe Beta", "Sem equipe"]);
  });

  it("realizado: captação pela aprovação no mês (sem repetir), vendas em pontas na assinatura", () => {
    const por = Object.fromEntries(base().pessoas.map((p) => [p.userId, p]));
    expect(por.ana.real).toEqual({ v1: 10, v2: 5, captacoes: 1, vendas: 3 });
    expect(por.ana.vendasIds.sort()).toEqual(["s1", "s2"]);
    expect(por.bia.real).toEqual({ v1: 4, v2: 2, captacoes: 1, vendas: 1 });
    expect(por.dono.real.vendas).toBe(2);
    expect(base().outros.real.vendas).toBe(1);
  });

  it("V1/V2 do plano usam o recorte do funil; sem o recorte a meta continua saindo", () => {
    const sem = montarBaseMetasMes({
      hoje: HOJE,
      planos: planos(PESSOAS),
      realizadoMes: REAL,
      atividades: { ...ATIV, funil: [] },
    });
    const com = base();
    const a = (b: typeof com) => b.pessoas.find((p) => p.userId === "ana")!.meta!;
    expect(a(com).v1).toBe(calc(PLANO).v1Mes);
    expect(a(sem)).not.toBeNull();
  });

  it("regra de admin é configurável (adminSemMeta) e plano antes de 2027 vira prévia", () => {
    const b = montarBaseMetasMes({
      hoje: "2026-11-20",
      planos: planos(PESSOAS),
      realizadoMes: { ...REAL, vendas: [], captacoes: [] },
      atividades: ATIV,
    });
    expect(b.previa).toBe(true);
    expect(b.mes).toBe(11);
    expect(b.fracMes).toBeCloseTo(20 / 30);
  });
});

describe("montarMetasMes (filtro)", () => {
  it("Empresa: meta = soma de quem tem meta; fora da % = sem meta + quem já saiu", () => {
    const b = base();
    const m = montarMetasMes(b, { nivel: "empresa" });
    expect(m.total).toBe(6);
    expect(m.comMeta).toBe(3); // ana, bia, edu
    const metaAna = metaMesDoPlano({ ...PLANO }, 3)!;
    const metaBia = metaMesDoPlano({ ...ABSURDO }, 3)!;
    const v = linha(m, "vendas");
    expect(v.meta).toBe(metaAna.vendas * 2 + metaBia.vendas); // ana + edu (mesmo plano) + bia
    expect(v.real).toBe(4); // ana 3 + bia 1 (edu 0)
    expect(v.vendasAssinadas).toBe(2); // s1, s2 (s2 com 2 pontas conta 1 venda)
    expect(v.fora).toBe(1 + 2 + 1); // caio + dono + ex
    expect(linha(m, "v1")).toMatchObject({ real: 14, fora: 7 });
    expect(linha(m, "captacoes")).toMatchObject({ real: 2, fora: 1 });
    expect(m.semMeta).toEqual({ qtd: 3, porMotivo: { preenchimento: 1, sem_plano: 1, admin: 1 } });
    expect(textoMotivos(m.semMeta)).toBe(
      "1 sem plano 2027 · 1 plano não assinado · 1 administrador (sem plano)",
    );
    expect(m.aConferir.map((x) => x.userId)).toEqual(["bia"]);
  });

  it("% e ritmo: real ÷ meta e % ÷ fração do mês; selo verde/amarelo/vermelho", () => {
    const m = montarMetasMes(base(), { nivel: "empresa" });
    const l = linha(m, "v1");
    expect(l.pct).toBeCloseTo(l.real / l.meta!);
    expect(l.ritmo).toBeCloseTo(l.pct! / (16 / 31));
    expect(l.falta).toBe(Math.max(0, l.meta! - l.real));
    expect(tomRitmo(1)).toBe("verde");
    expect(tomRitmo(0.8)).toBe("amarelo");
    expect(tomRitmo(0.79)).toBe("vermelho");
    expect(tomRitmo(null)).toBe("sem_meta");
  });

  it("Equipe: só os membros (sem quem já saiu); 'Sem equipe' junta quem não tem equipe", () => {
    const b = base();
    const a = montarMetasMes(b, { nivel: "equipe", equipe: "t-a" });
    expect(a.pessoas.map((p) => p.userId)).toEqual(["ana", "bia"]);
    expect(linha(a, "vendas")).toMatchObject({ real: 4, fora: 0 });
    expect(a.equipe?.liderNome).toBe("Líder A");
    const sem = montarMetasMes(b, { nivel: "equipe", equipe: null });
    expect(sem.pessoas.map((p) => p.userId).sort()).toEqual(["dono", "edu"]);
    expect(linha(sem, "vendas").fora).toBe(2); // só o dono, não quem já saiu
  });

  it("Equipe sem ninguém com meta: mostra só o feito ('sem meta definida')", () => {
    const m = montarMetasMes(base(), { nivel: "equipe", equipe: "t-b" });
    expect(m.comMeta).toBe(0);
    const v1 = linha(m, "v1");
    expect(v1).toMatchObject({ meta: null, real: 7, pct: null, tom: "sem_meta", fora: 0 });
  });

  it("Corretor: com meta, sem meta e a conferir", () => {
    const b = base();
    const ana = montarMetasMes(b, { nivel: "corretor", pessoa: "ana" });
    expect(ana.comMeta).toBe(1);
    expect(ana.aConferir).toEqual([]);
    const bia = montarMetasMes(b, { nivel: "corretor", pessoa: "bia" });
    expect(bia.aConferir.map((x) => x.nome)).toEqual(["BIA"]);
    const dono = montarMetasMes(b, { nivel: "corretor", pessoa: "dono" });
    expect(dono.comMeta).toBe(0);
    expect(linha(dono, "vendas")).toMatchObject({ meta: null, real: 2, vendasAssinadas: 1 });
    expect(dono.semMeta.porMotivo).toEqual({ admin: 1 });
    expect(dono.equipe?.nome).toBe("Sem equipe");
  });

  it("captação desligada: a linha some", () => {
    const b = montarBaseMetasMes({
      hoje: HOJE,
      planos: planos(PESSOAS),
      realizadoMes: { ...REAL, captacoes_ligadas: false },
      atividades: ATIV,
    });
    expect(montarMetasMes(b, { nivel: "empresa" }).linhas.map((l) => l.linha)).toEqual([
      "v1",
      "v2",
      "vendas",
    ]);
  });
});

describe("normalizarAtividadesRpc", () => {
  it("aceita números como texto e listas ausentes", () => {
    const a = normalizarAtividadesRpc({ atividades: [{ user_id: "x", v1: "3", v2: null }] });
    expect(a.atividades).toEqual([{ user_id: "x", v1: 3, v2: 0 }]);
    expect(a.funil).toEqual([]);
    expect(a.admins).toEqual([]);
  });
});
