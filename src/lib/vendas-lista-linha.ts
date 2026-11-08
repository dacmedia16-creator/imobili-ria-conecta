// Regras puras da linha da lista de Vendas, compartilhadas pela tela Vendas e pelo cartão
// "Vendas recentes" do Início (t_e99f64cb): nomes, líder de cada corretor e "Sua vez".
import { proximoResponsavelRoles, type SaleStatus } from "@/lib/status";
import { corretoresDaLinha, responsaveisDaLinha } from "@/lib/sale-permissions";
import type { AppRole } from "@/lib/auth";

/** O mínimo que uma linha precisa ter para aparecer na lista de Vendas. */
export type LinhaListaVendas = {
  id: string;
  status: string;
  valor_negociado: number | null;
  imovel_id: string | null;
  codigo_interno: string | null;
  corretor_id: string;
  modalidade: string;
  created_at: string;
  data_assinatura: string | null;
  /** Data oficial da venda (assinatura ou criação); null quando a leitura falhou. */
  data_venda: string | null;
  corretores_ids?: string[] | null;
  pagamento_tipo?: string | null;
  pagamento_banco?: string | null;
  pagamento_correspondente?: string | null;
  pagamento_oba?: boolean | null;
};

/** Papéis que enxergam vendas de várias equipes e por isso veem a coluna Gestor/Líder. */
export const PAPEIS_COLUNA_LIDER: AppRole[] = ["juridico", "admin", "super_admin", "financeiro"];

export function codigoDaVenda(s: Pick<LinhaListaVendas, "id" | "imovel_id" | "codigo_interno">) {
  return s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`;
}

/** Nomes dos corretores participantes (não de quem cadastrou a venda). */
export function nomesCorretores(
  s: Pick<LinhaListaVendas, "corretor_id" | "corretores_ids">,
  profileName: Record<string, string>,
): string {
  return corretoresDaLinha(s)
    .map((id) => profileName[id] ?? "—")
    .join(", ");
}

export function nomesLideres(
  s: Pick<LinhaListaVendas, "corretor_id" | "corretores_ids">,
  profileName: Record<string, string>,
  liderIdByCorretor: Record<string, string>,
): string {
  const ids = [
    ...new Set(
      corretoresDaLinha(s)
        .map((id) => liderIdByCorretor[id])
        .filter(Boolean),
    ),
  ];
  return ids.map((id) => profileName[id] ?? "—").join(", ");
}

type Equipe = { id: string; lider_id: string | null };

/**
 * Corretor → líder da equipe (membro, líder ou líder auxiliar) — pra mostrar de qual
 * gestor/team_leader cada corretor é na coluna "Gestor/Líder", já que quem vê vendas de várias
 * equipes ao mesmo tempo (jurídico/financeiro/admin) não tem como saber isso de cabeça.
 */
export function mapaLiderPorCorretor(
  teams: Equipe[],
  members: { membro_id: string; team_id: string }[],
  coLeaders: { user_id: string; team_id: string }[],
): Record<string, string> {
  const byId: Record<string, Equipe> = {};
  teams.forEach((t) => {
    byId[t.id] = t;
  });
  const teamIdByCorretor: Record<string, string> = {};
  members.forEach((m) => {
    if (!teamIdByCorretor[m.membro_id]) teamIdByCorretor[m.membro_id] = m.team_id;
  });
  teams.forEach((t) => {
    if (t.lider_id && !teamIdByCorretor[t.lider_id]) teamIdByCorretor[t.lider_id] = t.id;
  });
  coLeaders.forEach((c) => {
    if (!teamIdByCorretor[c.user_id]) teamIdByCorretor[c.user_id] = c.team_id;
  });
  const liderByCorretor: Record<string, string> = {};
  for (const [corretorId, teamId] of Object.entries(teamIdByCorretor)) {
    const liderId = byId[teamId]?.lider_id;
    if (liderId) liderByCorretor[corretorId] = liderId;
  }
  return liderByCorretor;
}

/**
 * "Sua vez" da linha. admin/super_admin enxerga tudo por definição — "Sua vez" é pra quem tem uma
 * fila operacional de verdade, não pra quem só está supervisionando o sistema.
 */
export function vendaEhMinhaVez(
  s: Pick<LinhaListaVendas, "status" | "corretor_id" | "modalidade" | "corretores_ids">,
  ctx: {
    userId: string | undefined;
    hasAny: (roles: AppRole[]) => boolean;
    teamIds: Set<string>;
  },
): boolean {
  const { userId, hasAny, teamIds } = ctx;
  if (hasAny(["admin", "super_admin"])) return false;
  return proximoResponsavelRoles(s.status as SaleStatus).some((papel) =>
    papel === "corretor"
      ? !!userId && responsaveisDaLinha(s).includes(userId)
      : // gestor/team_leader só é "a vez dele" se ele lidera o corretor da venda — sem esse filtro,
        // quem também é jurídico/financeiro (e por isso enxerga vendas de times que não lidera) via
        // o badge acender pra toda venda parada numa etapa do gestor, mesmo fora da própria equipe.
        // "Corretor da venda" = participantes, não quem cadastrou.
        papel === "gestor"
        ? hasAny(["gestor", "team_leader"]) && responsaveisDaLinha(s).some((id) => teamIds.has(id))
        : hasAny([papel]),
  );
}
