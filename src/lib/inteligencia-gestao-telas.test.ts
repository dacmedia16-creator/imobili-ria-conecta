// @vitest-environment jsdom
/**
 * Inteligência de gestão 2/3 — telas (cartão t_01d580b6). Dados fictícios.
 * - módulo desligado: Painel da Equipe e Minha carreira exatamente como antes (sem farol, previsão,
 *   termômetro, próxima 1:1, itens novos do "O que fazer hoje" nem "Onde você perde mais");
 * - farol: linha por corretor, 5 sinais, ordem risco → tranquilo, "sem plano", "meta de DD/MM", 🆕;
 * - clique no corretor abre a 1:1 (pauta + combinados + próxima em 14 dias editável) e salva pela RPC;
 * - corretor: termômetro só dele, sem ranking; próxima 1:1 com combinados;
 * - "O que fazer hoje": lead sem resposta, reunião 45 dias, 1:1 atrasada (gestor/TL).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        is: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) =>
    createElement("a", { href: to }, children as never),
  createFileRoute: () => (o: unknown) => o,
  redirect: (o: unknown) => o,
}));
let roles: string[] = ["gestor"];
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ hasAny: (r: string[]) => r.some((x) => roles.includes(x)) }),
}));

import {
  FarolEquipe,
  PrevisaoTrimestre,
  useGestaoPainel,
  type GestaoPainel,
} from "@/components/gestao/FarolEquipe";
import {
  MeuTermometro,
  MinhaProxima1a1,
  OndePerdeMais,
  useMinhaGestao,
} from "@/components/gestao/MinhaGestao";
import { PainelEquipeConteudo } from "@/routes/_authenticated/painel-equipe";
import {
  insumosPrevisao,
  normalizarFarolDados,
  pendenciasExtras,
  umAUmAtrasadas,
} from "@/lib/inteligencia-gestao-tela";
import { calcularFarol, gargalo } from "@/lib/inteligencia-gestao";
import { metasDoSnapshot } from "@/lib/meta-atividades";
import { pontasDoPainel, type PainelEquipeDados } from "@/lib/painel-equipe-calc";

afterEach(() => {
  cleanup();
  rpc.mockReset();
  roles = ["gestor"];
});

const HOJE = "2026-11-08";
const METAS = metasDoSnapshot({
  "ms.lig": 10,
  "ms.v1": 4,
  "ms.v2": 2,
  "ms.capt": 3,
  "ms.ligMes": 40,
  "ms.v1Mes": 16,
  "ms.v2Mes": 8,
})!;
const semana = (o: Partial<Record<string, number>> = {}) => ({
  ligacoes: 10,
  v1: 4,
  v2: 2,
  acm: 2,
  visitaComprador: 0,
  captMes: 3,
  ...o,
});
const mes = { ligacoes: 30, v1: 10, v2: 5, acm: 5, visitaComprador: 1 };

const farolRaw = {
  hoje: HOJE,
  lead_config: {
    prazo_aceite_min: 1440,
    prazo_primeira_interacao_dias: 7,
    prazo_sem_interacao_dias: 30,
  },
  taxas_em: "2026-11-01T12:00:00Z",
  pessoas: [
    {
      user_id: "ana",
      nome: "Ana Teste",
      team_id: "A",
      entrou_em: "2025-01-01",
      metas_em: "2026-10-20",
      leads: [
        {
          etapa: "novo",
          no_banco_desde: null,
          responsavel_id: "ana",
          atribuido_em: "2026-11-05T10:00:00Z",
          aceito_em: null,
          ultima_interacao_em: null,
          created_at: "2026-11-05T10:00:00Z",
        },
      ],
      captacoes: [
        {
          id: "cap1",
          status: "aprovada",
          signed_on: "2026-08-01",
          prazo_dias: "365",
          vendida: false,
          reunioes: [],
        },
      ],
      funil90: { ligacoes: 100, v1: 20, v2: 3, captacoes: 1 },
      funil90_equipe: { ligacoes: 300, v1: 60, v2: 30, captacoes: 10 },
      ultima_1a1: {
        id: "c1",
        data: "2026-10-20",
        proxima_data: "2026-11-03",
        com: "Ricardo Gestor",
        combinados: [{ texto: "Ligar para 5 proprietários", feito: null }],
      },
    },
    {
      user_id: "bia",
      nome: "Bia Teste",
      team_id: "A",
      entrou_em: "2025-01-01",
      metas_em: null,
      leads: [],
      captacoes: [],
      funil90: { ligacoes: 2, v1: 0, v2: 0, captacoes: 0 },
      funil90_equipe: { ligacoes: 300, v1: 60, v2: 30, captacoes: 10 },
      ultima_1a1: null,
    },
    {
      user_id: "caio",
      nome: "Caio Novo",
      team_id: "A",
      entrou_em: "2026-10-01",
      metas_em: null,
      leads: [],
      captacoes: [],
      funil90: null,
      funil90_equipe: null,
      ultima_1a1: null,
    },
  ],
};
const farol = normalizarFarolDados(farolRaw);

const dados: PainelEquipeDados = {
  equipe: { id: "A", nome: "Equipe A", lider_id: "lider", lider_nome: "Líder" },
  viewer_id: "lider",
  eu_id: "lider",
  membros: [
    { user_id: "ana", nome: "Ana Teste", papel: "membro", ultima_venda_em: "2026-09-01T15:00:00Z" },
    { user_id: "bia", nome: "Bia Teste", papel: "membro", ultima_venda_em: "2026-11-01T15:00:00Z" },
    { user_id: "caio", nome: "Caio Novo", papel: "membro", ultima_venda_em: null },
  ],
  vigencias: [
    { membro_id: "ana", team_id: "A", de: null, ate: null, prioridade: 1 },
    { membro_id: "bia", team_id: "A", de: null, ate: null, prioridade: 1 },
  ],
  vendas: [
    {
      sale_id: "v1",
      imovel_id: null,
      codigo_interno: "V1",
      modalidade: "padrao",
      concluida_em: "2026-10-10T15:00:00Z",
      valor_negociado: 1_000_000,
      comissao_bruta: 60_000,
      captador_id: "ana",
      captador_nome: "Ana Teste",
      vendedor_id: "bia",
      vendedor_nome: "Bia Teste",
      vendedor_fracao: null,
    },
    {
      sale_id: "v2",
      imovel_id: null,
      codigo_interno: "V2",
      modalidade: "padrao",
      concluida_em: "2026-11-02T15:00:00Z",
      valor_negociado: 500_000,
      comissao_bruta: 30_000,
      captador_id: "bia",
      captador_nome: "Bia Teste",
      vendedor_id: "bia",
      vendedor_nome: "Bia Teste",
      vendedor_fracao: null,
    },
    {
      sale_id: "v3",
      imovel_id: null,
      codigo_interno: "V3",
      modalidade: "padrao",
      concluida_em: "2026-08-15T15:00:00Z",
      valor_negociado: 600_000,
      comissao_bruta: 36_000,
      captador_id: "ana",
      captador_nome: "Ana Teste",
      vendedor_id: "ana",
      vendedor_nome: "Ana Teste",
      vendedor_fracao: null,
    },
  ],
  ganhos: [],
  parcelas: [],
  andamento: [
    {
      sale_id: "v2",
      codigo: "V2",
      bairro: null,
      modalidade: "padrao",
      valor_negociado: 500_000,
      status: "ocorrencia_pendente",
      venda_em: "2026-11-02T15:00:00Z",
      etapa_desde: null,
      membros: ["bia"],
      parceria: false,
      parceria_externa: false,
      midia_vazia: false,
      contrato_faltando: false,
      recebimento_sem_data: false,
    },
  ],
  exclusivas: [],
  meta: { meta_comissao: 50_000, comissao_realizada: null },
};

const gestao = (over: Partial<GestaoPainel> = {}): GestaoPainel => ({
  farol,
  semana: new Map([
    [
      "ana",
      {
        user_id: "ana",
        nome: "Ana Teste",
        semana: semana({ ligacoes: 2, v1: 0, v2: 0, acm: 0, captMes: 0 }),
        mes,
        antigasMes: 0,
        metas: METAS,
        ultimo: null,
        copia: true,
      },
    ],
    [
      "bia",
      {
        user_id: "bia",
        nome: "Bia Teste",
        semana: semana(),
        mes,
        antigasMes: 0,
        metas: null,
        ultimo: null,
        copia: false,
      },
    ],
  ]),
  metasTrimestre: 150_000,
  recarregar: vi.fn(),
  ...over,
});

// --- Módulo desligado = tela como hoje --------------------------------------------------------------------

describe("chave do módulo: desligado = tela exatamente como hoje", () => {
  const painel = readFileSync("src/routes/_authenticated/painel-equipe.tsx", "utf8");
  const carreira = readFileSync("src/routes/_authenticated/minha-carreira.tsx", "utf8");
  const ganchos = readFileSync("src/components/gestao/FarolEquipe.tsx", "utf8");
  const minha = readFileSync("src/components/gestao/MinhaGestao.tsx", "utf8");

  it("Painel da Equipe: farol e previsão só com gestao != null; senão o bloco antigo inteiro", () => {
    expect(painel).toContain("gestao = null,");
    expect(painel).toMatch(/\{gestao \? \(\s*<FarolEquipe/);
    expect(painel).toMatch(/\) : semVender\.length === 0 \? \(/);
    expect(painel).toMatch(/\{gestao \? \(\s*<PrevisaoTrimestre/);
    expect(painel).toContain(
      // min-w-0: sem ele a tabela do farol esticava a página no celular (achado nos prints do cartão 3/3).
      '<Card className={gestao ? "min-w-0 lg:order-last lg:col-span-3" : undefined}>',
    );
    expect(painel).toContain(
      '"Pela última assinatura. Amarelo acima de 14 dias, vermelho acima de 30."',
    );
  });
  it("o gancho do painel devolve null com o módulo desligado (nenhuma outra consulta)", () => {
    expect(ganchos).toMatch(
      /if \(!\(await inteligenciaGestaoEnabled\(\)\)\) \{\s*if \(vivo\) setSt\(null\);\s*return;/,
    );
  });
  it("Minha carreira: termômetro, próxima 1:1, itens novos e gargalo só com gestao.on", () => {
    expect(minha).toMatch(/if \(!\(await inteligenciaGestaoEnabled\(\)\)\) return;/);
    expect(minha).toContain("const DESLIGADO: MinhaGestaoEstado = {\n  on: false,");
    expect(carreira).toContain("{gestao.on && gestao.linha ? <MeuTermometro");
    expect(carreira).toContain("{gestao.on ? <MinhaProxima1a1");
    expect(carreira).toContain("gestao.gargalo ? <OndePerdeMais g={gestao.gargalo} /> : undefined");
    // Desligado: extras = [] → a lista e o vazio ficam como antes.
    expect(carreira).toContain("pendencias.length === 0 && gestao.extras.length === 0");
  });
  it("Meu dinheiro, Meu mês e Conquistas continuam chamados do mesmo jeito", () => {
    expect(carreira).toContain("{userId ? <MeuDinheiro userId={userId} /> : null}");
    expect(carreira).toContain("{userId ? <MeuMes userId={userId} /> : null}");
    expect(carreira).toContain("{userId ? <Conquistas userId={userId} /> : null}");
  });
});

describe("chave do módulo renderizada", () => {
  it("Painel da Equipe com gestao = null: bloco antigo de dias sem vender, sem farol e sem previsão", () => {
    render(createElement(PainelEquipeConteudo, { dados, mes: "2026-11", hoje: HOJE }));
    expect(screen.getByText("Há quantos dias sem vender")).toBeTruthy();
    expect(
      screen.getByText("Pela última assinatura. Amarelo acima de 14 dias, vermelho acima de 30."),
    ).toBeTruthy();
    expect(screen.queryByTestId("farol-equipe")).toBeNull();
    expect(screen.queryByTestId("previsao-trimestre")).toBeNull();
    expect(screen.getByText("68 dias · alerta")).toBeTruthy();
  });
  it("Painel da Equipe com o módulo ligado: farol no lugar da lista e previsão no Meta do mês", () => {
    render(
      createElement(PainelEquipeConteudo, { dados, mes: "2026-11", hoje: HOJE, gestao: gestao() }),
    );
    expect(screen.getByTestId("farol-equipe")).toBeTruthy();
    expect(screen.getByTestId("previsao-trimestre")).toBeTruthy();
    expect(screen.queryByText("68 dias · alerta")).toBeNull();
  });
  it("Minha carreira com o módulo desligado: só a checagem do módulo, nenhuma outra consulta", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    let st: ReturnType<typeof useMinhaGestao> | null = null;
    function Sonda() {
      st = useMinhaGestao("ana");
      return null;
    }
    render(createElement(Sonda));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("inteligencia_gestao_enabled"));
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["inteligencia_gestao_enabled"]);
    expect(st).toEqual({ on: false, linha: null, gargalo: null, ultima: null, extras: [] });
  });
  it("Painel da Equipe com o módulo desligado: o gancho devolve null e não chama o farol", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    let st: GestaoPainel | null | undefined;
    function Sonda() {
      st = useGestaoPainel("A", HOJE);
      return null;
    }
    render(createElement(Sonda));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("inteligencia_gestao_enabled"));
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["inteligencia_gestao_enabled"]);
    expect(st).toBeNull();
  });
});

// --- Farol do gestor ----------------------------------------------------------------------------------------

describe("farol no Painel da Equipe", () => {
  it("uma linha por corretor, ordem risco alto → tranquilo → novo, 5 sinais", () => {
    render(createElement(FarolEquipe, { dados, gestao: gestao(), hoje: HOJE }));
    const linhas = screen.getAllByTestId("farol-linha");
    expect(linhas.map((l) => l.getAttribute("data-farol"))).toEqual(["risco", "tranquilo", "novo"]);
    expect(linhas[0].textContent).toContain("Ana Teste");
    expect(linhas[0].querySelectorAll("[data-sinal]")).toHaveLength(5);
    expect(screen.getAllByTestId("farol-geral").map((x) => x.textContent)).toEqual([
      "🔴 Risco alto",
      "🟢 Tranquilo",
      "🆕 Novo",
    ]);
  });
  it("sem plano: atividade e captações = 'sem plano', sem cor", () => {
    render(createElement(FarolEquipe, { dados, gestao: gestao(), hoje: HOJE }));
    const bia = screen.getAllByTestId("farol-linha")[1];
    for (const k of ["atividade", "captacoes"]) {
      const s = bia.querySelector(`[data-sinal="${k}"]`)!;
      expect(s.getAttribute("data-cor")).toBe("sem_plano");
      expect(s.textContent).toBe("sem plano");
    }
  });
  it("cópia ms.* do TL desatualizada: 'meta de DD/MM'", () => {
    render(createElement(FarolEquipe, { dados, gestao: gestao(), hoje: HOJE }));
    expect(screen.getByTestId("meta-de").textContent).toBe("meta de 20/10");
  });
  it("coluna gargalo: etapa apontada ou 'pouco dado ainda'", () => {
    render(createElement(FarolEquipe, { dados, gestao: gestao(), hoje: HOJE }));
    const g = screen.getAllByTestId("farol-gargalo").map((x) => x.textContent);
    expect(g[0]).toBe("de V1 para V2");
    expect(g[1]).toBe("pouco dado ainda");
  });
  it("link para 'Equipe: feito x meta' continua; não é ranking", () => {
    render(createElement(FarolEquipe, { dados, gestao: gestao(), hoje: HOJE }));
    expect(screen.getByText("Equipe: feito x meta").getAttribute("href")).toBe("/minha-carreira");
    expect(screen.getByTestId("farol-equipe").textContent).toMatch(/Não é ranking/);
    expect(screen.getByTestId("farol-equipe").textContent).not.toMatch(/[0-9]º|pontos:/i);
  });

  it("clique no corretor abre a 1:1 com pauta automática e salva com próxima em 14 dias", async () => {
    rpc.mockImplementation((fn: string) =>
      fn === "gestao_pendencias_corretor"
        ? Promise.resolve({
            data: [
              {
                kind: "vencendo",
                capture_id: "cap9",
                imovel: "Apto — Campolim",
                detalhe: "Exclusividade vence em breve",
                prazo: "2026-11-13",
                dias: 5,
              },
            ],
            error: null,
          })
        : Promise.resolve({ data: "nova-id", error: null }),
    );
    const g = gestao();
    render(createElement(FarolEquipe, { dados, gestao: g, hoje: HOJE }));
    fireEvent.click(screen.getByRole("button", { name: "Ana Teste" }));
    const dlg = await screen.findByTestId("conversa-1a1");
    await waitFor(() => expect(within(dlg).getByTestId("pauta-pendencias")).toBeTruthy());
    expect(dlg.textContent).toContain("Ligações no mês");
    expect(dlg.textContent).toContain("30 de 40");
    expect(within(dlg).getByTestId("pauta-pendencias").textContent).toContain(
      "Exclusividade: Exclusividade vence em breve",
    );
    // Lead sem resposta e reunião de 45 dias entram na pauta (mesma regra do "O que fazer hoje").
    expect(within(dlg).getByTestId("pauta-pendencias").textContent).toContain("Lead sem resposta");
    expect(within(dlg).getByTestId("pauta-pendencias").textContent).toContain("Reunião 45 dias");
    // Combinados anteriores com feito/não feito.
    fireEvent.click(within(dlg).getByRole("button", { name: "Feito" }));
    fireEvent.change(within(dlg).getByLabelText("Novo combinado 1"), {
      target: { value: "  Fazer a reunião de 45 dias  " },
    });
    expect((within(dlg).getByTestId("proxima-1a1") as HTMLInputElement).value).toBe("2026-11-22");
    fireEvent.click(within(dlg).getByTestId("salvar-1a1"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "gestao_1a1_salvar",
        expect.objectContaining({ _corretor: "ana" }),
      ),
    );
    const args = rpc.mock.calls.find((c) => c[0] === "gestao_1a1_salvar")![1];
    expect(args._data).toBe(HOJE);
    expect(args._proxima).toBe("2026-11-22");
    expect(args._combinados).toEqual([{ texto: "Fazer a reunião de 45 dias", feito: null }]);
    expect(args._pauta.combinados_anteriores).toEqual([
      { texto: "Ligar para 5 proprietários", feito: true },
    ]);
    expect(args._pauta.sinais.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(g.recarregar).toHaveBeenCalled());
  });

  it("próxima 1:1 editável (e acompanha a data enquanto não for mexida)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(createElement(FarolEquipe, { dados, gestao: gestao(), hoje: HOJE }));
    fireEvent.click(screen.getByRole("button", { name: "Bia Teste" }));
    const dlg = await screen.findByTestId("conversa-1a1");
    fireEvent.change(within(dlg).getByLabelText("Data da conversa"), {
      target: { value: "2026-11-01" },
    });
    expect((within(dlg).getByTestId("proxima-1a1") as HTMLInputElement).value).toBe("2026-11-15");
    fireEvent.change(within(dlg).getByTestId("proxima-1a1"), { target: { value: "2026-12-01" } });
    expect((within(dlg).getByTestId("proxima-1a1") as HTMLInputElement).value).toBe("2026-12-01");
    expect(dlg.textContent).toContain("Primeira 1:1 registrada.");
  });
});

// --- Previsão do trimestre -----------------------------------------------------------------------------------

describe("previsão do trimestre (Meta do mês)", () => {
  it("usa as pontas do painel: recebido no trimestre + 80% andamento + 50% ritmo × meses", () => {
    const pontas = pontasDoPainel(dados);
    const i = insumosPrevisao(dados, pontas, HOJE);
    // 4º tri (out-dez): v1 concluída em outubro = recebido; v2 em andamento; ritmo = (ago 36k + set 0 + out 60k)/3.
    expect(i.recebido).toBe(60_000);
    expect(i.andamento).toBe(30_000);
    expect(i.ritmoMensal).toBe(32_000);
    expect(i.mesesRestantes).toBe(1);
    render(createElement(PrevisaoTrimestre, { dados, pontas, hoje: HOJE, meta: 150_000 }));
    const t = screen.getByTestId("previsao-trimestre").textContent!;
    // 60.000 + 24.000 + 16.000 = 100.000 → 67% de 150.000
    expect(t).toMatch(/Previsão do 4º trimestre/);
    expect(t).toMatch(/R\$\s?100\.000/);
    expect(t).toContain("(67%)");
    expect(t).toMatch(/já recebidos \+ 80% de/);
  });
  it("sem meta cadastrada: só o valor previsto", () => {
    const pontas = pontasDoPainel(dados);
    render(createElement(PrevisaoTrimestre, { dados, pontas, hoje: HOJE, meta: null }));
    expect(screen.getByTestId("previsao-trimestre").textContent).not.toMatch(/%\)/);
  });
});

// --- Corretor ------------------------------------------------------------------------------------------------

describe("Minha carreira: Meu termômetro, Minha próxima 1:1, Onde você perde mais", () => {
  const ana = farol.pessoas[0];
  const linha = calcularFarol(
    {
      user_id: "ana",
      nome: "Ana Teste",
      entrou_em: ana.entrou_em,
      dias_sem_vender: 68,
      semana: semana({ ligacoes: 2, v1: 0, v2: 0, acm: 0, captMes: 0 }),
      capt_mes: 0,
      metas: METAS,
      leads: ana.leads,
      lead_config: null,
      captacoes: ana.captacoes,
    },
    HOJE,
    new Date("2026-11-08T15:00:00Z"),
  );
  it("termômetro: farol + 5 sinais do próprio corretor, sem ranking nem colegas", () => {
    render(createElement(MeuTermometro, { linha }));
    const c = screen.getByTestId("meu-termometro");
    expect(c.querySelectorAll("[data-sinal]")).toHaveLength(5);
    expect(c.textContent).toContain("🔴 Risco alto");
    expect(c.textContent).toMatch(/Sem ranking/);
    expect(c.textContent).not.toContain("Bia");
  });
  it("corretor novo: aparece como novo, sem farol de produção", () => {
    const novo = calcularFarol(
      {
        user_id: "caio",
        nome: "Caio Novo",
        entrou_em: "2026-10-01",
        dias_sem_vender: null,
        semana: semana(),
        capt_mes: 0,
        metas: null,
        leads: null,
        lead_config: null,
        captacoes: null,
      },
      HOJE,
      new Date(),
    );
    render(createElement(MeuTermometro, { linha: novo }));
    expect(screen.getByTestId("meu-termometro").textContent).toContain("🆕 Novo");
    expect(screen.getByTestId("meu-termometro").textContent).toContain(
      "ainda sem farol de produção",
    );
  });
  it("próxima 1:1: data, com quem, combinados da última (e 'atrasada')", () => {
    render(createElement(MinhaProxima1a1, { ultima: ana.ultima_1a1, hoje: HOJE }));
    const c = screen.getByTestId("minha-proxima-1a1");
    expect(c.textContent).toContain("terça, 03/11 com Ricardo Gestor");
    expect(c.textContent).toContain("atrasada");
    expect(screen.getByTestId("meus-combinados").textContent).toContain(
      "Ligar para 5 proprietários",
    );
  });
  it("sem 1:1 registrada: explica", () => {
    render(createElement(MinhaProxima1a1, { ultima: null, hoje: HOJE }));
    expect(screen.getByTestId("minha-proxima-1a1").textContent).toMatch(/Nenhuma conversa 1:1/);
  });
  it("Onde você perde mais: etapa + dica fixa; pouco dado", () => {
    render(createElement(OndePerdeMais, { g: gargalo(ana.funil90!, ana.funil90_equipe!) }));
    expect(screen.getByTestId("onde-perde-mais").textContent).toMatch(
      /de V1 para V2\. Você converte 15%, a equipe 50%\. Dica:/,
    );
    cleanup();
    render(
      createElement(OndePerdeMais, {
        g: gargalo(farol.pessoas[1].funil90!, farol.pessoas[1].funil90_equipe!),
      }),
    );
    expect(screen.getByTestId("onde-perde-mais").textContent).toContain("pouco dado ainda");
  });
});

describe("O que fazer hoje: itens novos", () => {
  const agora = new Date("2026-11-08T15:00:00Z");
  it("lead sem resposta (prazo vencido) e reunião 45 dias pendente", () => {
    const x = pendenciasExtras(farol.pessoas[0], farol, HOJE, agora);
    expect(x.map((p) => p.kind)).toEqual(["lead_sem_resposta", "reuniao_45"]);
    expect(x[0].detalhe).toMatch(/^1 lead sem resposta/);
    expect(x[1].capture_id).toBe("cap1");
    expect(x[1].detalhe).toBe("99 dias sem reunião com o proprietário");
  });
  it("módulo de avisos desligado (reunioes = null) ou leads desligado: nada", () => {
    const sem = normalizarFarolDados({
      ...farolRaw,
      lead_config: null,
      pessoas: [
        {
          ...farolRaw.pessoas[0],
          leads: null,
          captacoes: [{ ...farolRaw.pessoas[0].captacoes[0], reunioes: null }],
        },
      ],
    });
    expect(pendenciasExtras(sem.pessoas[0], sem, HOJE, agora)).toEqual([]);
  });
  it("1:1 atrasada para gestor/TL: só quem passou da próxima data", () => {
    const x = umAUmAtrasadas(farol, HOJE);
    expect(x).toHaveLength(1);
    expect(x[0].detalhe).toBe("1:1 com Ana Teste era para 03/11");
  });
  it("'Reunião 45 dias' não duplica: minhas_pendencias não tem esse tipo", () => {
    const tipos = readFileSync("src/lib/minha-carreira.ts", "utf8");
    expect(tipos).not.toMatch(/reuniao/);
  });
});
