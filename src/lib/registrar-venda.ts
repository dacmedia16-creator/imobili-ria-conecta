import type { AppRole } from "@/lib/auth";

export type RegistrarVendaAction = "nenhuma" | "venda_padrao" | "lancamento" | "escolher";

export function registrarVendaAction(roles: AppRole[]): RegistrarVendaAction {
  const podeVendaPadrao = roles.some((role) =>
    (["corretor", "gestor", "team_leader"] as AppRole[]).includes(role),
  );
  const podeLancamento = roles.includes("lancamento");

  if (podeVendaPadrao && podeLancamento) return "escolher";
  if (podeVendaPadrao) return "venda_padrao";
  if (podeLancamento) return "lancamento";
  return "nenhuma";
}
