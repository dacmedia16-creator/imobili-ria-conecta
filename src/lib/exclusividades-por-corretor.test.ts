import { describe, expect, it } from "vitest";
import { normalizeForm, type Capture, type CaptureStatus } from "./exclusive-captures";
import {
  corDiasRestantes,
  faseCaptacao,
  linhaCaptacao,
  passaFiltros,
  pessoasDaEquipe,
  resumoPorCorretor,
  textoDiasRestantes,
  totaisPorCorretor,
  FILTROS_POR_CORRETOR_VAZIOS as VAZIO,
} from "./exclusividades-por-corretor";

const HOJE = "2026-10-08";
let n = 0;
function cap(
  captor: string,
  status: CaptureStatus,
  opts: { signed?: string; prazo?: string; valor?: string; bairro?: string; plano?: string[] } = {},
): Capture {
  n++;
  return {
    id: `c${n}`,
    captor_id: captor,
    template: "remax-padrao",
    status,
    form_data: normalizeForm({
      imovel: {
        endereco: `Rua Fictícia, ${n}`,
        bairro: opts.bairro ?? "Campolim",
        valor_imovel: opts.valor ?? "500.000,00",
      } as never,
      condicoes: { prazo_dias_numero: opts.prazo ?? "180" } as never,
      proprietario_1: { nome: "PROPRIETARIO SECRETO", cpf: "000.000.000-00" } as never,
      ...(opts.plano ? { dossie: opts.plano } : {}),
    }),
    broker_name: captor.toUpperCase(),
    broker_cpf: "",
    broker_creci: "",
    created_on_sp: "2026-01-01",
    created_at: `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`,
    signed_on: opts.signed ?? null,
  };
}

describe("fases e cores", () => {
  it("classifica por status e vigência", () => {
    expect(faseCaptacao(cap("a", "aprovada", { signed: "2026-09-01" }), HOJE)).toBe("vigor");
    expect(faseCaptacao(cap("a", "aprovada", { signed: "2026-01-01", prazo: "90" }), HOJE)).toBe(
      "vencida",
    );
    expect(faseCaptacao(cap("a", "aprovada"), HOJE)).toBe("vigor"); // sem data: não some
    expect(faseCaptacao(cap("a", "enviada"), HOJE)).toBe("gestor");
    expect(faseCaptacao(cap("a", "em_assinatura"), HOJE)).toBe("assinatura");
    expect(faseCaptacao(cap("a", "devolvida"), HOJE)).toBe("rascunho");
    expect(faseCaptacao(cap("a", "rascunho"), HOJE)).toBe("rascunho");
  });
  it("verde > 60, amarelo 30–60, vermelho < 30 ou vencida", () => {
    expect(corDiasRestantes(61)).toBe("verde");
    expect(corDiasRestantes(60)).toBe("amarelo");
    expect(corDiasRestantes(30)).toBe("amarelo");
    expect(corDiasRestantes(29)).toBe("vermelho");
    expect(corDiasRestantes(-3)).toBe("vermelho");
    expect(textoDiasRestantes(-3)).toBe("venceu há 3 d");
    expect(textoDiasRestantes(1)).toBe("1 dia");
  });
  it("fim = assinatura + prazo; antes de assinar não há vigência", () => {
    const l = linhaCaptacao(cap("a", "aprovada", { signed: "2026-10-01", prazo: "180" }), HOJE);
    expect(l.v?.end).toBe("2027-03-30");
    expect(l.v?.daysLeft).toBe(173);
    expect(linhaCaptacao(cap("a", "em_assinatura", { signed: "2026-10-01" }), HOJE).v).toBeNull();
  });
});

describe("resumo e filtros", () => {
  const lista = [
    cap("diego", "aprovada", { signed: "2026-09-15", valor: "640.000,00", plano: ["a", "b"] }),
    cap("diego", "aprovada", { signed: "2026-04-20", valor: "1.850.000,00", plano: ["a"] }), // 9 dias
    cap("diego", "enviada", { bairro: "Jardim Europa" }),
    cap("carla", "aprovada", { signed: "2026-01-01", prazo: "90", plano: ["x"] }), // vencida
    cap("carla", "em_assinatura", { plano: ["x"] }),
    cap("bruno", "devolvida", { valor: "" }),
  ].map((c) => linhaCaptacao(c, HOJE));

  it("conta por corretor e soma só o valor em vigor", () => {
    const r = resumoPorCorretor(lista);
    const diego = r.find((x) => x.id === "diego")!;
    expect(diego.emVigor).toBe(2);
    expect(diego.valorEmVigor).toBe(2_490_000);
    expect(diego.vencem30).toBe(1);
    expect(diego.aguardandoGestor).toBe(1);
    expect(diego.semPlano).toBe(1);
    expect(diego.linhas[0].v?.daysLeft).toBe(9); // 20/04 + 180 = 17/10; menos dias primeiro
    const carla = r.find((x) => x.id === "carla")!;
    expect([carla.vencidas, carla.emAssinatura, carla.valorEmVigor]).toEqual([1, 1, 0]);
    expect(r[0].id).toBe("diego");
  });

  it("com a equipe escolhida, mostra quem está zerado e esconde quem é de fora", () => {
    const r = resumoPorCorretor(lista, [
      { id: "diego", nome: "Diego" },
      { id: "juliana", nome: "Juliana" },
    ]);
    expect(r.map((x) => x.id)).toEqual(["diego", "juliana"]);
    expect(r[1].linhas).toHaveLength(0);
  });

  it("filtra por corretor, status, bairro e vence em X dias", () => {
    const ids = (f: typeof VAZIO) => lista.filter((l) => passaFiltros(l, f)).map((l) => l.c.id);
    expect(ids({ ...VAZIO, corretor: "carla" })).toHaveLength(2);
    expect(ids({ ...VAZIO, fase: "gestor" })).toHaveLength(1);
    expect(ids({ ...VAZIO, bairro: "Jardim Europa" })).toHaveLength(1);
    expect(ids({ ...VAZIO, vence: "15" })).toEqual([lista[1].c.id]);
    expect(ids({ ...VAZIO, vence: "vencidas" })).toEqual([lista[3].c.id]);
    expect(ids({ ...VAZIO, vence: "30" })).toEqual([lista[1].c.id]);
  });

  it("totais do topo", () => {
    expect(totaisPorCorretor(lista)).toEqual({
      emVigor: 2,
      valorEmVigor: 2_490_000,
      vencem30: 1,
      vencidas: 1,
      aguardandoGestor: 1,
      assinaturaOuRascunho: 2,
      semValor: 0,
    });
  });

  it("nunca expõe dados do proprietário nem comissão nas linhas calculadas", () => {
    const texto = JSON.stringify(
      resumoPorCorretor(lista).map((r) => ({
        ...r,
        linhas: r.linhas.map(({ c: _c, ...resto }) => resto),
      })),
    );
    expect(texto).not.toContain("PROPRIETARIO SECRETO");
    expect(texto).not.toMatch(/comiss/i);
  });
});

describe("pessoas da equipe", () => {
  it("líder, líder auxiliar e membros só da equipe escolhida", () => {
    const ids = pessoasDaEquipe("t1", {
      teams: [
        { id: "t1", lider_id: "rafaela" },
        { id: "t2", lider_id: "marcos" },
      ],
      membros: [
        { team_id: "t1", membro_id: "diego" },
        { team_id: "t2", membro_id: "paula" },
      ],
      coLideres: [{ team_id: "t1", user_id: "aux" }],
    });
    expect([...ids].sort()).toEqual(["aux", "diego", "rafaela"]);
  });
});
