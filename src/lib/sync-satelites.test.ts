/* eslint-disable @typescript-eslint/no-explicit-any -- banco e satélites falsos do teste */
import { describe, expect, it } from "vitest";
import {
  assinarPedido,
  foraDaSync,
  hmacHex,
  modoEfetivo,
  papelNoSatelite,
  pessoaParaSatelite,
  processarFila,
  reconciliar,
  segredoInternoOk,
  type LinhaEstado,
  type Satelite,
} from "../../supabase/functions/sync-satelites/core.ts";

// Dados 100% fictícios.
const ORG = "00000000-0000-4000-8000-000000000001";
const S = "s".repeat(40);
const linha = (o: Partial<LinhaEstado> = {}): LinhaEstado =>
  ({
    adm_user_id: "u1",
    org_id: ORG,
    email: " Ana@RemaX.com.br ",
    nome: "Ana  Silva",
    telefone: "15991112222",
    ativo: true,
    roles: ["corretor"],
    lider_email: "lider@remax.com.br",
    cpf: "não deve sair",
    ...o,
  }) as LinhaEstado;

describe("tradução de papéis (tabela 4.1)", () => {
  it("maior acesso vence e papéis sem acesso viram none", () => {
    expect(papelNoSatelite(["corretor", "team_leader"], "estudo")).toBe("manager");
    expect(papelNoSatelite(["corretor", "admin"], "estudo")).toBe("owner");
    expect(papelNoSatelite(["coordenador"], "visita")).toBe("imobiliaria_admin");
    expect(papelNoSatelite(["corretor"], "visita")).toBe("corretor");
    expect(papelNoSatelite(["juridico", "financeiro", "staff", "lancamento"], "estudo")).toBe(
      "none",
    );
    expect(papelNoSatelite([], "visita")).toBe("none");
  });
  it("super_admin fica fora da sincronização", () => {
    expect(foraDaSync(linha({ roles: ["super_admin", "corretor"] }))).toBe("super_admin");
    expect(foraDaSync(linha({ email: null }))).toBe("sem_email");
    expect(foraDaSync(linha())).toBeNull();
  });
  it("envia só campos mínimos, e-mail normalizado e sem líder no Visita", () => {
    const p = pessoaParaSatelite(linha(), "visita");
    expect(p).toEqual({
      adm_user_id: "u1",
      email: "ana@remax.com.br",
      nome: "Ana Silva",
      telefone: "15991112222",
      papel: "corretor",
      ativo: true,
      lider_email: null,
    });
    expect(JSON.stringify(p)).not.toContain("não deve sair");
    expect(pessoaParaSatelite(linha(), "estudo").lider_email).toBe("lider@remax.com.br");
  });
});

describe("chaves e segurança", () => {
  it("modo mais restritivo vence", () => {
    expect(modoEfetivo("live", "dry_run")).toBe("dry_run");
    expect(modoEfetivo("live", "off")).toBe("off");
    expect(modoEfetivo("live", "xpto")).toBe("off");
  });
  it("segredo interno: exige >=32 e igualdade exata", () => {
    expect(segredoInternoOk(S, S)).toBe(true);
    expect(segredoInternoOk("x".repeat(40), S)).toBe(false);
    expect(segredoInternoOk(null, S)).toBe(false);
    expect(segredoInternoOk("curto", "curto")).toBe(false);
  });
  it("assinatura confere com o corpo exato", async () => {
    const { corpo, assinatura } = await assinarPedido(S, { a: 1 }, 1000);
    expect(assinatura).toBe(`v1=${await hmacHex(S, corpo)}`);
    expect(JSON.parse(corpo)).toMatchObject({ a: 1, iat: 1000 });
  });
});

// Banco falso mínimo para processarFila/reconciliar.
function fakeAdmin(o: {
  mode?: string;
  orgMode?: string;
  itens?: Array<{ id: number; adm_user_id: string }>;
  estado?: LinhaEstado[];
}) {
  const gravado: Record<string, unknown[]> = {
    sync_log: [],
    sync_conflicts: [],
    sync_reconcile_runs: [],
    concluir: [],
  };
  const tabela = (nome: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({
        data: nome === "sync_config" ? { mode: o.mode ?? "live", allow_deactivate: false } : null,
        error: null,
      }),
      insert: async (rows: unknown) => {
        gravado[nome].push(...(Array.isArray(rows) ? rows : [rows]));
        return { error: null };
      },
      upsert: async (row: unknown) => {
        gravado[nome].push(row);
        return { error: null };
      },
      then: (res: (v: unknown) => void) =>
        res({
          data:
            nome === "sync_org_map"
              ? [
                  {
                    adm_org_id: ORG,
                    estudo_org_id: "E",
                    visita_imobiliaria_id: "V",
                    mode: o.orgMode ?? "live",
                    estudo_enabled: true,
                    visita_enabled: true,
                  },
                ]
              : [],
          error: null,
        }),
    };
    return q;
  };
  return {
    gravado,
    from: tabela,
    rpc: async (fn: string, args: any) => {
      if (fn === "sync_outbox_pegar") return { data: o.itens ?? [], error: null };
      if (fn === "sync_estado_desejado") return { data: o.estado ?? [], error: null };
      if (fn === "sync_outbox_concluir") {
        gravado.concluir.push(args);
        return { data: "ok", error: null };
      }
      return { data: null, error: { message: "rpc desconhecida" } };
    },
  };
}

function ambiente(resposta: (sat: Satelite, body: any) => { status: number; json: any }) {
  const enviados: Array<{ sat: Satelite; body: any; assinatura: string }> = [];
  return {
    enviados,
    amb: {
      segredos: { estudo: S, visita: S },
      enviar: async (sat: Satelite, corpo: string, assinatura: string) => {
        const body = JSON.parse(corpo);
        enviados.push({ sat, body, assinatura });
        return resposta(sat, body);
      },
    },
  };
}

describe("processarFila", () => {
  const okResp = (_s: Satelite, b: any) => ({
    status: 200,
    json: {
      modo: b.modo,
      resultados: b.pessoas.map((p: any) => ({
        adm_user_id: p.adm_user_id,
        acoes: ["nada_a_fazer"],
        resultado: "nada_a_fazer",
        conflito: null,
        avisos: [],
        erro: null,
      })),
    },
  });

  it("envia para os 2 satélites com o modo mais restritivo e conclui ok", async () => {
    const admin = fakeAdmin({
      mode: "live",
      orgMode: "dry_run",
      itens: [{ id: 1, adm_user_id: "u1" }],
      estado: [linha()],
    });
    const { amb, enviados } = ambiente(okResp);
    await processarFila(admin, amb);
    expect(enviados.map((e) => e.sat)).toEqual(["estudo", "visita"]);
    expect(enviados.every((e) => e.body.modo === "dry_run")).toBe(true);
    expect(enviados[0].body.org_id).toBe("E");
    expect(enviados[1].body.org_id).toBe("V");
    expect(admin.gravado.concluir).toEqual([{ p_id: 1, p_resultado: "ok", p_erro: null }]);
  });

  it("imobiliária em off ou super_admin: não envia nada e descarta", async () => {
    const admin = fakeAdmin({
      orgMode: "off",
      itens: [{ id: 1, adm_user_id: "u1" }],
      estado: [linha()],
    });
    const { amb, enviados } = ambiente(okResp);
    await processarFila(admin, amb);
    expect(enviados).toHaveLength(0);
    const admin2 = fakeAdmin({
      itens: [{ id: 2, adm_user_id: "u1" }],
      estado: [linha({ roles: ["super_admin"] })],
    });
    await processarFila(admin2, amb);
    expect(enviados).toHaveLength(0);
    expect(admin2.gravado.concluir).toEqual([{ p_id: 2, p_resultado: "ok", p_erro: null }]);
  });

  it("falha de rede vira erro (vai para nova tentativa) e fica no log", async () => {
    const admin = fakeAdmin({ itens: [{ id: 1, adm_user_id: "u1" }], estado: [linha()] });
    const { amb } = ambiente(() => ({ status: 500, json: { error: "x" } }));
    await processarFila(admin, amb);
    expect((admin.gravado.concluir[0] as any).p_resultado).toBe("erro");
    expect(admin.gravado.sync_log.length).toBe(2);
  });

  it("conflito vira aguardando_humano e abre sync_conflicts", async () => {
    const admin = fakeAdmin({ itens: [{ id: 1, adm_user_id: "u1" }], estado: [linha()] });
    const { amb } = ambiente((sat, b) =>
      sat === "estudo"
        ? {
            status: 200,
            json: {
              modo: b.modo,
              resultados: [
                {
                  adm_user_id: "u1",
                  acoes: ["conflito"],
                  resultado: "conflito",
                  conflito: {
                    tipo: "possivel_duplicata",
                    candidatos: [{ id: "x", motivos: ["telefone"] }],
                  },
                  avisos: [],
                  erro: null,
                },
              ],
            },
          }
        : okResp(sat, b),
    );
    await processarFila(admin, amb);
    expect((admin.gravado.concluir[0] as any).p_resultado).toBe("aguardando_humano");
    expect(admin.gravado.sync_conflicts).toHaveLength(1);
  });
});

describe("reconciliar (sob demanda)", () => {
  it("sempre manda dry_run, pede a lista só-no-satélite e grava o resumo", async () => {
    const admin = fakeAdmin({
      mode: "live",
      estado: [linha(), linha({ adm_user_id: "u2", roles: ["super_admin"] })],
    });
    const { amb, enviados } = ambiente((_s, b) => ({
      status: 200,
      json: {
        modo: b.modo,
        resultados: b.pessoas.map((p: any) => ({
          adm_user_id: p.adm_user_id,
          acoes: ["vincular_existente"],
          resultado: "simulado",
          conflito: null,
          avisos: [],
          erro: null,
        })),
        so_no_satelite: [{ id: "x" }],
      },
    }));
    const r = await reconciliar(admin, amb);
    expect(
      enviados.every((e) => e.body.modo === "dry_run" && e.body.incluir_so_no_satelite === true),
    ).toBe(true);
    expect(enviados[0].body.pessoas).toHaveLength(1); // super_admin fora
    expect((r.relatorios[0] as any).estudo.contagem).toMatchObject({
      pessoas: 1,
      so_no_satelite: 1,
      por_acao: { vincular_existente: 1 },
    });
    expect(admin.gravado.sync_reconcile_runs).toHaveLength(1);
  });
});
