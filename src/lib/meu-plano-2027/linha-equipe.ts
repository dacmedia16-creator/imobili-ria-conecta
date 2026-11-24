/**
 * Linha de cada pessoa na lista "Meu Plano 2027 — equipe" (t_adaaa240, Denis 24/11): leitura e regra ÚNICAS, usadas
 * pela tela de equipe (Equipe.tsx) e pelos rankings do painel de metas da imobiliária. As duas telas leem o plano
 * pelo mesmo caminho (carreira_plano_equipe + meta oficial gravada) e calculam a etiqueta pela mesma função, então
 * sempre mostram a mesma coisa. Só exibição: nada é gravado e nenhum cálculo de meta/realizado/farol muda aqui.
 */
import type { Respostas, TaxasFunil } from "@/lib/meu-plano-2027/regras";
import { ANO_PLANO, progresso } from "@/lib/meu-plano-2027/telas";
import { planoDb } from "@/lib/meu-plano-2027/modulo";
import { planoComSelo, type MetaOficialGravada, type SeloMeta } from "@/lib/metas-2027/consolidado";
import { bateSituacao, normalizarBusca, type SituacaoFiltro } from "./filtro-equipe";

/** Uma pessoa como vem de carreira_plano_equipe (+ meta oficial gravada lida à parte). */
export type MembroPlano = {
  user_id: string;
  nome: string;
  /** Legado: trilha escolhida antes do caminho único (o banco ainda devolve; o app não usa). */
  trilha: string | null;
  ativacao_inicio: string | null;
  respostas: Respostas;
  assinado_corretor_em: string | null;
  assinado_broker_em: string | null;
  meta_oficial_em: string | null;
  /** Lido à parte de carreira_plano (a RPC só devolve a data). */
  meta_oficial?: MetaOficialGravada | null;
  updated_at: string | null;
};

/** Situação do preenchimento mostrada ao lado do nome: "✅ assinado", "📝 em preenchimento" ou "não começou". */
export type EstadoPlano = "assinado" | "preenchendo" | "nao_comecou";
export const TEXTO_ESTADO: Record<EstadoPlano, string> = {
  assinado: "✅ assinado",
  preenchendo: "📝 em preenchimento",
  nao_comecou: "não começou",
};

export function estadoPlano(
  m: Pick<MembroPlano, "assinado_corretor_em" | "updated_at"> & { respostas: Respostas | null },
): EstadoPlano {
  if (m.assinado_corretor_em) return "assinado";
  return m.updated_at || Object.keys(m.respostas ?? {}).length ? "preenchendo" : "nao_comecou";
}

/**
 * Selo + progresso de uma pessoa. Mesma regra do somarPlanos e dos painéis de metas (seloMeta, t_91ec7aa3): conta
 * quem tem a meta oficial GRAVADA (botão verde ou assinatura), dentro do limite.
 */
export function linhaPlano(m: MembroPlano, padrao: Partial<TaxasFunil> | null) {
  const p = progresso(m.respostas);
  return {
    m,
    p,
    nome: m.nome,
    pct: p.pct,
    assinado: !!m.assinado_corretor_em,
    estado: estadoPlano(m),
    selo: planoComSelo(
      {
        assinadoEm: m.assinado_corretor_em,
        respostas: m.respostas,
        metaOficial: m.meta_oficial,
        metaOficialEm: m.meta_oficial_em,
      },
      padrao,
    ).selo as SeloMeta,
  };
}
export type LinhaPlano = ReturnType<typeof linhaPlano>;

/** Pessoa sem linha na lista (sem plano e sem papel de corretor): a mesma regra aplicada a "sem plano". */
export const linhaSemPlano = (user_id: string, nome: string): LinhaPlano =>
  linhaPlano(
    {
      user_id,
      nome,
      trilha: null,
      ativacao_inicio: null,
      respostas: {},
      assinado_corretor_em: null,
      assinado_broker_em: null,
      meta_oficial_em: null,
      meta_oficial: null,
      updated_at: null,
    },
    null,
  );

/** Taxas padrão (carreira_taxas da imobiliária) no formato que o planoComSelo espera. */
export const padraoDasTaxas = (t: TaxasFunil | null): Partial<TaxasFunil> | null => {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return t ? { v2cre: n(t.v2cre), v1v2: n(t.v1v2), folga: n(t.folga) } : null;
};

/**
 * Lê a lista da equipe como a tela "Meu Plano 2027 — equipe": carreira_plano_equipe (o banco decide quem aparece:
 * admin = imobiliária; gestor/TL = a equipe que lidera) + a meta oficial GRAVADA (t_bd480fee; a RLS de
 * carreira_plano deixa ler exatamente as mesmas pessoas). Erro = { erro } com a mensagem do banco.
 */
export async function lerPlanosEquipe(): Promise<
  { membros: MembroPlano[]; erro?: undefined } | { membros?: undefined; erro: string }
> {
  const [r, mo] = await Promise.all([
    planoDb.rpc("carreira_plano_equipe", { _ano: ANO_PLANO }),
    planoDb
      .from("carreira_plano")
      .select("user_id,meta_oficial")
      .eq("ano", ANO_PLANO)
      .not("meta_oficial", "is", null),
  ]);
  if (r.error || mo.error) return { erro: (r.error ?? mo.error)!.message ?? "" };
  const gravadas = new Map(
    ((mo.data ?? []) as { user_id: string; meta_oficial: MetaOficialGravada | null }[]).map(
      (x) => [x.user_id, x.meta_oficial] as const,
    ),
  );
  return {
    membros: ((r.data ?? []) as MembroPlano[]).map((m) => ({
      ...m,
      respostas: (m.respostas ?? {}) as Respostas,
      meta_oficial: gravadas.get(m.user_id) ?? null,
    })),
  };
}

// --- Ranking por equipe: resumo e filtro pelas mesmas etiquetas -----------------------------------------------

/** "N contam na meta · M sem meta oficial · K falta assinar" de um grupo (mesmas regras do filtro). */
export function resumoGrupo(linhas: readonly LinhaPlano[]) {
  const q = (s: SituacaoFiltro) => linhas.filter((l) => bateSituacao(l, s)).length;
  return {
    pessoas: linhas.length,
    contam: q("conta_meta"),
    semMeta: q("sem_meta"),
    faltaAssinar: q("falta_assinar"),
    assinados: q("assinado"),
  };
}

export function textoResumoGrupo(r: ReturnType<typeof resumoGrupo>): string {
  const partes = [`${r.contam}/${r.pessoas} contam na meta`, `${r.semMeta} sem meta oficial`];
  if (r.faltaAssinar) partes.push(`${r.faltaAssinar} falta assinar`);
  return partes.join(" · ");
}

/**
 * Equipe aparece no filtro quando o nome da equipe ou do líder bate com a busca (sem acento) E ao menos uma pessoa
 * da equipe está na situação escolhida. Mantém a ordem (a posição no ranking não muda).
 */
export function filtrarGrupos<T extends { nome: string; liderNome?: string | null }>(
  grupos: readonly T[],
  pessoasDe: (g: T) => readonly LinhaPlano[],
  busca: string,
  situacao: SituacaoFiltro,
): T[] {
  const termos = normalizarBusca(busca).split(" ").filter(Boolean);
  return grupos.filter((g) => {
    if (situacao !== "todos" && !pessoasDe(g).some((l) => bateSituacao(l, situacao))) return false;
    if (!termos.length) return true;
    const alvo = normalizarBusca(`${g.nome} ${g.liderNome ?? ""}`);
    return termos.every((t) => alvo.includes(t));
  });
}
