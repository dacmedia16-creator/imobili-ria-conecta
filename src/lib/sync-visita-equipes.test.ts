/* eslint-disable @typescript-eslint/no-explicit-any -- banco e satélites falsos do teste */
// t_cbc7cc69: equipes do ADM no Visita (etapa 1) e TL como corretor-líder (etapa 2). Dados 100% fictícios.
import { describe, expect, it } from "vitest";
import {
  equipeParaVisita,
  papelVisita,
  pessoaParaSatelite,
  processarFila,
  sincronizarEquipesVisita,
  tlComoLider,
  type LinhaEstado,
  type Mapa,
  type Satelite,
} from "../../supabase/functions/sync-satelites/core.ts";

const ORG = "00000000-0000-4000-8000-000000000001";
const S = "s".repeat(40);
const linha = (o: Partial<LinhaEstado> = {}): LinhaEstado => ({
  adm_user_id: "u1",
  org_id: ORG,
  email: "tl@exemplo.com.br",
  nome: "TL Teste",
  telefone: null,
  ativo: true,
  roles: ["team_leader"],
  lider_email: null,
  ...o,
});
const mapaBase = (o: Partial<Mapa> = {}): Mapa => ({
  adm_org_id: ORG,
  estudo_org_id: null,
  visita_imobiliaria_id: "V",
  mode: "live",
  estudo_enabled: false,
  visita_enabled: true,
  ...o,
});
const EQUIPES = [
  {
    adm_team_id: "t1",
    nome: "  Equipe   Alfa ",
    cor: "#123456",
    parent_adm_team_id: null,
    lider_adm_user_id: "u1",
    colideres_adm_user_ids: ["u3"],
    membros_adm_user_ids: ["u2"],
  },
];

function fakeAdmin(o: {
  mapa?: Mapa;
  itens?: any[];
  estado?: LinhaEstado[];
  erroEquipes?: boolean;
}) {
  const gravado: Record<string, any[]> = { sync_log: [], concluir: [], updates: [] };
  const tabela = (nome: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      update: (v: unknown) => {
        gravado.updates.push({ nome, v });
        return q;
      },
      maybeSingle: async () => ({
        data: nome === "sync_config" ? { mode: "live", allow_deactivate: false } : null,
        error: null,
      }),
      insert: async (rows: unknown) => {
        gravado[nome]?.push(...(Array.isArray(rows) ? rows : [rows]));
        return { error: null };
      },
      then: (res: (v: unknown) => void) =>
        res({ data: nome === "sync_org_map" ? [o.mapa ?? mapaBase()] : [], error: null }),
    };
    return q;
  };
  return {
    gravado,
    from: tabela,
    rpc: async (fn: string, args: any) => {
      if (fn === "sync_outbox_pegar") return { data: o.itens ?? [], error: null };
      if (fn === "sync_estado_desejado") return { data: o.estado ?? [], error: null };
      if (fn === "sync_equipes_da_org")
        return o.erroEquipes
          ? { data: null, error: { message: "falhou" } }
          : { data: EQUIPES, error: null };
      if (fn === "sync_outbox_concluir") {
        gravado.concluir.push(args);
        return { data: "ok", error: null };
      }
      if (fn === "sync_enfileirar_org") {
        (gravado.reenfileirar ??= []).push(args);
        return { data: 1, error: null };
      }
      return { data: null, error: { message: "rpc desconhecida" } };
    },
  };
}

function ambiente(respEquipes: any = { resultado: "ok", resumo: {}, avisos: [] }, status = 200) {
  const enviados: Array<{ sat: Satelite; body: any }> = [];
  return {
    enviados,
    amb: {
      segredos: { visita: S },
      enviar: async (sat: Satelite, corpo: string) => {
        const body = JSON.parse(corpo);
        enviados.push({ sat, body });
        if (body.acao === "equipes") return { status, json: respEquipes };
        return {
          status: 200,
          json: {
            modo: body.modo,
            resultados: body.pessoas.map((p: any) => ({
              adm_user_id: p.adm_user_id,
              acoes: ["nada_a_fazer"],
              resultado: "nada_a_fazer",
              conflito: null,
              avisos: [],
              erro: null,
            })),
          },
        };
      },
    },
  };
}

describe("papel no Visita com a etapa 2 (TL vira corretor-líder)", () => {
  it("chave desligada: tabela 4.1 de sempre (TL = imobiliaria_admin)", () => {
    expect(papelVisita(["team_leader"], false)).toBe("imobiliaria_admin");
    expect(papelVisita(["corretor", "team_leader"], false)).toBe("imobiliaria_admin");
  });
  it("chave ligada: TL puro (ou corretor+TL) vira corretor", () => {
    expect(papelVisita(["team_leader"], true)).toBe("corretor");
    expect(papelVisita(["corretor", "team_leader"], true)).toBe("corretor");
  });
  it("chave ligada: gestor+TL, coordenador+TL e admin+TL continuam imobiliaria_admin (decisão 1)", () => {
    expect(papelVisita(["gestor", "team_leader"], true)).toBe("imobiliaria_admin");
    expect(papelVisita(["coordenador", "team_leader"], true)).toBe("imobiliaria_admin");
    expect(papelVisita(["admin", "team_leader"], true)).toBe("imobiliaria_admin");
    expect(papelVisita(["gestor"], true)).toBe("imobiliaria_admin");
  });
  it("corretor e papéis sem acesso não mudam", () => {
    expect(papelVisita(["corretor"], true)).toBe("corretor");
    expect(papelVisita(["juridico"], true)).toBe("none");
  });
  it("etapa 2 só vale com a etapa 1 ligada", () => {
    expect(tlComoLider({ visita_tl_lider: true, visita_equipes: false })).toBe(false);
    expect(tlComoLider({ visita_tl_lider: true })).toBe(false);
    // ligada mas ainda sem confirmação do Visita: TL NÃO é rebaixado
    expect(tlComoLider({ visita_tl_lider: true, visita_equipes: true })).toBe(false);
    expect(tlComoLider({ visita_tl_lider: true, visita_equipes: true, visita_equipes_ok_em: "2026-10-22" })).toBe(true);
    expect(tlComoLider({ visita_tl_lider: false, visita_equipes: true })).toBe(false);
  });
  it("Estudo/60 Dias não são afetados pela chave do Visita", () => {
    expect(pessoaParaSatelite(linha(), "estudo", { tlLider: true }).papel).toBe("manager");
    expect(pessoaParaSatelite(linha(), "visita", { tlLider: true }).papel).toBe("corretor");
    expect(pessoaParaSatelite(linha(), "visita", { tlLider: true }).admin_adm).toBe(false);
  });
});

describe("equipes do ADM para o Visita", () => {
  it("só ids, nome e cor (sem dado pessoal)", () => {
    const e = equipeParaVisita(EQUIPES[0] as any);
    expect(e).toEqual({
      adm_team_id: "t1",
      nome: "Equipe Alfa",
      cor: "#123456",
      parent_adm_team_id: null,
      lider_adm_user_id: "u1",
      colideres_adm_user_ids: ["u3"],
      membros_adm_user_ids: ["u2"],
    });
  });

  it("chave desligada e nada pendente: não envia nada", async () => {
    const admin = fakeAdmin({});
    const { amb, enviados } = ambiente();
    expect(await sincronizarEquipesVisita(admin, amb, mapaBase(), "live")).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it("Visita desligado ou modo off: não envia", async () => {
    const admin = fakeAdmin({});
    const { amb, enviados } = ambiente();
    expect(
      await sincronizarEquipesVisita(
        admin,
        amb,
        mapaBase({ visita_equipes: true, visita_enabled: false }),
        "live",
      ),
    ).toBeNull();
    expect(
      await sincronizarEquipesVisita(admin, amb, mapaBase({ visita_equipes: true }), "off"),
    ).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it("chave ligada: envia acao=equipes assinada para a imobiliária do Visita", async () => {
    const admin = fakeAdmin({});
    const { amb, enviados } = ambiente();
    const r = await sincronizarEquipesVisita(
      admin,
      amb,
      mapaBase({ visita_equipes: true }),
      "dry_run",
    );
    expect(r?.erro).toBeNull();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].body).toMatchObject({
      acao: "equipes",
      modo: "dry_run",
      org_id: "V",
      ligado: true,
    });
    expect(enviados[0].body.equipes[0].nome).toBe("Equipe Alfa");
    expect(r?.log).toMatchObject({ satelite: "visita", acao: "equipes", adm_org_id: ORG });
  });

  it("chave recém-desligada: manda ligado=false uma vez e limpa a pendência (só em live)", async () => {
    const admin = fakeAdmin({});
    const { amb, enviados } = ambiente({
      resultado: "ok",
      resumo: { chave_desligada: 1 },
      avisos: [],
    });
    const mapa = mapaBase({ visita_equipes: false, visita_equipes_desligar_pendente: true });
    await sincronizarEquipesVisita(admin, amb, mapa, "live");
    expect(enviados[0].body).toMatchObject({ acao: "equipes", ligado: false, equipes: [] });
    expect(admin.gravado.updates).toEqual([
      { nome: "sync_org_map", v: { visita_equipes_desligar_pendente: false } },
    ]);
    const admin2 = fakeAdmin({});
    await sincronizarEquipesVisita(admin2, amb, mapa, "dry_run");
    expect(admin2.gravado.updates).toHaveLength(0);
  });

  it("erro do Visita ou do banco vira erro (sem lançar)", async () => {
    const { amb } = ambiente({ resultado: "erro", erro: "x" });
    const r = await sincronizarEquipesVisita(
      fakeAdmin({}),
      amb,
      mapaBase({ visita_equipes: true }),
      "live",
    );
    expect(r?.erro).toContain("http_200");
    const { amb: amb2 } = ambiente({ error: "org_not_managed" }, 403);
    const r2 = await sincronizarEquipesVisita(
      fakeAdmin({}),
      amb2,
      mapaBase({ visita_equipes: true }),
      "live",
    );
    expect(r2?.erro).toContain("http_403_org_not_managed");
    const r3 = await sincronizarEquipesVisita(
      fakeAdmin({ erroEquipes: true }),
      ambiente().amb,
      mapaBase({ visita_equipes: true }),
      "live",
    );
    expect(r3?.erro).toContain("equipes_da_org");
  });
});

describe("processarFila com as chaves", () => {
  it("etapa 1+2 ligadas mas equipes ainda não confirmadas: TL fica imobiliaria_admin; ao confirmar, marca e reenfileira", async () => {
    const admin = fakeAdmin({
      mapa: mapaBase({ visita_equipes: true, visita_tl_lider: true }),
      itens: [{ id: 1, adm_user_id: "u1" }],
      estado: [linha()],
    });
    const { amb, enviados } = ambiente();
    await processarFila(admin, amb);
    expect(enviados.map((e) => e.body.acao)).toEqual(["apply", "equipes"]);
    expect(enviados[0].body.pessoas[0].papel).toBe("imobiliaria_admin");
    expect(admin.gravado.updates.some((u: any) => u.nome === "sync_org_map" && u.v.visita_equipes_ok_em)).toBe(true);
    expect(admin.gravado.reenfileirar).toEqual([{ p_org: ORG, p_motivo: "visita_equipes_ok" }]);
  });

  it("equipes com erro: NÃO marca confirmação (TL continua imobiliaria_admin na próxima rodada)", async () => {
    const admin = fakeAdmin({
      mapa: mapaBase({ visita_equipes: true, visita_tl_lider: true }),
      itens: [{ id: 1, adm_user_id: "u1" }, { id: 2, adm_user_id: "u1" }],
      estado: [linha()],
    });
    await processarFila(admin, ambiente({ resultado: "erro", erro: "x" }).amb);
    expect(admin.gravado.updates.some((u: any) => u.v?.visita_equipes_ok_em)).toBe(false);
    expect(admin.gravado.reenfileirar).toBeUndefined();
  });

  it("etapa 1+2 ligadas e confirmadas: pessoas primeiro (TL como corretor), depois equipes; conclui ok", async () => {
    const admin = fakeAdmin({
      mapa: mapaBase({ visita_equipes: true, visita_tl_lider: true, visita_equipes_ok_em: "2026-10-22T00:00:00Z" }),
      itens: [{ id: 1, adm_user_id: "u1" }],
      estado: [linha()],
    });
    const { amb, enviados } = ambiente();
    await processarFila(admin, amb);
    expect(enviados.map((e) => e.body.acao)).toEqual(["apply", "equipes"]);
    expect(enviados[0].body.pessoas[0].papel).toBe("corretor");
    expect(admin.gravado.concluir).toEqual([{ p_id: 1, p_resultado: "ok", p_erro: null }]);
    expect(admin.gravado.sync_log.some((l: any) => l.acao === "equipes")).toBe(true);
  });

  it("só a etapa 2 ligada (sem equipes): TL continua imobiliaria_admin e nada de equipes", async () => {
    const admin = fakeAdmin({
      mapa: mapaBase({ visita_tl_lider: true }),
      itens: [{ id: 1, adm_user_id: "u1" }],
      estado: [linha()],
    });
    const { amb, enviados } = ambiente();
    await processarFila(admin, amb);
    expect(enviados.map((e) => e.body.acao)).toEqual(["apply"]);
    expect(enviados[0].body.pessoas[0].papel).toBe("imobiliaria_admin");
  });

  it("falha nas equipes: só 1 item da org volta para nova tentativa (as pessoas aplicadas ficam ok)", async () => {
    const admin = fakeAdmin({
      mapa: mapaBase({ visita_equipes: true }),
      itens: [{ id: 7, adm_user_id: "u1" }, { id: 8, adm_user_id: "u1" }],
      estado: [linha()],
    });
    const { amb } = ambiente({ resultado: "erro", erro: "x" });
    await processarFila(admin, amb);
    expect(admin.gravado.concluir[0]).toMatchObject({ p_id: 7, p_resultado: "erro" });
    expect(admin.gravado.concluir[0].p_erro).toContain("visita_equipes");
    expect(admin.gravado.concluir[1]).toMatchObject({ p_id: 8, p_resultado: "ok" });
  });
});
