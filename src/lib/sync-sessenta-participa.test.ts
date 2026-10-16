/* eslint-disable @typescript-eslint/no-explicit-any -- banco e satélites falsos do teste */
// "Participa do 60 Dias MAX" (cartão t_2ea96382). Dados 100% fictícios.
// Regra de Denis (16/10): ao 60 Dias vão dono e gestor ativos sempre; corretor só com a opção ligada.
import { describe, expect, it } from "vitest";
import {
  processarFila,
  reconciliar,
  vaiAoSatelite,
  type LinhaEstado,
  type Mapa,
  type Satelite,
} from "../../supabase/functions/sync-satelites/core.ts";

const ORG = "00000000-0000-4000-8000-000000000001";
const SEG: Record<Satelite, string> = {
  estudo: "e".repeat(40),
  visita: "v".repeat(40),
  sessenta: "6".repeat(40),
};
const linha = (id: string, roles: string[], o: Partial<LinhaEstado> = {}): LinhaEstado => ({
  adm_user_id: id,
  org_id: ORG,
  email: `${id}@example.com`,
  nome: `Pessoa ${id}`,
  telefone: null,
  ativo: true,
  roles,
  lider_email: null,
  ...o,
});
const LINHAS: LinhaEstado[] = [
  linha("dono", ["admin"]),
  linha("gestor", ["gestor"]),
  linha("corretor_sim", ["corretor"], { participa_sessenta: true }),
  linha("corretor_nao", ["corretor"], { participa_sessenta: false }),
  linha("corretor_antigo", ["corretor"]), // função antiga sem a coluna: conta como false
];
const mapa: Mapa = {
  adm_org_id: ORG,
  estudo_org_id: "E",
  visita_imobiliaria_id: "V",
  mode: "live",
  estudo_enabled: true,
  visita_enabled: true,
  sessenta_org_id: "S",
  sessenta_enabled: true,
};

function fakeAdmin() {
  const gravado: Record<string, any[]> = {
    sync_log: [],
    sync_conflicts: [],
    sync_reconcile_runs: [],
    concluir: [],
  };
  return {
    gravado,
    from: (nome: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: { mode: "live", allow_deactivate: false, provision_mode: "live" },
          error: null,
        }),
        insert: async (rows: any) => {
          gravado[nome]?.push(...(Array.isArray(rows) ? rows : [rows]));
          return { error: null };
        },
        then: (res: (v: unknown) => void) =>
          res({ data: nome === "sync_org_map" ? [mapa] : [], error: null }),
      };
      return q;
    },
    rpc: async (fn: string, args: any) => {
      if (fn === "sync_outbox_pegar")
        return { data: LINHAS.map((l, i) => ({ id: i + 1, adm_user_id: l.adm_user_id })), error: null };
      if (fn === "sync_estado_desejado") return { data: LINHAS, error: null };
      if (fn === "sync_outbox_concluir") {
        gravado.concluir.push(args);
        return { data: "ok", error: null };
      }
      return { data: null, error: { message: "rpc desconhecida" } };
    },
  };
}

function ambiente() {
  const enviados: Array<{ sat: Satelite; body: any }> = [];
  return {
    enviados,
    amb: {
      segredos: SEG,
      enviar: async (sat: Satelite, corpo: string) => {
        const body = JSON.parse(corpo);
        enviados.push({ sat, body });
        return {
          status: 200,
          json: {
            modo: body.modo,
            resultados: (body.pessoas ?? []).map((p: any) => ({
              adm_user_id: p.adm_user_id,
              acoes: ["nada_a_fazer"],
              resultado: "nada_a_fazer",
              conflito: null,
              avisos: [],
              erro: null,
            })),
            so_no_satelite: [],
          },
        };
      },
    },
  };
}

const ids = (b: any) => (b.pessoas ?? []).map((p: any) => p.adm_user_id).sort();

describe("Participa do 60 Dias MAX", () => {
  it("vaiAoSatelite: dono/gestor sempre; corretor só com a opção; outros satélites não mudam", () => {
    const [dono, gestor, sim, nao, antigo] = LINHAS;
    expect([dono, gestor, sim, nao, antigo].map((l) => vaiAoSatelite(l, "sessenta"))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(LINHAS.every((l) => vaiAoSatelite(l, "estudo") && vaiAoSatelite(l, "visita"))).toBe(true);
    // Papel sem tradução (none) não vai ao 60 Dias nem com a opção ligada.
    expect(vaiAoSatelite(linha("j", ["juridico"], { participa_sessenta: true }), "sessenta")).toBe(false);
  });

  it("fila: 60 Dias recebe só dono, gestor e corretor marcado; Estudo e Visita recebem todos", async () => {
    const admin = fakeAdmin();
    const { amb, enviados } = ambiente();
    await processarFila(admin, amb);
    const porSat = Object.fromEntries(enviados.map((e) => [e.sat, ids(e.body)]));
    expect(porSat.sessenta).toEqual(["corretor_sim", "dono", "gestor"]);
    expect(porSat.estudo).toHaveLength(5);
    expect(porSat.visita).toHaveLength(5);
    // Ninguém fica com erro na fila por não participar.
    expect(admin.gravado.concluir.every((c) => c.p_resultado === "ok")).toBe(true);
  });

  it("reconciliar (dry_run): relata quem não participa, sem enviar", async () => {
    const admin = fakeAdmin();
    const { amb, enviados } = ambiente();
    const r = await reconciliar(admin, amb, ORG);
    const s = enviados.find((e) => e.sat === "sessenta")!;
    expect(s.body.modo).toBe("dry_run");
    expect(ids(s.body)).toEqual(["corretor_sim", "dono", "gestor"]);
    const rel = (r.relatorios[0] as any).sessenta;
    expect(rel.contagem.nao_participam).toBe(2);
    expect([...rel.nao_participam].sort()).toEqual(["corretor_antigo", "corretor_nao"]);
  });
});
