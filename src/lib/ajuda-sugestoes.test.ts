import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { enviarAvisosCaptacao, type DestinoAviso } from "./captacao-auditoria";
import {
  caminhoDoPrint,
  decodificarPrint,
  filtrarChamados,
  idade,
  nomeDaTela,
  resumoCentral,
  rotaSemIds,
  SUPORTE_WHATSAPP_LIGADO,
  textoAvisoSuporte,
} from "./ajuda-sugestoes";

const UUID = "e5d5f854-0000-4000-8000-000000000000";
const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("tela automática", () => {
  it("nome amigável e caminho sem ids", () => {
    expect(nomeDaTela(`/exclusividades/${UUID}`)).toBe(
      "Captações exclusivas › Detalhe da captação",
    );
    expect(nomeDaTela("/vendas/nova")).toBe("Vendas › Nova venda");
    expect(nomeDaTela("/")).toBe("Início");
    expect(rotaSemIds(`/vendas/${UUID}`)).toBe("/vendas/…");
  });
});

describe("print", () => {
  it("aceita PNG/JPG/WEBP até 5 MB e recusa o resto", () => {
    const b64 = btoa("\x89PNG\r\n\x1a\nabc");
    expect(decodificarPrint({ base64: b64, contentType: "image/png" }).ext).toBe("png");
    expect(() => decodificarPrint({ base64: b64, contentType: "application/pdf" })).toThrow(/PNG/);
    expect(() => decodificarPrint({ base64: "", contentType: "image/png" })).toThrow(/vazio/);
    expect(() => decodificarPrint({ base64: "%%%", contentType: "image/png" })).toThrow(/inválido/);
  });
  it("caminho <org>/<autor>/<uuid>.<ext>", () => {
    expect(caminhoDoPrint("o", "u", "x", "jpg")).toBe("o/u/x.jpg");
  });
});

const lista = [
  {
    numero: 1041,
    organization_id: "A",
    organizacao: "Única",
    tipo: "duvida",
    status: "recebido",
    assunto: "Painel diferente",
    autor_nome: "Rafael",
  },
  {
    numero: 1042,
    organization_id: "A",
    organizacao: "Única",
    tipo: "erro",
    status: "respondido",
    assunto: "Contrato não gera",
    autor_nome: "Carla",
  },
  {
    numero: 1043,
    organization_id: "B",
    organizacao: "Litoral",
    tipo: "erro",
    status: "recebido",
    assunto: "Upload de RG",
    autor_nome: "Juliana",
  },
  {
    numero: 1044,
    organization_id: "B",
    organizacao: "Litoral",
    tipo: "sugestao",
    status: "resolvido",
    assunto: "Filtro",
    autor_nome: "Marcos",
    resolved_at: new Date().toISOString(),
  },
];

describe("central da equipe MAX", () => {
  it("filtros: abertos, imobiliária, tipo, #número e texto", () => {
    const base = { organizacao: "", tipo: "", status: "abertos", busca: "" };
    expect(filtrarChamados(lista, base).map((c) => c.numero)).toEqual([1041, 1042, 1043]);
    expect(filtrarChamados(lista, { ...base, organizacao: "B" }).map((c) => c.numero)).toEqual([
      1043,
    ]);
    expect(filtrarChamados(lista, { ...base, tipo: "erro" })).toHaveLength(2);
    expect(filtrarChamados(lista, { ...base, status: "", busca: "#1044" })).toHaveLength(1);
    expect(filtrarChamados(lista, { ...base, busca: "juliana" })[0].numero).toBe(1043);
  });
  it("cartões de resumo", () => {
    expect(resumoCentral(lista)).toEqual({
      abertos: 3,
      recebidos: 2,
      errosAbertos: 2,
      resolvidos30d: 1,
    });
  });
  it("idade", () => {
    const agora = Date.parse("2026-10-08T12:00:00Z");
    expect(idade("2026-10-08T11:48:00Z", agora)).toBe("12 min");
    expect(idade("2026-10-08T10:00:00Z", agora)).toBe("2 h");
    expect(idade("2026-10-05T12:00:00Z", agora)).toBe("3 d");
  });
});

describe("avisos (sino + WhatsApp desligado)", () => {
  const destinos: DestinoAviso[] = [
    { id: "u1", telefone: "15999990000", ativo: true, querWhatsapp: true },
  ];
  const base = {
    url: "https://ziontalk.mock/send",
    timeoutMs: 10_000,
    normalizePhone: (t: string | null | undefined) => (t ? `55${t}` : null),
    paraWhatsapp: (t: string) => t,
    semDadosPessoais: (t: string) => t,
    registrar: async () => {},
  };
  const texto = textoAvisoSuporte({
    evento: "novo",
    numero: 1043,
    tipo: "erro",
    organizacao: "RE/MAX Litoral Azul",
    autor: "Juliana Prado",
    appUrl: "https://app",
  });

  it("textos das 2 mensagens, sem o conteúdo do chamado", () => {
    expect(texto.whatsapp).toBe(
      "*Novo chamado de suporte*\n\nChamado: #1043 (Erro)\nImobiliaria: RE/MAX Litoral Azul\nQuem abriu: Juliana Prado\n\nAcesse: https://app/plataforma/chamados",
    );
    const r = textoAvisoSuporte({
      evento: "resposta",
      numero: 1043,
      tipo: "erro",
      organizacao: "x",
      autor: "y",
      appUrl: "https://app",
    });
    expect(r.whatsapp).toBe(
      "*Seu chamado foi respondido*\n\nChamado: #1043 (Erro)\nA equipe MAX respondeu. Abra o ADM MAX para ver a resposta.\n\nAcesse: https://app/ajuda",
    );
  });

  it("WhatsApp nasce DESLIGADO e a função de servidor só passa a chave quando ligado", () => {
    expect(SUPORTE_WHATSAPP_LIGADO).toBe(false);
    const fn = ler("./ajuda-sugestoes.functions.ts");
    expect(fn).toContain(
      "apiKey: SUPORTE_WHATSAPP_LIGADO ? process.env.ZIONTALK_API_KEY : undefined",
    );
    expect(fn).toContain("enviarAvisosCaptacao");
  });

  it("desligado (sem chave): grava o sino e não chama o ZionTalk", async () => {
    const fetchImpl = vi.fn();
    const gravarSino = vi.fn(async () => {});
    const r = await enviarAvisosCaptacao({
      ...base,
      texto,
      destinos,
      gravarSino,
      apiKey: undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(gravarSino).toHaveBeenCalledWith([
      { user_id: "u1", titulo: texto.titulo, mensagem: texto.mensagem },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ notificados: 1, enviados: 0, ignorados: 1 });
  });

  it("ligado (mock): envia o texto ao ZionTalk simulado", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 201 }));
    const r = await enviarAvisosCaptacao({
      ...base,
      texto,
      destinos,
      gravarSino: async () => {},
      apiKey: "chave-falsa",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.enviados).toBe(1);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("mobile_phone")).toBe("5515999990000");
    expect(body.get("msg")).toContain("Novo chamado de suporte");
  });
});

describe("migration e rollback", () => {
  const up = ler("../../supabase/migrations/20261008220000_ajuda_sugestoes.sql");
  const down = ler("../../supabase/rollback/20261008220000_ajuda_sugestoes.sql");
  it("bucket privado, org_isolation restritiva e coluna do sino", () => {
    expect(up).toContain("'support-attachments', 'support-attachments', false");
    expect(up).toMatch(/CREATE POLICY org_isolation ON public\.support_tickets AS RESTRICTIVE/);
    expect(up).toMatch(
      /CREATE POLICY org_isolation ON public\.support_ticket_messages AS RESTRICTIVE/,
    );
    expect(up).toContain("ALTER TABLE public.notifications ADD COLUMN support_ticket_id");
    expect(up).not.toMatch(/ON storage\.objects/i);
  });
  it("rollback desfaz tabelas e coluna", () => {
    expect(down).toMatch(/DROP TABLE[^;]*support_ticket_messages/);
    expect(down).toMatch(/DROP TABLE[^;]*support_tickets/);
    expect(down).toMatch(/DROP COLUMN[^;]*support_ticket_id/);
  });
});
