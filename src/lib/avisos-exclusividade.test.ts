import { describe, expect, it } from "vitest";
import { emptyForm } from "./exclusive-captures";
import {
  addDias,
  avisosDaCaptacao,
  contarReunioesPendentes,
  linhasResumo,
  mensagemResumo,
  rotuloImovel,
  statusReuniao,
  textoStatusReuniao,
  type CapturaAviso,
} from "./avisos-exclusividade";
import {
  executarEnvios,
  lideresDe,
  planejarEnvios,
  chaveEnvio,
  type Canais,
  type DadosOrg,
  type Envio,
  type Registro,
} from "./avisos-exclusividade.server";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";

const cap = (
  id: string,
  signed_on: string,
  prazo: string,
  over: Partial<CapturaAviso> = {},
): CapturaAviso => {
  const f = emptyForm();
  f.condicoes.prazo_dias_numero = prazo;
  f.imovel.bairro = "Campolim";
  f.imovel.endereco = "Rua Secreta, 10";
  f.proprietario_1.nome_completo = "Fulano Proprietario";
  f.proprietario_1.telefone_1 = "15999990000";
  return {
    id,
    organization_id: ORG_A,
    captor_id: "corretor-1",
    status: "aprovada",
    signed_on,
    form_data: f,
    archived_at: null,
    discarded_at: null,
    broker_name: "Maiana",
    ...over,
  } as CapturaAviso;
};

const plano = (c: CapturaAviso, hoje: string, reunioes: string[] = [], vendida = false) =>
  avisosDaCaptacao(c, { hoje, vendida, reunioes, codigoAnuncio: "AB123" });

describe("vencimento pelo prazo individual", () => {
  it("usa signed_on + prazo_dias_numero de cada captação", () => {
    // 90 dias: assinada 01/09 → fim 30/11. 180 dias: fim 28/02/2027.
    const hoje = "2026-11-08";
    const a = plano(cap("a", "2026-09-01", "90"), hoje, ["2026-11-01"]);
    expect(a.map((x) => [x.tipo, x.chave])).toEqual([["vence_30", "2026-11-30"]]);
    expect(a[0].mensagem).toContain("Faltam 22 dias");
    expect(plano(cap("b", "2026-09-01", "180"), hoje).filter((x) => x.tipo.startsWith("venc"))).toEqual([]);
  });
  it("sem prazo ou sem assinatura: nenhum aviso", () => {
    expect(plano(cap("a", "2026-09-01", ""), "2026-11-08")).toEqual([]);
    expect(plano(cap("a", "", "90", { signed_on: null }), "2026-11-08")).toEqual([]);
  });
  it("só aprovada e em vigor; encerrada, cancelada e vendida não recebem", () => {
    const hoje = "2026-11-08";
    expect(plano(cap("a", "2026-09-01", "90", { status: "enviada" }), hoje)).toEqual([]);
    expect(plano(cap("a", "2026-09-01", "90", { archived_at: "x" }), hoje)).toEqual([]);
    expect(plano(cap("a", "2026-09-01", "90", { discarded_at: "x" }), hoje)).toEqual([]);
    expect(plano(cap("a", "2026-09-01", "90"), hoje, [], true)).toEqual([]);
  });
});

describe("os 3 avisos (30, 15, no dia) sem duplicar", () => {
  const c = cap("a", "2026-09-01", "90"); // fim 2026-11-30
  const dia = (n: number) => addDias("2026-11-30", -n);
  it("cada janela gera 1 tipo com a mesma chave (fim) todos os dias da janela", () => {
    expect(plano(c, dia(31)).filter((x) => x.tipo.startsWith("venc"))).toEqual([]);
    expect(plano(c, dia(30))[0].tipo).toBe("vence_30");
    expect(plano(c, dia(16))[0].tipo).toBe("vence_30");
    expect(plano(c, dia(15))[0].tipo).toBe("vence_15");
    expect(plano(c, dia(1))[0].tipo).toBe("vence_15");
    const hoje = plano(c, dia(0))[0];
    expect(hoje.tipo).toBe("vence_hoje");
    expect(hoje.mensagem).toBe(
      "A exclusividade do imóvel AB123 / Campolim venceu hoje. Fale com o proprietário sobre renovar ou encerrar.",
    );
  });
  it("rodando todos os dias, cada tipo sai 1 vez só (registro por pessoa+captação+tipo+chave)", () => {
    const enviados = new Set<string>();
    const contagem: Record<string, number> = {};
    for (let n = 40; n >= 0; n--) {
      for (const a of plano(c, dia(n))) {
        if (!a.tipo.startsWith("venc")) continue;
        const k = `${a.tipo}|${a.chave}`;
        if (enviados.has(k)) continue;
        enviados.add(k);
        contagem[a.tipo] = (contagem[a.tipo] ?? 0) + 1;
      }
    }
    expect(contagem).toEqual({ vence_30: 1, vence_15: 1, vence_hoje: 1 });
  });
  it("sistema fora do ar no dia 30: o aviso de 30 sai no dia seguinte (janela), sem perder", () => {
    expect(plano(c, dia(29))[0]).toMatchObject({ tipo: "vence_30", chave: "2026-11-30" });
  });
  it("renovou (prazo maior): novo vencimento = nova chave, avisos voltam no novo ciclo", () => {
    const renovada = cap("a", "2026-09-01", "180"); // fim 2027-02-28
    expect(plano(renovada, "2027-02-10")[0]).toMatchObject({ tipo: "vence_30", chave: "2027-02-28" });
  });
});

describe("lembrete semanal da vencida", () => {
  const c = cap("a", "2026-09-01", "90"); // fim 2026-11-30
  it("1 por semana até renovar ou encerrar", () => {
    const enviados = new Set<string>();
    const dias: string[] = [];
    for (let n = 1; n <= 35; n++) {
      const hoje = addDias("2026-11-30", n);
      for (const a of plano(c, hoje)) {
        if (a.tipo !== "vencida_semanal" || enviados.has(a.chave)) continue;
        enviados.add(a.chave);
        dias.push(hoje);
      }
    }
    expect(dias).toEqual(["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28", "2027-01-04"]);
    expect(plano(c, "2026-12-07")[0].mensagem).toContain("venceu há 7 dias");
  });
  it("encerrou (arquivada): para de avisar", () => {
    expect(plano(cap("a", "2026-09-01", "90", { archived_at: "x" }), "2026-12-14")).toEqual([]);
  });
});

describe("reunião de 45 dias", () => {
  const c = cap("a", "2026-09-01", "180");
  it("conta do signed_on e recomeça a cada reunião registrada", () => {
    expect(statusReuniao(c, [], "2026-10-15")).toMatchObject({ dias: 44, pendente: false });
    expect(statusReuniao(c, [], "2026-10-16")).toMatchObject({ dias: 45, pendente: true });
    const depois = statusReuniao(c, ["2026-10-20"], "2026-11-08");
    expect(depois).toMatchObject({ base: "2026-10-20", dias: 19, pendente: false });
    expect(textoStatusReuniao(depois!)).toBe("Reunião em dia (19 dias desde a última)");
    expect(textoStatusReuniao(statusReuniao(c, [], "2026-10-20")!)).toBe("Reunião pendente (49 dias)");
  });
  it("aviso aos 45 dias e depois 1 por semana enquanto pendente; para após registrar", () => {
    const enviados = new Set<string>();
    const saidas: string[] = [];
    const reunioes: string[] = [];
    for (let n = 40; n <= 75; n++) {
      const hoje = addDias("2026-09-01", n);
      if (hoje === "2026-10-30") reunioes.push("2026-10-30"); // registrou a reunião
      for (const a of plano(c, hoje, reunioes)) {
        if (!a.tipo.startsWith("reuniao")) continue;
        const k = `${a.tipo}|${a.chave}`;
        if (enviados.has(k)) continue;
        enviados.add(k);
        saidas.push(`${hoje}:${a.tipo}`);
      }
    }
    expect(saidas).toEqual(["2026-10-16:reuniao_45", "2026-10-23:reuniao_semanal"]);
  });
  it("vencida: não cobra reunião (fora de vigor)", () => {
    expect(statusReuniao(cap("a", "2026-01-01", "90"), [], "2026-11-08")).toBeNull();
  });
  it("conta 'Reuniões pendentes' só entre as em vigor", () => {
    const caps = [
      cap("a", "2026-09-01", "180"),
      cap("b", "2026-10-30", "180"),
      cap("c", "2026-01-01", "90"),
    ];
    expect(contarReunioesPendentes(caps, new Map(), "2026-11-08")).toBe(1);
  });
});

describe("privacidade da mensagem", () => {
  it("só código e bairro; nunca nome, telefone ou endereço do proprietário", () => {
    const c = cap("12345678-aaaa-4000-8000-000000000000", "2026-09-01", "90");
    const todas = avisosDaCaptacao(c, { hoje: "2026-11-30", vendida: false, reunioes: [] })
      .map((a) => a.mensagem)
      .join(" ");
    expect(todas).toContain("#123456 / Campolim");
    expect(todas).not.toMatch(/Fulano|15999990000|Rua Secreta/);
    expect(rotuloImovel(c, "XY9")).toBe("XY9 / Campolim");
  });
});

const dados = (over: Partial<DadosOrg> = {}): DadosOrg => ({
  orgId: ORG_A,
  capturas: [],
  vendidas: new Set(),
  reunioes: new Map(),
  codigos: new Map(),
  pessoas: new Map([
    ["corretor-1", { id: "corretor-1", nome: "Maiana", telefone: "(15) 98888-7777", ativo: true }],
    ["lider-1", { id: "lider-1", nome: "Líder", telefone: "15977776666", ativo: true }],
  ]),
  preferencias: new Map(),
  inscricoes: [],
  lideranca: {
    teams: [{ id: "t1", lider_id: "lider-1", parent_team_id: null }],
    membros: [{ team_id: "t1", membro_id: "corretor-1" }],
    coLideres: [],
    lideresComPapel: ["lider-1"],
  },
  jaEnviados: new Set(),
  ...over,
});

describe("isolamento entre imobiliárias", () => {
  it("captação de outra imobiliária ou corretor que não é da imobiliária não gera aviso", () => {
    const d = dados({
      capturas: [
        cap("a", "2026-09-01", "90", { organization_id: ORG_B }),
        cap("b", "2026-09-01", "90", { captor_id: "corretor-de-fora" }),
        cap("c", "2026-09-01", "90"),
      ],
    });
    const env = planejarEnvios(d, "2026-11-08");
    expect([...new Set(env.map((e) => e.captureId))]).toEqual(["c"]);
    expect(env.every((e) => e.orgId === ORG_A)).toBe(true);
  });
  it("resumo de segunda: só para líder com papel gestor/TL, separado por corretor", () => {
    const d = dados({ capturas: [cap("c", "2026-09-01", "90"), cap("v", "2026-08-01", "90")] });
    const seg = planejarEnvios(d, "2026-11-09"); // segunda
    const r = seg.find((e) => e.tipo === "resumo_gestor");
    expect(r?.recipientId).toBe("lider-1");
    expect(r?.mensagem).toContain("Maiana");
    expect(r?.mensagem).toContain("vencidas (1)");
    expect(planejarEnvios(d, "2026-11-10").some((e) => e.tipo === "resumo_gestor")).toBe(false);
    const semPapel = dados({
      capturas: d.capturas,
      lideranca: { ...d.lideranca, lideresComPapel: [] },
    });
    expect(planejarEnvios(semPapel, "2026-11-09").some((e) => e.tipo === "resumo_gestor")).toBe(false);
  });
  it("líder auxiliar e líder da equipe-mãe também contam", () => {
    expect(
      lideresDe("x", {
        teams: [
          { id: "pai", lider_id: "L0", parent_team_id: null },
          { id: "t", lider_id: "L1", parent_team_id: "pai" },
        ],
        membros: [{ team_id: "t", membro_id: "x" }],
        coLideres: [{ team_id: "t", user_id: "L2" }],
        lideresComPapel: ["L0", "L1", "L2"],
      }).sort(),
    ).toEqual(["L0", "L1", "L2"]);
  });
  it("já registrado não volta ao plano", () => {
    const d = dados({ capturas: [cap("c", "2026-09-01", "90")] });
    for (const e of planejarEnvios(d, "2026-11-08")) d.jaEnviados.add(chaveEnvio(e));
    expect(planejarEnvios(d, "2026-11-08")).toEqual([]);
  });
  it("preferências: push/WhatsApp desligados no perfil; sino continua", () => {
    const d = dados({
      capturas: [cap("c", "2026-09-01", "90")],
      preferencias: new Map([["corretor-1", { user_id: "corretor-1", push: false, whatsapp: false }]]),
    });
    expect(planejarEnvios(d, "2026-11-08")[0].canais).toEqual({ push: false, whatsapp: false });
  });
});

describe("canais: falha de um não derruba os outros", () => {
  const envio = (): Envio => ({
    orgId: ORG_A,
    recipientId: "corretor-1",
    captureId: "c",
    tipo: "vence_30",
    chave: "2026-11-30",
    titulo: "t",
    mensagem: "Faltam 22 dias para vencer a exclusividade do imóvel AB123 / Campolim.",
    url: "/exclusividades/c",
    canais: { push: true, whatsapp: true },
    telefone: "5515988887777",
  });
  const sub = { id: "s", user_id: "corretor-1", endpoint: "https://x", p256dh: "p", auth: "a" };
  const registroMem = () => {
    const reservados = new Set<string>();
    const resultados: Record<string, unknown>[] = [];
    const r: Registro = {
      async reservar(e) {
        const k = chaveEnvio(e);
        if (reservados.has(k)) return false;
        reservados.add(k);
        return true;
      },
      async concluir(_e, res) {
        resultados.push(res);
      },
    };
    return { r, resultados };
  };

  it("push lança erro: sino e WhatsApp seguem e a falha fica registrada", async () => {
    const chamadas: string[] = [];
    const canais: Canais = {
      sino: async () => void chamadas.push("sino"),
      push: async () => {
        throw new Error("serviço de push fora do ar");
      },
      whatsapp: async () => (chamadas.push("whatsapp"), true),
    };
    const { r, resultados } = registroMem();
    const t = await executarEnvios([envio()], [sub], canais, r);
    expect(chamadas).toEqual(["sino", "whatsapp"]);
    expect(resultados[0]).toMatchObject({ sino: "ok", push: "falhou", whatsapp: "ok" });
    expect(String(resultados[0].erro)).toContain("push");
    expect(t.falhasCanal).toBe(1);
  });
  it("sino e WhatsApp falham: push ainda vai", async () => {
    let push = 0;
    const canais: Canais = {
      sino: async () => {
        throw new Error("db");
      },
      push: async () => (push++, { ok: 1, falhas: 0 }),
      whatsapp: async () => false,
    };
    const { r, resultados } = registroMem();
    await executarEnvios([envio()], [sub], canais, r);
    expect(push).toBe(1);
    expect(resultados[0]).toMatchObject({ sino: "falhou", push: "ok", whatsapp: "falhou" });
  });
  it("mesmo aviso duas vezes (duas rodadas): manda 1 só", async () => {
    let n = 0;
    const canais: Canais = { sino: async () => void n++, push: null, whatsapp: null };
    const { r } = registroMem();
    const t = await executarEnvios([envio(), envio()], [], canais, r);
    expect(n).toBe(1);
    expect(t.pulados).toBe(1);
  });
  it("WhatsApp em ASCII e sem dado do proprietário", async () => {
    let texto = "";
    const canais: Canais = {
      sino: async () => {},
      push: null,
      whatsapp: async (_t, m) => ((texto = m), true),
    };
    await executarEnvios([envio()], [], canais, registroMem().r);
    expect([...texto].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    expect(texto).toContain("imovel AB123 / Campolim");
  });
});

describe("resumo do gestor", () => {
  it("separa por corretor e lista vencidas, até 15 dias e reuniões pendentes", () => {
    const caps = [
      cap("a", "2026-08-01", "90"), // vencida 30/10
      cap("b", "2026-08-20", "90"), // vence 18/11 (10 dias)
      cap("c", "2026-09-01", "180", { captor_id: "outro", broker_name: "Bruno" }), // reunião pendente
    ];
    const l = linhasResumo(caps, {
      hoje: "2026-11-08",
      vendidas: new Set(),
      reunioes: new Map(),
      codigos: new Map(),
      nomes: new Map([["corretor-1", "Maiana"]]),
    });
    expect(l.map((x) => [x.corretor, x.vencidas.length, x.vencem15.length, x.reunioesPendentes.length])).toEqual([
      ["Bruno", 0, 0, 1],
      ["Maiana", 1, 1, 1],
    ]);
    expect(mensagemResumo(l)).toContain("reuniões pendentes (1)");
  });
});
