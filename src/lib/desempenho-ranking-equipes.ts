/**
 * Linhas do ranking "Por equipe" do Desempenho (RPC desempenho_ranking_periodo, migration 20261225120000,
 * t_fee0b359). Além das equipes, a RPC devolve:
 * - "sem_equipe": a parte de quem não tinha equipe na data da venda;
 * - "coordenacao_lancamento": a parte da coordenação de lançamento (pela regra, fica fora das equipes).
 * Com as duas, a soma das linhas fecha com a soma das pessoas (ranking por corretor).
 */
export type LinhaRankingEquipe = "equipe" | "sem_equipe" | "coordenacao_lancamento";

export type RankingEquipeRpc = {
  team_id: string | null;
  team_nome: string | null;
  linha?: LinhaRankingEquipe | null;
  vendas_fechadas: number;
  comissao: number;
  taxa_devolucao: number;
};

export const ID_SEM_EQUIPE = "sem-equipe";
export const ID_COORDENACAO_LANCAMENTO = "coordenacao-lancamento";

export const INFO_SEM_EQUIPE =
  "Parte de quem não tinha equipe na data da venda. Entra aqui para a soma das equipes fechar com a soma das pessoas.";
export const INFO_COORDENACAO_LANCAMENTO =
  "Parte da coordenação de lançamento. Pela regra, ela fica fora das equipes e aparece nesta linha própria.";
export const INFO_PREMIO_LANCAMENTO =
  "O prêmio de Lançamento fica à parte da comissão: é pago além dela e não entra nestes valores.";

/** Tipo da linha. Respostas antigas (sem `linha`) só traziam equipes reais. */
export function tipoLinhaEquipe(
  r: Pick<RankingEquipeRpc, "team_id" | "linha">,
): LinhaRankingEquipe {
  if (r.linha === "coordenacao_lancamento") return "coordenacao_lancamento";
  if (r.linha === "sem_equipe" || r.team_id == null) return "sem_equipe";
  return "equipe";
}

export function linhaRankingEquipe(r: RankingEquipeRpc): {
  id: string;
  nome: string;
  tipo: LinhaRankingEquipe;
  info?: string;
} {
  const tipo = tipoLinhaEquipe(r);
  if (tipo === "coordenacao_lancamento")
    return {
      id: ID_COORDENACAO_LANCAMENTO,
      nome: "Coordenação de lançamento",
      tipo,
      info: INFO_COORDENACAO_LANCAMENTO,
    };
  if (tipo === "sem_equipe")
    return { id: ID_SEM_EQUIPE, nome: r.team_nome ?? "Sem equipe", tipo, info: INFO_SEM_EQUIPE };
  return { id: r.team_id as string, nome: r.team_nome ?? "Equipe", tipo };
}
