/**
 * Busca por nome + filtro por situação da lista "Planos 2027 · equipe" (t_8960c522, Denis 24/11).
 * Só exibição: não muda cálculo, permissão nem os contadores do topo (que seguem mostrando o total).
 * Os estados vêm do que a tela já calcula: progresso() (% e telas), assinatura do corretor e o selo da meta
 * (planoComSelo/seloMeta, a mesma regra do "X de N já contam na meta").
 */
import { contaNaMeta, type SeloMeta } from "@/lib/metas-2027/consolidado";

export type SituacaoFiltro =
  | "todos"
  | "nao_comecou"
  | "preenchendo"
  | "falta_assinar"
  | "assinado"
  | "conta_meta"
  | "sem_meta"
  | "a_conferir";

export const OPCOES_SITUACAO: { id: SituacaoFiltro; texto: string }[] = [
  { id: "todos", texto: "Todos" },
  { id: "nao_comecou", texto: "Não começou" },
  { id: "preenchendo", texto: "Preenchendo" },
  { id: "falta_assinar", texto: "Falta assinar" },
  { id: "assinado", texto: "Assinado" },
  { id: "conta_meta", texto: "Conta na meta" },
  { id: "sem_meta", texto: "Sem meta oficial" },
  { id: "a_conferir", texto: "Valor a conferir" },
];

export type LinhaFiltro = {
  nome: string;
  /** % de preenchimento (progresso().pct). 0 = não começou (mesma conta do contador "começaram"). */
  pct: number;
  assinado: boolean;
  selo: SeloMeta;
};

/** Minúsculas, sem acento e sem espaço sobrando: "  PÉREZ " → "perez". */
export const normalizarBusca = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function bateSituacao(l: LinhaFiltro, s: SituacaoFiltro): boolean {
  switch (s) {
    case "todos":
      return true;
    case "nao_comecou":
      return l.pct <= 0;
    case "preenchendo":
      return l.pct > 0 && !l.assinado;
    // Meta oficial gravada (já conta na meta), mas o corretor ainda não assinou o pacto.
    case "falta_assinar":
      return l.selo === "conta_falta_assinar";
    case "assinado":
      return l.assinado;
    case "conta_meta":
      return contaNaMeta(l.selo);
    case "sem_meta":
      return l.selo === "falta_meta" || l.selo === "assinado_sem_meta";
    case "a_conferir":
      return l.selo === "meta_a_conferir";
  }
}

/** Busca (cada palavra digitada precisa aparecer no nome) E situação. Mantém a ordem original. */
export function filtrarEquipe<T extends LinhaFiltro>(
  linhas: readonly T[],
  busca: string,
  situacao: SituacaoFiltro,
): T[] {
  const termos = normalizarBusca(busca).split(" ").filter(Boolean);
  return linhas.filter((l) => {
    if (!bateSituacao(l, situacao)) return false;
    if (!termos.length) return true;
    const nome = normalizarBusca(l.nome);
    return termos.every((t) => nome.includes(t));
  });
}

/** Quantas pessoas em cada situação (sobre o total, sem a busca), para mostrar no seletor. */
export function contarSituacoes(linhas: readonly LinhaFiltro[]): Record<SituacaoFiltro, number> {
  const r = {} as Record<SituacaoFiltro, number>;
  for (const o of OPCOES_SITUACAO) r[o.id] = linhas.filter((l) => bateSituacao(l, o.id)).length;
  return r;
}
