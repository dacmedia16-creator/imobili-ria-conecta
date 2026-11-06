import { describe, expect, it } from "vitest";
import { podeVerValorImobiliaria } from "@/lib/comissao-valor-imobiliaria";

// Denis 06/11: "broker, financeiro, admin continua vendo". Broker = Administrador principal
// (super_admin da organização) — não existe papel "broker" no sistema.
describe("Valor para a imobiliária na divisão de comissão — quem vê", () => {
  it.each([
    ["broker (Administrador principal)", ["super_admin"]],
    ["financeiro", ["financeiro"]],
    ["admin", ["admin"]],
    ["corretor que também é financeiro", ["corretor", "financeiro"]],
  ] as const)("%s vê", (_n, roles) => {
    expect(podeVerValorImobiliaria(roles)).toBe(true);
  });

  it.each([
    ["corretor", ["corretor"]],
    ["gestor", ["gestor"]],
    ["team leader", ["team_leader"]],
    ["jurídico", ["juridico"]],
    ["lançamento", ["lancamento"]],
    ["staff", ["staff"]],
    ["gestor + team leader", ["gestor", "team_leader"]],
    ["sem papel", []],
  ] as const)("%s NÃO vê", (_n, roles) => {
    expect(podeVerValorImobiliaria(roles)).toBe(false);
  });
});
