import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { montarCorretoresPorVenda } from "./sale-participantes";
import {
  corretoresDaLinha,
  corretoresDaVenda,
  getSaleRoleFlags,
  responsaveisDaLinha,
  responsaveisDaVenda,
} from "./sale-permissions";

// Venda criada por um gestor (corretor_id) para os corretores A (captador) e B (vendedor).
const vendaDoGestor = {
  corretor_id: "gestor",
  corretor_captador_id: "A",
  corretor_vendedor_id: "B",
  modalidade: "padrao",
};

describe("atribuição = participantes, nunca quem cadastrou", () => {
  it("corretoresDaVenda devolve captador e vendedor, sem o criador", () => {
    expect(corretoresDaVenda(vendaDoGestor)).toEqual(["A", "B"]);
  });
  it("extras corretor_captador/corretor_vendedor entram; líder/coordenador não", () => {
    const ids = corretoresDaVenda({ corretor_id: "gestor" }, [
      { papel: "corretor_vendedor", user_id: "C" },
      { papel: "team_leader", user_id: "L" },
      { papel: "coordenador", user_id: "K" },
      { papel: "corretor_captador", user_id: null },
    ]);
    expect(ids).toEqual(["C"]);
  });
  it("sem nenhum participante (rascunho recém-criado), cai no criador", () => {
    expect(corretoresDaVenda({ corretor_id: "gestor" })).toEqual(["gestor"]);
  });
  it("mesma pessoa em dois papéis aparece uma vez", () => {
    expect(
      corretoresDaVenda({ corretor_id: "g", corretor_captador_id: "A", corretor_vendedor_id: "A" }),
    ).toEqual(["A"]);
  });
  it("Lançamento: operador que cadastrou responde pelas etapas (sem atribuição comercial)", () => {
    const lanc = { corretor_id: "op", modalidade: "lancamento" };
    expect(responsaveisDaVenda(lanc, [{ papel: "corretor_vendedor", user_id: "V" }])).toEqual([
      "op",
    ]);
    expect(corretoresDaVenda(lanc, [{ papel: "corretor_vendedor", user_id: "V" }])).toEqual(["V"]);
  });
  it("getSaleRoleFlags: participante é dono; criador não participante não é", () => {
    const resp = responsaveisDaVenda(vendaDoGestor);
    expect(getSaleRoleFlags(["corretor"], resp, "A").isOwner).toBe(true);
    expect(getSaleRoleFlags(["corretor"], resp, "B").isOwner).toBe(true);
    expect(getSaleRoleFlags(["gestor"], resp, "gestor").isOwner).toBe(false);
    expect(getSaleRoleFlags(["corretor"], resp, undefined).isOwner).toBe(false);
  });
  it("linhas da listagem usam corretores_ids do banco, com fallback no criador", () => {
    expect(corretoresDaLinha({ corretor_id: "g", corretores_ids: ["A", "B"] })).toEqual(["A", "B"]);
    expect(corretoresDaLinha({ corretor_id: "g", corretores_ids: [] })).toEqual(["g"]);
    expect(corretoresDaLinha({ corretor_id: "g" })).toEqual(["g"]);
    expect(
      responsaveisDaLinha({ corretor_id: "op", modalidade: "lancamento", corretores_ids: ["V"] }),
    ).toEqual(["op"]);
  });
  it("montarCorretoresPorVenda agrupa por venda (relatórios)", () => {
    const mapa = montarCorretoresPorVenda(
      [
        { id: "s1", corretor_id: "gestor", corretor_captador_id: "A", corretor_vendedor_id: "B" },
        { id: "s2", corretor_id: "lider" },
        { id: "s3", corretor_id: "op" },
      ],
      [
        { sale_id: "s3", papel: "corretor_vendedor", user_id: "V" },
        { sale_id: "s3", papel: "team_leader", user_id: "L" },
      ],
    );
    expect(mapa.get("s1")).toEqual(["A", "B"]);
    expect(mapa.get("s2")).toEqual(["lider"]);
    expect(mapa.get("s3")).toEqual(["V"]);
  });
});
