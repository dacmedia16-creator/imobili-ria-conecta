import { describe, expect, it } from "vitest";
import {
  CAMPOS_PERMITIDOS,
  aplicarFiltros,
  handleVendasReais,
  resumo,
  sanitizar,
  sha256Hex,
  type VendaReal,
} from "../../supabase/functions/estudo-vendas-reais/core.ts";

// Banco falso em memória (dados 100% fictícios). Imita estudo_vendas_reais: a organização vem do hash
// da chave; chave desconhecida -> erro 28000.
const CHAVE_A = "chave-ficticia-imobiliaria-A-0123456789abcdef";
const CHAVE_B = "chave-ficticia-imobiliaria-B-0123456789abcdef";

const linha = (o: Partial<Record<string, unknown>>) => ({
  tipo_imovel: "Apartamento",
  area_m2: 80,
  valor_venda: 400000,
  preco_m2: 5000,
  mes_assinatura: "2026-09",
  rua: "Rua das Acácias",
  bairro: "Campolim",
  cidade: "Sorocaba",
  uf: "SP",
  quartos: 3,
  suites: 1,
  banheiros: 2,
  vagas: 2,
  modalidade: "padrao",
  area_fonte: "confirmada",
  ...o,
});

async function fakeAdmin() {
  const porHash: Record<string, Array<Record<string, unknown>>> = {
    [await sha256Hex(CHAVE_A)]: [
      // Campos proibidos "vazando" da RPC: a função precisa descartar.
      linha({
        corretor: "Fulano Corretor",
        comprador: "Beltrano",
        cpf: "000.111.222-33",
        comissao: 24000,
        codigo_interno: "VND-0001",
        imovel_numero: "412",
        imovel_complemento: "Apto 31",
        geo_lat: -23.5,
        geo_lon: -47.45,
        data_assinatura: "2026-09-14",
      }),
      linha({
        tipo_imovel: "Casa",
        area_m2: null,
        preco_m2: null,
        valor_venda: 650000,
        bairro: "Centro",
      }),
      linha({ area_m2: 120, preco_m2: 6000, valor_venda: 720000, bairro: "Jardim Paulistano" }),
    ],
    [await sha256Hex(CHAVE_B)]: [
      linha({
        cidade: "Campinas",
        bairro: "Cambuí",
        valor_venda: 560000,
        preco_m2: 8000,
        area_m2: 70,
      }),
    ],
  };
  const chamadas: unknown[] = [];
  return {
    chamadas,
    rpc: async (fn: string, args: { _key_hash: string }) => {
      chamadas.push({ fn, args });
      if (fn !== "estudo_vendas_reais") throw new Error(`rpc inesperada ${fn}`);
      const rows = porHash[args._key_hash];
      return rows ? { data: rows, error: null } : { data: null, error: { code: "28000" } };
    },
    from: () => {
      throw new Error("a função não pode ler tabelas diretamente");
    },
  };
}

describe("estudo-vendas-reais", () => {
  it("chave curta, desconhecida ou ausente -> 401, sem dados", async () => {
    const admin = await fakeAdmin();
    expect((await handleVendasReais(admin, "", {})).status).toBe(401);
    expect((await handleVendasReais(admin, "curta", {})).status).toBe(401);
    const r = await handleVendasReais(admin, "x".repeat(40), {});
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "unauthorized" });
  });

  it("envia ao banco só o hash da chave, nunca a chave", async () => {
    const admin = await fakeAdmin();
    await handleVendasReais(admin, CHAVE_A, {});
    const json = JSON.stringify(admin.chamadas);
    expect(json).not.toContain(CHAVE_A);
    expect(json).toContain(await sha256Hex(CHAVE_A));
  });

  it("isolamento A × B: cada chave só recebe as próprias vendas, mesmo pedindo a cidade da outra", async () => {
    const admin = await fakeAdmin();
    const a = await handleVendasReais(admin, CHAVE_A, {});
    const b = await handleVendasReais(admin, CHAVE_B, {});
    const va = a.body.vendas as VendaReal[];
    const vb = b.body.vendas as VendaReal[];
    expect(va).toHaveLength(3);
    expect(va.every((v) => v.cidade === "Sorocaba")).toBe(true);
    expect(vb).toHaveLength(1);
    expect(vb[0].cidade).toBe("Campinas");
    const cruzado = await handleVendasReais(admin, CHAVE_A, { cidade: "Campinas" });
    expect(cruzado.body.vendas).toEqual([]);
  });

  it("saída sem número do endereço, complemento, código, coordenada, data exata e dados pessoais", async () => {
    const admin = await fakeAdmin();
    const r = await handleVendasReais(admin, CHAVE_A, {});
    const json = JSON.stringify(r.body);
    for (const proibido of [
      "412",
      "Apto",
      "VND-0001",
      "Fulano",
      "Beltrano",
      "000.111.222-33",
      "24000",
      "-23.5",
      "-47.45",
      "2026-09-14",
      "corretor",
      "comprador",
      "cpf",
      "comissao",
      "codigo",
      "numero",
      "complemento",
      "geo_",
      "modalidade",
    ]) {
      expect(json, `vazou: ${proibido}`).not.toContain(proibido);
    }
    for (const v of r.body.vendas as VendaReal[]) {
      expect(Object.keys(v).sort()).toEqual([...CAMPOS_PERMITIDOS].sort());
    }
  });

  it("sanitizar descarta qualquer campo fora da lista fechada", () => {
    const v = sanitizar({ ...linha({}), cliente_nome: "X", sale_id: "uuid" });
    expect(Object.keys(v).sort()).toEqual([...CAMPOS_PERMITIDOS].sort());
  });

  it("filtros: cidade/bairro sem acento e caixa, tipo e faixa de metragem (sem área fica fora da faixa)", () => {
    const vendas = [
      sanitizar(linha({ bairro: "Jardim São Paulo" })),
      sanitizar(linha({ tipo_imovel: "Casa", area_m2: null, preco_m2: null })),
      sanitizar(linha({ area_m2: 150, preco_m2: 4000 })),
    ];
    expect(
      aplicarFiltros(vendas, { cidade: "sorocaba", bairros: ["jardim sao paulo"] }),
    ).toHaveLength(1);
    expect(aplicarFiltros(vendas, { tipo: "Casa" })).toHaveLength(1);
    // 80 m² entra; 150 m² e a venda sem área ficam fora da faixa
    expect(aplicarFiltros(vendas, { area_min: 60, area_max: 100 })).toHaveLength(1);
    expect(aplicarFiltros(vendas, { area_min: 60 }).every((v) => v.area_m2 !== null)).toBe(true);
  });

  it("resumo: venda sem área aparece na contagem, mas fica fora do R$/m²", () => {
    const s = resumo([
      sanitizar(linha({ preco_m2: 5000 })),
      sanitizar(linha({ preco_m2: 6000, area_m2: 120 })),
      sanitizar(linha({ area_m2: null, preco_m2: null })),
    ]);
    expect(s).toMatchObject({
      total: 3,
      com_area: 2,
      sem_area: 1,
      preco_m2_mediana: 5500,
      preco_m2_media: 5500,
    });
    expect(s.criterio).toMatch(/fora do cálculo/);
  });

  it("área do documento: marcada na venda e contada no resumo; sem área não tem fonte", () => {
    const vendas = [
      sanitizar(linha({ area_fonte: "documento" })),
      sanitizar(linha({ area_fonte: "confirmada", preco_m2: 6000, area_m2: 120 })),
      sanitizar(linha({ area_m2: null, preco_m2: null, area_fonte: "documento" })),
      sanitizar(linha({ area_fonte: "inventada" })),
    ];
    expect(vendas.map((v) => v.area_fonte)).toEqual(["documento", "confirmada", null, null]);
    const s = resumo(vendas);
    expect(s.area_documento).toBe(1);
    expect(s.com_area).toBe(3);
  });

  it("filtros inválidos são ignorados (tipo fora da lista, UF inválida)", async () => {
    const admin = await fakeAdmin();
    const r = await handleVendasReais(admin, CHAVE_A, {
      tipo: "Mansão",
      uf: "São Paulo",
      area_min: -5,
    });
    expect(r.body.filtros).toEqual({});
    expect((r.body.vendas as VendaReal[]).length).toBe(3);
  });
});
