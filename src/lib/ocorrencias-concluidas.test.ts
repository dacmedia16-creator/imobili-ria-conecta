import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chaveMesAtual,
  catalogoOcorrenciasConcluidas,
  corretoresDaEquipe,
  corretorValidoNaEquipe,
  relatorioOcorrenciasConcluidasSchema,
  type RelatorioOcorrenciasConcluidas,
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
    ocorrenciaId: saleId,
    corretorId: null,
    equipeIds: [],
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
    expect(pagina).toContain('.rpc("relatorio_ocorrencias_concluidas")');
    expect(pagina.match(/\.from\("[^"]+"\)/g)).toEqual(['.from("user_roles")']);
    expect(pagina).not.toMatch(/router\.navigate|cursor-pointer/);
    expect(pagina).toContain('to="/vendas/$id"');
    expect(pagina).toContain("Abrir ocorrência de");
    expect(pagina).toContain('const [equipeSelecionada, setEquipeSelecionada] = useState("todas")');
    expect(pagina).toContain(
      'const [corretorSelecionado, setCorretorSelecionado] = useState("todos")',
    );
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
  it.each([
    "corretor",
    "gestor",
    "team_leader",
    "admin",
    "super_admin",
    "financeiro",
    "juridico",
    "lancamento",
  ])("libera o papel %s", (papel) => {
    expect(podeVerOcorrenciasConcluidas([papel])).toBe(true);
  });

  it.each(["coordenador", "visitante", "", "ADMIN"])("bloqueia o papel %s", (papel) => {
    expect(podeVerOcorrenciasConcluidas([papel])).toBe(false);
  });

  it("bloqueia lista vazia", () => {
    expect(podeVerOcorrenciasConcluidas([])).toBe(false);
  });

  it("libera quando um dos papéis dá acesso, mesmo entre outros sem acesso", () => {
    expect(podeVerOcorrenciasConcluidas(["corretor", "gestor"])).toBe(true);
  });
});

describe("catálogo canônico e filtros combinados", () => {
  const relatorio: RelatorioOcorrenciasConcluidas = {
    profiles: [
      { id: "u1", nome: "Ana" },
      { id: "u1", nome: "Ana" },
      { id: "u2", nome: "Ana" },
      { id: "lider", nome: "Líder" },
      { id: "aux", nome: "Auxiliar" },
      { id: "filha", nome: "Equipe filha" },
      { id: "sem-equipe", nome: "Sem equipe" },
    ],
    teams: [
      { id: "t1", nome: "Equipe", lider_id: "lider", parent_team_id: null },
      { id: "t1", nome: "Equipe", lider_id: "lider", parent_team_id: null },
      { id: "t2", nome: "Equipe", lider_id: null, parent_team_id: "t1" },
    ],
    members: [
      { membro_id: "u1", team_id: "t1" },
      { membro_id: "u1", team_id: "t1" },
      { membro_id: "u1", team_id: "t2" },
      { membro_id: "u2", team_id: "t2" },
      { membro_id: "aux", team_id: "t1" },
      { membro_id: "filha", team_id: "t2" },
    ],
    coLeaders: [
      { user_id: "aux", team_id: "t1" },
      { user_id: "aux", team_id: "t1" },
      { user_id: "lider", team_id: "t1" },
    ],
    sales: [
      { id: "s1", corretor_id: "u1", codigo_interno: "C1", imovel_id: null },
      { id: "s2", corretor_id: "u2", codigo_interno: "C2", imovel_id: null },
      { id: "s3", corretor_id: "aux", codigo_interno: "C3", imovel_id: null },
      { id: "s4", corretor_id: "lider", codigo_interno: "C4", imovel_id: null },
      { id: "s5", corretor_id: "sem-equipe", codigo_interno: "C5", imovel_id: null },
      { id: "s6", corretor_id: null, codigo_interno: "C6", imovel_id: null },
    ],
    occs: [
      { id: "o1", sale_id: "s1", valor_comissao: 100, data_assinatura: "2026-09-01" },
      { id: "o2", sale_id: "s2", valor_comissao: 200, data_assinatura: "2026-09-02" },
      { id: "o3", sale_id: "s3", valor_comissao: 50, data_assinatura: "2026-08-31" },
      { id: "o4", sale_id: "s4", valor_comissao: 25, data_assinatura: null },
      { id: "o5", sale_id: "s5", valor_comissao: 75, data_assinatura: "2026-09-01" },
      { id: "o6", sale_id: "s6", valor_comissao: 10, data_assinatura: null },
    ],
  };

  const preparar = () => {
    const catalogo = catalogoOcorrenciasConcluidas(relatorio);
    const rows = montarOcorrenciasConcluidas({
      ...relatorio,
      nomesPorId: Object.fromEntries(relatorio.profiles.map((p) => [p.id, p.nome ?? p.id])),
      equipesPorCorretor: new Map(catalogo.corretores.map((c) => [c.id, c.equipeIds])),
    });
    return { ...catalogo, rows };
  };

  it("deduplica por ID e preserva homônimos distintos em pessoas e equipes", () => {
    const { equipes, corretores } = preparar();
    expect(equipes.map((e) => e.id).sort()).toEqual(["t1", "t2"]);
    expect(new Set(corretores.map((c) => c.id)).size).toBe(6);
    expect(corretores).toHaveLength(6);
    expect(corretores.find((c) => c.id === "u1")?.label).not.toBe(
      corretores.find((c) => c.id === "u2")?.label,
    );
    expect(equipes[0].label).not.toBe(equipes[1].label);
    expect(corretores.find((c) => c.id === "u1")?.equipeIds).toEqual(["t1", "t2"]);
  });

  it("inclui líder e auxiliares sem vínculo de membro e não expande descendentes", () => {
    const { corretores } = preparar();
    expect(
      corretoresDaEquipe(corretores, "t1")
        .map((c) => c.id)
        .sort(),
    ).toEqual(["aux", "lider", "u1"]);
    expect(corretoresDaEquipe(corretores, "todas")).toHaveLength(6);
    expect(corretoresDaEquipe(corretores, "inexistente")).toEqual([]);
    const somenteLiderancas = catalogoOcorrenciasConcluidas({ ...relatorio, members: [] });
    expect(
      corretoresDaEquipe(somenteLiderancas.corretores, "t1")
        .map((c) => c.id)
        .sort(),
    ).toEqual(["aux", "lider"]);
  });

  it("mantém corretor válido na troca de equipe e redefine inválido para Todos", () => {
    const { corretores } = preparar();
    expect(corretorValidoNaEquipe(corretores, "t1", "u2")).toBe("todos");
    expect(corretorValidoNaEquipe(corretores, "t1", "u1")).toBe("u1");
    expect(corretorValidoNaEquipe(corretores, "t2", "aux")).toBe("todos");
    expect(corretorValidoNaEquipe(corretores, "todas", "sem-equipe")).toBe("sem-equipe");
    expect(corretorValidoNaEquipe(corretores, "todas", "ausente")).toBe("todos");
  });

  it("visão inicial inclui tudo, inclusive sem assinatura, sem corretor e sem equipe", () => {
    const { rows } = preparar();
    expect(resumoOcorrenciasConcluidas(rows, "todos", "todas", "todos")).toEqual({
      rows,
      totalComissao: 460,
    });
    expect(rows).toHaveLength(6);
  });

  it("combina mês, equipe e corretor e sincroniza soma e linhas sem duplicar vínculos", () => {
    const { rows } = preparar();
    expect(resumoOcorrenciasConcluidas(rows, "2026-09", "t1", "u1")).toEqual({
      rows: [rows.find((r) => r.saleId === "s1")],
      totalComissao: 100,
    });
    expect(resumoOcorrenciasConcluidas(rows, "todos", "t1", "todos").totalComissao).toBe(175);
    expect(resumoOcorrenciasConcluidas(rows, "todos", "t1", "todos").rows).toHaveLength(3);
    expect(resumoOcorrenciasConcluidas(rows, "2026-09", "t2", "todos").totalComissao).toBe(300);
    expect(resumoOcorrenciasConcluidas(rows, "2026-08", "t1", "aux").totalComissao).toBe(50);
    expect(resumoOcorrenciasConcluidas(rows, "todos", "todas", "u2").totalComissao).toBe(200);
    expect(resumoOcorrenciasConcluidas(rows, "2026-09", "t1", "u2")).toEqual({
      rows: [],
      totalComissao: 0,
    });
    expect(rows).toHaveLength(6);
  });

  it("preserva IDs de ocorrência distintos mesmo na mesma venda", () => {
    const { rows } = preparar();
    expect(rows.find((r) => r.saleId === "s1")).toMatchObject({
      ocorrenciaId: "o1",
      corretorId: "u1",
      equipeIds: ["t1", "t2"],
    });
    const montadas = montarOcorrenciasConcluidas({
      occs: [relatorio.occs[0], { ...relatorio.occs[0], id: "outra" }],
      sales: relatorio.sales,
      nomesPorId: {},
    });
    expect(new Set(montadas.map((r) => r.ocorrenciaId)).size).toBe(2);
  });

  it("roster vazio não elimina pessoas do histórico sem profile e ignora equipe inexistente", () => {
    const { corretores } = catalogoOcorrenciasConcluidas({
      ...relatorio,
      profiles: [],
      teams: [],
      coLeaders: [],
      members: [{ membro_id: "u1", team_id: "ausente" }],
    });
    expect(corretores.map((c) => c.id).sort()).toEqual(["aux", "lider", "sem-equipe", "u1", "u2"]);
    expect(corretores.every((c) => c.equipeIds.length === 0)).toBe(true);
    expect(corretores.every((c) => c.label.includes(c.id))).toBe(true);
  });

  it("valida o contrato completo da RPC e aceita resposta vazia legítima", () => {
    expect(relatorioOcorrenciasConcluidasSchema.safeParse(relatorio).success).toBe(true);
    expect(
      relatorioOcorrenciasConcluidasSchema.safeParse({
        occs: [],
        sales: [],
        profiles: [],
        teams: [],
        members: [],
        coLeaders: [],
      }).success,
    ).toBe(true);
    expect(relatorioOcorrenciasConcluidasSchema.safeParse(null).success).toBe(false);
    expect(relatorioOcorrenciasConcluidasSchema.safeParse({ occs: [] }).success).toBe(false);
    expect(
      relatorioOcorrenciasConcluidasSchema.safeParse({ ...relatorio, teams: null }).success,
    ).toBe(false);
  });

  it.each(["2026-09-01T00:00:00Z", "2026-02-30", "2026-13-01", ""])(
    "rejeita assinatura inválida sem inventar fallback: %s",
    (data_assinatura) => {
      expect(
        relatorioOcorrenciasConcluidasSchema.safeParse({
          ...relatorio,
          occs: [{ ...relatorio.occs[0], data_assinatura }],
        }).success,
      ).toBe(false);
    },
  );

  it("rejeita comissão inválida em vez de exibir total financeiro enganoso", () => {
    expect(
      relatorioOcorrenciasConcluidasSchema.safeParse({
        ...relatorio,
        occs: [{ ...relatorio.occs[0], valor_comissao: "inválido" }],
      }).success,
    ).toBe(false);
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
