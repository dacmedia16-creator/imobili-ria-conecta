/* eslint-disable @typescript-eslint/no-explicit-any -- banco e satélites falsos do teste */
// Provisionamento automático de imobiliária (cartão t_c0844acb). Dados 100% fictícios.
import { describe, expect, it } from "vitest";
import {
  orgParaSatelite,
  processarProvisionamento,
  type OrgParaProvisao,
  type Satelite,
} from "../../supabase/functions/sync-satelites/core.ts";

const S = "s".repeat(40);
const ORG = "11111111-2222-4333-8444-555555555555";
const org = (o: Partial<OrgParaProvisao> = {}): OrgParaProvisao => ({
  adm_org_id: ORG,
  nome: "ZZ  Teste Provisionamento",
  slug: "zz-teste-provisionamento",
  cnpj: null,
  cidade: "Sorocaba",
  uf: "SP",
  email_contato: "admin@example.com",
  status_org: "ativa",
  ja_mapeada: false,
  tentativas: 1,
  ...o,
});

function fakeAdmin(o: {
  mode?: string;
  provision?: string;
  orgs?: OrgParaProvisao[];
  erroConflito?: { code: string; message: string };
}) {
  const gravado: Record<string, any[]> = {
    sync_log: [],
    sync_conflicts: [],
    concluir: [],
    pegar: [],
  };
  return {
    gravado,
    from: (nome: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: { mode: o.mode ?? "live", provision_mode: o.provision ?? "live" },
          error: null,
        }),
        insert: async (rows: any) => {
          if (nome === "sync_conflicts" && o.erroConflito) return { error: o.erroConflito };
          gravado[nome].push(...(Array.isArray(rows) ? rows : [rows]));
          return { error: null };
        },
      };
      return q;
    },
    rpc: async (fn: string, args: any) => {
      if (fn === "sync_provisao_pegar") {
        gravado.pegar.push(args);
        return { data: o.orgs ?? [], error: null };
      }
      if (fn === "sync_provisao_concluir") {
        gravado.concluir.push(args);
        return { data: args.p_resultado === "erro" ? "pendente" : args.p_resultado, error: null };
      }
      return { data: null, error: { message: "rpc desconhecida" } };
    },
  };
}

type Resp = { status: number; json: any };
function ambiente(resp: (sat: Satelite, body: any) => Resp) {
  const enviados: Array<{ sat: Satelite; body: any }> = [];
  return {
    enviados,
    amb: {
      segredos: { estudo: S, visita: S },
      enviar: async (sat: Satelite, corpo: string) => {
        const body = JSON.parse(corpo);
        enviados.push({ sat, body });
        return resp(sat, body);
      },
    },
  };
}
const id = (sat: Satelite) => (sat === "estudo" ? "E-NOVA" : "V-NOVA");
const tudoOk = (sat: Satelite, b: any): Resp => ({
  status: 200,
  json: b.modo === "dry_run" ? { resultado: "simulado" } : { resultado: "criado", id: id(sat) },
});

describe("orgParaSatelite", () => {
  it("só dados mínimos e nome sem espaços extras", () => {
    const p = orgParaSatelite(org());
    expect(p).toEqual({
      adm_org_id: ORG,
      nome: "ZZ Teste Provisionamento",
      slug: "zz-teste-provisionamento",
      cnpj: null,
      cidade: "Sorocaba",
      uf: "SP",
      email_contato: "admin@example.com",
    });
  });
});

describe("processarProvisionamento", () => {
  it("off (geral ou provisão): não pega nada nem envia", async () => {
    for (const cfg of [{ mode: "off" }, { provision: "off" }, { provision: "xpto" }]) {
      const admin = fakeAdmin({ ...cfg, orgs: [org()] });
      const { amb, enviados } = ambiente(tudoOk);
      expect(await processarProvisionamento(admin, amb)).toEqual({ orgs: 0 });
      expect(admin.gravado.pegar).toHaveLength(0);
      expect(enviados).toHaveLength(0);
    }
  });

  it("live: prévia nos 2, cria nos 2 e só então grava o mapa (ok com os 2 ids)", async () => {
    const admin = fakeAdmin({ orgs: [org()] });
    const { amb, enviados } = ambiente(tudoOk);
    await processarProvisionamento(admin, amb);
    expect(enviados.map((e) => `${e.sat}:${e.body.modo}`)).toEqual([
      "estudo:dry_run",
      "visita:dry_run",
      "estudo:live",
      "visita:live",
    ]);
    expect(
      enviados.every((e) => e.body.acao === "provisionar_org" && e.body.org.adm_org_id === ORG),
    ).toBe(true);
    expect(admin.gravado.concluir).toEqual([
      expect.objectContaining({
        p_org: ORG,
        p_resultado: "ok",
        p_estudo: "E-NOVA",
        p_visita: "V-NOVA",
      }),
    ]);
    expect(admin.gravado.sync_log).toHaveLength(4);
    expect(
      admin.gravado.sync_log.every((l) => l.adm_user_id === null && l.adm_org_id === ORG),
    ).toBe(true);
    expect(admin.gravado.sync_log.filter((l) => l.resultado === "ok")).toHaveLength(2);
  });

  it("provision_mode dry_run: só prévia, nada criado, status simulado", async () => {
    const admin = fakeAdmin({ provision: "dry_run", orgs: [org()] });
    const { amb, enviados } = ambiente(tudoOk);
    await processarProvisionamento(admin, amb);
    expect(enviados.every((e) => e.body.modo === "dry_run")).toBe(true);
    expect(admin.gravado.concluir[0]).toMatchObject({
      p_resultado: "simulado",
      p_estudo: null,
      p_visita: null,
    });
  });

  it("org parecida em 1 satélite: conflito na fila humana e NADA é criado em nenhum", async () => {
    const admin = fakeAdmin({ orgs: [org()] });
    const { amb, enviados } = ambiente((sat, b) =>
      sat === "visita"
        ? {
            status: 200,
            json: {
              resultado: "conflito",
              conflito: {
                tipo: "org_parecida_no_satelite",
                candidatos: [{ id: "x", motivos: ["cnpj"] }],
              },
            },
          }
        : tudoOk(sat, b),
    );
    await processarProvisionamento(admin, amb);
    expect(enviados.some((e) => e.body.modo === "live")).toBe(false);
    expect(admin.gravado.sync_conflicts).toEqual([
      expect.objectContaining({
        adm_user_id: null,
        adm_org_id: ORG,
        satelite: "visita",
        tipo: "org_parecida_no_satelite",
        status: "aberto",
      }),
    ]);
    expect(admin.gravado.concluir[0]).toMatchObject({
      p_resultado: "aguardando_humano",
      p_estudo: null,
      p_visita: null,
    });
  });

  it("conflito que não chega à fila humana vira erro (nova tentativa)", async () => {
    const admin = fakeAdmin({ orgs: [org()], erroConflito: { code: "XX000", message: "boom" } });
    const { amb } = ambiente((sat, b) =>
      sat === "estudo"
        ? { status: 200, json: { resultado: "conflito", conflito: { tipo: "t" } } }
        : tudoOk(sat, b),
    );
    await processarProvisionamento(admin, amb);
    expect(admin.gravado.concluir[0].p_resultado).toBe("erro");
    expect(admin.gravado.concluir[0].p_erro).toMatch(/conflito_nao_gravado/);
  });

  it("satélite fora do ar na prévia: erro, nada criado", async () => {
    const admin = fakeAdmin({ orgs: [org()] });
    const { amb, enviados } = ambiente((sat, b) =>
      sat === "estudo" ? { status: 503, json: { error: "down" } } : tudoOk(sat, b),
    );
    await processarProvisionamento(admin, amb);
    expect(enviados.some((e) => e.body.modo === "live")).toBe(false);
    expect(admin.gravado.concluir[0]).toMatchObject({ p_resultado: "erro" });
    expect(admin.gravado.concluir[0].p_erro).toMatch(/^estudo: http_503_down/);
  });

  it("criou no Estudo e falhou no Visita: NÃO grava mapa; guarda o id do Estudo e tenta de novo", async () => {
    const admin = fakeAdmin({ orgs: [org()] });
    const { amb } = ambiente((sat, b) =>
      sat === "visita" && b.modo === "live"
        ? { status: 500, json: { error: "provision_failed" } }
        : tudoOk(sat, b),
    );
    await processarProvisionamento(admin, amb);
    expect(admin.gravado.concluir[0]).toMatchObject({
      p_resultado: "erro",
      p_estudo: "E-NOVA",
      p_visita: null,
    });
    expect(admin.gravado.concluir[0].p_erro).toMatch(/^visita: http_500/);
  });

  it("reenvio após falha parcial: satélite que já criou devolve ja_provisionada e o mapa fecha", async () => {
    const admin = fakeAdmin({ orgs: [org({ tentativas: 2 })] });
    const { amb } = ambiente((sat, b) =>
      b.modo === "dry_run"
        ? {
            status: 200,
            json: {
              resultado: sat === "estudo" ? "ja_provisionada" : "simulado",
              id: sat === "estudo" ? "E-NOVA" : undefined,
            },
          }
        : {
            status: 200,
            json: { resultado: sat === "estudo" ? "ja_provisionada" : "criado", id: id(sat) },
          },
    );
    await processarProvisionamento(admin, amb);
    expect(admin.gravado.concluir[0]).toMatchObject({
      p_resultado: "ok",
      p_estudo: "E-NOVA",
      p_visita: "V-NOVA",
    });
  });

  it("satélite com ADM_SYNC_MODE dry_run (devolve simulado em live): erro visível, mapa não é gravado", async () => {
    const admin = fakeAdmin({ orgs: [org()] });
    const { amb } = ambiente(() => ({ status: 200, json: { resultado: "simulado" } }));
    await processarProvisionamento(admin, amb);
    expect(admin.gravado.concluir[0]).toMatchObject({ p_resultado: "erro", p_estudo: null });
    expect(admin.gravado.concluir[0].p_erro).toBe("estudo: satelite_em_dry_run");
  });

  it("org já mapeada à mão ou suspensa: ignorada, sem envio", async () => {
    const admin = fakeAdmin({
      orgs: [org({ ja_mapeada: true }), org({ adm_org_id: "o2", status_org: "suspensa" })],
    });
    const { amb, enviados } = ambiente(tudoOk);
    await processarProvisionamento(admin, amb);
    expect(enviados).toHaveLength(0);
    expect(admin.gravado.concluir.map((c) => [c.p_resultado, c.p_erro])).toEqual([
      ["ignorado", "ja_mapeada_manual"],
      ["ignorado", "org_suspensa"],
    ]);
  });

  it("segredo de satélite ausente: erro sem enviar nada", async () => {
    const admin = fakeAdmin({ orgs: [org()] });
    const { amb, enviados } = ambiente(tudoOk);
    (amb.segredos as any).visita = undefined;
    await processarProvisionamento(admin, amb);
    expect(enviados.map((e) => e.sat)).toEqual(["estudo"]);
    expect(admin.gravado.concluir[0].p_erro).toBe("visita: segredo_nao_configurado");
  });
});
