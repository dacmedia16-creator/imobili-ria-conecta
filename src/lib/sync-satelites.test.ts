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
  it("só a conta da plataforma fica fora; Administrador principal (super_admin) entra (t_06782054)", () => {
    const plataforma = new Set(["plat"]);
    expect(foraDaSync(linha({ adm_user_id: "plat", roles: ["super_admin"] }), plataforma)).toBe(
      "conta_da_plataforma",
    );
    expect(foraDaSync(linha({ adm_user_id: "plat", roles: [] }), plataforma)).toBe(
      "conta_da_plataforma",
    );
    expect(foraDaSync(linha({ roles: ["super_admin"] }), plataforma)).toBeNull();
    expect(foraDaSync(linha({ email: null }), plataforma)).toBe("sem_email");
    expect(foraDaSync(linha(), plataforma)).toBeNull();
  });
  it("Administrador principal vira owner no Estudo/60 Dias e imobiliaria_admin (admin de verdade) no Visita", () => {
    expect(papelNoSatelite(["super_admin"], "estudo")).toBe("owner");
    expect(papelNoSatelite(["super_admin"], "sessenta")).toBe("owner");
    expect(papelNoSatelite(["super_admin"], "visita")).toBe("imobiliaria_admin");
    const v = pessoaParaSatelite(linha({ roles: ["super_admin"] }), "visita", { tlLider: true });
    expect(v.papel).toBe("imobiliaria_admin");
    expect(v.admin_adm).toBe(true);
    expect(
      pessoaParaSatelite(linha({ roles: ["super_admin", "team_leader"] }), "visita", {
        tlLider: true,
      }).papel,
    ).toBe("imobiliaria_admin");
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
      admin_adm: false,
    });
    expect(JSON.stringify(p)).not.toContain("não deve sair");
    expect(pessoaParaSatelite(linha({ roles: ["admin"] }), "visita").admin_adm).toBe(true);
    for (const r of ["gestor", "coordenador", "team_leader", "corretor"]) {
      expect(pessoaParaSatelite(linha({ roles: [r] }), "visita").admin_adm).toBe(false);
    }
    expect(pessoaParaSatelite(linha({ roles: ["admin"] }), "estudo")).not.toHaveProperty(
      "admin_adm",
    );
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
  exclusoes?: Array<{ adm_user_id: string; satelite: Satelite }>;
  erroInsertConflito?: { code: string; message: string };
  /** user_id das contas da plataforma (platform_admins). */
  plataforma?: string[];
  erroPlataforma?: boolean;
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
        if (nome === "sync_conflicts" && o.erroInsertConflito)
          return { error: o.erroInsertConflito };
        gravado[nome].push(...(Array.isArray(rows) ? rows : [rows]));
        return { error: null };
      },
      // Como no banco real: o índice único de sync_conflicts é parcial e o PostgREST não manda o predicado
      // no ON CONFLICT, então o upsert com onConflict falha com 42P10 (conferido no homolog em 11/10).
      upsert: async (row: unknown, opts?: { onConflict?: string }) => {
        if (nome === "sync_conflicts" && opts?.onConflict) {
          return {
            error: {
              code: "42P10",
              message:
                "there is no unique or exclusion constraint matching the ON CONFLICT specification",
            },
          };
        }
        gravado[nome].push(row);
        return { error: null };
      },
      then: (res: (v: unknown) => void) =>
        nome === "platform_admins"
          ? res(
              o.erroPlataforma
                ? { data: null, error: { message: "permission denied" } }
                : { data: (o.plataforma ?? []).map((user_id) => ({ user_id })), error: null },
            )
          : res({
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
                  : nome === "sync_exclusoes"
                    ? (o.exclusoes ?? [])
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

  it("imobiliária em off ou conta da plataforma: não envia nada e descarta", async () => {
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
      plataforma: ["u1"],
    });
    await processarFila(admin2, amb);
    expect(enviados).toHaveLength(0);
    expect(admin2.gravado.concluir).toEqual([{ p_id: 2, p_resultado: "ok", p_erro: null }]);
  });

  it("t_06782054: Administrador principal (super_admin fora da plataforma) vai como owner/imobiliaria_admin", async () => {
    const admin = fakeAdmin({
      itens: [{ id: 3, adm_user_id: "u1" }],
      estado: [linha({ roles: ["super_admin"], lider_email: null })],
      plataforma: ["outra-conta"],
    });
    const { amb, enviados } = ambiente(okResp);
    await processarFila(admin, amb);
    expect(enviados.map((e) => e.sat)).toEqual(["estudo", "visita"]);
    expect(enviados[0].body.pessoas[0]).toMatchObject({ adm_user_id: "u1", papel: "owner" });
    expect(enviados[1].body.pessoas[0]).toMatchObject({
      adm_user_id: "u1",
      papel: "imobiliaria_admin",
      admin_adm: true,
    });
    expect(admin.gravado.concluir).toEqual([{ p_id: 3, p_resultado: "ok", p_erro: null }]);
  });

  it("t_06782054: erro ao ler platform_admins para a rodada sem enviar nada (falha fechada)", async () => {
    const admin = fakeAdmin({
      itens: [{ id: 4, adm_user_id: "u1" }],
      estado: [linha({ roles: ["super_admin"] })],
      erroPlataforma: true,
    });
    const { amb, enviados } = ambiente(okResp);
    await expect(processarFila(admin, amb)).rejects.toThrow(/platform_admins/);
    expect(enviados).toHaveLength(0);
    expect(admin.gravado.concluir).toEqual([]);
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
    expect(admin.gravado.sync_conflicts[0]).toMatchObject({
      adm_user_id: "u1",
      satelite: "estudo",
      tipo: "possivel_duplicata",
      status: "aberto",
    });
  });

  const respConflito = (sat: Satelite, b: any) =>
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
                conflito: { tipo: "rebaixar_owner" },
                avisos: [],
                erro: null,
              },
            ],
          },
        }
      : okResp(sat, b);

  it("conflito igual já aberto (23505) não é erro: segue aguardando_humano", async () => {
    const admin = fakeAdmin({
      itens: [{ id: 1, adm_user_id: "u1" }],
      estado: [linha()],
      erroInsertConflito: { code: "23505", message: "duplicate key" },
    });
    await processarFila(admin, ambiente(respConflito).amb);
    expect((admin.gravado.concluir[0] as any).p_resultado).toBe("aguardando_humano");
  });

  it("falha ao gravar o conflito NÃO é engolida: item vira erro e fica no log", async () => {
    const admin = fakeAdmin({
      itens: [{ id: 1, adm_user_id: "u1" }],
      estado: [linha()],
      erroInsertConflito: { code: "42501", message: "permission denied" },
    });
    await processarFila(admin, ambiente(respConflito).amb);
    const c = admin.gravado.concluir[0] as any;
    expect(c.p_resultado).toBe("erro");
    expect(c.p_erro).toContain("conflito_nao_gravado");
    expect(
      admin.gravado.sync_log.some(
        (l: any) => l.acao === "registrar_conflito" && l.resultado === "erro",
      ),
    ).toBe(true);
  });
});

describe("reconciliar (sob demanda)", () => {
  it("sempre manda dry_run, pede a lista só-no-satélite e grava o resumo", async () => {
    const admin = fakeAdmin({
      mode: "live",
      estado: [linha(), linha({ adm_user_id: "u2", roles: ["super_admin"] })],
      plataforma: ["u2"],
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
    expect(enviados[0].body.pessoas).toHaveLength(1); // conta da plataforma fora
    expect((r.relatorios[0] as any).fora_da_sync).toEqual([
      { adm_user_id: "u2", motivo: "conta_da_plataforma" },
    ]);
    expect((r.relatorios[0] as any).estudo.contagem).toMatchObject({
      pessoas: 1,
      so_no_satelite: 1,
      por_acao: { vincular_existente: 1 },
    });
    expect(admin.gravado.sync_reconcile_runs).toHaveLength(1);
  });

  it("lista de exclusão: não envia a pessoa ao satélite excluído e conta no relatório", async () => {
    const admin = fakeAdmin({
      estado: [linha(), linha({ adm_user_id: "u2", email: "b@remax.com.br" })],
      exclusoes: [{ adm_user_id: "u2", satelite: "estudo" }],
    });
    const { amb, enviados } = ambiente((_s, b) => ({
      status: 200,
      json: { modo: b.modo, resultados: [], so_no_satelite: [] },
    }));
    const r = await reconciliar(admin, amb);
    const est = enviados.find((e) => e.sat === "estudo")!;
    const vis = enviados.find((e) => e.sat === "visita")!;
    expect(est.body.pessoas.map((p: any) => p.adm_user_id)).toEqual(["u1"]);
    expect(vis.body.pessoas.map((p: any) => p.adm_user_id)).toEqual(["u1", "u2"]);
    expect((r.relatorios[0] as any).estudo.excluidos).toEqual(["u2"]);
    expect((r.relatorios[0] as any).estudo.contagem.excluidos).toBe(1);
  });
});

describe("processarFila com exclusão", () => {
  it("excluído nos dois satélites: nada é enviado e o item é concluído ok", async () => {
    const admin = fakeAdmin({
      itens: [{ id: 9, adm_user_id: "u1" }],
      estado: [linha()],
      exclusoes: [
        { adm_user_id: "u1", satelite: "estudo" },
        { adm_user_id: "u1", satelite: "visita" },
      ],
    });
    const { amb, enviados } = ambiente(() => ({ status: 500, json: {} }));
    await processarFila(admin, amb);
    expect(enviados).toHaveLength(0);
    expect(admin.gravado.concluir).toEqual([{ p_id: 9, p_resultado: "ok", p_erro: null }]);
  });
});
