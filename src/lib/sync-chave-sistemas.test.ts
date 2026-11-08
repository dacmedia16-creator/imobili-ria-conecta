/* eslint-disable @typescript-eslint/no-explicit-any -- banco e satélites falsos do teste */
// Passo 3, etapa 0 (t_1969ae17): chave por imobiliária de cada sistema + cópia nos satélites. Dados fictícios.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  acessoDaOrg,
  carregarChaves,
  processarFila,
  reconciliar,
  type LinhaEstado,
  type Satelite,
} from "../../supabase/functions/sync-satelites/core.ts";
import { ORGANIZATION_MODULES, ORGANIZATION_MODULE_LABELS } from "./platform-organizations";

const ORG = "00000000-0000-4000-8000-000000000001";
const S = "s".repeat(40);
const MIG = readFileSync("supabase/migrations/20261105150000_chave_sistemas_etapa0.sql", "utf8");
const RB = readFileSync(
  "docs/sql/rollback/20261105150000_chave_sistemas_etapa0.rollback.sql",
  "utf8",
);

const linha = (o: Partial<LinhaEstado> = {}): LinhaEstado => ({
  adm_user_id: "u1",
  org_id: ORG,
  email: "corretor@exemplo.com.br",
  nome: "Corretor Teste",
  telefone: null,
  ativo: true,
  roles: ["admin"],
  lider_email: null,
  ...o,
});

type Modulo = { organization_id: string; module: string; enabled: boolean };

function fakeAdmin(o: { modulos?: Modulo[] | "erro" | "excecao" }) {
  const gravado: Record<string, any[]> = { sync_log: [], concluir: [], sync_reconcile_runs: [] };
  const tabela = (nome: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => {
        if (nome === "organization_modules" && o.modulos === "excecao") throw new Error("rede");
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
      then: (res: (v: unknown) => void) => {
        if (nome === "organization_modules") {
          return res(
            o.modulos === "erro"
              ? { data: null, error: { message: "permission denied" } }
              : { data: o.modulos ?? [], error: null },
          );
        }
        return res({
          data:
            nome === "sync_org_map"
              ? [
                  {
                    adm_org_id: ORG,
                    estudo_org_id: "E",
                    visita_imobiliaria_id: "V",
                    sessenta_org_id: "D",
                    mode: "live",
                    estudo_enabled: true,
                    visita_enabled: true,
                    sessenta_enabled: true,
                  },
                ]
              : nome === "platform_admins"
                ? [{ user_id: "conta-plataforma" }]
                : [],
          error: null,
        });
      },
    };
    return q;
  };
  return {
    gravado,
    from: tabela,
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

function ambiente(respAcesso: (sat: Satelite, body: any) => any = () => null) {
  const enviados: Array<{ sat: Satelite; body: any }> = [];
  return {
    enviados,
    amb: {
      segredos: { estudo: S, visita: S, sessenta: S },
      enviar: async (sat: Satelite, corpo: string) => {
        const body = JSON.parse(corpo);
        enviados.push({ sat, body });
        return {
          status: 200,
          json: {
            modo: body.modo,
            acesso: respAcesso(sat, body),
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

describe("chave por imobiliária: leitura e valor enviado", () => {
  it("sem linha = ligado; false só quando a chave está desligada", async () => {
    const chaves = await carregarChaves(
      fakeAdmin({ modulos: [{ organization_id: ORG, module: "visita", enabled: false }] }),
    );
    expect(acessoDaOrg(chaves, ORG, "visita")).toBe(false);
    expect(acessoDaOrg(chaves, ORG, "estudo")).toBe(true);
    expect(acessoDaOrg(chaves, "outra", "sessenta")).toBe(true);
  });

  it("leitura com erro ou exceção: não manda o campo (satélite mantém a cópia)", async () => {
    expect(await carregarChaves(fakeAdmin({ modulos: "erro" }))).toBeNull();
    expect(await carregarChaves(fakeAdmin({ modulos: "excecao" }))).toBeNull();
    expect(acessoDaOrg(null, ORG, "visita")).toBeUndefined();
  });
});

describe("processarFila leva a cópia da chave a cada satélite", () => {
  it("manda acesso por satélite, conforme organization_modules", async () => {
    const admin = fakeAdmin({
      modulos: [
        { organization_id: ORG, module: "visita", enabled: true },
        { organization_id: ORG, module: "estudo", enabled: true },
        { organization_id: ORG, module: "sessenta", enabled: false },
      ],
    });
    const { amb, enviados } = ambiente();
    await processarFila(admin, amb);
    const por = Object.fromEntries(enviados.map((e) => [e.sat, e.body]));
    expect(por.visita.acesso).toBe(true);
    expect(por.estudo.acesso).toBe(true);
    expect(por.sessenta.acesso).toBe(false);
    // a pessoa continua indo normalmente (o cadastro não para com a chave desligada)
    expect(por.sessenta.pessoas).toHaveLength(1);
    expect(admin.gravado.concluir[0]).toMatchObject({ p_id: 1, p_resultado: "ok" });
  });

  it("leitura falhou: nenhum lote leva o campo acesso e a rodada segue", async () => {
    const admin = fakeAdmin({ modulos: "erro" });
    const { amb, enviados } = ambiente();
    await processarFila(admin, amb);
    expect(enviados.length).toBe(3);
    for (const e of enviados) expect("acesso" in e.body).toBe(false);
    expect(admin.gravado.concluir[0]).toMatchObject({ p_resultado: "ok" });
  });

  it("sync_log: registra só quando a cópia mudou ou deu erro; erro na cópia não derruba a pessoa", async () => {
    const admin = fakeAdmin({ modulos: [] });
    const { amb } = ambiente((sat) =>
      sat === "visita"
        ? { resultado: "ok" }
        : sat === "estudo"
          ? { resultado: "erro", erro: "falhou" }
          : { resultado: "nada_a_fazer" },
    );
    await processarFila(admin, amb);
    const logs = admin.gravado.sync_log.filter((l) => l.acao === "acesso");
    expect(logs.map((l) => [l.satelite, l.resultado]).sort()).toEqual([
      ["estudo", "erro"],
      ["visita", "ok"],
    ]);
    for (const l of logs) {
      expect(l.adm_user_id).toBeNull();
      expect(l.adm_org_id).toBe(ORG);
    }
    expect(admin.gravado.concluir[0]).toMatchObject({ p_resultado: "ok" });
  });

  it("reconciliar (dry_run) também manda o acesso e devolve o que o satélite faria", async () => {
    const admin = fakeAdmin({
      modulos: [{ organization_id: ORG, module: "visita", enabled: false }],
    });
    const { amb, enviados } = ambiente(() => ({ resultado: "simulado" }));
    const r: any = await reconciliar(admin, amb);
    const v = enviados.find((e) => e.sat === "visita")!;
    expect(v.body.modo).toBe("dry_run");
    expect(v.body.acesso).toBe(false);
    expect(r.relatorios[0].visita.acesso).toEqual({ resultado: "simulado" });
  });
});

describe("módulos na tela da plataforma", () => {
  it("visita, estudo e sessenta entram na lista, com rótulo de sistema", () => {
    for (const m of ["visita", "estudo", "sessenta"] as const) {
      expect(ORGANIZATION_MODULES).toContain(m);
      expect(ORGANIZATION_MODULE_LABELS[m]).toMatch(/MAX \(sistema/);
    }
  });
});

describe("migration 20261105150000 (chave dos sistemas)", () => {
  it("CHECK e lista da RPC iguais à lista do código", () => {
    const check = MIG.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "";
    const rpc = MIG.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "";
    const nomes = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(nomes(check)).toEqual(
      [...ORGANIZATION_MODULES]
        .filter(
          (x) =>
            x !== "meu_plano_2027" &&
            x !== "avisos_exclusividade" &&
            x !== "inteligencia_gestao" &&
            x !== "link_acompanhamento",
        )
        .sort(),
    );
    expect(nomes(rpc)).toEqual(
      [...ORGANIZATION_MODULES]
        .filter(
          (x) =>
            x !== "meu_plano_2027" &&
            x !== "avisos_exclusividade" &&
            x !== "inteligencia_gestao" &&
            x !== "link_acompanhamento",
        )
        .sort(),
    );
  });

  it("só a plataforma altera: a RPC confere is_platform_super_admin", () => {
    expect(MIG).toMatch(/NOT public\.is_platform_super_admin\(_actor\)/);
    expect(MIG).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)/i);
  });

  it("valor inicial copia o sync_org_map, sem sobrescrever (ON CONFLICT DO NOTHING)", () => {
    expect(MIG).toMatch(/WHEN 'visita'\s+THEN coalesce\(m\.visita_enabled, true\)/);
    expect(MIG).toMatch(/WHEN 'estudo'\s+THEN coalesce\(m\.estudo_enabled, true\)/);
    expect(MIG).toMatch(/WHEN 'sessenta' THEN coalesce\(m\.sessenta_enabled, false\)/);
    expect(MIG).toMatch(/ON CONFLICT \(organization_id, module\) DO NOTHING;\s*\n\s*\n-- 3\)/);
  });

  it("imobiliária nova: Visita e Estudo ligados, 60 Dias desligado", () => {
    expect(MIG).toMatch(/\(NEW\.id, 'visita', true/);
    expect(MIG).toMatch(/\(NEW\.id, 'estudo', true/);
    expect(MIG).toMatch(/\(NEW\.id, 'sessenta', false/);
    expect(MIG).toMatch(/AFTER INSERT ON public\.organizations/);
  });

  it("gatilho de reenfileirar é criado DEPOIS do preenchimento e nunca derruba a gravação", () => {
    expect(MIG.indexOf("CREATE TRIGGER trg_zz_org_sistema_chave")).toBeGreaterThan(
      MIG.indexOf("CROSS JOIN (VALUES ('visita')"),
    );
    expect(MIG).toMatch(/EXCEPTION WHEN others THEN\s+RAISE WARNING/);
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.org_sistema_chave_trg\(\) FROM PUBLIC, anon, authenticated/,
    );
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.org_sistemas_padrao_trg\(\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it("rollback tira gatilhos, linhas e volta CHECK/RPC à lista anterior", () => {
    expect(RB).toMatch(/DROP TRIGGER IF EXISTS trg_zz_org_sistema_chave/);
    expect(RB).toMatch(/DROP TRIGGER IF EXISTS trg_zz_org_sistemas_padrao/);
    expect(RB).toMatch(
      /DELETE FROM public\.organization_modules WHERE module IN \('visita', 'estudo', 'sessenta'\)/,
    );
    expect(RB).not.toMatch(/'sessenta'\)\)/);
  });
});
