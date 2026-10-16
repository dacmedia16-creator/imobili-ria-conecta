/* eslint-disable @typescript-eslint/no-explicit-any -- banco e satélites falsos do teste */
// 60 Dias MAX como 3º satélite, opcional por imobiliária (cartão t_46bd77c2). Dados 100% fictícios.
import { describe, expect, it } from "vitest";
import {
  alvosDoMapa,
  hmacHex,
  papelNoSatelite,
  pessoaParaSatelite,
  processarFila,
  processarProvisionamento,
  reconciliar,
  SATS,
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
const linha = (o: Partial<LinhaEstado> = {}): LinhaEstado => ({
  adm_user_id: "u1",
  org_id: ORG,
  email: "ana@example.com",
  nome: "Ana Teste",
  telefone: null,
  ativo: true,
  roles: ["team_leader"],
  lider_email: "lider@example.com",
  ...o,
});
const mapa = (o: Partial<Mapa> = {}): Mapa => ({
  adm_org_id: ORG,
  estudo_org_id: "E",
  visita_imobiliaria_id: "V",
  mode: "live",
  estudo_enabled: true,
  visita_enabled: true,
  ...o,
});

function fakeAdmin(m: Mapa) {
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
          gravado[nome].push(...(Array.isArray(rows) ? rows : [rows]));
          return { error: null };
        },
        then: (res: (v: unknown) => void) =>
          res({ data: nome === "sync_org_map" ? [m] : [], error: null }),
      };
      return q;
    },
    rpc: async (fn: string, args: any) => {
      if (fn === "sync_outbox_pegar") return { data: [{ id: 1, adm_user_id: "u1" }], error: null };
      if (fn === "sync_estado_desejado") return { data: [linha()], error: null };
      if (fn === "sync_outbox_concluir") {
        gravado.concluir.push(args);
        return { data: "ok", error: null };
      }
      return { data: null, error: { message: "rpc desconhecida" } };
    },
  };
}

function ambiente(falhar: Satelite[] = []) {
  const enviados: Array<{ sat: Satelite; corpo: string; body: any; assinatura: string }> = [];
  return {
    enviados,
    amb: {
      segredos: SEG,
      enviar: async (sat: Satelite, corpo: string, assinatura: string) => {
        const body = JSON.parse(corpo);
        enviados.push({ sat, corpo, body, assinatura });
        if (falhar.includes(sat)) return { status: 401, json: { error: "unauthorized" } };
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

describe("60 Dias MAX: tradução e alvos", () => {
  it("usa a tabela de papéis do Estudo e leva o lider_email", () => {
    expect(papelNoSatelite(["corretor", "admin"], "sessenta")).toBe("owner");
    expect(papelNoSatelite(["coordenador"], "sessenta")).toBe("manager");
    expect(papelNoSatelite(["corretor"], "sessenta")).toBe("agent");
    expect(papelNoSatelite(["juridico"], "sessenta")).toBe("none");
    const p = pessoaParaSatelite(linha(), "sessenta");
    expect(p).toEqual({ ...pessoaParaSatelite(linha(), "estudo") });
    expect(p.lider_email).toBe("lider@example.com");
  });
  it("mapa antigo (sem colunas novas) ou sessenta_enabled=false: 60 Dias desligado", () => {
    expect(alvosDoMapa(mapa())[2]).toEqual(["sessenta", null, false]);
    expect(alvosDoMapa(mapa({ sessenta_org_id: "S", sessenta_enabled: false }))[2]).toEqual([
      "sessenta",
      "S",
      false,
    ]);
  });
});

describe("60 Dias MAX: processarFila", () => {
  it("sessenta_enabled=false: nada é enviado ao 60 Dias", async () => {
    const admin = fakeAdmin(mapa({ sessenta_org_id: "S", sessenta_enabled: false }));
    const { amb, enviados } = ambiente();
    await processarFila(admin, amb);
    expect(enviados.map((e) => e.sat)).toEqual(["estudo", "visita"]);
    expect(admin.gravado.concluir).toEqual([{ p_id: 1, p_resultado: "ok", p_erro: null }]);
  });

  it("sessenta_enabled=true: corpo assinado com o segredo do 60 Dias, papel/líder no formato Estudo", async () => {
    const admin = fakeAdmin(mapa({ sessenta_org_id: "S", sessenta_enabled: true }));
    const { amb, enviados } = ambiente();
    await processarFila(admin, amb);
    expect(enviados.map((e) => e.sat)).toEqual(["estudo", "visita", "sessenta"]);
    const s = enviados[2];
    expect(s.assinatura).toBe(`v1=${await hmacHex(SEG.sessenta, s.corpo)}`);
    expect(s.assinatura).not.toBe(`v1=${await hmacHex(SEG.estudo, s.corpo)}`);
    expect(s.body.org_id).toBe("S");
    expect(s.body.pessoas[0]).toMatchObject({ papel: "manager", lider_email: "lider@example.com" });
    expect(admin.gravado.sync_log.map((l) => l.satelite)).toEqual(["estudo", "visita", "sessenta"]);
  });

  it("falha no 60 Dias não impede o envio ao Estudo nem ao Visita", async () => {
    const admin = fakeAdmin(mapa({ sessenta_org_id: "S", sessenta_enabled: true }));
    const { amb, enviados } = ambiente(["sessenta"]);
    await processarFila(admin, amb);
    expect(enviados.map((e) => e.sat)).toEqual(["estudo", "visita", "sessenta"]);
    const porSat = Object.fromEntries(admin.gravado.sync_log.map((l) => [l.satelite, l.resultado]));
    expect(porSat).toEqual({ estudo: "nada_a_fazer", visita: "nada_a_fazer", sessenta: "erro" });
    // O item volta para nova tentativa (erro), como já acontece com falha em qualquer satélite.
    expect(admin.gravado.concluir[0].p_resultado).toBe("erro");
  });

  it("segredo do 60 Dias ausente: erro só no 60 Dias, Estudo e Visita seguem", async () => {
    const admin = fakeAdmin(mapa({ sessenta_org_id: "S", sessenta_enabled: true }));
    const { amb, enviados } = ambiente();
    amb.segredos = { estudo: SEG.estudo, visita: SEG.visita } as any;
    await processarFila(admin, amb);
    expect(enviados.map((e) => e.sat)).toEqual(["estudo", "visita"]);
    expect(admin.gravado.sync_log.find((l) => l.satelite === "sessenta")?.erro).toMatch(
      /segredo_nao_configurado/,
    );
  });
});

describe("60 Dias MAX: reconciliar e provisão", () => {
  it("reconciliar inclui o 60 Dias só quando ligado, sempre em dry_run", async () => {
    const admin = fakeAdmin(mapa({ sessenta_org_id: "S", sessenta_enabled: true }));
    const { amb, enviados } = ambiente();
    const r = await reconciliar(admin, amb, ORG);
    expect(enviados.map((e) => e.sat)).toEqual(["estudo", "visita", "sessenta"]);
    expect(enviados.every((e) => e.body.modo === "dry_run")).toBe(true);
    expect((r.relatorios[0] as any).sessenta.contagem.pessoas).toBe(1);
  });

  it("provisão automática continua exigindo só Estudo e Visita", async () => {
    expect(SATS).toEqual(["estudo", "visita"]);
    const enviados: Satelite[] = [];
    const admin: any = {
      from: () => {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: { mode: "live", provision_mode: "live" },
            error: null,
          }),
          insert: async () => ({ error: null }),
        };
        return q;
      },
      concluir: [] as any[],
      rpc: async (fn: string, args: any) => {
        if (fn === "sync_provisao_pegar")
          return {
            data: [
              {
                adm_org_id: ORG,
                nome: "ZZ Teste",
                slug: "zz-teste",
                cnpj: null,
                cidade: null,
                uf: null,
                email_contato: null,
                status_org: "ativa",
                ja_mapeada: false,
                tentativas: 1,
              },
            ],
            error: null,
          };
        admin.concluir.push(args);
        return { data: args.p_resultado, error: null };
      },
    };
    await processarProvisionamento(admin, {
      segredos: SEG,
      enviar: async (sat: Satelite, corpo: string) => {
        enviados.push(sat);
        const b = JSON.parse(corpo);
        return {
          status: 200,
          json:
            b.modo === "dry_run"
              ? { resultado: "simulado" }
              : { resultado: "criado", id: sat.toUpperCase() },
        };
      },
    });
    expect(enviados).not.toContain("sessenta");
    expect(admin.concluir[0]).toMatchObject({
      p_resultado: "ok",
      p_estudo: "ESTUDO",
      p_visita: "VISITA",
    });
  });
});
