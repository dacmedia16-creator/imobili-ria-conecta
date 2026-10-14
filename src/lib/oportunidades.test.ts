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
    const c = classifyPost("Alguém tem apartamento no Campolim de 400 a 600 mil para cliente com financiamento?");
    expect(c.kind).toBe("procura");
    expect(c.tipo).toBe("Apartamento");
    expect(c.finalidade).toBe("Venda");
    expect(c.valor_min).toBe(400_000);
    expect(c.valor_max).toBe(600_000);
  });

  it("oferta de locação", () => {
    const c = classifyPost("CASA PARA LOCAÇÃO no Jardim Europa, 3 dormitórios, R$ 3.500 mensais. Parceria 50%");
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
    const base = { tipo: "Apartamento" as const, finalidade: "Venda" as const, bairro: "Campolim", valor: 500_000 };
    expect(encaixa(procura, base)).toBe(true);
    expect(encaixa(procura, { ...base, tipo: "Casa" })).toBe(false);
    expect(encaixa(procura, { ...base, finalidade: "Locação" })).toBe(false);
    expect(encaixa({ ...procura, kind: "oferta" }, base)).toBe(false);
  });

  it("grupo: autores diferentes, sem vencidos e sem pares ocultos", () => {
    const oferta = post({ id: "o1", kind: "oferta", valor: 550_000, corretor: "Bruno Lima" });
    const propria = post({ id: "o2", kind: "oferta", valor: 550_000 });
    const velha = post({ id: "o3", kind: "oferta", valor: 550_000, corretor: "Caio", posted_at: "2026-10-01T10:00:00-03:00" });
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
    expect(c).toMatchObject({ tipo: "Apartamento", finalidade: "Venda", bairro: "Campolim", valor: 520_000 });
    const minha: CaptureCandidate = { ...c, id: "c2", captor_nome: "Ana Souza" };
    expect(captureMatches([procura], [c, minha], new Set(), NOW).map((x) => x.capture.id)).toEqual(["c1"]);
    expect(captureMatches([procura], [c], new Set([pairKey("p1", "c1")]), NOW)).toEqual([]);
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
