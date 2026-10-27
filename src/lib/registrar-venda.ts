import type { AppRole } from "@/lib/auth";

export type RegistrarVendaAction = "nenhuma" | "venda_padrao" | "lancamento" | "escolher";

export function registrarVendaAction(roles: AppRole[]): RegistrarVendaAction {
  // Administrador e Administrador principal registram venda padrão desde 27/10/2026 (t_3c10bab8);
  // o banco confere na policy sales_insert_corretor. Lançamento continua só com o papel próprio.
  const podeVendaPadrao = roles.some((role) =>
    (["corretor", "gestor", "team_leader", "admin", "super_admin"] as AppRole[]).includes(role),
  );
  const podeLancamento = roles.includes("lancamento");

  if (podeVendaPadrao && podeLancamento) return "escolher";
  if (podeVendaPadrao) return "venda_padrao";
  if (podeLancamento) return "lancamento";
  return "nenhuma";
}
