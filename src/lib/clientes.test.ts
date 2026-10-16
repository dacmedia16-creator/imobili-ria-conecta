import { describe, it, expect } from "vitest";
import {
  type ClientesDb,
  decidirCliente,
  mensagemErroCliente,
  resolverClienteDaParte,
} from "./clientes";

// Banco fake com a mesma regra do índice clientes_org_cpf_cnpj_normalizado_key (único por doc).
function fakeDb(inicial: Record<string, unknown>[]) {
  const rows = inicial.map((r) => ({ ...r }));
  const norm = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const dup = (doc: string, exceto?: string) =>
    doc !== "" && rows.some((r) => r.id !== exceto && norm(r.cpf_cnpj) === doc);
  const err23505 = {
    code: "23505",
    message:
      'duplicate key value violates unique constraint "clientes_org_cpf_cnpj_normalizado_key"',
  };
  let seq = 0;
  const db = {
    from: () => ({
      select: () => ({
        eq: (_c: string, v: string) => ({
          maybeSingle: async () => ({
            data: rows.find((r) => norm(r.cpf_cnpj) === v) ?? null,
            error: null,
          }),
        }),
      }),
      update: (v: Record<string, unknown>) => ({
        eq: async (_c: string, id: string) => {
          if (v.cpf_cnpj !== undefined && dup(norm(v.cpf_cnpj), id))
            return { data: null, error: err23505 };
          Object.assign(
            rows.find((r) => r.id === id)!,
            v,
          );
          return { data: null, error: null };
        },
      }),
      insert: (v: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            if (dup(norm(v.cpf_cnpj))) return { data: null, error: err23505 };
            const id = `novo-${++seq}`;
            rows.push({ ...v, id });
            return { data: { id }, error: null };
          },
        }),
      }),
    }),
  } as unknown as ClientesDb;
  return { db, rows };
}

const CPF_A = "111.111.111-11";
const CPF_B = "222.222.222-22";

describe("vínculo parte ↔ cadastro de clientes (t_d1738ada)", () => {
  it("reproduz o caso: parte ligada ao cadastro de outra pessoa e CPF corrigido p/ um que já existe — não dá 23505 e liga no certo", async () => {
    // comprador_1 ficou ligado ao cadastro do comprador_2 (A); corretora digita o CPF correto (B),
    // que já existe na org. O código antigo dava UPDATE no cadastro A com o CPF B → 23505.
    const { db, rows } = fakeDb([
      { id: "A", cpf_cnpj: CPF_A, nome: "Pessoa A" },
      { id: "B", cpf_cnpj: CPF_B, nome: "Pessoa B", email: null },
    ]);
    const r = await resolverClienteDaParte(
      db,
      { cpf_cnpj: CPF_B, nome: "Pessoa B digitada", email: "b@x.com" },
      "A",
      "u1",
    );
    expect(r.error).toBeNull();
    expect(r.clienteId).toBe("B");
    // cadastro A (de outra pessoa) intacto
    expect(rows.find((x) => x.id === "A")).toMatchObject({ cpf_cnpj: CPF_A, nome: "Pessoa A" });
    // cadastro B: nome existente preservado, só o vazio completado
    expect(rows.find((x) => x.id === "B")).toMatchObject({ nome: "Pessoa B", email: "b@x.com" });
  });

  it("CPF corrigido para um documento novo: cria cadastro novo em vez de reescrever o CPF do antigo", async () => {
    const { db, rows } = fakeDb([{ id: "A", cpf_cnpj: CPF_A, nome: "Pessoa A" }]);
    const r = await resolverClienteDaParte(db, { cpf_cnpj: CPF_B, nome: "Nova" }, "A", null);
    expect(r.error).toBeNull();
    expect(r.clienteId).not.toBe("A");
    expect(rows.find((x) => x.id === "A")).toMatchObject({ cpf_cnpj: CPF_A, nome: "Pessoa A" });
    expect(rows).toHaveLength(2);
  });

  it("mesmo cadastro já ligado e mesmo CPF: atualiza com o digitado", async () => {
    const { db, rows } = fakeDb([{ id: "A", cpf_cnpj: CPF_A, nome: "Antigo" }]);
    const r = await resolverClienteDaParte(
      db,
      { cpf_cnpj: "11111111111", nome: "Novo" },
      "A",
      null,
    );
    expect(r).toEqual({ clienteId: "A", error: null });
    expect(rows[0].nome).toBe("Novo");
  });

  it("cliente já cadastrado em outra venda (parte sem vínculo): reaproveita sem duplicar nem sobrescrever", async () => {
    const { db, rows } = fakeDb([{ id: "A", cpf_cnpj: CPF_A, nome: "Pessoa A" }]);
    const r = await resolverClienteDaParte(db, { cpf_cnpj: CPF_A, nome: "Outro nome" }, null, null);
    expect(r).toEqual({ clienteId: "A", error: null });
    expect(rows).toHaveLength(1);
    expect(rows[0].nome).toBe("Pessoa A");
  });

  it("corrida no INSERT (23505): reaproveita o cadastro criado pela outra chamada", async () => {
    const { db, rows } = fakeDb([]);
    const realFrom = db.from.bind(db);
    let primeiraBusca = true;
    (db as { from: unknown }).from = () => {
      const t = realFrom("clientes");
      return {
        ...t,
        select: (c: string) => ({
          eq: (k: "cpf_cnpj_normalizado", v: string) => ({
            maybeSingle: async () => {
              if (primeiraBusca) {
                primeiraBusca = false;
                rows.push({ id: "concorrente", cpf_cnpj: CPF_A }); // outra aba gravou nesse meio-tempo
                return { data: null, error: null };
              }
              return t.select(c).eq(k, v).maybeSingle();
            },
          }),
        }),
      };
    };
    const r = await resolverClienteDaParte(db, { cpf_cnpj: CPF_A }, null, null);
    expect(r).toEqual({ clienteId: "concorrente", error: null });
  });

  it("documento incompleto mantém o vínculo atual e não mexe no cadastro", () => {
    expect(decidirCliente("123", "A", null)).toEqual({ acao: "manter", clienteId: "A" });
  });

  it("erro de duplicidade vira aviso em português, sem nome de constraint", () => {
    const m = mensagemErroCliente({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "clientes_org_cpf_cnpj_normalizado_key"',
    });
    expect(m).toMatch(/já pertence a outro cliente/);
    expect(m).not.toMatch(/duplicate|constraint|clientes_org/);
  });
});
