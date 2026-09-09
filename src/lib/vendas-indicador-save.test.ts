import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  podeSincronizarResumo,
  temEdicaoFinanceiraResumo,
  resumoTemPendencia,
} from "./resumo-sync-guard";
import { corretorPodeEditar, isSaleLocked } from "./sale-permissions";
import { saleManagementCapabilities } from "./sale-management-capabilities";

// OFFLINE: executa os handlers extraídos do TSX real. Somente as fronteiras React/Supabase
// são simuladas. Não monta DOM, não executa PostgreSQL/RLS nem chama rede/produção.
const source = readFileSync(
  new URL("../routes/_authenticated/vendas.$id.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "route.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes: ts.Node[] = [];
function visit(n: ts.Node) {
  nodes.push(n);
  ts.forEachChild(n, visit);
}
visit(ast);
const named = (name: string) =>
  nodes.find(
    (n) =>
      (ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name?.getText(ast) === name,
  );
function expression(name: string) {
  const n = named(name);
  if (!n) throw new Error(`Handler não encontrado: ${name}`);
  return ts.isVariableDeclaration(n) ? n.initializer!.getText(ast) : n.getText(ast);
}
function js(text: string) {
  return ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const sides = ["captador", "vendedor"] as const;
// Única fronteira dinâmica: o VM recebe closures TSX sem importar/montar o app ou seu client real.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bag = Record<string, any>;
function fixture(): Bag {
  const row: Bag = {
    id: "sale-fixture",
    status: "enviada_revisao",
    corretor_id: "owner-fixture",
    parceria_tipo: null,
    valor_negociado: 395000,
    valor_total_comissao: 23700,
    valor_comissao_imobiliaria: 13035,
  };
  for (const side of sides)
    Object.assign(row, {
      [`corretor_${side}`]: "Pessoa sintética A",
      [`corretor_${side}_id`]: "person-a",
      [`valor_comissao_${side}`]: 5332.5,
      [`indicador_${side}`]: "Indicador sintético",
      [`indicador_${side}_id`]: `indicator-${side}`,
      [`valor_comissao_indicador_${side}`]: 592.5,
      [`lider_${side}_nome`]: "Líder sintético",
      [`lider_${side}_id`]: `leader-${side}`,
      [`valor_comissao_lider_${side}`]: 0,
    });
  return row;
}
function harness(initial = fixture()) {
  let db = structuredClone(initial);
  let extras: Bag[] = [];
  let derived: Bag[] = [
    { papel: "indicador_captador", managed_by_sale: false, valor: 77, user_id: "manual" },
  ];
  const calls: Bag[] = [];
  const errors: string[] = [];
  const failure: Bag = {};
  let hasOccurrence = true;
  const context: Bag = {
    sale: structuredClone(db),
    formSale: structuredClone(db),
    dirtyResumo: false,
    dirtyExtras: false,
    formExtras: [],
    commissionExtras: [],
    dirtyMap: {},
    saversRef: { current: {} },
    savingResumoRef: { current: false },
    resumoSaveFailed: false,
    editable: true,
    roles: ["gestor"],
    user: { id: "gestor-fixture" },
    teamIds: new Set(["owner-fixture"]),
    podeSincronizarResumo,
    saleManagementCapabilities,
    temEdicaoFinanceiraResumo,
    resumoTemPendencia,
    corretorPodeEditar,
    isSaleLocked,
    asDistribution: (value: unknown) => value,
    id: "sale-fixture",
    indicadorOptions: [{ id: "replacement", nome: "Substituto sintético" }],
    setSaving: (v: boolean) => {
      context.saving = v;
    },
    setResumoSaveFailed: (v: boolean) => {
      context.resumoSaveFailed = v;
    },
    setDirtyResumo: (v: boolean) => {
      context.dirtyResumo = v;
    },
    setDirtyExtras: (v: boolean) => {
      context.dirtyExtras = v;
    },
    setFormSale: (v: Bag | ((row: Bag) => Bag)) => {
      context.formSale = typeof v === "function" ? v(context.formSale) : v;
    },
    setFormExtras: (v: Bag[]) => {
      context.formExtras = v;
    },
    setCommissionExtras: (v: Bag[]) => {
      context.commissionExtras = v;
    },
    toast: { error: (v: string) => errors.push(v), success: () => {} },
    errorMessage: (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback),
    STATUS_LABEL: {},
    notifySaleStatusChange: async () => {},
    load: async () => {
      context.sale = structuredClone(db);
      if (!context.dirtyResumo) context.formSale = structuredClone(db);
      context.commissionExtras = structuredClone(extras);
      if (!context.dirtyExtras) context.formExtras = structuredClone(extras);
    },
  };
  // Modelo MÍNIMO do contrato SQL inspecionado: transação, NULL vs zero e chave por papel/extra.
  // Asserções de estado derivado abaixo são do modelo, NÃO evidência de gravação PostgreSQL.
  function syncModel() {
    if (!hasOccurrence) return;
    const next = derived.filter((r) => !r.managed_by_sale);
    for (const side of sides) {
      for (const role of ["corretor", "indicador", "lider"]) {
        const nameKey = role === "lider" ? `lider_${side}_nome` : `${role}_${side}`;
        const valueKey =
          role === "corretor" ? `valor_comissao_${side}` : `valor_comissao_${role}_${side}`;
        const nome = db[nameKey] ?? null;
        const user_id = db[`${role}_${side}_id`] ?? null;
        const bruto = db[valueKey] ?? null;
        if (nome === null && user_id === null && bruto === null) continue;
        if (!user_id)
          throw {
            code: "23514",
            message: "private SQL",
            details: "private row",
            hint: "private hint",
          };
        const valor =
          role === "corretor"
            ? bruto -
              (db[`valor_comissao_indicador_${side}`] ?? 0) -
              (db[`valor_comissao_lider_${side}`] ?? 0)
            : bruto;
        next.push({ papel: `${role}_${side}`, nome, user_id, valor, managed_by_sale: true });
      }
    }
    for (const e of extras)
      next.push({ ...e, sale_commission_extra_id: e.id, managed_by_sale: true });
    derived = next;
  }
  context.supabase = {
    rpc: async (name: string, payload: Bag) => {
      calls.push({ op: "rpc", name, payload });
      if (name === "sale_management_capabilities")
        return {
          data: {
            can_manage: context.roles.includes("gestor") || context.roles.includes("team_leader"),
            can_edit: !failure.locked,
            team_owner: failure.auxiliary === true || context.teamIds.has(db.corretor_id),
            auxiliary: failure.auxiliary === true,
          },
          error: failure.capability ?? null,
        };
      if (name === "calcular_distribuicao_venda")
        return {
          data: failure.distributionMissing
            ? null
            : {
                liquido_captador:
                  db.valor_comissao_captador - (db.valor_comissao_indicador_captador ?? 0),
                liquido_vendedor:
                  db.valor_comissao_vendedor - (db.valor_comissao_indicador_vendedor ?? 0),
              },
          error: failure.read ?? null,
        };
      if (name !== "sync_occurrence_commissions") return { error: null };
      if (failure.rpc) return { error: failure.rpc };
      try {
        syncModel();
        return { error: null };
      } catch (error) {
        return { error };
      }
    },
    from: (table: string) => {
      let operation = "select";
      let data: Bag;
      const filters: Bag = {};
      const run = async () => {
        calls.push({ table, operation, data: structuredClone(data), filters: { ...filters } });
        if (operation === "select" && failure.read) return { data: null, error: failure.read };
        if (table === "sales" && operation === "select")
          return { data: structuredClone(db), error: null };
        if (table === "occurrence_commissions")
          return { data: structuredClone(derived), error: null };
        if (table === "sales" && operation === "update") {
          if (failure.updateThrow) throw failure.updateThrow;
          if (failure.update) return { error: failure.update };
          db = { ...db, ...data };
          return { error: null };
        }
        if (table === "sale_commission_extras") {
          if (failure.extra) return { error: failure.extra };
          if (operation === "insert") {
            const row = { ...data, id: `extra-${extras.length}` };
            extras.push(row);
            return { data: row, error: null };
          }
          if (operation === "update")
            extras = extras.map((e) => (e.id === filters.id ? { ...e, ...data } : e));
          if (operation === "delete") extras = extras.filter((e) => e.id !== filters.id);
          return { data: extras, error: null };
        }
        if (table === "occurrences")
          return {
            data: hasOccurrence ? { id: "occ-fixture", aceita_financeiro: !!failure.locked } : null,
            error: null,
          };
        if (table === "occurrence_partners") return { data: [], error: failure.partner ?? null };
        throw new Error(`Fronteira não prevista: ${table}`);
      };
      const chain: Bag = {
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
          run().then(resolve, reject),
      };
      for (const method of ["update", "insert", "delete"])
        chain[method] = (v: Bag) => {
          operation = method;
          data = v;
          return chain;
        };
      chain.select = () => chain;
      chain.eq = (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      };
      chain.single = run;
      chain.maybeSingle = run;
      return chain;
    },
  };
  vm.createContext(context);
  for (const name of [
    "resumoSaveErrorMessage",
    "syncOccurrenceCommissions",
    "syncOccurrencePartnerFromSale",
    "updResumo",
    "resumoSyncAllowed",
    "saveResumo",
    "flushAllDirty",
    "changeStatus",
    "onBeforeLeave",
  ]) {
    if (named(name)) vm.runInContext(js(`globalThis.${name} = ${expression(name)};`), context);
  }
  function select(side: string, value: string) {
    const selectNode = nodes.find(
      (n) =>
        ts.isJsxOpeningElement(n) &&
        n.tagName.getText(ast) === "Select" &&
        n.attributes.properties.some(
          (p) =>
            ts.isJsxAttribute(p) &&
            p.name.getText(ast) === "value" &&
            p.getText(ast).includes(`formSale.indicador_${side}_id`),
        ),
    );
    if (!selectNode || !ts.isJsxOpeningElement(selectNode)) throw new Error("Select ausente");
    const attr = selectNode.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(ast) === "onValueChange",
    ) as ts.JsxAttribute;
    const handler = (attr.initializer as ts.JsxExpression).expression!;
    context.selection = value;
    vm.runInContext(js(`(${handler.getText(ast)})(selection)`), context);
  }
  return {
    context,
    select,
    calls,
    errors,
    failure,
    db: () => db,
    derived: () => derived,
    noOccurrence: () => {
      hasOccurrence = false;
    },
    remount: () => {
      context.dirtyResumo = false;
      context.dirtyExtras = false;
      context.resumoSaveFailed = false;
      return context.load();
    },
  };
}
const syncCalls = (h: ReturnType<typeof harness>) =>
  h.calls.filter((c) => c.name === "sync_occurrence_commissions");

describe("remoção de indicadores e retomada — handlers reais, backend MOCK offline", () => {
  it("630601093-153: auxiliar salva antes de avançar sem depender da lista de subordinados", async () => {
    const h = harness();
    h.db().status = "contrato_conferencia_gestor";
    h.db().codigo_interno = "630601093-153";
    h.context.teamIds = new Set();
    h.failure.auxiliary = true;
    h.noOccurrence();
    await h.remount();
    h.context.formSale.imovel_observacoes = "Conferência sintética";
    h.context.dirtyResumo = true;
    await h.context.changeStatus("aguardando_assinatura");
    const save = h.calls.findIndex((c) => c.table === "sales" && c.operation === "update");
    const advance = h.calls.findIndex((c) => c.name === "change_sale_status");
    expect(save).toBeGreaterThanOrEqual(0);
    expect(advance).toBeGreaterThan(save);
    expect(h.db().imovel_observacoes).toBe("Conferência sintética");
  });
  it("falha ao consultar capacidade interrompe save e avanço sem escrita", async () => {
    const h = harness();
    h.failure.capability = { code: "42501" };
    await h.context.changeStatus("aguardando_assinatura");
    expect(h.calls.some((c) => c.name === "change_sale_status")).toBe(false);
    expect(h.calls.some((c) => c.operation === "update")).toBe(false);
    expect(syncCalls(h)).toHaveLength(0);
  });
  it.each([
    ["juridico", "aprovada_gestor", "em_elaboracao_contrato"],
    ["corretor", "contrato_conferencia_corretor", "contrato_ok_corretor"],
  ])("%s avança limpo com ocorrência sem escrita financeira", async (role, status, next) => {
    const h = harness();
    expect(await h.context.saveResumo()).toBe(true);
    h.db().status = status;
    h.context.roles = [role];
    h.context.user = { id: role === "corretor" ? "owner-fixture" : "juridico-fixture" };
    await h.remount();
    h.calls.length = 0;
    h.failure.rpc = { code: "42501" }; // Seria negada se fosse chamada.
    await h.context.changeStatus(next);
    expect(h.calls.some((c) => c.name === "change_sale_status")).toBe(true);
    expect(syncCalls(h)).toHaveLength(0);
    expect(h.calls.filter((c) => c.operation && c.operation !== "select")).toEqual([]);
  });
  it("pendência persistida após reload bloqueia jurídico e responsável sincroniza por retry", async () => {
    const h = harness();
    expect(await h.context.saveResumo()).toBe(true);
    sides.forEach((side) => h.select(side, "none"));
    h.failure.rpc = { code: "42501" };
    expect(await h.context.saveResumo()).toBe(false);
    await h.remount();
    h.context.roles = ["juridico"];
    h.calls.length = 0;
    await h.context.changeStatus("em_elaboracao_contrato");
    expect(h.calls.some((c) => c.name === "change_sale_status")).toBe(false);
    expect(syncCalls(h)).toHaveLength(0);
    expect(h.errors.at(-1)).toContain("gestor/financeiro");
    h.context.roles = ["gestor"];
    delete h.failure.rpc;
    expect(await h.context.saveResumo()).toBe(true);
    h.context.roles = ["juridico"];
    expect(await h.context.saveResumo()).toBe(true);
  });
  it("edição financeira não autorizada bloqueia antes de qualquer escrita", async () => {
    const h = harness();
    h.context.roles = ["juridico"];
    h.select("captador", "none");
    expect(await h.context.saveResumo()).toBe(false);
    expect(h.calls.filter((c) => c.operation && c.operation !== "select")).toEqual([]);
    expect(syncCalls(h)).toHaveLength(0);
  });
  it("edição não financeira legítima continua salvando sem RPC financeira", async () => {
    const h = harness();
    expect(await h.context.saveResumo()).toBe(true);
    h.context.roles = ["juridico"];
    h.context.updResumo({ matricula: "revisada" });
    h.calls.length = 0;
    expect(await h.context.saveResumo()).toBe(true);
    expect(h.db().matricula).toBe("revisada");
    expect(syncCalls(h)).toHaveLength(0);
  });
  it.each(["read", "distributionMissing"])("falha %s não confirma sincronismo", async (key) => {
    const h = harness();
    expect(await h.context.saveResumo()).toBe(true);
    h.context.roles = ["juridico"];
    h.failure[key] = key === "read" ? { code: "42501" } : true;
    h.calls.length = 0;
    await h.context.changeStatus("em_elaboracao_contrato");
    expect(h.calls.some((c) => c.name === "change_sale_status")).toBe(false);
    expect(syncCalls(h)).toHaveLength(0);
  });
  it("trava financeira preservada: gestor bloqueado, financeiro pode sincronizar", async () => {
    const h = harness();
    expect(await h.context.saveResumo()).toBe(true);
    h.failure.locked = true;
    h.select("captador", "none");
    h.calls.length = 0;
    expect(await h.context.saveResumo()).toBe(false);
    expect(h.calls.filter((c) => c.operation && c.operation !== "select")).toEqual([]);
    h.context.roles = ["financeiro"];
    expect(await h.context.saveResumo()).toBe(true);
  });
  it.each(sides)(
    "remove %s no estado, payload e modelo derivado sem mudar brutos/manuais",
    async (side) => {
      const h = harness();
      h.select(side, "none");
      expect(h.context.formSale[`valor_comissao_indicador_${side}`]).toBeNull();
      expect(await h.context.saveResumo()).toBe(true);
      expect(h.db()[`valor_comissao_indicador_${side}`]).toBeNull();
      expect(h.db()[`valor_comissao_${side}`]).toBe(5332.5);
      expect(h.db().valor_total_comissao).toBe(23700);
      expect(
        h.derived().filter((r) => r.managed_by_sale && r.papel === `indicador_${side}`),
      ).toEqual([]);
      expect(h.derived().find((r) => !r.managed_by_sale)?.valor).toBe(77);
      expect(h.derived().find((r) => r.papel === `corretor_${side}`)?.valor).toBe(5332.5);
      expect(h.calls.find((c) => c.table === "sales" && c.operation === "update")?.data).toEqual({
        [`indicador_${side}`]: null,
        [`indicador_${side}_id`]: null,
        [`valor_comissao_indicador_${side}`]: null,
      });
    },
  );
  it("remove ambos e mantém a mesma pessoa em dois papéis", async () => {
    const h = harness();
    sides.forEach((s) => h.select(s, "none"));
    expect(await h.context.saveResumo()).toBe(true);
    expect(
      h
        .derived()
        .filter((r) => r.user_id === "person-a")
        .map((r) => r.papel),
    ).toEqual(["corretor_captador", "corretor_vendedor"]);
    expect(h.db().valor_comissao_imobiliaria).toBe(13035);
  });
  it.each([592.5, 0, null])(
    "normaliza indicador já ausente com residual %s apenas ao salvar",
    async (value) => {
      const row = fixture();
      sides.forEach((s) =>
        Object.assign(row, {
          [`indicador_${s}`]: null,
          [`indicador_${s}_id`]: null,
          [`valor_comissao_indicador_${s}`]: value,
        }),
      );
      const h = harness(row);
      expect(h.calls).toEqual([]);
      expect(h.db().valor_comissao_indicador_captador).toBe(value);
      expect(await h.context.saveResumo()).toBe(true);
      sides.forEach((s) => expect(h.db()[`valor_comissao_indicador_${s}`]).toBeNull());
      expect(syncCalls(h)).toHaveLength(1);
    },
  );
  it("reassocia sem reaproveitar residual de quem foi removido", async () => {
    const h = harness();
    h.select("captador", "none");
    h.select("captador", "replacement");
    expect(h.context.formSale.indicador_captador_id).toBe("replacement");
    expect(h.context.formSale.valor_comissao_indicador_captador).toBeNull();
    expect(await h.context.saveResumo()).toBe(true);
  });
  it("troca diretamente pessoa preservando comissão deliberadamente preenchida", async () => {
    const h = harness();
    h.select("captador", "replacement");
    expect(await h.context.saveResumo()).toBe(true);
    expect(h.db().valor_comissao_indicador_captador).toBe(592.5);
  });
  it.each(["nome", "id"])(
    "não limpa comissão com identidade parcial legítima: %s",
    async (field) => {
      const row = fixture();
      row[field === "nome" ? "indicador_captador_id" : "indicador_captador"] = null;
      const h = harness(row);
      await h.context.saveResumo();
      expect(h.db().valor_comissao_indicador_captador).toBe(592.5);
      expect(h.calls.filter((c) => c.table === "sales" && c.operation === "update")).toEqual([]);
    },
  );
  it("sem ocorrência: salva remoção, sem criar ocorrência/linhas", async () => {
    const h = harness();
    h.noOccurrence();
    h.select("vendedor", "none");
    expect(await h.context.saveResumo()).toBe(true);
    expect(h.calls.filter((c) => c.operation === "insert")).toEqual([]);
  });
  it("falha de UPDATE não sincroniza nem libera avanço", async () => {
    const h = harness();
    h.select("captador", "none");
    h.failure.update = { code: "42501", message: "private token" };
    expect(await h.context.saveResumo()).toBe(false);
    expect(syncCalls(h)).toHaveLength(0);
    expect(h.errors.join()).not.toContain("private token");
    await h.context.changeStatus("aprovada_gestor");
    expect(h.calls.some((c) => c.name === "change_sale_status")).toBe(false);
    expect(h.db().indicador_captador_id).toBe("indicator-captador");
  });
  it("exceção de transporte vira falha segura, não rejeição sem tratamento", async () => {
    const h = harness();
    h.select("captador", "none");
    h.failure.updateThrow = new Error("private URL/token");
    expect(await h.context.saveResumo()).toBe(false);
    expect(h.errors.join()).not.toContain("private");
    expect(h.context.saving).toBe(false);
  });
  it.each([false, true])("retry de RPC sem patch, inclusive remontagem=%s", async (remount) => {
    const h = harness();
    h.context.updResumo({ matricula: "sintética" });
    h.failure.rpc = { code: "23514", message: "private", details: "private", hint: "private" };
    expect(await h.context.saveResumo()).toBe(false);
    expect(h.db().matricula).toBe("sintética");
    if (remount) await h.remount();
    expect(await h.context.saveResumo()).toBe(false);
    expect(syncCalls(h)).toHaveLength(2);
    delete h.failure.rpc;
    expect(await h.context.saveResumo()).toBe(true);
    expect(syncCalls(h)).toHaveLength(3);
    expect(h.errors.join()).not.toContain("erro desconhecido");
    expect(h.errors.join()).not.toContain("private");
    expect(h.errors.join()).toContain("23514");
  });
  it("avanço e saída de Resumo após reload não contornam falha", async () => {
    const h = harness();
    h.failure.rpc = { code: "42501" };
    await h.remount();
    expect(await h.context.flushAllDirty()).toBe(false);
    expect(await h.context.onBeforeLeave("resumo")).toBe(false);
    await h.context.changeStatus("aprovada_gestor");
    expect(h.calls.some((c) => c.name === "change_sale_status")).toBe(false);
    delete h.failure.rpc;
    await h.context.changeStatus("aprovada_gestor");
    expect(h.calls.filter((c) => c.name === "change_sale_status")).toHaveLength(1);
  });
  it("falha da parceria também bloqueia; retry refaz ambas etapas", async () => {
    const h = harness();
    h.context.updResumo({ matricula: "sintética" });
    h.failure.partner = { code: "42501" };
    expect(await h.context.saveResumo()).toBe(false);
    await h.remount();
    expect(await h.context.saveResumo()).toBe(false);
    delete h.failure.partner;
    expect(await h.context.saveResumo()).toBe(true);
    expect(syncCalls(h)).toHaveLength(3);
  });
  it("gestor extra recebe ID definitivo e não duplica após falha/retry", async () => {
    const h = harness();
    h.context.formExtras = [
      {
        id: "new-fixture",
        _new: true,
        nome: "Extra sintético",
        papel: "gestor",
        lado: "vendedor",
        user_id: "extra-person",
        valor: 0,
      },
    ];
    h.context.dirtyExtras = true;
    h.failure.rpc = { code: "23514" };
    expect(await h.context.saveResumo()).toBe(false);
    expect(h.context.formExtras[0]._new).toBe(false);
    delete h.failure.rpc;
    expect(await h.context.saveResumo()).toBe(true);
    expect(
      h.calls.filter((c) => c.table === "sale_commission_extras" && c.operation === "insert"),
    ).toHaveLength(1);
    expect(h.derived().filter((r) => r.sale_commission_extra_id)).toHaveLength(1);
    expect(h.derived().filter((r) => r.papel === "lider_vendedor")).toHaveLength(1);
  });
  it("autosave não agenda retry infinito após falha e não grava ao carregar", async () => {
    const h = harness();
    expect(h.calls).toEqual([]);
    h.context.updResumo({ matricula: "sintética" });
    h.failure.rpc = { code: "23514" };
    expect(await h.context.saveResumo()).toBe(false);
    const call = nodes.find(
      (n) =>
        ts.isCallExpression(n) &&
        n.expression.getText(ast) === "useAutosave" &&
        n.getText(ast).includes("saveResumo"),
    ) as ts.CallExpression;
    expect(vm.runInContext(js(call.arguments[0].getText(ast)), h.context)).toBe(false);
  });
  it("preserva zero quando o indicador segue vinculado", async () => {
    const row = fixture();
    row.valor_comissao_indicador_captador = 0;
    const h = harness(row);
    expect(await h.context.saveResumo()).toBe(true);
    expect(h.db().valor_comissao_indicador_captador).toBe(0);
    expect(
      h.derived().find((r) => r.managed_by_sale && r.papel === "indicador_captador")?.valor,
    ).toBe(0);
  });
  it("normaliza strings vazias sem ampliar a limpeza para outros participantes", async () => {
    const row = fixture();
    row.indicador_captador = "";
    row.indicador_captador_id = "";
    const h = harness(row);
    expect(await h.context.saveResumo()).toBe(true);
    expect(h.db().indicador_captador).toBeNull();
    expect(h.db().indicador_captador_id).toBeNull();
    expect(h.db().lider_captador_id).toBe("leader-captador");
  });
  it("não duplica derivadas ao salvar duas vezes sequencialmente (modelo)", async () => {
    const h = harness();
    h.select("captador", "none");
    expect(await h.context.saveResumo()).toBe(true);
    const first = structuredClone(h.derived());
    expect(await h.context.saveResumo()).toBe(true);
    expect(h.derived()).toEqual(first);
    expect(syncCalls(h)).toHaveLength(2);
  });
  it("salvamento concorrente retorna false e não libera status/duplica RPC", async () => {
    const h = harness();
    const first = h.context.saveResumo();
    expect(await h.context.saveResumo()).toBe(false);
    await h.context.changeStatus("aprovada_gestor");
    expect(h.calls.some((c) => c.name === "change_sale_status")).toBe(false);
    expect(await first).toBe(true);
    expect(syncCalls(h)).toHaveLength(1);
    expect(h.context.savingResumoRef.current).toBe(false);
  });
  it("leitura sem edição não passa a gravar ao navegar no wizard", async () => {
    const h = harness();
    expect(await h.context.saveResumo()).toBe(true);
    h.calls.length = 0;
    h.context.roles = ["juridico"];
    h.context.editable = false;
    expect(await h.context.onBeforeLeave("resumo")).toBe(true);
    expect(h.calls.filter((c) => c.operation && c.operation !== "select")).toEqual([]);
    expect(syncCalls(h)).toHaveLength(0);
  });
  it("falha de extra bloqueia sync e status com mensagem sanitizada", async () => {
    const h = harness();
    h.context.formExtras = [
      { id: "new-fixture", _new: true, papel: "gestor", user_id: "extra-person" },
    ];
    h.context.dirtyExtras = true;
    h.failure.extra = { code: "23503", message: "private payload" };
    expect(await h.context.saveResumo()).toBe(false);
    expect(syncCalls(h)).toHaveLength(0);
    expect(h.errors.join()).toContain("23503");
    expect(h.errors.join()).not.toContain("private");
  });
  it.each(["23514", "23503", "23505", "42501", "PGRST301", "private-code"])(
    "erro %s não expõe message/details/hint",
    async (code) => {
      const h = harness();
      h.failure.rpc = {
        code,
        message: "private-name SELECT token",
        details: "private-row",
        hint: "private-hint",
      };
      expect(await h.context.saveResumo()).toBe(false);
      expect(h.errors.join()).not.toMatch(/private|SELECT|token|erro desconhecido/);
      if (["23514", "23503", "23505", "42501"].includes(code))
        expect(h.errors.join()).toContain(code);
    },
  );
  it.each([null, undefined, "private-message", new Error("private-error")])(
    "fallback sanitizado para erro sem código %#",
    async (error) => {
      const h = harness();
      expect(h.context.resumoSaveErrorMessage(error)).not.toMatch(/private|erro desconhecido/);
    },
  );
  it("botão real de retry chama saveResumo e só limpa falha após sync", async () => {
    const button = nodes.find(
      (n) =>
        ts.isJsxElement(n) &&
        n.openingElement.tagName.getText(ast) === "Button" &&
        n.getText(ast).includes("Tentar salvar novamente"),
    ) as ts.JsxElement;
    expect(button).toBeDefined();
    const onClick = button.openingElement.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(ast) === "onClick",
    ) as ts.JsxAttribute;
    const callback = (onClick.initializer as ts.JsxExpression).expression!.getText(ast);
    const h = harness();
    h.failure.rpc = { code: "23514" };
    expect(await h.context.saveResumo()).toBe(false);
    delete h.failure.rpc;
    expect(await vm.runInContext(js(`${callback}()`), h.context)).toBe(true);
    expect(h.context.resumoSaveFailed).toBe(false);
    expect(syncCalls(h)).toHaveLength(2);
  });
  it("gestor fixo alterado é incluído no payload e reconciliado após retry", async () => {
    const h = harness();
    h.context.updResumo({
      lider_captador_id: "leader-replacement",
      lider_captador_nome: "Novo líder sintético",
    });
    h.failure.rpc = { code: "23514" };
    expect(await h.context.saveResumo()).toBe(false);
    await h.remount();
    delete h.failure.rpc;
    expect(await h.context.saveResumo()).toBe(true);
    expect(h.derived().find((r) => r.papel === "lider_captador")?.user_id).toBe(
      "leader-replacement",
    );
  });
  it("preserva tratamento amigável de imóvel ativo duplicado", async () => {
    const h = harness();
    h.select("captador", "none");
    h.failure.update = { code: "23505", message: "sales_imovel_id_ativa_key private" };
    expect(await h.context.saveResumo()).toBe(false);
    expect(h.errors).toEqual(["Já existe outra venda em andamento para esse código de imóvel."]);
  });
});
