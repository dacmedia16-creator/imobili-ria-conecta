/** Campo "Equipe" do formulário Novo usuário (admin/super admin) — t_32d5dd75.
 * Mesma ordem e rótulo do agrupamento da tela de Usuários: equipe-mãe por nome, logo depois as
 * subequipes dela no formato "Mãe → Sub". */

export const SEM_EQUIPE = "__sem_equipe__";

export type EquipeBase = { id: string; nome: string; parent_team_id: string | null };

export function opcoesEquipeNovoUsuario(teams: EquipeBase[]): { id: string; label: string }[] {
  const tops = teams.filter((t) => !t.parent_team_id).sort((a, b) => a.nome.localeCompare(b.nome));
  const out: { id: string; label: string }[] = [];
  for (const top of tops) {
    out.push({ id: top.id, label: top.nome });
    teams
      .filter((t) => t.parent_team_id === top.id)
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .forEach((s) => out.push({ id: s.id, label: `${top.nome} → ${s.nome}` }));
  }
  return out;
}
