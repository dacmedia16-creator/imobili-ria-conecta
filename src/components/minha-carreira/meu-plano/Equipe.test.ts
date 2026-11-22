// @vitest-environment jsdom
/**
 * Planos 2027 · Preenchimento (t_889fb3c1): o admin/dono chega à lista pelo menu Equipe, sem passar por
 * "Minha carreira". A lista mostra a % de preenchimento de cada pessoa (mesma conta de progresso()).
 * Quem vê o quê é decidido no banco (carreira_plano_equipe + meu_plano_eh_broker).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";

const rpc = vi.fn();
const taxas = {
  select: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
};
vi.mock("@/lib/meu-plano-2027/modulo", async (orig) => ({
  ...(await orig<typeof import("@/lib/meu-plano-2027/modulo")>()),
  planoDb: { rpc: (...a: unknown[]) => rpc(...a), from: () => taxas },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "admin-1" }, roles: ["admin"] }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EquipePlano } from "./Equipe";
import { ehBroker, ehLider, veImobiliaria } from "@/lib/meu-plano-2027/modulo";
import { progresso } from "@/lib/meu-plano-2027/telas";
import type { Respostas } from "@/lib/meu-plano-2027/regras";

afterEach(cleanup);

describe("lista Planos 2027 · Preenchimento", () => {
  it("admin vê cada pessoa com a % de preenchimento", async () => {
    // Ana preencheu o diagnóstico e parte do plano (mesmo caso de telas.test.ts); Bia não começou.
    const ana: Respostas = {
      "d.comissao": "200.000",
      "d.trans": "10",
      "d.cres": "20",
      "d.conv": "42",
      "d.ticket": "700.000",
      "d.dias": "90",
      "d.ativos": "15",
      "d.revisados": "30",
      "pq.frase": "Dar segurança à minha família",
    };
    const pctAna = progresso(ana).pct;
    expect(pctAna).toBeGreaterThan(0);
    expect(pctAna).toBeLessThan(100);
    rpc.mockResolvedValue({
      data: [
        {
          user_id: "u-ana",
          nome: "Ana",
          trilha: null,
          ativacao_inicio: null,
          respostas: ana,
          assinado_corretor_em: null,
          assinado_broker_em: null,
          meta_oficial_em: null,
          updated_at: "2026-11-20T12:00:00Z",
        },
        {
          user_id: "u-bia",
          nome: "Bia",
          trilha: null,
          ativacao_inicio: null,
          respostas: null,
          assinado_corretor_em: null,
          assinado_broker_em: null,
          meta_oficial_em: null,
          updated_at: null,
        },
      ],
      error: null,
    });
    render(createElement(EquipePlano, { aberto: null, abrir: vi.fn(), broker: true }));
    const lista = await screen.findByTestId("broker-equipe");
    expect(rpc).toHaveBeenCalledWith("carreira_plano_equipe", { _ano: 2027 });
    const linhaAna = within(lista).getByText("Ana").closest("li")!;
    const linhaBia = within(lista).getByText("Bia").closest("li")!;
    expect(within(linhaAna).getByText(`${pctAna}%`)).toBeTruthy();
    expect(within(linhaBia).getByText("0%")).toBeTruthy();
    expect(within(lista).getByText("1/2")).toBeTruthy(); // começaram
  });

  it("gestor vê só a própria equipe (t_48670ed3): texto de equipe, não de imobiliária", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(
      createElement(EquipePlano, { aberto: null, abrir: vi.fn(), broker: false, assina: true }),
    );
    const lista = await screen.findByTestId("broker-equipe");
    expect(within(lista).getByText("Ninguém da sua equipe começou o plano ainda.")).toBeTruthy();
    expect(within(lista).queryByText(/desta imobiliária/)).toBeNull();
    expect(within(lista).getByText(/só da sua equipe.*você assina o pacto/)).toBeTruthy();
  });

  it("papéis (t_48670ed3): imobiliária toda só admin/dono; gestor segue assinando; corretor nada", () => {
    const caso = (roles: string[]) => ({
      imobiliaria: veImobiliaria(roles),
      assina: ehBroker(roles),
      lista: ehBroker(roles) || ehLider(roles),
    });
    expect(caso(["admin"])).toEqual({ imobiliaria: true, assina: true, lista: true });
    expect(caso(["super_admin"])).toEqual({ imobiliaria: true, assina: true, lista: true });
    expect(caso(["gestor"])).toEqual({ imobiliaria: false, assina: true, lista: true });
    expect(caso(["team_leader", "corretor"])).toEqual({
      imobiliaria: false,
      assina: false,
      lista: true,
    });
    expect(caso(["corretor"])).toEqual({ imobiliaria: false, assina: false, lista: false });
  });

  it("a rota /minha-carreira/plano só exige o módulo ligado: não bloqueia quem não vê Minha carreira", () => {
    const rota = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/minha-carreira_.plano.tsx"),
      "utf8",
    );
    expect(rota).toContain("beforeLoad: guardMeuPlanoRoute");
    expect(rota).not.toContain("podeVerMinhaCarreira");
    expect(rota).not.toContain("podeVerMinhaImobiliaria");
    // A lista só aparece para gestor/admin/dono ou TL; os demais caem no plano pessoal.
    // "broker" (texto "imobiliária") = só admin/dono; gestor assina, mas vê só a equipe (t_48670ed3).
    expect(rota).toContain("const broker = veImobiliaria(roles);");
    expect(rota).toContain("const assina = ehBroker(roles);");
    expect(rota).toContain("const veEquipe = assina || ehLider(roles);");
    expect(rota).toContain("assina={assina}");
    expect(rota).toContain('busca.v === "equipe" && veEquipe');
    const modulo = readFileSync(join(process.cwd(), "src/lib/meu-plano-2027/modulo.ts"), "utf8");
    const guarda = modulo.slice(modulo.indexOf("export async function guardMeuPlanoRoute"));
    expect(guarda.slice(0, guarda.indexOf("\n}"))).not.toMatch(/roles|podeVer/);
  });
});
