import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ageDays,
  ageLabel,
  alertMessage,
  bairroCasa,
  captureCandidate,
  captureMatches,
  classifyPost,
  encaixa,
  encaixesVisiveis,
  extractValues,
  faixaTexto,
  groupMatches,
  isExpired,
  isNoise,
  pairKey,
  sanitizeName,
  sanitizeText,
  sourceKeyInput,
  valorCasa,
  type CaptureCandidate,
  type OpportunityPost,
} from "./oportunidades";

const NOW = new Date("2026-10-14T15:00:00-03:00");

function post(p: Partial<OpportunityPost> & Pick<OpportunityPost, "id" | "kind">): OpportunityPost {
  return {
    tipo: "Apartamento",
    finalidade: "Venda",
    bairro: "Campolim",
    valor_min: null,
    valor_max: null,
    valor: null,
    corretor: "Ana Souza",
    texto: "",
    posted_at: "2026-10-14T10:00:00-03:00",
    ...p,
  };
}

describe("limpeza", () => {
  it("remove telefone, e-mail, link, senha e menção", () => {
    const t = sanitizeText(
      "Apto no Campolim (15) 99123-4567 ana@x.com.br https://site.com/a senha: abc123 @fulano 3 dorms",
    );
    expect(t).not.toMatch(/9912|@|https|abc123/);
    expect(t).toContain("3 dorms");
  });

  it("nome sem cargo/telefone; fallback quando tem dígito", () => {
    expect(sanitizeName("Corretora Ana Souza | Imob X")).toBe("Ana Souza");
    expect(sanitizeName("+55 15 99999-0000")).toBe("Corretor(a) do grupo");
    expect(sanitizeName("")).toBe("Corretor(a) do grupo");
  });

  it("ruído não vira cartão", () => {
    expect(isNoise("ok 👍")).toBe(true);
    expect(isNoise("cronjob response job_id: 1")).toBe(true);
    expect(isNoise("Procuro apartamento no Campolim até 600 mil")).toBe(false);
  });
});

describe("classificação", () => {
  it("valores ignoram metragem e condomínio", () => {
    expect(extractValues("Casa 250m² por R$ 890.000, condomínio R$ 600")).toEqual([890000]);
    expect(extractValues("até 1,2 mi")).toEqual([1_200_000]);
    expect(extractValues("3 dormitórios 2 vagas")).toEqual([]);
    // pontuação logo depois do preço não pode descartar o valor
    expect(extractValues("Vendo por R$ 450.000.")).toEqual([450_000]);
    expect(extractValues("até 500 mil, aceita permuta")).toEqual([500_000]);
  });

  it("procura com faixa", () => {
    const c = classifyPost(
      "Alguém tem apartamento no Campolim de 400 a 600 mil para cliente com financiamento?",
    );
    expect(c.kind).toBe("procura");
    expect(c.tipo).toBe("Apartamento");
    expect(c.finalidade).toBe("Venda");
    expect(c.valor_min).toBe(400_000);
    expect(c.valor_max).toBe(600_000);
  });

  it("oferta de locação", () => {
    const c = classifyPost(
      "CASA PARA LOCAÇÃO no Jardim Europa, 3 dormitórios, R$ 3.500 mensais. Parceria 50%",
    );
    expect(c.kind).toBe("oferta");
    expect(c.tipo).toBe("Casa");
    expect(c.finalidade).toBe("Locação");
    expect(c.valor).toBe(3500);
  });

  it("mensagem social vira outros, sem bairro", () => {
    const c = classifyPost("Bom dia pessoal, ótima semana a todos!!");
    expect(c.kind).toBe("outros");
    expect(c.bairro).toBeNull();
  });
});

describe("idade", () => {
  it("dias, rótulo e validade de 7 dias", () => {
    expect(ageDays("2026-10-14T08:00:00-03:00", NOW)).toBe(0);
    expect(ageDays("2026-10-13T23:30:00-03:00", NOW)).toBe(1);
    expect(ageLabel(1)).toBe("ontem");
    expect(ageLabel(6)).toBe("6 dias · vence em 1d");
    expect(isExpired("2026-10-07T10:00:00-03:00", NOW)).toBe(false);
    expect(isExpired("2026-10-06T10:00:00-03:00", NOW)).toBe(true);
  });
});

describe("encaixe", () => {
  const procura = post({ id: "p1", kind: "procura", valor_min: 400_000, valor_max: 600_000 });

  it("teto com 10% de folga e piso com 10% abaixo", () => {
    expect(valorCasa(procura, 660_000)).toBe(true);
    expect(valorCasa(procura, 661_000)).toBe(false);
    expect(valorCasa(procura, 360_000)).toBe(true);
    expect(valorCasa(procura, 359_000)).toBe(false);
    expect(valorCasa({ valor_min: null, valor_max: null }, 500_000)).toBe(false);
  });

  it("bairro: contém, lista e curinga de cidade", () => {
    expect(bairroCasa("Jardim Europa / Campolim", "Parque Campolim")).toBe(true);
    expect(bairroCasa("Vila Hortência", "Campolim")).toBe(false);
    expect(bairroCasa("Qualquer região", "Centro")).toBe(true);
    expect(bairroCasa("Sorocaba", "Campolim", "Sorocaba")).toBe(true);
    expect(bairroCasa("Sorocaba", "Centro", "Votorantim")).toBe(false);
  });

  it("tipo e finalidade precisam bater", () => {
    const base = {
      tipo: "Apartamento" as const,
      finalidade: "Venda" as const,
      bairro: "Campolim",
      valor: 500_000,
    };
    expect(encaixa(procura, base)).toBe(true);
    expect(encaixa(procura, { ...base, tipo: "Casa" })).toBe(false);
    expect(encaixa(procura, { ...base, finalidade: "Locação" })).toBe(false);
    expect(encaixa({ ...procura, kind: "oferta" }, base)).toBe(false);
  });

  it("grupo: autores diferentes, sem vencidos e sem pares ocultos", () => {
    const oferta = post({ id: "o1", kind: "oferta", valor: 550_000, corretor: "Bruno Lima" });
    const propria = post({ id: "o2", kind: "oferta", valor: 550_000 });
    const velha = post({
      id: "o3",
      kind: "oferta",
      valor: 550_000,
      corretor: "Caio",
      posted_at: "2026-10-01T10:00:00-03:00",
    });
    const m = groupMatches([procura, oferta, propria, velha], new Set(), NOW);
    expect(m.get("p1")?.map((p) => p.id)).toEqual(["o1"]);
    expect(m.get("o1")?.map((p) => p.id)).toEqual(["p1"]);
    expect(groupMatches([procura, oferta], new Set([pairKey("p1", "o1")]), NOW).size).toBe(0);
  });

  it("captação: converte form_data, ignora a do próprio autor e pares ocultos", () => {
    const c = captureCandidate({
      id: "c1",
      captor_id: "u1",
      captor_nome: "Bruno Lima",
      tipo_imovel: "Apartamento",
      bairro: " Campolim ",
      municipio: "Sorocaba",
      valor_imovel: "520.000,00",
    });
    expect(c).toMatchObject({
      tipo: "Apartamento",
      finalidade: "Venda",
      bairro: "Campolim",
      valor: 520_000,
    });
    const minha: CaptureCandidate = { ...c, id: "c2", captor_nome: "Ana Souza" };
    expect(captureMatches([procura], [c, minha], new Set(), NOW).map((x) => x.capture.id)).toEqual([
      "c1",
    ]);
    expect(captureMatches([procura], [c], new Set([pairKey("p1", "c1")]), NOW)).toEqual([]);
  });
});

describe("encaixes visíveis só para quem está no par (t_6dd4a31b)", () => {
  // Ana (uAna) procura; Bruno (uBruno) oferece; Caio (uCaio) é captador; Davi (uDavi) está de fora.
  const procura = post({
    id: "p1",
    kind: "procura",
    valor_max: 600_000,
    corretor: "Ana Souza",
    author_profile_id: "uAna",
  });
  const oferta = post({
    id: "o1",
    kind: "oferta",
    valor: 550_000,
    corretor: "Bruno Lima",
    author_profile_id: "uBruno",
  });
  const semAutor = post({
    id: "o2",
    kind: "oferta",
    valor: 560_000,
    corretor: "Edu Reis",
    author_profile_id: null,
  });
  const cap: CaptureCandidate = {
    id: "c1",
    captor_id: "uCaio",
    captor_nome: "Caio Neves",
    tipo: "Apartamento",
    finalidade: "Venda",
    bairro: "Campolim",
    municipio: "Sorocaba",
    valor: 520_000,
  };
  const ver = (userId: string, isStaff = false) =>
    encaixesVisiveis([procura, oferta, semAutor], [cap], new Set(), { userId, isStaff }, NOW);

  it("autor da procura vê 🤝 e ⭐ do próprio cartão; só pares com autor identificado", () => {
    const v = ver("uAna");
    expect(v.grupo.p1).toEqual(["o1", "o2"]); // a procura é dela: vê todas as ofertas que encaixam
    expect(v.grupo.o1).toEqual(["p1"]);
    expect(v.grupo.o2).toEqual(["p1"]);
    expect(v.equipe.p1?.map((c) => c.id)).toEqual(["c1"]);
  });

  it("autor da oferta vê só o par dele", () => {
    const v = ver("uBruno");
    expect(v.grupo).toEqual({ p1: ["o1"], o1: ["p1"] });
    expect(v.equipe).toEqual({});
  });

  it("dono da captação vê o ⭐ da procura, sem os 🤝 dos outros", () => {
    const v = ver("uCaio");
    expect(v.grupo).toEqual({});
    expect(v.equipe.p1?.map((c) => c.id)).toEqual(["c1"]);
  });

  it("corretor de fora não vê selo nenhum", () => {
    expect(ver("uDavi")).toEqual({ grupo: {}, equipe: {} });
  });

  it("post sem autor identificado não dá acesso a ninguém (só staff)", () => {
    const anon = post({
      id: "p9",
      kind: "procura",
      valor_max: 600_000,
      corretor: "Fulano",
      author_profile_id: null,
    });
    const r = encaixesVisiveis(
      [anon, semAutor],
      [cap],
      new Set(),
      { userId: "uDavi", isStaff: false },
      NOW,
    );
    expect(r.grupo).toEqual({});
    // o captador continua vendo o ⭐ da captação dele
    const c = encaixesVisiveis([anon], [cap], new Set(), { userId: "uCaio", isStaff: false }, NOW);
    expect(Object.keys(c.equipe)).toEqual(["p9"]);
    const s = encaixesVisiveis(
      [anon, semAutor],
      [cap],
      new Set(),
      { userId: "uX", isStaff: true },
      NOW,
    );
    expect(s.grupo).toEqual({ p9: ["o2"], o2: ["p9"] });
  });

  it("staff vê todos os encaixes", () => {
    const v = ver("uGestor", true);
    expect(v.grupo).toEqual({ p1: ["o1", "o2"], o1: ["p1"], o2: ["p1"] });
    expect(v.equipe.p1?.map((c) => c.id)).toEqual(["c1"]);
  });

  it("não devolve captor_id para a tela", () => {
    const c = ver("uAna").equipe.p1?.[0] as Record<string, unknown>;
    expect(c).not.toHaveProperty("captor_id");
    expect(c.captor_nome).toBe("Caio Neves");
  });

  it("par oculto some para todos; userId vazio não casa com post sem autor", () => {
    expect(
      encaixesVisiveis(
        [procura, oferta],
        [cap],
        new Set([pairKey("p1", "o1"), pairKey("p1", "c1")]),
        { userId: "uAna", isStaff: false },
        NOW,
      ),
    ).toEqual({ grupo: {}, equipe: {} });
    expect(
      encaixesVisiveis([procura, semAutor], [], new Set(), { userId: "", isStaff: false }, NOW),
    ).toEqual({ grupo: {}, equipe: {} });
  });

  it("mesmo autor (pelo cadastro) não encaixa consigo mesmo, ainda que o nome no WhatsApp mude", () => {
    const outraOferta = post({
      id: "o3",
      kind: "oferta",
      valor: 550_000,
      corretor: "Ana S. Imóveis",
      author_profile_id: "uAna",
    });
    expect(groupMatches([procura, outraOferta], new Set(), NOW).size).toBe(0);
    const minhaCap: CaptureCandidate = {
      ...cap,
      id: "c2",
      captor_id: "uAna",
      captor_nome: "A. Souza",
    };
    expect(captureMatches([procura], [minhaCap], new Set(), NOW)).toEqual([]);
  });
});

describe("formatação", () => {
  it("faixa e alerta", () => {
    const p = post({ id: "p1", kind: "procura", valor_max: 500_000 });
    expect(faixaTexto(p)).toBe("até R$ 500 mil");
    expect(faixaTexto(post({ id: "x", kind: "procura" }))).toBe("Sem teto informado");
    const c: CaptureCandidate = {
      id: "c1",
      captor_id: "u1",
      captor_nome: "Bruno",
      tipo: "Apartamento",
      finalidade: "Venda",
      bairro: "Campolim",
      municipio: "Sorocaba",
      valor: 540_000,
    };
    const msg = alertMessage(p, c, "https://adm.example/");
    expect(msg).toContain("8% acima do teto");
    expect(msg).toContain("https://adm.example/oportunidades");
    expect(msg).not.toMatch(/\d{4}-\d{4}/);
  });

  it("chave da repostagem ignora acento, caixa e espaços", () => {
    expect(sourceKeyInput("Ána", "Apto  CAMPOLIM")).toBe(sourceKeyInput("ana", "apto campolim"));
  });
});

describe("quem vê todos os encaixes (opportunity_is_staff)", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20261101120000_oportunidades_encaixe_envolvidos.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const corpo = sql.slice(sql.indexOf("FUNCTION public.opportunity_is_staff()"));
  const papeis = [...(corpo.match(/ARRAY\[([^\]]*)\]/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
    (m) => m[1],
  );

  it("gestor, admin, administrador principal, staff, team leader e coordenador (decisão de Denis, t_1805d507)", () => {
    expect(papeis.sort()).toEqual(
      ["admin", "coordenador", "gestor", "staff", "super_admin", "team_leader"].sort(),
    );
  });

  it("corretor e papéis de apoio (jurídico, financeiro, lançamento) não veem tudo", () => {
    for (const p of ["corretor", "juridico", "financeiro", "lancamento"])
      expect(papeis).not.toContain(p);
  });
});
