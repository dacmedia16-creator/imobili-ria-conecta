import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chaveMesAtual,
  mesesOcorrenciasConcluidas,
  resumoOcorrenciasConcluidas,
  imovelOuCodigo,
  montarOcorrenciasConcluidas,
  podeVerOcorrenciasConcluidas,
  type OcorrenciaConcluidaRaw,
  type OcorrenciaConcluidaRow,
} from "./ocorrencias-concluidas";

describe("filtro mensal de ocorrências concluídas", () => {
  const row = (
    saleId: string,
    dataAssinatura: string | null,
    valorComissao = 100,
  ): OcorrenciaConcluidaRow => ({
    saleId,
    dataAssinatura,
    valorComissao,
    imovelLabel: saleId,
    corretorNome: null,
  });
  const rows = [
    row("set-2", "2026-09-20", 200),
    row("set-1", "2026-09-01", 150),
    row("ago", "2026-08-31", 50),
    row("antigo", "2025-09-10", 25),
  ];

  it("inicializa a página em Todos os meses, sem depender do mês atual", () => {
    const pagina = readFileSync(
      new URL("../routes/_authenticated/ocorrencias-concluidas.tsx", import.meta.url),
      "utf8",
    );
    expect(pagina).toContain('const [mesSelecionado, setMesSelecionado] = useState("todos")');
    expect(pagina).toContain("id, sale_id, valor_comissao, data_assinatura");
    expect(pagina).toContain('.eq("status", "concluida")');
    expect(pagina).toContain("Data da assinatura");
    expect(pagina).toContain('dateBR(r.dataAssinatura) : "Não informada"');
    expect(pagina).not.toMatch(/sale_status_history|updated_at|dataConclusao/);
  });

  it("obtém o mês atual para mantê-lo entre as opções do filtro", () => {
    expect(chaveMesAtual(new Date(2026, 8, 9))).toBe("2026-09");
  });

  it("deriva meses únicos dos dados, em ordem decrescente, incluindo o atual vazio", () => {
    expect(mesesOcorrenciasConcluidas(rows, "2026-10")).toEqual([
      { value: "2026-10", label: "Outubro de 2026" },
      { value: "2026-09", label: "Setembro de 2026" },
      { value: "2026-08", label: "Agosto de 2026" },
      { value: "2025-09", label: "Setembro de 2025" },
    ]);
    expect(mesesOcorrenciasConcluidas([], "2026-09")).toEqual([
      { value: "2026-09", label: "Setembro de 2026" },
    ]);
  });

  it("filtra lista e totais juntos sem mudar a ordem nem os dados originais", () => {
    const resumo = resumoOcorrenciasConcluidas(rows, "2026-09");
    expect(resumo.rows.map((r) => r.saleId)).toEqual(["set-2", "set-1"]);
    expect(resumo.rows).toHaveLength(2);
    expect(resumo.totalComissao).toBe(350);
    expect(rows).toHaveLength(4);
  });

  it("troca o mês e não mistura o mesmo mês de outro ano", () => {
    expect(resumoOcorrenciasConcluidas(rows, "2026-08")).toEqual({
      rows: [rows[2]],
      totalComissao: 50,
    });
    expect(resumoOcorrenciasConcluidas(rows, "2025-09").rows).toEqual([rows[3]]);
  });

  it("Todos os meses recupera o histórico e ambos os totais", () => {
    const resumo = resumoOcorrenciasConcluidas(rows, "todos");
    expect(resumo.rows).toEqual(rows);
    expect(resumo.rows).toHaveLength(4);
    expect(resumo.totalComissao).toBe(425);
  });

  it("zera tabela e totais para mês vazio", () => {
    expect(resumoOcorrenciasConcluidas(rows, "2026-10")).toEqual({ rows: [], totalComissao: 0 });
    expect(resumoOcorrenciasConcluidas([], "todos")).toEqual({ rows: [], totalComissao: 0 });
  });

  it("preserva datas civis nos limites de mês e ano em qualquer fuso", () => {
    const limites = [
      row("antes", "2025-12-31"),
      row("inicio", "2026-01-01"),
      row("fim", "2026-01-31"),
      row("depois", "2026-02-01"),
    ];
    expect(resumoOcorrenciasConcluidas(limites, "2026-01").rows.map((r) => r.saleId)).toEqual([
      "inicio",
      "fim",
    ]);
  });

  it("assinatura em agosto concluída em setembro pertence somente a agosto", () => {
    const occs = [
      {
        id: "o1",
        sale_id: "agosto",
        valor_comissao: 200,
        data_assinatura: "2026-08-31",
        updated_at: "2026-09-09T12:00:00Z",
      },
      {
        id: "o2",
        sale_id: "setembro",
        valor_comissao: 50,
        data_assinatura: "2026-09-01",
        updated_at: "2026-09-09T12:00:00Z",
      },
      {
        id: "o3",
        sale_id: "sem-data",
        valor_comissao: 25,
        data_assinatura: null,
        updated_at: "2026-09-09T12:00:00Z",
      },
    ];
    const montadas = montarOcorrenciasConcluidas({ occs, sales: [], nomesPorId: {} });
    expect(resumoOcorrenciasConcluidas(montadas, "2026-09").rows.map((r) => r.saleId)).toEqual([
      "setembro",
    ]);
    expect(resumoOcorrenciasConcluidas(montadas, "2026-09").totalComissao).toBe(50);
    expect(resumoOcorrenciasConcluidas(montadas, "2026-08").rows.map((r) => r.saleId)).toEqual([
      "agosto",
    ]);
    expect(resumoOcorrenciasConcluidas(montadas, "2026-08").totalComissao).toBe(200);
    expect(resumoOcorrenciasConcluidas(montadas, "todos")).toEqual({
      rows: montadas,
      totalComissao: 275,
    });
    expect(mesesOcorrenciasConcluidas(montadas, "2026-09").map((m) => m.value)).toEqual([
      "2026-09",
      "2026-08",
    ]);
  });

  it("sem assinatura fica somente em Todos os meses e não cria opção inválida", () => {
    const semData = [row("sem-data", null, 30)];
    expect(resumoOcorrenciasConcluidas(semData, "todos")).toEqual({
      rows: semData,
      totalComissao: 30,
    });
    expect(resumoOcorrenciasConcluidas(semData, "2026-09")).toEqual({ rows: [], totalComissao: 0 });
    expect(mesesOcorrenciasConcluidas(semData, "2026-09")).toEqual([
      { value: "2026-09", label: "Setembro de 2026" },
    ]);
  });
});

describe("podeVerOcorrenciasConcluidas", () => {
  it.each(["gestor", "team_leader", "admin", "super_admin", "financeiro"])(
    "libera o papel %s",
    (papel) => {
      expect(podeVerOcorrenciasConcluidas([papel])).toBe(true);
    },
  );

  it.each(["corretor", "juridico", "lancamento"])("bloqueia o papel %s", (papel) => {
    expect(podeVerOcorrenciasConcluidas([papel])).toBe(false);
  });

  it("bloqueia lista vazia", () => {
    expect(podeVerOcorrenciasConcluidas([])).toBe(false);
  });

  it("libera quando um dos papéis dá acesso, mesmo entre outros sem acesso", () => {
    expect(podeVerOcorrenciasConcluidas(["corretor", "gestor"])).toBe(true);
  });
});

describe("imovelOuCodigo", () => {
  it("prioriza codigo_interno", () => {
    expect(
      imovelOuCodigo({
        id: "aaaaaaaa-0000-0000-0000-000000000000",
        codigo_interno: "C123",
        imovel_id: "IM-9",
      }),
    ).toBe("C123");
  });

  it("usa imovel_id quando não há codigo_interno", () => {
    expect(
      imovelOuCodigo({
        id: "aaaaaaaa-0000-0000-0000-000000000000",
        codigo_interno: null,
        imovel_id: "IM-9",
      }),
    ).toBe("IM-9");
  });

  it("cai para Venda #<id> quando os dois estão vazios", () => {
    expect(
      imovelOuCodigo({
        id: "abcd1234-0000-0000-0000-000000000000",
        codigo_interno: null,
        imovel_id: null,
      }),
    ).toBe("Venda #abcd1234");
  });
});

describe("montarOcorrenciasConcluidas", () => {
  const occ = (over: Partial<OcorrenciaConcluidaRaw>): OcorrenciaConcluidaRaw => ({
    id: "occ-1",
    sale_id: "s1",
    valor_comissao: 100,
    data_assinatura: "2026-01-01",
    ...over,
  });

  it("ordena por assinatura mais recente, sem data ao final e desempate estável", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [
        occ({ id: "occ-a", sale_id: "sa", data_assinatura: "2026-01-01" }),
        occ({ id: "occ-b", sale_id: "sb", data_assinatura: "2026-03-01" }),
        occ({ id: "occ-c", sale_id: "sc", data_assinatura: "2026-03-01" }),
        occ({ id: "occ-d", sale_id: "sd", data_assinatura: null }),
      ],
      sales: [],
      nomesPorId: {},
    });
    expect(rows.map((r) => r.saleId)).toEqual(["sc", "sb", "sa", "sd"]);
  });

  it("preserva a data da assinatura sem converter para UTC", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [occ({ sale_id: "s1", data_assinatura: "2026-09-01" })],
      sales: [],
      nomesPorId: {},
    });
    expect(rows[0].dataAssinatura).toBe("2026-09-01");
  });

  it("não inventa data quando não há assinatura", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [occ({ sale_id: "s1", data_assinatura: null })],
      sales: [],
      nomesPorId: {},
    });
    expect(rows[0].dataAssinatura).toBeNull();
  });

  it("resolve o corretor pelo nome do profile e o valor da comissão", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [occ({ sale_id: "s1", valor_comissao: 1234.5 })],
      sales: [{ id: "s1", codigo_interno: "C1", imovel_id: null, corretor_id: "u1" }],
      nomesPorId: { u1: "Maria" },
    });
    expect(rows[0]).toMatchObject({
      saleId: "s1",
      imovelLabel: "C1",
      corretorNome: "Maria",
      valorComissao: 1234.5,
    });
  });

  it("trata comissão nula como zero e venda ausente sem quebrar", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [occ({ sale_id: "s1", valor_comissao: null })],
      sales: [],
      nomesPorId: {},
    });
    expect(rows[0]).toMatchObject({
      valorComissao: 0,
      corretorNome: null,
      imovelLabel: "Venda #s1",
    });
  });
});
