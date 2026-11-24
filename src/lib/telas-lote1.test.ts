import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Lead } from "@/lib/leads";
import type { ItemFila } from "@/lib/crm";
import {
  esperaDoLead,
  gruposDaFila,
  ordenarBanco,
  ordenarPorEspera,
  paginar,
  POR_PAGINA_CAPTACAO,
  POR_PAGINA_LEADS,
  resumoMensagem,
  tempoCurto,
  tituloHoje,
} from "@/lib/telas-lote1";

const lead = (p: Partial<Lead> & { id: string }): Lead =>
  ({
    nome: p.id,
    telefone: null,
    email: null,
    origem: "c2s",
    mensagem: null,
    etapa: "novo",
    etapa_em: "2026-11-01T00:00:00Z",
    responsavel_id: "u1",
    atribuido_em: null,
    capture_id: null,
    captador_id: null,
    motivo_perda_id: null,
    motivo_perda_obs: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    aceito_em: null,
    ultima_interacao_em: null,
    no_banco_desde: null,
    simulado: false,
    contato_liberado: true,
    ...p,
  }) as Lead;

describe("paginar (Captação 24 por vez, Leads 25 por vez)", () => {
  const lista = Array.from({ length: 366 }, (_, i) => i + 1);

  it("366 captações viram 16 páginas de até 24; a lista inteira continua contada", () => {
    expect(POR_PAGINA_CAPTACAO).toBe(24);
    const p1 = paginar(lista, 1, POR_PAGINA_CAPTACAO);
    expect(p1.itens).toHaveLength(24);
    expect(p1).toMatchObject({ pagina: 1, paginas: 16, total: 366, de: 1, ate: 24 });
    const ult = paginar(lista, 16, POR_PAGINA_CAPTACAO);
    expect(ult.itens).toEqual([361, 362, 363, 364, 365, 366]);
    expect(ult).toMatchObject({ de: 361, ate: 366 });
  });

  it("nenhum item some nem se repete entre as páginas", () => {
    const todos: number[] = [];
    for (let p = 1; p <= 16; p++) todos.push(...paginar(lista, p, 24).itens);
    expect(todos).toEqual(lista);
  });

  it("página fora do intervalo cai na última válida (ex.: filtro reduziu a lista)", () => {
    expect(paginar(lista.slice(0, 30), 9, 24)).toMatchObject({ pagina: 2, de: 25, ate: 30 });
    expect(paginar([1, 2], 0, 24)).toMatchObject({ pagina: 1, itens: [1, 2] });
  });

  it("lista vazia: 1 página, de 0 a 0", () => {
    expect(paginar([], 1, POR_PAGINA_LEADS)).toMatchObject({
      itens: [],
      pagina: 1,
      paginas: 1,
      total: 0,
      de: 0,
      ate: 0,
    });
  });
});

describe("painel Leads: tempo sem atendimento", () => {
  const agora = new Date("2026-11-24T12:00:00Z");

  it("ordena do que está há mais tempo sem atendimento; encerrados no fim", () => {
    const ls = [
      lead({ id: "recente", created_at: "2026-11-24T10:00:00Z" }),
      lead({
        id: "ganho",
        etapa: "ganho",
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-11-20T00:00:00Z",
      }),
      lead({
        id: "falou-ontem",
        created_at: "2026-11-01T00:00:00Z",
        ultima_interacao_em: "2026-11-23T12:00:00Z",
      }),
      lead({ id: "nunca-atendido", created_at: "2026-11-10T00:00:00Z" }),
      lead({
        id: "perdido",
        etapa: "perdido",
        updated_at: "2026-11-22T00:00:00Z",
      }),
    ];
    expect(ordenarPorEspera(ls).map((l) => l.id)).toEqual([
      "nunca-atendido",
      "falou-ontem",
      "recente",
      "perdido",
      "ganho",
    ]);
  });

  it("não altera a lista original (só tela)", () => {
    const ls = [lead({ id: "b", created_at: "2026-11-02T00:00:00Z" }), lead({ id: "a" })];
    ordenarPorEspera(ls);
    expect(ls.map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("cor sempre acompanhada de texto: verde < 1 dia, âmbar 1-3 dias, vermelho > 3 dias", () => {
    expect(esperaDoLead(lead({ id: "x", created_at: "2026-11-24T11:20:00Z" }), agora)).toEqual(
      expect.objectContaining({ tom: "green", texto: "Sem 1º contato há 40 min" }),
    );
    expect(
      esperaDoLead(lead({ id: "x", ultima_interacao_em: "2026-11-22T12:00:00Z" }), agora),
    ).toEqual(expect.objectContaining({ tom: "amber", texto: "Sem contato há 2 dias" }));
    expect(esperaDoLead(lead({ id: "x", created_at: "2026-11-14T12:00:00Z" }), agora)).toEqual(
      expect.objectContaining({ tom: "red", texto: "Sem 1º contato há 10 dias" }),
    );
    expect(esperaDoLead(lead({ id: "x", etapa: "ganho" }), agora)).toEqual(
      expect.objectContaining({ tom: "slate", texto: "Encerrado" }),
    );
  });

  it("tempoCurto", () => {
    expect(tempoCurto(10_000)).toBe("agora");
    expect(tempoCurto(5 * 3_600_000)).toBe("5 h");
    expect(tempoCurto(86_400_000)).toBe("1 dia");
  });

  it("banco: quem está esperando há mais tempo primeiro", () => {
    const b = [
      { id: "novo", no_banco_desde: "2026-11-24T00:00:00Z", created_at: "2026-11-23T00:00:00Z" },
      { id: "velho", no_banco_desde: "2026-11-01T00:00:00Z", created_at: "2026-10-30T00:00:00Z" },
    ];
    expect(ordenarBanco(b).map((x) => x.id)).toEqual(["velho", "novo"]);
  });

  it("mensagem do portal vira 1 linha curta, sem links", () => {
    const msg =
      "\n https://www.zapimoveis.com.br/imovel/123 \nOlá, tenho interesse neste imóvel que vi no Grupo ZAP.\nMais texto";
    expect(resumoMensagem(msg)).toBe("Olá, tenho interesse neste imóvel que vi no Grupo ZAP.");
    expect(resumoMensagem("a".repeat(200), 20)).toHaveLength(20);
    expect(resumoMensagem(null)).toBe("");
  });
});

describe("fila do dia: data e 4 grupos", () => {
  it("título com o dia da semana e a data de São Paulo", () => {
    expect(tituloHoje("2026-11-24")).toBe("Hoje, terça 24/11");
    expect(tituloHoje("2026-11-29")).toBe("Hoje, domingo 29/11");
  });

  it("separa a fila nos 4 grupos, na ordem e com contadores (inclusive zero)", () => {
    const fila: ItemFila[] = [
      { lead: lead({ id: "a1" }), motivo: "aceite" },
      { lead: lead({ id: "s1" }), motivo: "sem" },
      { lead: lead({ id: "s2" }), motivo: "sem" },
      { lead: lead({ id: "h1" }), motivo: "hoje" },
    ];
    const g = gruposDaFila(fila);
    expect(g.map((x) => [x.titulo, x.total])).toEqual([
      ["Aguardando aceite", 1],
      ["Atrasados", 0],
      ["Sem próximo passo", 2],
      ["Para hoje", 1],
    ]);
    expect(g[2].itens.map((i) => i.lead.id)).toEqual(["s1", "s2"]);
    // atrasados em vermelho, com texto
    expect(g[1]).toMatchObject({ tom: "red", titulo: "Atrasados" });
  });
});

describe("lote 1 não mexe em quem vê (PR #412/#413/#414)", () => {
  const painel = readFileSync("src/components/leads/LeadsPagina.tsx", "utf8");
  const banco = readFileSync("src/components/leads/LeadsBanco.tsx", "utf8");
  const crm = readFileSync("src/components/crm/CrmPagina.tsx", "utf8");
  const capt = readFileSync("src/routes/_authenticated/exclusividades.index.tsx", "utf8");

  it("painel continua usando a mesma consulta (meus = só os próprios; painel = a RLS decide)", () => {
    expect(painel).toMatch(
      /listarLeads\(modo === "meus" && user \? \{ responsavel: user\.id \} : \{\}\)/,
    );
    expect(banco).toMatch(/await listarBanco\(\)/);
    expect(banco).toMatch(/await pegarLead\(id\)/);
  });

  it("CRM continua individual", () => {
    expect(crm).toMatch(/listarLeadsCrm\(meuId\)/);
    expect(crm).toMatch(/filaDoDia\(leads \?\? \[\], hoje, user\?\.id\)/);
  });

  it("captação: contadores e 'Vencendo' contam o total; só a lista é paginada", () => {
    expect(capt).toMatch(/contarPainel\(captures, today\)/);
    expect(capt).toMatch(/contarEtapas\(captures, ctxVez\)/);
    expect(capt).toMatch(/captures\.filter\(\(c\) => !c\.archived_at && expiring\(c\)\)\.length/);
    expect(capt).toMatch(/\{visible\.length\} captação\(ões\)/);
    expect(capt).toMatch(/pag\.itens\.map\(/);
    expect(capt).not.toMatch(/visible\.map\(/);
  });
});
