import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assuntoToque15, montarMensagensToque15, textoFixoToque15, textoToque15, validarToque15 } from "./leads-ia-toque15";
import { receberReengajar, toque15UmaVez, type DepsToque15 } from "./leads-ia-retorno.server";
import { iaConfigMudou } from "./leads-ia";
import type { FalaHistorico } from "./leads-ia-redacao";

// t_b3f753a5. O banco (gatilho de 15 min, 1 vez, horário, passada/recusa/SAIR/corretor, allowlist, limite, chip e
// isolamento) está em scripts/leads-ia-test/test_toque15.sql (PostgreSQL descartável, 2 imobiliárias). Aqui: o
// texto, a trava e a rota, com banco, ZionTalk e modelo SIMULADOS (nenhuma rede real).
const MIG = readFileSync("supabase/migrations/20261028190000_leads_ia_toque15.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261028190000_leads_ia_toque15.rollback.sql", "utf8");

const hist = (ultimaIa: string): FalaHistorico[] => [
  { autor: "ia", texto: "Oi, Denis! Vi seu interesse no apartamento. Anúncio: https://site.com.br/imovel/1 Quer saber mais?" },
  { autor: "cliente", texto: "tem casas nesse valor? meu tel 15 98111-0001" },
  { autor: "ia", texto: ultimaIa },
];

describe("texto fixo do toque de 15 min", () => {
  const casos: Array<[string, string]> = [
    ["Tenho uma casa com 3 quartos por R$ 665.000. Dá uma olhada: https://site.com.br/imovel/3882 Gostou?", "opcao"],
    ["Claro! Qual dia e período ficam melhores para você? O corretor confirma.", "visita"],
    ["O apartamento tem 3 quartos, 2 vagas e 80 m². O condomínio é R$ 550.", "detalhes"],
    ["Você procura comprar ou alugar?", "pergunta"],
    ["Anotado.", "geral"],
  ];
  it.each(casos)("assunto de %s", (txt, assunto) => {
    expect(assuntoToque15(txt)).toBe(assunto);
  });
  it.each(casos)("frase fixa passa na trava, sem número/link e com o nome: %s", (txt) => {
    const t = textoFixoToque15("Denis", txt);
    expect(validarToque15(t)).toBeNull();
    expect(t).toMatch(/^Denis, fico por aqui\./);
    expect(t).not.toMatch(/[0-9]|https?:|R\$/);
  });
  it("nome com número ou estranho fica de fora (o banco recusaria o texto)", () => {
    expect(textoFixoToque15("Cliente123", "Gostou?")).toMatch(/^Fico por aqui\./);
    expect(textoFixoToque15("joão.silva@x.com", "Gostou?")).toMatch(/^Fico por aqui\./);
    expect(textoFixoToque15("Ana Maria", "Gostou?")).toMatch(/^Ana, fico por aqui\./);
    expect(textoFixoToque15("Lead OLX", "Gostou?")).toMatch(/^Fico por aqui\./);
  });
  it("sem nome do cliente começa com maiúscula", () => {
    expect(textoFixoToque15("", "Gostou?")).toMatch(/^Fico por aqui\./);
  });
  it("exemplo de Denis: retoma com o tipo que estava em conversa", () => {
    expect(textoFixoToque15("", "Tenho uma casa por R$ 665.000. Gostou?")).toContain("te mando mais casas nessa faixa");
  });
  it("o pedido do cliente vale mais que a última oferta (pediu casa, recebeu apartamento)", () => {
    expect(textoFixoToque15("", "Tenho um apartamento no mesmo bairro. Gostou?", "me manda casas")).toContain("mais casas");
    expect(textoFixoToque15("", "Tenho outra opção. Gostou?", "")).toContain("mais opções parecidas");
  });
});

describe("toque de 15 min NÃO convida para visita (ajuste de Denis, t_5335cd2b)", () => {
  const ultimas = [
    "Tenho uma casa com 3 quartos por R$ 665.000. Dá uma olhada: https://site.com.br/imovel/3882 Gostou?",
    "Claro! Qual dia e período ficam melhores para você? O corretor confirma.",
    "O apartamento tem 3 quartos, 2 vagas e 80 m². O condomínio é R$ 550.",
    "Você procura comprar ou alugar?",
    "Anotado.",
  ];
  it.each(ultimas)("frase fixa sem visita/agendamento/horário: %s", (txt) => {
    for (const nome of ["Denis", ""]) {
      const t = textoFixoToque15(nome, txt, "me manda casas");
      expect(t).not.toMatch(/visit|agend|hor[aá]rio|conhecer o im[oó]vel|marcar/i);
      expect(validarToque15(t)).toBeNull();
    }
  });
  it("frase fixa nova do exemplo de Denis", () => {
    expect(textoFixoToque15("Denis", "O apartamento tem 3 quartos e 2 vagas.", "me manda casas")).toBe(
      "Denis, fico por aqui. Se quiser, te mando mais casas nessa faixa ou tiro alguma dúvida sobre o imóvel.",
    );
  });
  it.each([
    "Fico por aqui, Denis. Quando quiser, posso adiantar um pré-agendamento de visita.",
    "Fico por aqui. Se quiser, já vejo um horário para você conhecer o imóvel.",
    "Fico por aqui. Quer agendar uma visita para ver de perto?",
    "Fico por aqui. Se quiser, posso marcar com o corretor para você ver.",
    "Fico por aqui. Se quiser conhecer a casa, é só me falar.",
    "Fico por aqui. Que tal visitarmos o apartamento juntos?",
    "Fico por aqui. Se preferir, a gente vê o imóvel pessoalmente.",
    "Fico por aqui, posso fazer o AGENDAMENTO pra você quando quiser.",
  ])("trava barra convite de visita: %s", (t) => {
    expect(validarToque15(t)).toBe("visita");
  });
  it("modelo convida para visita: trava barra e sai a frase fixa (sem visita)", async () => {
    const f = respostaOr("Fico por aqui, Denis. Quando quiser, posso adiantar um pré-agendamento de visita.");
    const usos: Array<{ bloqueio?: string | null }> = [];
    const r = await textoToque15({ ...base(f as unknown as typeof fetch), registrar: (u) => usos.push(u) });
    expect(r.origem).toBe("fixo");
    expect(r.texto).not.toMatch(/visit|agend|hor[aá]rio/i);
    expect(usos[0].bloqueio).toBe("toque_visita");
  });
  it("prompt proíbe convite de visita e não sugere mais horário de visita", () => {
    const m = montarMensagensToque15({ ia_nome: "Nicole", org_nome: "ZZ", cliente: "Denis" }, hist("Gostou?"));
    expect(m.sistema).toContain("NÃO convide para visita");
    expect(m.sistema).not.toMatch(/ver um horário de visita|pré-agendamento que o corretor confirma/);
  });
  it("banco também recusa convite de visita no toque", () => {
    expect(MIG).toContain("Toque com convite de visita");
  });
});

describe("trava do toque", () => {
  it.each([
    ["oi?", "tamanho"],
    ["Oi, ainda está aí? Sumiu de vez por aqui?", "seco"],
    ["Fico por aqui. Tenho outra casa por R$ 650 mil, quer ver?", "numero"],
    ["Fico por aqui. Tenho outra casa com 3 quartos se quiser ver.", "numero"],
    ["Fico por aqui. Tenho outra casa com ３ quartos se quiser ver.", "numero"],
    ["Fico por aqui. Veja mais em https://site.com.br/imoveis se quiser.", "link"],
    ["Fico por aqui. Veja mais em www.site.com.br se quiser, tá bom?", "link"],
    ["Fico por aqui. Quer ver mais? Ou prefere visitar? Me diz.", "perguntas"],
    ["Fico por aqui. Consigo um desconto especial para você nessa casa.", "promessa"],
    ["Fico por aqui. O imóvel está disponível, quer que eu reserve?", "promessa"],
  ])("barra %s", (t, motivo) => {
    expect(validarToque15(t)).toBe(motivo);
  });
  it("aceita o exemplo de Denis", () => {
    expect(validarToque15("Fico por aqui. Se quiser, te mando mais casas nessa faixa de preço.")).toBeNull();
  });
  it("mensagem ao modelo vai mascarada (sem telefone e sem link)", () => {
    const m = montarMensagensToque15({ ia_nome: "Nicole", org_nome: "ZZ", cliente: "Denis" }, hist("Gostou?"));
    expect(m.usuario).not.toMatch(/98111|https?:\/\//);
    expect(m.usuario).toContain("[número]");
    expect(m.sistema).toContain("NÃO escreva nenhum número");
  });
});

const respostaOr = (mensagem: string) =>
  vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ mensagem }) } }], usage: { prompt_tokens: 300, completion_tokens: 30, cost: 0.0001 }, provider: "Relace" }), { status: 200 }),
  );
const base = (fetchFn: typeof fetch, redige = true) => ({
  ia_nome: "Nicole",
  org_nome: "ZZ",
  cliente: "Denis",
  historico: hist("Tenho uma casa com 3 quartos por R$ 665.000. Gostou?"),
  redige,
  escolha: { provedor: "openrouter" as const, modelo: "deepseek/deepseek-v4-flash-0731" },
  env: { OPENROUTER_API_KEY: "k" },
  fetchFn,
});

describe("textoToque15 (modelo simulado)", () => {
  it("redação desligada: frase fixa, sem chamar o modelo (custo zero)", async () => {
    const f = respostaOr("x");
    const r = await textoToque15(base(f as unknown as typeof fetch, false));
    expect(r.origem).toBe("fixo");
    expect(f).not.toHaveBeenCalled();
  });
  it("modelo aprovado pela trava: sai o texto do modelo e o uso é registrado", async () => {
    const f = respostaOr("Denis, fico por aqui. Se quiser, te mando mais casas parecidas nessa faixa.");
    const usos: unknown[] = [];
    const r = await textoToque15({ ...base(f as unknown as typeof fetch), registrar: (u) => usos.push(u) });
    expect(r).toMatchObject({ origem: "modelo", texto: "Denis, fico por aqui. Se quiser, te mando mais casas parecidas nessa faixa." });
    expect(usos).toHaveLength(1);
    expect(usos[0]).toMatchObject({ uso: "redigir", bloqueado: false, provedor: "openrouter" });
  });
  it("modelo inventa preço: trava barra e sai a frase fixa", async () => {
    const f = respostaOr("Fico por aqui. Tenho outra casa por R$ 640 mil, quer ver?");
    const usos: Array<{ bloqueio?: string | null }> = [];
    const r = await textoToque15({ ...base(f as unknown as typeof fetch), registrar: (u) => usos.push(u) });
    expect(r.origem).toBe("fixo");
    expect(r.texto).not.toMatch(/[0-9]/);
    expect(usos[0].bloqueio).toBe("toque_numero");
  });
  it("modelo fora do ar: frase fixa", async () => {
    const f = vi.fn(async () => new Response("", { status: 503 }));
    const r = await textoToque15(base(f as unknown as typeof fetch));
    expect(r).toMatchObject({ origem: "fixo", bloqueio: "modelo_falhou" });
  });
});

describe("toque15UmaVez e a rota do reengajamento", () => {
  const cand = { conversa_id: "cv1", lead_id: "l1", organization_id: "o1", ultima_id: "m9", cliente: "Denis", ia_nome: "Nicole", org_nome: "ZZ", redige: false, provedor: "openrouter", modelo: null };
  const mk = (over: Partial<DepsToque15> = {}, gravado: unknown = "l1") => {
    const t: DepsToque15 = {
      candidatas: vi.fn(async () => ({ data: [cand], error: null })),
      gravar: vi.fn(async () => ({ data: gravado, error: null })),
      historico: vi.fn(async () => hist("Gostou?")),
      registrarUso: vi.fn(async () => undefined),
      ...over,
    };
    const reservar = vi.fn(async () => ({ data: [{ msg_id: "x", telefone: "5515981110001", texto: "t", primeira: false }], error: null }));
    const zion = vi.fn(async () => new Response("", { status: 201 }));
    return { t, reservar, zion };
  };
  it("grava pelo banco (conversa + id da última mensagem) e envia pelo mesmo caminho (enviarPendentes)", async () => {
    const { t, reservar, zion } = mk();
    const env = { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "k" };
    const r = await toque15UmaVez({ toque15: t, reservar, resultado: vi.fn(async () => undefined), env, fetchFn: zion as unknown as typeof fetch });
    expect(r.r).toBe("preparado");
    expect(t.gravar).toHaveBeenCalledWith("cv1", "m9", expect.stringMatching(/^Denis, fico por aqui\./));
    expect(reservar).toHaveBeenCalledWith("l1");
  });
  it("sem envio real ligado: grava, mas nada sai pela ZionTalk", async () => {
    const { t, reservar, zion } = mk();
    await toque15UmaVez({ toque15: t, reservar, resultado: vi.fn(async () => undefined), env: {}, fetchFn: zion as unknown as typeof fetch });
    expect(zion).not.toHaveBeenCalled();
  });
  it("banco recusa (cliente respondeu / corretor assumiu): nada enviado", async () => {
    const { t, reservar } = mk({}, null);
    const r = await toque15UmaVez({ toque15: t, reservar, resultado: vi.fn(async () => undefined), env: { LEADS_IA_ENVIO_REAL: "on" } });
    expect(r.r).toBe("nada");
    expect(reservar).not.toHaveBeenCalled();
  });
  it("cliente respondeu depois da lista (última fala é dele): nem grava", async () => {
    const { t, reservar } = mk({ historico: vi.fn(async () => [...hist("Gostou?"), { autor: "cliente" as const, texto: "sim" }]) });
    await toque15UmaVez({ toque15: t, reservar, resultado: vi.fn(async () => undefined), env: {} });
    expect(t.gravar).not.toHaveBeenCalled();
  });
  it("migration não aplicada (RPC com erro): só 'erro', nada gravado", async () => {
    const { t, reservar } = mk({ candidatas: vi.fn(async () => ({ data: null, error: { code: "PGRST202" } })) });
    expect((await toque15UmaVez({ toque15: t, reservar, resultado: vi.fn(async () => undefined), env: {} })).r).toBe("erro");
    expect(t.gravar).not.toHaveBeenCalled();
  });
  const SEG = "S".repeat(40);
  const req = (h: Record<string, string>) => new Request("https://app/api/leads/reengajar", { method: "POST", headers: h });
  it("mesma rota do pg_cron (sem agendador novo): sem segredo, 404 e o toque nem roda", async () => {
    const { t, reservar } = mk();
    const d = { reengajarReservar: vi.fn(async () => ({ data: [], error: null })), reservar, resultado: vi.fn(async () => undefined), env: {}, toque15: t };
    expect((await receberReengajar(req({ "x-leads-ia-segredo": SEG }), d)).status).toBe(404);
    expect(t.candidatas).not.toHaveBeenCalled();
  });
  it("com segredo: roda o reengajamento e depois o toque; erro no toque não muda a resposta", async () => {
    const { t, reservar } = mk({ candidatas: vi.fn(async () => { throw new Error("x"); }) });
    const d = { reengajarReservar: vi.fn(async () => ({ data: [], error: null })), reservar, resultado: vi.fn(async () => undefined), env: { LEADS_IA_REENGAJAR_SEGREDO: SEG }, toque15: t };
    const r = await receberReengajar(req({ "x-leads-ia-segredo": SEG }), d);
    expect(r.status).toBe(200);
    expect(d.reengajarReservar).toHaveBeenCalledOnce();
    expect(t.candidatas).toHaveBeenCalledOnce();
  });
});

describe("migration e tela", () => {
  it("chave própria, desligada por padrão, separada do ia_reengajar", () => {
    expect(MIG).toMatch(/ia_toque15 boolean NOT NULL DEFAULT false/);
    expect(MIG).not.toMatch(/UPDATE public\.lead_config SET ia_reengajar/);
  });
  it("funções do servidor só service_role; rollback apaga tudo", () => {
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.lead_ia_toque15_horario[\s\S]*FROM PUBLIC, anon, authenticated/);
    for (const f of ["lead_ia_toque15_salvar", "lead_ia_toque15_gravar", "lead_ia_toque15_candidatas", "lead_ia_toque15_elegivel", "lead_ia_toque15_horario", "lead_ia_toque15_hoje"])
      expect(RB).toContain(`DROP FUNCTION IF EXISTS public.${f}`);
    expect(RB).toMatch(/DROP COLUMN IF EXISTS toque15_em/);
  });
  it("não agenda nada e não liga em nenhuma imobiliária", () => {
    expect(MIG).not.toMatch(/cron\.schedule|net\.http_post|ia_toque15 = true/);
  });
  it("tela: mudar só o lembrete de 15 min conta como alteração não salva", () => {
    const a = { ia_ativa: true, ia_nome: "Nicole", ia_primeira_msg: null, ia_reengajar: true, ia_toque15: false };
    expect(iaConfigMudou(a, { ...a, ia_toque15: true })).toBe(true);
    expect(iaConfigMudou(a, { ...a })).toBe(false);
  });
});
