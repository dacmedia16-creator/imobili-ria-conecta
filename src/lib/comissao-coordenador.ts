import { supabase } from "@/integrations/supabase/client";

/** Papéis que representam a comissão de QUEM SUPERVISIONA a venda (nunca uma venda própria) —
 * `lider_captador`/`lider_vendedor` (padrão, ligados a um captador/vendedor específico da mesma
 * ocorrência), `gestor`/`team_leader` (corte avulso, sem ligação com ninguém — ex.: Rafaela em
 * cima da equipe do Gustavo) e `coordenador_lancamento` (Lançamento). Todos geram sua própria
 * linha "(coordenação)" na seção da PRÓPRIA pessoa, nunca na de outra. */
const PAPEIS_COORDENACAO = new Set([
  "lider_captador",
  "lider_vendedor",
  "gestor",
  "team_leader",
  "coordenador_lancamento",
]);
const PAPEIS_MEMBRO = new Set(["corretor_captador", "corretor_vendedor"]);

export type LinhaComissaoCoordenador = {
  occurrence_id: string;
  modalidade: "padrao" | "lancamento";
  papel: string;
  user_id: string | null;
  nome: string | null;
  valor: number | string | null;
  sem_cadastro_confirmado: boolean;
};

/** true = tem o cargo na equipe (não confundir com `lider_*`, que é o vínculo NAQUELA venda). */
export type CargoPorUsuario = Record<string, { gestor: boolean; teamLeader: boolean }>;

export type ItemSecao = {
  occurrenceId: string;
  /** null = linha "(coordenação)" — comissão de supervisão, nunca conta como venda própria. */
  tipo: "coordenacao" | "membro";
  /** Nome de quem recebeu ESSA linha (o vendedor, ou o próprio coordenador na linha de coordenação). */
  nome: string;
  /** Só preenchido em linhas de coordenação — de quem é a venda que ele está supervisionando. */
  vendaDe: string | null;
  /** true = a própria pessoa vendeu (ela é gestor/team leader E é o vendedor da linha). */
  vendeuElaMesma: boolean;
  modalidade: "padrao" | "lancamento";
  valor: number;
};

export type Secao = {
  /** Chave de agrupamento: user_id (interno) ou nome (parceiro externo sem cadastro). */
  chave: string;
  nome: string;
  bloco: "AGENTES" | "TEAM_LEADERS";
  itens: ItemSecao[];
  subtotalComissao: number;
  subtotalVgv6pct: number;
  /** Fatia do subtotal que veio de linhas "(coordenação)" — supervisionando venda de outra pessoa. */
  subtotalComissaoCoordenacao: number;
  subtotalVgv6pctCoordenacao: number;
  /** Fatia do subtotal que veio de venda própria (papel corretor_captador/corretor_vendedor). */
  subtotalComissaoCorretor: number;
  subtotalVgv6pctCorretor: number;
};

export type RelatorioComissaoCoordenador = {
  secoes: Secao[];
  blocos: {
    bloco: "AGENTES" | "TEAM_LEADERS";
    comissao: number;
    vgv6pct: number;
    comissaoCoordenacao: number;
    vgv6pctCoordenacao: number;
    comissaoCorretor: number;
    vgv6pctCorretor: number;
  }[];
  totalComissao: number;
  totalVgv6pct: number;
};

const vgv6 = (valor: number) => Math.round((valor / 0.06) * 100) / 100;

/**
 * Agrupa as linhas brutas de `comissao_coordenador_dados()` na estrutura do relatório —
 * validada em várias rodadas de simulação com o usuário antes de virar código. Regras:
 *
 * 1. Pareamento (só decide de quem é a linha de "membro", corretor_captador/corretor_vendedor):
 *    - padrão: corretor_captador pareia com lider_captador da MESMA ocorrência; corretor_vendedor
 *      pareia com lider_vendedor.
 *    - lançamento: corretor_vendedor pareia com team_leader da mesma ocorrência (não existe
 *      captador em Lançamento).
 *    - Sem líder pareado: a própria pessoa vira "equipe dela mesma" (self-fallback) — nunca
 *      inventa um vínculo que não está gravado.
 * 2. Prioridade própria: se quem vendeu (`corretor_captador`/`corretor_vendedor`) É gestor ou
 *    team leader, a venda aparece NA SEÇÃO DELE(A), mesmo que outra pessoa tenha ganhado uma
 *    comissão de supervisão em cima da mesma venda (essa comissão de supervisão continua
 *    aparecendo, só que na seção de quem a recebeu, separada).
 * 3. Toda linha de coordenação (`lider_captador`, `lider_vendedor`, `gestor`, `team_leader`,
 *    `coordenador_lancamento`) sempre vira uma linha "(coordenação)" na seção da PRÓPRIA pessoa
 *    que a recebeu — nunca é escondida, mesmo quando é um corte avulso sem pareamento (ex.: um
 *    gestor com uma % em cima da equipe de um team leader).
 * 4. Bloco (AGENTES x TEAM LEADERS) é decidido pelo cargo da pessoa da seção: tem `team_leader` →
 *    TEAM LEADERS; senão (inclui `gestor` e corretor comum sem cargo, self-fallback) → AGENTES.
 */
export function agruparComissaoPorCoordenador(
  linhas: LinhaComissaoCoordenador[],
  cargos: CargoPorUsuario,
): RelatorioComissaoCoordenador {
  const porOcorrencia = new Map<string, LinhaComissaoCoordenador[]>();
  for (const l of linhas.filter((linha) => !linha.sem_cadastro_confirmado)) {
    const arr = porOcorrencia.get(l.occurrence_id) ?? [];
    arr.push(l);
    porOcorrencia.set(l.occurrence_id, arr);
  }

  const isTeamLeader = (userId: string | null) =>
    userId ? (cargos[userId]?.teamLeader ?? false) : false;
  const isGestorOuTL = (userId: string | null) =>
    userId ? cargos[userId]?.gestor || cargos[userId]?.teamLeader || false : false;
  const bloco = (userId: string | null): "AGENTES" | "TEAM_LEADERS" =>
    isTeamLeader(userId) ? "TEAM_LEADERS" : "AGENTES";
  // Chave estável por pessoa: user_id quando existe (interno), senão o nome (parceiro externo
  // sem cadastro — não some do relatório, só não tem cargo nem pode virar "vendeu ele mesmo").
  const chaveDe = (l: { user_id: string | null; nome: string | null }) =>
    l.user_id ?? l.nome ?? "sem cadastro";

  const secoesPorChave = new Map<string, Secao>();
  const getSecao = (chave: string, nome: string, blocoSecao: "AGENTES" | "TEAM_LEADERS") => {
    let s = secoesPorChave.get(chave);
    if (!s) {
      s = {
        chave,
        nome,
        bloco: blocoSecao,
        itens: [],
        subtotalComissao: 0,
        subtotalVgv6pct: 0,
        subtotalComissaoCoordenacao: 0,
        subtotalVgv6pctCoordenacao: 0,
        subtotalComissaoCorretor: 0,
        subtotalVgv6pctCorretor: 0,
      };
      secoesPorChave.set(chave, s);
    }
    return s;
  };

  for (const linhasOcc of porOcorrencia.values()) {
    const coordenacao = linhasOcc.filter((l) => PAPEIS_COORDENACAO.has(l.papel));
    const membros = linhasOcc.filter((l) => PAPEIS_MEMBRO.has(l.papel));

    // Mapa de pareamento: papel do membro -> papel do líder correspondente NAQUELA modalidade.
    const papelLiderDoMembro = (papelMembro: string, modalidade: "padrao" | "lancamento") => {
      if (modalidade === "lancamento") return "team_leader";
      return papelMembro === "corretor_captador" ? "lider_captador" : "lider_vendedor";
    };

    for (const m of membros) {
      const valor = Number(m.valor ?? 0);
      const vendedorEhLiderDeVerdade = isGestorOuTL(m.user_id);
      let dono: LinhaComissaoCoordenador | null = null;
      if (!vendedorEhLiderDeVerdade) {
        const papelLider = papelLiderDoMembro(m.papel, m.modalidade);
        dono = coordenacao.find((c) => c.papel === papelLider) ?? null;
      }
      const chave = vendedorEhLiderDeVerdade || !dono ? chaveDe(m) : chaveDe(dono);
      const nomeSecao =
        vendedorEhLiderDeVerdade || !dono
          ? (m.nome ?? "sem cadastro")
          : (dono.nome ?? "sem cadastro");
      const blocoSecao = vendedorEhLiderDeVerdade || !dono ? bloco(m.user_id) : bloco(dono.user_id);
      const secao = getSecao(chave, nomeSecao, blocoSecao);
      secao.itens.push({
        occurrenceId: m.occurrence_id,
        tipo: "membro",
        nome: m.nome ?? "sem cadastro",
        vendaDe: null,
        vendeuElaMesma: vendedorEhLiderDeVerdade || !dono,
        modalidade: m.modalidade,
        valor,
      });
      secao.subtotalComissao += valor;
      secao.subtotalVgv6pct += vgv6(valor);
      secao.subtotalComissaoCorretor += valor;
      secao.subtotalVgv6pctCorretor += vgv6(valor);
    }

    for (const c of coordenacao) {
      const valor = Number(c.valor ?? 0);
      const chave = chaveDe(c);
      const secao = getSecao(chave, c.nome ?? "sem cadastro", bloco(c.user_id));
      // "venda de quem" — só informativo: o membro pareado com esse MESMO papel/ocorrência, se
      // houver (uma linha de coordenação sem pareamento, tipo um corte avulso de gestor, some
      // esse texto mas continua aparecendo com o valor dela).
      const membroPareado = membros.find(
        (m) => papelLiderDoMembro(m.papel, m.modalidade) === c.papel && !isGestorOuTL(m.user_id),
      );
      secao.itens.push({
        occurrenceId: c.occurrence_id,
        tipo: "coordenacao",
        nome: c.nome ?? "sem cadastro",
        vendaDe: membroPareado?.nome ?? null,
        vendeuElaMesma: false,
        modalidade: c.modalidade,
        valor,
      });
      secao.subtotalComissao += valor;
      secao.subtotalVgv6pct += vgv6(valor);
      secao.subtotalComissaoCoordenacao += valor;
      secao.subtotalVgv6pctCoordenacao += vgv6(valor);
    }
  }

  // Uma pessoa que é captador E vendedor da MESMA ocorrência (o caso mais comum — corretor sem
  // parceiro na venda) gera 2 linhas de "membro" ali em cima, uma pra cada papel. Junta as duas
  // numa só pra exibição — é a mesma venda, não duas — mantendo separado quando são pessoas
  // diferentes (venda dividida) ou ocorrências diferentes.
  for (const secao of secoesPorChave.values()) {
    const membrosMesclados = new Map<string, ItemSecao>();
    const outros: ItemSecao[] = [];
    for (const item of secao.itens) {
      if (item.tipo !== "membro") {
        outros.push(item);
        continue;
      }
      const k = `${item.occurrenceId}::${item.nome}`;
      const existente = membrosMesclados.get(k);
      if (existente) existente.valor += item.valor;
      else membrosMesclados.set(k, { ...item });
    }
    secao.itens = [...outros, ...membrosMesclados.values()];
  }

  const secoes = [...secoesPorChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const blocosMap = new Map<
    "AGENTES" | "TEAM_LEADERS",
    {
      comissao: number;
      vgv6pct: number;
      comissaoCoordenacao: number;
      vgv6pctCoordenacao: number;
      comissaoCorretor: number;
      vgv6pctCorretor: number;
    }
  >();
  for (const s of secoes) {
    const acc = blocosMap.get(s.bloco) ?? {
      comissao: 0,
      vgv6pct: 0,
      comissaoCoordenacao: 0,
      vgv6pctCoordenacao: 0,
      comissaoCorretor: 0,
      vgv6pctCorretor: 0,
    };
    acc.comissao += s.subtotalComissao;
    acc.vgv6pct += s.subtotalVgv6pct;
    acc.comissaoCoordenacao += s.subtotalComissaoCoordenacao;
    acc.vgv6pctCoordenacao += s.subtotalVgv6pctCoordenacao;
    acc.comissaoCorretor += s.subtotalComissaoCorretor;
    acc.vgv6pctCorretor += s.subtotalVgv6pctCorretor;
    blocosMap.set(s.bloco, acc);
  }
  const blocos = (["AGENTES", "TEAM_LEADERS"] as const)
    .filter((b) => blocosMap.has(b))
    .map((b) => ({ bloco: b, ...blocosMap.get(b)! }));

  return {
    secoes,
    blocos,
    totalComissao: blocos.reduce((s, b) => s + b.comissao, 0),
    totalVgv6pct: blocos.reduce((s, b) => s + b.vgv6pct, 0),
  };
}

/** Busca os dados do mês (RPC) + os cargos (gestor/team_leader) de todo mundo que aparece nas
 * linhas, e já devolve agrupado. `p_mes` no formato "YYYY-MM-01". */
export async function fetchComissaoPorCoordenador(
  mesIso: string,
): Promise<RelatorioComissaoCoordenador> {
  const { data, error } = await supabase.rpc("comissao_coordenador_dados", { p_mes: mesIso });
  if (error) throw error;
  const linhas = (data ?? []) as LinhaComissaoCoordenador[];
  const ids = [...new Set(linhas.map((l) => l.user_id).filter((id): id is string => !!id))];
  const cargos: CargoPorUsuario = {};
  if (ids.length > 0) {
    const { data: roles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", ids)
      .in("role", ["gestor", "team_leader"]);
    if (rolesErr) throw rolesErr;
    for (const r of roles ?? []) {
      const c = cargos[r.user_id] ?? { gestor: false, teamLeader: false };
      if (r.role === "gestor") c.gestor = true;
      if (r.role === "team_leader") c.teamLeader = true;
      cargos[r.user_id] = c;
    }
  }
  return agruparComissaoPorCoordenador(linhas, cargos);
}
