/**
 * "Minha imobiliária" — bloco "🎯 Metas do mês" (cartão t_f7f1b3e4, maquete v2 aprovada por Denis em 20/11/2026,
 * tópico 6238). Puro, sem banco: a tela só mostra o que sai de montarMetasMes().
 *
 * 4 linhas: V1, V2, Captação e Vendas (em PONTAS: captou = 1, vendeu = 1), meta × realizado do MÊS CORRENTE, com
 * filtro Empresa → Equipe → Corretor (o filtro muda SÓ este bloco).
 *
 * Regras (Denis, 20/11):
 * - meta só com plano ASSINADO (mesma regra dos painéis Metas 2027), inclusive em V1/V2;
 * - meta de V1/V2 = conta do funil do plano (calc → v1Mes/v2Mes, a mesma do Diário), igual em todos os meses;
 * - meta de Captação/Vendas = distribuição mês a mês do plano (metaDoPlano → meses[mês]);
 * - captação conta pela DATA DE APROVAÇÃO (metas_equipe_realizado), vendas pela assinatura (dia de SP);
 * - soma de empresa/equipe = só as metas de quem tem meta; a produção de quem não tem meta aparece separada como
 *   "fora da %", para o % comparar meta e realizado das MESMAS pessoas (comparação justa, PR #361);
 * - selo "valor a conferir" = conferirPlano (PR #363), sem mudar a conta.
 * Suposições (fáceis de mudar, ver REGRAS_METAS_MES): admin que vende fica SEM meta e a produção dele vai para
 * "fora da %"; só o mês corrente.
 */
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import { calc, num, ok, type Respostas, type TaxasFunil } from "@/lib/meu-plano-2027/regras";
import { conferirPlano } from "@/lib/meu-plano-2027/conferencia";
import { metaDoPlano, situacaoPlano, type SituacaoPlano } from "@/lib/metas-2027/regra";
import { mesNoAno } from "@/lib/metas-2027/realizado";
import type { PlanosRpc, RealizadoRpc } from "@/lib/metas-2027/painel-gestor";

/** Decisões que Denis pode trocar sem mexer na conta. */
export const REGRAS_METAS_MES = {
  /** Admin/dono que vende fica sem meta (não tem mais "Minha carreira" nem plano). */
  adminSemMeta: true,
  /** Faixas do selo (realizado ÷ esperado até hoje): mesmas do farol de meta dos painéis. */
  limiteVerde: 1,
  limiteAmarelo: 0.8,
} as const;

export const LINHAS = ["v1", "v2", "captacoes", "vendas"] as const;
export type Linha = (typeof LINHAS)[number];
export type PorLinha = Record<Linha, number>;

export const ROTULO_LINHA: Record<Linha, { rot: string; sub: string }> = {
  v1: { rot: "V1", sub: "1ª visita ao proprietário" },
  v2: { rot: "V2", sub: "2ª visita (Plano de Marketing + ACM)" },
  captacoes: { rot: "Captação", sub: "exclusivas aprovadas no mês" },
  vendas: { rot: "Vendas", sub: "em pontas: captou = 1, vendeu = 1" },
};

export type MotivoSemMeta = "sem_plano" | "preenchimento" | "admin" | "incompleto";
export const ROTULO_MOTIVO: Record<MotivoSemMeta, string> = {
  sem_plano: "sem plano 2027",
  preenchimento: "plano não assinado",
  admin: "administrador (sem plano)",
  incompleto: "plano assinado incompleto",
};

const zero = (): PorLinha => ({ v1: 0, v2: 0, captacoes: 0, vendas: 0 });
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// --- O que o banco devolve (minha_imobiliaria_atividades) ----------------------------------------------------

export type AtividadesRpc = {
  inicio: string;
  fim: string;
  atividades: { user_id: string; v1: number; v2: number }[];
  /** Recorte do plano que a conta de V1/V2 usa (funil + somas das despesas). */
  funil: { user_id: string; respostas: Respostas | null }[];
  admins: {
    user_id: string;
    nome: string | null;
    team_id: string | null;
    papeis: string[] | null;
  }[];
};

export function normalizarAtividadesRpc(x: unknown): AtividadesRpc {
  const o = (x ?? {}) as Partial<AtividadesRpc>;
  return {
    inicio: String(o.inicio ?? ""),
    fim: String(o.fim ?? ""),
    atividades: (o.atividades ?? []).map((a) => ({
      user_id: String(a.user_id),
      v1: n(a.v1),
      v2: n(a.v2),
    })),
    funil: (o.funil ?? []).map((f) => ({
      user_id: String(f.user_id),
      respostas: f.respostas ?? null,
    })),
    admins: (o.admins ?? []).map((a) => ({ ...a, papeis: a.papeis ?? [] })),
  };
}

/**
 * Espelho de minha_imobiliaria_respostas_funil() (banco): só o que calc() usa para chegar em v1Mes/v2Mes.
 * Despesas pessoais saem SÓ somadas (op.0, on.0, so.0.v). O teste confere que V1/V2 saem iguais ao plano inteiro.
 */
const CHAVES_FUNIL =
  /^(m\.(faixa|conv|ticket|pct)|d\.(conv|ticket)|es\.aliq|fu\.(v2cre|v1v2|folga))$/;
const SOMAS_DESPESA: [string, RegExp][] = [
  ["op.0", /^op\.[0-7]$/],
  ["on.0", /^on\.[0-5]$/],
  ["so.0.v", /^so\.[0-2]\.v$/],
];
export function respostasDoFunil(r: Respostas | null | undefined): Respostas {
  const s = r ?? {};
  const out: Respostas = {};
  for (const [k, v] of Object.entries(s)) if (CHAVES_FUNIL.test(k)) out[k] = v;
  for (const [chave, re] of SOMAS_DESPESA) {
    const xs = Object.entries(s)
      .filter(([k]) => re.test(k))
      .map(([, v]) => num(v))
      .filter(ok);
    if (xs.length) out[chave] = xs.reduce((t, x) => t + x, 0);
  }
  return out;
}

// --- Metas de uma pessoa ---------------------------------------------------------------------------------------

/** Meta do mês `mes` (1..12) de uma pessoa a partir do plano (respostas já juntas: meta + funil). */
export function metaMesDoPlano(
  respostas: Respostas | null | undefined,
  mes: number,
  padrao?: Partial<TaxasFunil> | null,
): PorLinha | null {
  if (!respostas || Object.keys(respostas).length === 0) return null;
  const mp = metaDoPlano(respostas, padrao);
  if (!mp) return null;
  const C = calc(respostas, padrao);
  const m = mp.meses[mes - 1];
  return {
    v1: ok(C.v1Mes) ? C.v1Mes : 0,
    v2: ok(C.v2Mes) ? C.v2Mes : 0,
    captacoes: Math.round(m?.captacoes ?? 0),
    vendas: Math.round(m?.vendas ?? 0),
  };
}

// --- Entrada e saída do bloco ----------------------------------------------------------------------------------

export type PessoaMetas = {
  userId: string;
  nome: string;
  teamId: string | null;
  situacao: SituacaoPlano;
  /** Tem meta no mês (plano assinado, completo e não é admin). */
  temMeta: boolean;
  motivo: MotivoSemMeta | null;
  meta: PorLinha | null;
  real: PorLinha;
  /** Vendas assinadas (distintas) em que a pessoa é ponta. */
  vendasIds: string[];
  aConferir: boolean;
  admin: boolean;
};

export type EquipeMetas = { id: string | null; nome: string; liderNome: string | null };

export type BaseMetasMes = {
  /** Mês do plano usado como meta (1..12) e a data de hoje. */
  mes: number;
  hoje: string;
  /** Meses antes de jan/2027: a meta é uma PRÉVIA (mesmo mês do plano 2027). */
  previa: boolean;
  /** Fração do mês já passada (dia ÷ dias do mês), para o traço de ritmo. */
  fracMes: number;
  captacoesLigadas: boolean;
  moduloPlano: boolean;
  equipes: EquipeMetas[];
  pessoas: PessoaMetas[];
  /** Produção do mês de quem não está na lista (já saiu, staff etc.): entra no "fora da %" da empresa. */
  outros: { real: PorLinha; vendasIds: string[] };
};

const diasDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

export function montarBaseMetasMes(e: {
  hoje: string;
  planos: PlanosRpc;
  /** metas_equipe_realizado do mês corrente (empresa toda). */
  realizadoMes: RealizadoRpc;
  atividades: AtividadesRpc;
  padrao?: Partial<TaxasFunil> | null;
}): BaseMetasMes {
  const [ano, mes, dia] = e.hoje.split("-").map(Number);
  const previa = ano < ANO_PLANO;
  const funil = new Map(e.atividades.funil.map((f) => [f.user_id, f.respostas] as const));
  const admins = new Set(e.atividades.admins.map((a) => a.user_id));

  // Realizado do mês por pessoa: captação na aprovação; vendas em pontas (lados) na assinatura.
  const real = new Map<string, { r: PorLinha; vendas: Set<string> }>();
  const de = (u: string) => {
    let x = real.get(u);
    if (!x) real.set(u, (x = { r: zero(), vendas: new Set() }));
    return x;
  };
  for (const v of e.realizadoMes.vendas) {
    if (mesNoAno(v.venda_em, ano) !== mes) continue;
    const l = Math.max(0, n(v.lados));
    if (l <= 0) continue;
    const x = de(v.user_id);
    x.r.vendas += l;
    x.vendas.add(v.sale_id);
  }
  const capContada = new Set<string>();
  if (e.realizadoMes.captacoes_ligadas)
    for (const c of e.realizadoMes.captacoes) {
      if (capContada.has(c.capture_id) || mesNoAno(c.aprovada_em, ano) !== mes) continue;
      capContada.add(c.capture_id);
      de(c.user_id).r.captacoes += 1;
    }
  for (const a of e.atividades.atividades) {
    const x = de(a.user_id);
    x.r.v1 += a.v1;
    x.r.v2 += a.v2;
  }

  const pessoas: PessoaMetas[] = [];
  const vistos = new Set<string>();
  const add = (
    userId: string,
    nome: string | null,
    teamId: string | null,
    planoP: { tem: boolean; respostas: Respostas | null; assinadoEm: string | null } | null,
  ) => {
    if (vistos.has(userId)) return;
    vistos.add(userId);
    const admin = admins.has(userId);
    const situacao = situacaoPlano(
      planoP?.tem ? { respostas: planoP.respostas, assinadoEm: planoP.assinadoEm } : null,
    );
    const respostas = planoP?.tem
      ? { ...(funil.get(userId) ?? {}), ...(planoP.respostas ?? {}) }
      : null;
    let meta: PorLinha | null = null;
    let motivo: MotivoSemMeta | null = null;
    if (admin && REGRAS_METAS_MES.adminSemMeta) motivo = "admin";
    else if (situacao !== "assinado") motivo = situacao;
    else {
      meta = metaMesDoPlano(respostas, mes, e.padrao);
      if (!meta) motivo = "incompleto";
    }
    const r = real.get(userId);
    pessoas.push({
      userId,
      nome: nome?.trim() || "Sem nome",
      teamId,
      situacao,
      temMeta: meta != null,
      motivo: meta ? null : motivo,
      meta,
      real: r ? { ...r.r } : zero(),
      vendasIds: r ? [...r.vendas] : [],
      aConferir: !!planoP?.tem && conferirPlano(planoP.respostas, e.padrao).aConferir,
      admin,
    });
  };
  for (const p of e.planos.pessoas)
    add(p.user_id, p.nome, p.team_id, {
      tem: p.tem_plano,
      respostas: p.respostas,
      assinadoEm: p.assinado_em,
    });
  // Admin/dono entra no bloco só se produziu no mês ("admin que vende"); quem só administra não pesa na conta.
  const equipesIds = new Set(e.planos.equipes.map((t) => t.id));
  for (const a of e.atividades.admins) {
    if (vistos.has(a.user_id)) continue;
    const r = real.get(a.user_id);
    if (!r || !LINHAS.some((k) => r.r[k] > 0)) continue;
    add(a.user_id, a.nome, a.team_id && equipesIds.has(a.team_id) ? a.team_id : null, null);
  }
  // Produção de quem não está na lista (saiu da imobiliária, staff…): só no "fora da %" da empresa.
  const outros = { real: zero(), vendasIds: [] as string[] };
  const vendasOutros = new Set<string>();
  for (const [u, x] of real) {
    if (vistos.has(u)) continue;
    for (const k of LINHAS) outros.real[k] += x.r[k];
    x.vendas.forEach((s) => vendasOutros.add(s));
  }
  outros.vendasIds = [...vendasOutros];

  const equipes: EquipeMetas[] = [...e.planos.equipes]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((t) => ({ id: t.id, nome: t.nome, liderNome: t.lider_nome }));
  if (pessoas.some((p) => !p.teamId || !equipesIds.has(p.teamId)))
    equipes.push({ id: null, nome: "Sem equipe", liderNome: null });

  return {
    mes,
    hoje: e.hoje,
    previa,
    fracMes: dia / diasDoMes(ano, mes),
    captacoesLigadas: e.realizadoMes.captacoes_ligadas,
    moduloPlano: e.planos.modulo_plano,
    equipes,
    pessoas: pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    outros,
  };
}

// --- Filtro e soma ---------------------------------------------------------------------------------------------

export type Filtro =
  | { nivel: "empresa" }
  | { nivel: "equipe"; equipe: string | null }
  | { nivel: "corretor"; pessoa: string };

export type TomRitmo = "verde" | "amarelo" | "vermelho" | "sem_meta";
export const ROTULO_RITMO: Record<TomRitmo, string> = {
  verde: "no ritmo",
  amarelo: "um pouco abaixo",
  vermelho: "abaixo do ritmo",
  sem_meta: "sem meta",
};

export type LinhaMetas = {
  linha: Linha;
  /** null = ninguém do recorte tem meta. */
  meta: number | null;
  /** Realizado SÓ de quem tem meta (o que entra no %). Sem meta no recorte = realizado de todos. */
  real: number;
  falta: number | null;
  /** real ÷ meta (fração); null sem meta ou meta 0. */
  pct: number | null;
  /** pct ÷ fração do mês. */
  ritmo: number | null;
  tom: TomRitmo;
  /** Produção de quem não tem meta (fora da %). */
  fora: number;
  /** Só na linha Vendas: vendas assinadas (distintas) que somam as pontas de `real`. */
  vendasAssinadas?: number;
};

export type ResumoSemMeta = { qtd: number; porMotivo: Partial<Record<MotivoSemMeta, number>> };

export type MetasMes = {
  filtro: Filtro;
  /** Pessoas do recorte (ordem alfabética, sem ranking). */
  pessoas: PessoaMetas[];
  comMeta: number;
  total: number;
  linhas: LinhaMetas[];
  semMeta: ResumoSemMeta;
  /** Planos com valor a conferir que ENTRAM na soma (quem tem meta). */
  aConferir: { userId: string; nome: string }[];
  equipe: EquipeMetas | null;
};

export function tomRitmo(ritmo: number | null): TomRitmo {
  if (ritmo == null || !Number.isFinite(ritmo)) return "sem_meta";
  const r = Math.round(ritmo * 1e9) / 1e9;
  if (r >= REGRAS_METAS_MES.limiteVerde) return "verde";
  if (r >= REGRAS_METAS_MES.limiteAmarelo) return "amarelo";
  return "vermelho";
}

export function pessoasDoFiltro(b: BaseMetasMes, f: Filtro): PessoaMetas[] {
  if (f.nivel === "empresa") return b.pessoas;
  if (f.nivel === "equipe") {
    const ids = new Set(b.equipes.filter((t) => t.id).map((t) => t.id));
    return b.pessoas.filter((p) =>
      f.equipe == null ? !p.teamId || !ids.has(p.teamId) : p.teamId === f.equipe,
    );
  }
  return b.pessoas.filter((p) => p.userId === f.pessoa);
}

export function montarMetasMes(b: BaseMetasMes, f: Filtro): MetasMes {
  const pessoas = pessoasDoFiltro(b, f);
  const com = pessoas.filter((p) => p.temMeta);
  const sem = pessoas.filter((p) => !p.temMeta);
  const somar = (xs: PessoaMetas[], campo: "meta" | "real") => {
    const o = zero();
    for (const p of xs)
      for (const k of LINHAS) o[k] += (campo === "meta" ? p.meta?.[k] : p.real[k]) ?? 0;
    return o;
  };
  const meta = somar(com, "meta");
  const real = somar(com, "real");
  const fora = somar(sem, "real");
  const vendasCom = new Set(com.flatMap((p) => p.vendasIds));
  const vendasSem = new Set(sem.flatMap((p) => p.vendasIds));
  if (f.nivel === "empresa") {
    for (const k of LINHAS) fora[k] += b.outros.real[k];
    b.outros.vendasIds.forEach((s) => vendasSem.add(s));
  }
  const semMetaNoRecorte = com.length === 0;
  const linhas: LinhaMetas[] = LINHAS.filter((k) => k !== "captacoes" || b.captacoesLigadas).map(
    (k) => {
      if (semMetaNoRecorte) {
        // Ninguém com meta: mostra só o que foi feito ("X feitos · sem meta definida").
        return {
          linha: k,
          meta: null,
          real: fora[k],
          falta: null,
          pct: null,
          ritmo: null,
          tom: "sem_meta",
          fora: 0,
          ...(k === "vendas" ? { vendasAssinadas: vendasSem.size } : {}),
        };
      }
      const m = meta[k];
      const pct = m > 0 ? real[k] / m : null;
      const ritmo = pct == null ? null : b.fracMes > 0 ? pct / b.fracMes : null;
      return {
        linha: k,
        meta: m,
        real: real[k],
        falta: Math.max(0, m - real[k]),
        pct,
        ritmo,
        tom: m > 0 ? tomRitmo(ritmo) : "sem_meta",
        fora: fora[k],
        ...(k === "vendas" ? { vendasAssinadas: vendasCom.size } : {}),
      };
    },
  );
  const porMotivo: Partial<Record<MotivoSemMeta, number>> = {};
  for (const p of sem) if (p.motivo) porMotivo[p.motivo] = (porMotivo[p.motivo] ?? 0) + 1;
  const equipe =
    f.nivel === "equipe"
      ? (b.equipes.find((t) => t.id === f.equipe) ?? null)
      : f.nivel === "corretor"
        ? (b.equipes.find((t) => t.id === (pessoas[0]?.teamId ?? null)) ??
          b.equipes.find((t) => t.id == null) ??
          null)
        : null;
  return {
    filtro: f,
    pessoas,
    comMeta: com.length,
    total: pessoas.length,
    linhas,
    semMeta: { qtd: sem.length, porMotivo },
    aConferir: com.filter((p) => p.aConferir).map((p) => ({ userId: p.userId, nome: p.nome })),
    equipe,
  };
}

/** Texto "4 sem plano 2027 · 3 plano não assinado · 1 administrador (sem plano)". */
export function textoMotivos(s: ResumoSemMeta): string {
  return (Object.keys(ROTULO_MOTIVO) as MotivoSemMeta[])
    .filter((k) => s.porMotivo[k])
    .map((k) => `${s.porMotivo[k]} ${ROTULO_MOTIVO[k]}`)
    .join(" · ");
}
