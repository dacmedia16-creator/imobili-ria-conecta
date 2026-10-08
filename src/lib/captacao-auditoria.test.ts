import { describe, expect, it, vi } from "vitest";
import {
  aprovarBloqueio,
  autorDoHistorico,
  avisarTransicao,
  enviarAvisosCaptacao,
  eventoDaAcao,
  podeDevolverAprovada,
  textoAvisoCaptacao,
  ultimaDevolucao,
  type DestinoAviso,
} from "./captacao-auditoria";

const ID = "e5d5f854-0000-4000-8000-000000000000";

describe("aprovarBloqueio (mesma regra do banco)", () => {
  it("fluxo normal sem contrato gerado: barrado", () => {
    expect(
      aprovarBloqueio({ manual: false, docs: [{ kind: "assinado" }], dossieMissing: false }),
    ).toMatch(/Gere o PDF/);
  });
  it("sem Plano de Marketing: barrado nos dois fluxos", () => {
    const docs = [{ kind: "gerado" as const }, { kind: "assinado" as const }];
    expect(aprovarBloqueio({ manual: false, docs, dossieMissing: true })).toMatch(/Plano/);
    expect(
      aprovarBloqueio({ manual: true, docs: [{ kind: "assinado" }], dossieMissing: true }),
    ).toMatch(/Plano/);
  });
  it("completo: liberado; manual não exige gerado", () => {
    expect(
      aprovarBloqueio({
        manual: false,
        docs: [{ kind: "gerado" }, { kind: "assinado" }],
        dossieMissing: false,
      }),
    ).toBeNull();
    expect(
      aprovarBloqueio({ manual: true, docs: [{ kind: "assinado" }], dossieMissing: false }),
    ).toBeNull();
  });
});

describe("devolver captação aprovada", () => {
  const base = { manager: true, status: "aprovada", archived: false, temVendaAtiva: false };
  it("sem venda ativa: permitido ao gestor", () => {
    expect(podeDevolverAprovada(base)).toBe(true);
  });
  it("com venda ativa, corretor, arquivada ou outro status: não", () => {
    expect(podeDevolverAprovada({ ...base, temVendaAtiva: true })).toBe(false);
    expect(podeDevolverAprovada({ ...base, manager: false })).toBe(false);
    expect(podeDevolverAprovada({ ...base, archived: true })).toBe(false);
    expect(podeDevolverAprovada({ ...base, status: "enviada" })).toBe(false);
  });
});

describe("faixa e histórico com nome", () => {
  it("última devolução com nome, nunca UUID", () => {
    const d = ultimaDevolucao([
      { action: "devolver", detail: "antigo", created_at: "2026-10-01T12:00:00Z", actor_nome: "A" },
      { action: "devolver", detail: "Falta IPTU", created_at: "2026-10-05T12:00:00Z", actor_nome: "Gestor Teste" },
      { action: "enviar", detail: null, created_at: "2026-10-06T12:00:00Z", actor_nome: "C" },
    ]);
    expect(d).toEqual({ motivo: "Falta IPTU", quem: "Gestor Teste", quando: "05/10/2026" });
    expect(ultimaDevolucao([])).toBeNull();
  });
  it("autor: você, nome ou rótulo neutro", () => {
    expect(autorDoHistorico({ actor_id: "u1", actor_nome: "X" }, "u1")).toBe("você");
    expect(autorDoHistorico({ actor_id: "u2", actor_nome: "Maria" }, "u1")).toBe("Maria");
    expect(autorDoHistorico({ actor_id: "u2", actor_nome: null }, "u1")).toBe("usuário");
  });
});

describe("avisos nos três eventos", () => {
  it("enviar/devolver/aprovar chamam o aviso; assinatura não", async () => {
    const notify = vi.fn().mockResolvedValue({});
    for (const a of ["enviar", "devolver", "aprovar"]) expect(await avisarTransicao(a, ID, notify)).toBe(true);
    expect(await avisarTransicao("assinatura", ID, notify)).toBe(false);
    expect(notify.mock.calls.map((c) => c[0].data.evento)).toEqual(["enviada", "devolvida", "aprovada"]);
    expect(eventoDaAcao("x")).toBeNull();
  });
  it("falha do aviso não lança (a transição já valeu)", async () => {
    const notify = vi.fn().mockRejectedValue(new Error("rede"));
    await expect(avisarTransicao("aprovar", ID, notify)).resolves.toBe(false);
  });
  it("textos curtos com link, sem dados do proprietário", () => {
    const t = (evento: "enviada" | "devolvida" | "aprovada") =>
      textoAvisoCaptacao({ evento, captureId: ID, corretor: "Corretor Teste", motivo: "Falta IPTU", appUrl: "https://app.test" });
    expect(t("enviada").whatsapp).toBe(
      `*Nova captação para aprovar*\n\nCaptação: #E5D5F854\nCorretor: Corretor Teste\n\nAcesse: https://app.test/exclusividades/${ID}`,
    );
    expect(t("devolvida").whatsapp).toContain("Motivo: Falta IPTU");
    expect(t("aprovada").titulo).toBe("Captação #E5D5F854 aprovada");
  });
});

describe("enviarAvisosCaptacao (sem envio real: fetch simulado)", () => {
  const texto = textoAvisoCaptacao({ evento: "aprovada", captureId: ID, corretor: null, motivo: null, appUrl: "x" });
  const comum = {
    texto,
    url: "https://zion.test",
    timeoutMs: 10_000,
    normalizePhone: (r: string | null | undefined) => (r ? "5515999990000" : null),
    paraWhatsapp: (s: string) => s,
    semDadosPessoais: (s: string) => s.replace(/\d{6,}/g, "[numero]"),
  };
  const d = (o: Partial<DestinoAviso>): DestinoAviso => ({ id: "u", telefone: "15999990000", ativo: true, querWhatsapp: true, ...o });

  it("sem telefone, opt-out ou inativo: só sino, sem erro", async () => {
    const fetchImpl = vi.fn();
    const gravarSino = vi.fn().mockResolvedValue(undefined);
    const r = await enviarAvisosCaptacao({
      ...comum,
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      gravarSino,
      registrar: vi.fn().mockResolvedValue(undefined),
      destinos: [d({ id: "a", telefone: null }), d({ id: "b", querWhatsapp: false }), d({ id: "c", ativo: false })],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(gravarSino.mock.calls[0][0]).toHaveLength(3);
    expect(r).toMatchObject({ notificados: 3, enviados: 0, falhas: 0, ignorados: 3 });
  });
  it("WhatsApp falhando não lança e registra o erro", async () => {
    const registrar = vi.fn().mockResolvedValue(undefined);
    const r = await enviarAvisosCaptacao({
      ...comum,
      apiKey: "k",
      fetchImpl: vi.fn().mockRejectedValue(new Error("falhou 5515999990000")) as unknown as typeof fetch,
      gravarSino: vi.fn().mockResolvedValue(undefined),
      registrar,
      destinos: [d({})],
    });
    expect(r.falhas).toBe(1);
    expect(r.erros[0].corpo).not.toMatch(/5515999990000/);
    expect(registrar).toHaveBeenCalledOnce();
  });
  it("201 conta como enviado", async () => {
    const r = await enviarAvisosCaptacao({
      ...comum,
      apiKey: "k",
      fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 201 })) as unknown as typeof fetch,
      gravarSino: vi.fn().mockResolvedValue(undefined),
      registrar: vi.fn().mockResolvedValue(undefined),
      destinos: [d({})],
    });
    expect(r.enviados).toBe(1);
  });
});
