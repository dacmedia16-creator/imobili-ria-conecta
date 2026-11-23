/**
 * Painel de metas 2027 do GESTOR / BROKER / TEAM LEADER (cartão t_863b7590, etapa 3). Puro, sem banco.
 *
 * Só junta o que a tela carrega e chama a regra única (regra.ts, realizado.ts, consolidado.ts). A tela NÃO faz
 * conta: mostra o que sai de montarPainelGestor().
 *
 * Fontes (o banco já devolve só o que quem chama pode ver):
 * - metas_equipe_planos: pessoas do escopo, equipe vigente e o plano de cada uma (só as respostas da meta);
 * - metas_equipe_realizado: realizado venda a venda (1 linha por pessoa e venda) + captações aprovadas;
 * - carreira_anotacoes (RLS, só leitura): últimas anotações de cada corretor.
 *
 * Regras (Denis, 19–20/11):
 * - meta só do plano ASSINADO; a soma dos planos em preenchimento aparece separada e não entra no farol;
 * - meta do mês = distribuição mês a mês do plano; comissão = meta principal (manda no farol);
 * - venda conta na assinatura (dia de SP);
 * - equipe: comissão = soma da parte de cada pessoa; VGV = 1 vez por venda (venda dividida não conta 2 vezes);
 *   vendas = LADOS das pessoas (captou = 1, vendeu = 1), a mesma unidade da meta "transações" do plano e a mesma
 *   do painel do corretor; captação = 1 por captação aprovada, para o captador original;
 * - cobertura: corretores ativos + gestor/TL que vendem (têm plano ou venda nos últimos 12 meses).
 */
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import { num, ok, type Respostas, type TaxasFunil } from "@/lib/meu-plano-2027/regras";
import { conferirPlano } from "@/lib/meu-plano-2027/conferencia";
import {
  avaliar,
  INDICADORES,
  metaDoPlano,
  posicaoNoAno,
  situacaoPlano,
  somaMeses,
  type Avaliacao,
  type FarolMeta,
  type MetaPlano,
  type Posicao,
  type SituacaoPlano,
  type Valores,
} from "./regra";
import {
  mesNoAno,
  realizadoMensal,
  type CaptacaoAprovada,
  type ParticipacaoVenda,
} from "./realizado";
import {
  avaliarGrupo,
  avaliarPessoa,
  coberturaPlanos,
  contaNaCobertura,
  contaNaMeta,
  planoComSelo,
  somarPlanos,
  type MetaOficialGravada,
  type SeloMeta,
  type Cobertura,
  type PessoaCobertura,
  type SomaPlanos,
} from "./consolidado";

// --- O que o banco devolve -------------------------------------------------------------------------------

/**
 * Respostas que a conta da meta usa (metaDoPlano → calc + tabelasMes). metas_respostas_meta() no banco devolve
 * só estas chaves. Despesas pessoais nunca saem item a item: quando a conta precisa delas (transações ou novas
 * captações em branco), saem só as SOMAS (op.0, on.0, so.0.v), que dão a mesma meta.
 * O teste painel-gestor.test.ts confere que a meta sai igual à do plano inteiro.
 */
export const CHAVES_META =
  /^(mt\.(tCapt|tVenda|comMedia|novas)|mt\.mes\.(novas|tcapt|tvenda|com)\.([1-9]|1[0-2])|m\.(ticket|pct)|d\.ticket)$/;
/** Só quando faltam transações ou novas captações (a conta passa pelo estilo de vida e pela conversão). */
export const CHAVES_SE_PRECISA = /^(m\.(faixa|conv)|d\.conv|es\.aliq)$/;
const SOMAS_DESPESA: [string, RegExp][] = [
  ["op.0", /^op\.[0-7]$/],
  ["on.0", /^on\.[0-5]$/],
  ["so.0.v", /^so\.[0-2]\.v$/],
];

/** Espelho de metas_respostas_meta() (usado nos testes). */
export function respostasDaMeta(r: Respostas | null | undefined): Respostas {
  const s = r ?? {};
  const precisa = ["mt.tCapt", "mt.tVenda", "mt.novas"].some((k) => !ok(num(s[k])));
  const out: Respostas = {};
  for (const [k, v] of Object.entries(s))
    if (CHAVES_META.test(k) || (precisa && CHAVES_SE_PRECISA.test(k))) out[k] = v;
  if (precisa)
    for (const [chave, re] of SOMAS_DESPESA) {
      const xs = Object.entries(s)
        .filter(([k]) => re.test(k))
        .map(([, v]) => num(v))
        .filter(ok);
      if (xs.length) out[chave] = xs.reduce((t, x) => t + x, 0);
    }
  return out;
}

export type EquipeRpc = {
  id: string;
  nome: string;
  lider_id: string | null;
  lider_nome: string | null;
};
export type PessoaRpc = {
  user_id: string;
  nome: string | null;
  avatar_url?: string | null;
  team_id: string | null;
  papeis: string[] | null;
  tem_plano: boolean;
  respostas: Respostas | null;
  assinado_em: string | null;
  /** Meta oficial gravada pelo clique "Usar como minha meta oficial" (t_bd480fee); ausente no banco antigo. */
  meta_oficial?: MetaOficialGravada | null;
  meta_oficial_em?: string | null;
};
export type PlanosRpc = {
  todas: boolean;
  modulo_plano: boolean;
  equipes: EquipeRpc[];
  pessoas: PessoaRpc[];
};
export type VendaRpc = {
  sale_id: string;
  user_id: string;
  venda_em: string;
  comissao: number;
  vgv: number;
  lados: number;
  /** false = só coordenador de lançamento nesta venda (não conta para a equipe, como participacoes_comerciais_validas). */
  conta_equipe?: boolean;
  /** true = a pessoa é captador ou vendedor (ponta) desta venda. */
  ponta?: boolean;
};
export type CaptacaoRpc = { capture_id: string; user_id: string; aprovada_em: string };
export type RealizadoRpc = {
  captacoes_ligadas: boolean;
  vendas: VendaRpc[];
  captacoes: CaptacaoRpc[];
};
export type AnotacaoLida = {
  id: string;
  user_id: string;
  texto: string;
  proximo_passo: string | null;
  proximo_passo_em: string | null;
  created_at: string;
};

// --- Saída -----------------------------------------------------------------------------------------------

export type CartaoCorretor = {
  userId: string;
  nome: string;
  teamId: string | null;
  situacao: SituacaoPlano;
  /** Conta na meta? Mesma regra do selo da Equipe do Meu Plano (consolidado.ts seloMeta). */
  selo: SeloMeta;
  avaliacao: Avaliacao;
  /** Realizado do ano que a tela mostra (ano do plano; antes de 2027, o ano corrente). */
  realizadoAno: Valores;
  anotacoes: AnotacaoLida[];
  diasSemVender: number | null;
  diasSemCaptar: number | null;
  /** Entra na contagem de planos (corretor ativo ou gestor/TL que vende). */
  elegivel: boolean;
  /** Dados para coberturaPlanos (papéis e se vende). */
  cobertura: PessoaCobertura;
  /**
   * "Plano com valor a conferir" (t_125c4dd3): algum valor da meta fora da faixa (conferirPlano). Só marca: o plano
   * continua na soma e no farol como antes.
   */
  aConferir: boolean;
};

/** Produção de quem NÃO tem plano assinado (fora da meta e do farol). */
export type ProducaoNaoAssinados = {
  /** Pessoas sem plano assinado com alguma venda ou captação no período (imobiliária: inclui quem já saiu). */
  pessoas: number;
  /** = realizadoTodos − realizadoAno (as duas partes sempre fecham com o total). */
  realizado: Valores;
};

export type GrupoPainel = {
  /** id da equipe; null = pessoas sem equipe. */
  id: string | null;
  nome: string;
  liderNome: string | null;
  soma: SomaPlanos;
  /** Meta (soma dos assinados) × realizado SÓ de quem assinou (Opção A, Denis 20/11). */
  avaliacao: Avaliacao;
  /**
   * Realizado do ano SÓ de quem tem plano assinado: é o que se compara com a meta (%, ritmo, falta, farol).
   * Venda dividida entre quem assinou e quem não assinou: VGV inteiro 1 vez aqui; comissão/lados de cada um na sua parte.
   */
  realizadoAno: Valores;
  /** Mês a mês de realizadoAno (gráfico da imobiliária). */
  mesesAssinados: Valores[];
  /** Realizado do grupo inteiro (assinados + não assinados; imobiliária: inclui quem já saiu). */
  realizadoTodos: Valores;
  /** Mês a mês de realizadoTodos. */
  mesesTodos: Valores[];
  naoAssinados: ProducaoNaoAssinados;
  cobertura: Cobertura;
  pessoas: CartaoCorretor[];
  /** Planos com valor a conferir (assinados e em preenchimento), já incluídos nas somas. */
  aConferir: { assinados: number; preenchimento: number; nomes: string[] };
  /**
   * Metas oficiais GRAVADAS fora dos limites de bloqueio (t_91ec7aa3, Denis 23/11): FORA da soma, à parte.
   * `comissao` = soma da meta de comissão delas (só informa).
   */
  metaAConferir: { nomes: string[]; comissao: number | null };
  /** Sem meta gravada e com meta CALCULADA acima dos limites: fora da soma "Sem meta oficial", à parte. */
  preenchimentoAConferir: { nomes: string[]; comissao: number | null };
};

export type AlertaParado = {
  userId: string;
  nome: string;
  equipe: string;
  diasSemVender: number | null;
  diasSemCaptar: number | null;
  /** Dias desde a última venda OU captação (o que for mais recente); null = nenhuma nos últimos 12 meses. */
  diasParado: number | null;
};

export type PainelGestor = {
  pos: Posicao;
  /** Ano dos números de realizado (2027; antes de jan/2027, o ano corrente). */
  anoDados: number;
  todas: boolean;
  moduloPlano: boolean;
  captacoesLigadas: boolean;
  grupos: GrupoPainel[];
  /** Total do que a pessoa vê (todas as equipes do escopo). */
  total: GrupoPainel;
  alertas: AlertaParado[];
};

// --- Contas ----------------------------------------------------------------------------------------------

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 864e5);

/**
 * Realizado mês a mês de um grupo de pessoas (ou de 1 pessoa). Comissão soma a parte de cada pessoa; VGV conta
 * 1 vez por venda; vendas = soma dos LADOS das pessoas do grupo; captações pela data de aprovação.
 * `pessoas` null = todo mundo das listas (total da imobiliária para o broker).
 * `grupo` = soma de equipe/imobiliária: a linha de quem é só coordenador de lançamento fica fora (mesma regra de
 * participacoes_comerciais_validas); a pessoa sozinha conta tudo, como meu_realizado.
 */
export function realizadoDoGrupo(
  real: Pick<RealizadoRpc, "vendas" | "captacoes" | "captacoes_ligadas">,
  pessoas: ReadonlySet<string> | null,
  ano: number,
  grupo = false,
): Valores[] {
  const vendas = grupo ? real.vendas.filter((v) => v.conta_equipe !== false) : real.vendas;
  const conta = (u: string) => !pessoas || pessoas.has(u);
  const linhas: ParticipacaoVenda[] = vendas.map((v) => ({
    saleId: v.sale_id,
    userId: v.user_id,
    assinadaEm: v.venda_em,
    comissao: n(v.comissao),
    vgv: n(v.vgv),
  }));
  const caps: CaptacaoAprovada[] = real.captacoes.map((c) => ({
    captureId: c.capture_id,
    userId: c.user_id,
    aprovadaEm: c.aprovada_em,
  }));
  // Conjunto vazio = ninguém (realizadoMensal trata vazio como "todos").
  if (pessoas && pessoas.size === 0)
    return realizadoMensal([], [], ano, null, real.captacoes_ligadas);
  const meses = realizadoMensal(linhas, caps, ano, pessoas, real.captacoes_ligadas);
  for (const m of meses) m.vendas = 0;
  for (const v of vendas) {
    if (!conta(v.user_id)) continue;
    const mes = mesNoAno(v.venda_em, ano);
    if (mes != null) meses[mes - 1].vendas = (meses[mes - 1].vendas ?? 0) + Math.max(0, n(v.lados));
  }
  return meses;
}

/** Soma do ano até o mês da posição (o que a tela mostra como "realizado no ano"). */
function totalAte(meses: Valores[], ate: number): Valores {
  const out = {} as Valores;
  for (const k of INDICADORES) out[k] = somaMeses(meses, k, ate);
  return out;
}

/** a − b por indicador (null fica null: ex.: captações com o módulo desligado). */
function menos(a: Valores, b: Valores): Valores {
  const out = {} as Valores;
  for (const k of INDICADORES) {
    const x = a[k];
    out[k] = x == null ? null : Math.round((x - (b[k] ?? 0)) * 100) / 100;
  }
  return out;
}

/** Mês a mês a − b. */
const menosMeses = (a: Valores[], b: Valores[]) => a.map((m, i) => menos(m, b[i]));

/**
 * Quantas pessoas FORA de `assinados` têm venda (que conta para a equipe) ou captação no ano, até o mês `ate`.
 * `pessoas` null = imobiliária inteira (inclui quem já saiu).
 */
function pessoasComProducao(
  real: Pick<RealizadoRpc, "vendas" | "captacoes" | "captacoes_ligadas">,
  pessoas: ReadonlySet<string> | null,
  assinados: ReadonlySet<string>,
  ano: number,
  ate: number,
): number {
  const conta = (u: string) => (!pessoas || pessoas.has(u)) && !assinados.has(u);
  const no = (d: string) => {
    const m = mesNoAno(d, ano);
    return m != null && m <= ate;
  };
  const xs = new Set<string>();
  for (const v of real.vendas)
    if (v.conta_equipe !== false && conta(v.user_id) && no(v.venda_em)) xs.add(v.user_id);
  if (real.captacoes_ligadas)
    for (const c of real.captacoes) if (conta(c.user_id) && no(c.aprovada_em)) xs.add(c.user_id);
  return xs.size;
}

/** Última data (aaaa-mm-dd) de venda (só como captador/vendedor) e de captação de cada pessoa. */
function ultimas(real: Pick<RealizadoRpc, "vendas" | "captacoes">) {
  const venda = new Map<string, string>();
  const capt = new Map<string, string>();
  const max = (m: Map<string, string>, k: string, d: string | null | undefined) => {
    const dd = d?.slice(0, 10);
    if (dd && (!m.has(k) || m.get(k)! < dd)) m.set(k, dd);
  };
  // Repasse de líder, indicação ou coordenação não é "vender": só conta a venda em que a pessoa é ponta.
  for (const v of real.vendas) if (v.ponta ?? n(v.lados) > 0) max(venda, v.user_id, v.venda_em);
  for (const c of real.captacoes) max(capt, c.user_id, c.aprovada_em);
  return { venda, capt };
}

const ORDEM_FAROL: Record<FarolMeta, number> = {
  vermelho: 0,
  amarelo: 1,
  verde: 2,
  aguardando: 3,
  cinza: 4,
};

export function montarPainelGestor(e: {
  hoje: string;
  planos: PlanosRpc;
  /** Realizado do ano dos dados (anoDadosDoPainel). */
  realizadoAno: RealizadoRpc;
  /** Realizado dos últimos 12 meses (alerta de quem está parado). */
  ultimos12: RealizadoRpc;
  anotacoes: readonly AnotacaoLida[];
  padrao?: Partial<TaxasFunil> | null;
  /** Quantas anotações por cartão (padrão 2). */
  anotacoesPorCartao?: number;
}): PainelGestor {
  const pos = posicaoNoAno(e.hoje);
  const anoDados = anoDadosDoPainel(e.hoje);
  const ateMes = pos.fase === "antes" ? Number(e.hoje.slice(5, 7)) : pos.mes;
  const nomeEquipe = new Map(e.planos.equipes.map((t) => [t.id, t] as const));
  const { venda: ultVenda, capt: ultCapt } = ultimas(e.ultimos12);
  const notasDe = new Map<string, AnotacaoLida[]>();
  for (const a of [...e.anotacoes].sort((x, y) => (x.created_at < y.created_at ? 1 : -1))) {
    const xs = notasDe.get(a.user_id) ?? [];
    if (xs.length < (e.anotacoesPorCartao ?? 2)) xs.push(a);
    notasDe.set(a.user_id, xs);
  }

  type Base = {
    p: PessoaRpc;
    situacao: SituacaoPlano;
    meta: MetaPlano | null;
    oficial: boolean;
    foraDoLimite: boolean;
    selo: SeloMeta;
    aConferir: boolean;
  };
  const vistos = new Set<string>();
  const base: Base[] = [];
  for (const p of e.planos.pessoas) {
    if (vistos.has(p.user_id)) continue;
    vistos.add(p.user_id);
    // Regra ÚNICA do selo (consolidado.ts): conta = meta oficial GRAVADA (valores gravados), assinado ou não.
    const x = p.tem_plano
      ? planoComSelo(
          {
            respostas: p.respostas,
            assinadoEm: p.assinado_em,
            metaOficial: p.meta_oficial,
            metaOficialEm: p.meta_oficial_em,
          },
          e.padrao,
        )
      : planoComSelo(null);
    base.push({
      p,
      ...x,
      aConferir: p.tem_plano && conferirPlano(p.respostas, e.padrao).aConferir,
    });
  }

  const cartao = ({ p, situacao, meta, selo, aConferir }: Base): CartaoCorretor => {
    const real = realizadoDoGrupo(e.realizadoAno, new Set([p.user_id]), anoDados);
    const papeis = p.papeis ?? [];
    const vende = situacao !== "sem_plano" || ultVenda.has(p.user_id) || ultCapt.has(p.user_id);
    // O banco só manda pessoas ativas. Gestor/TL "vende" se tem plano ou venda/captação nos últimos 12 meses.
    const pc: PessoaCobertura = { userId: p.user_id, ativo: true, papeis, vende };
    const uv = ultVenda.get(p.user_id);
    const uc = ultCapt.get(p.user_id);
    return {
      userId: p.user_id,
      nome: p.nome?.trim() || "Sem nome",
      teamId: p.team_id,
      situacao,
      selo,
      avaliacao: avaliarPessoa({ situacao, meta, selo }, real, pos),
      realizadoAno: totalAte(real, ateMes),
      anotacoes: notasDe.get(p.user_id) ?? [],
      diasSemVender: uv ? Math.max(0, diasEntre(uv, e.hoje)) : null,
      diasSemCaptar: uc ? Math.max(0, diasEntre(uc, e.hoje)) : null,
      elegivel: contaNaCobertura(pc),
      cobertura: pc,
      aConferir,
    };
  };

  const montarGrupo = (
    id: string | null,
    nome: string,
    liderNome: string | null,
    membros: Base[],
    todos = false,
  ): GrupoPainel => {
    const ids = new Set(membros.map((m) => m.p.user_id));
    const soma = somarPlanos(
      membros.map((m) => ({
        userId: m.p.user_id,
        situacao: m.situacao,
        meta: m.meta,
        oficial: m.oficial,
        foraDoLimite: m.foraDoLimite,
      })),
    );
    // Opção A (Denis 20/11): o realizado comparado com a meta é só de quem CONTA NA META (meta oficial gravada dentro
    // do limite, t_91ec7aa3), o ano inteiro dessa pessoa. O resto aparece à parte.
    const assinados = new Set(membros.filter((m) => contaNaMeta(m.selo)).map((m) => m.p.user_id));
    const todosMeses = realizadoDoGrupo(e.realizadoAno, todos ? null : ids, anoDados, true);
    const realAss = realizadoDoGrupo(e.realizadoAno, assinados, anoDados, true);
    const pessoas = membros
      .map(cartao)
      .sort(
        (a, b) =>
          ORDEM_FAROL[a.avaliacao.farol] - ORDEM_FAROL[b.avaliacao.farol] ||
          (a.avaliacao.indicadores.comissao.pctEsperado ?? 9) -
            (b.avaliacao.indicadores.comissao.pctEsperado ?? 9) ||
          a.nome.localeCompare(b.nome, "pt-BR"),
      );
    const situ = new Map(membros.map((m) => [m.p.user_id, m.situacao] as const));
    const cobertura = coberturaPlanos(
      pessoas.map((c) => c.cobertura),
      (u) => situ.get(u) ?? "sem_plano",
    );
    return {
      id,
      nome,
      liderNome,
      soma,
      avaliacao: avaliarGrupo(soma, realAss, pos),
      realizadoAno: totalAte(realAss, ateMes),
      mesesAssinados: realAss,
      realizadoTodos: totalAte(todosMeses, ateMes),
      mesesTodos: todosMeses,
      naoAssinados: {
        pessoas: pessoasComProducao(
          e.realizadoAno,
          todos ? null : ids,
          assinados,
          anoDados,
          ateMes,
        ),
        realizado: totalAte(menosMeses(todosMeses, realAss), ateMes),
      },
      cobertura,
      pessoas,
      aConferir: {
        assinados: pessoas.filter((c) => c.aConferir && c.situacao === "assinado").length,
        preenchimento: pessoas.filter((c) => c.aConferir && c.situacao === "preenchimento").length,
        nomes: pessoas.filter((c) => c.aConferir).map((c) => c.nome),
      },
      metaAConferir: {
        nomes: pessoas.filter((c) => c.selo === "meta_a_conferir").map((c) => c.nome),
        comissao: soma.aConferirAno.comissao,
      },
      preenchimentoAConferir: {
        nomes: pessoas
          .filter((c) => soma.preenchimentoAConferir.userIds.includes(c.userId))
          .map((c) => c.nome),
        comissao: soma.preenchimentoAConferir.ano.comissao,
      },
    };
  };

  const grupos: GrupoPainel[] = [];
  for (const t of [...e.planos.equipes].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))) {
    grupos.push(
      montarGrupo(
        t.id,
        t.nome,
        t.lider_nome,
        base.filter((b) => b.p.team_id === t.id),
      ),
    );
  }
  const semEquipe = base.filter((b) => !b.p.team_id || !nomeEquipe.has(b.p.team_id));
  if (semEquipe.length) grupos.push(montarGrupo(null, "Sem equipe", null, semEquipe));

  // Broker: o realizado da imobiliária inclui quem já saiu (o banco manda a imobiliária inteira); a meta é a
  // soma dos planos de quem está ativo.
  const total = montarGrupo(
    null,
    e.planos.todas ? "Imobiliária" : "Minha equipe",
    null,
    base,
    e.planos.todas,
  );

  const alertas: AlertaParado[] = total.pessoas
    .filter((c) => c.elegivel)
    .map((c) => {
      const dias = [c.diasSemVender, c.diasSemCaptar].filter((x): x is number => x != null);
      return {
        userId: c.userId,
        nome: c.nome,
        equipe: (c.teamId && nomeEquipe.get(c.teamId)?.nome) || "Sem equipe",
        diasSemVender: c.diasSemVender,
        diasSemCaptar: c.diasSemCaptar,
        diasParado: dias.length ? Math.min(...dias) : null,
      };
    })
    .sort(
      (a, b) =>
        (b.diasParado ?? Number.MAX_SAFE_INTEGER) - (a.diasParado ?? Number.MAX_SAFE_INTEGER) ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );

  return {
    pos,
    anoDados,
    todas: e.planos.todas,
    moduloPlano: e.planos.modulo_plano,
    captacoesLigadas: e.realizadoAno.captacoes_ligadas,
    grupos,
    total,
    alertas,
  };
}

/** Ano dos números de realizado: o do plano (2027) ou, antes dele, o ano corrente. */
export function anoDadosDoPainel(hoje: string): number {
  const a = Number(hoje.slice(0, 4));
  return a < ANO_PLANO ? a : ANO_PLANO;
}

/** Períodos que a tela pede ao banco: ano dos dados e últimos 12 meses (para o alerta de parado). */
export function periodosDoPainel(hoje: string) {
  const ano = anoDadosDoPainel(hoje);
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 365);
  return {
    ano: { inicio: `${ano}-01-01`, fim: `${ano}-12-31` },
    ultimos12: { inicio: d.toISOString().slice(0, 10), fim: hoje },
  };
}

/** Normaliza o JSON das RPCs (números podem vir como texto). */
export function normalizarRealizadoRpc(x: unknown): RealizadoRpc {
  const o = (x ?? {}) as Partial<RealizadoRpc>;
  return {
    captacoes_ligadas: !!o.captacoes_ligadas,
    vendas: (o.vendas ?? []).map((v) => ({
      ...v,
      comissao: n(v.comissao),
      vgv: n(v.vgv),
      lados: n(v.lados),
      conta_equipe: v.conta_equipe !== false,
      ponta: v.ponta == null ? n(v.lados) > 0 : !!v.ponta,
    })),
    captacoes: o.captacoes ?? [],
  };
}
export function normalizarPlanosRpc(x: unknown): PlanosRpc {
  const o = (x ?? {}) as Partial<PlanosRpc>;
  return {
    todas: !!o.todas,
    modulo_plano: !!o.modulo_plano,
    equipes: o.equipes ?? [],
    pessoas: (o.pessoas ?? []).map((p) => ({ ...p, papeis: p.papeis ?? [] })),
  };
}
