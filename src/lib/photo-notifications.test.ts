import { describe, expect, it, vi } from "vitest";
import {
  avisarFoto,
  destinosWhatsappFoto,
  enviarWhatsappFoto,
  textoWhatsappFoto,
  type AvisoFoto,
} from "./photo-notifications";

// Nenhum envio real: todo fetch aqui é simulado (vi.fn).
const AVISO: AvisoFoto = {
  organization_id: "org",
  capture_id: "cap",
  tipo: "foto_marcada",
  titulo: "Nova sessão de fotos para confirmar",
  mensagem: "Ana pediu fotos para 10/11 às 09:00 (com voucher). Confirme ou recuse na sua agenda.",
  destinos: ["fot"],
};

const comum = {
  appUrl: "https://app.test",
  url: "https://zion.test",
  timeoutMs: 10_000,
  normalizePhone: (r: string | null | undefined) => (r ? `55${r}` : null),
  paraWhatsapp: (s: string) => s,
  semDadosPessoais: (s: string) => s.replace(/\d{6,}/g, "[numero]"),
};

describe("texto do WhatsApp de fotos", () => {
  it("mesmo título e mensagem do sino + link da tela certa", () => {
    const t = textoWhatsappFoto(AVISO, "marcada", "https://app.test");
    expect(t.titulo).toBe(AVISO.titulo);
    expect(t.whatsapp).toContain(AVISO.mensagem);
    expect(t.whatsapp).toContain("https://app.test/fotografo");
    expect(textoWhatsappFoto(AVISO, "confirmada", "x").whatsapp).toContain("x/agendar-fotos");
  });
});

describe("destinos do WhatsApp de fotos", () => {
  const perfis = [
    { id: "fot", telefone: "15999990000", ativo: true },
    { id: "outro", telefone: "15988880000", ativo: true },
  ];
  it("só quem está no aviso; opt-out em qualquer papel = só sino", () => {
    expect(destinosWhatsappFoto(AVISO, perfis, [])).toEqual([
      { id: "fot", telefone: "15999990000", ativo: true, querWhatsapp: true },
    ]);
    const off = destinosWhatsappFoto(AVISO, perfis, [{ user_id: "fot", notificar_whatsapp: false }]);
    expect(off[0].querWhatsapp).toBe(false);
  });
});

describe("enviarWhatsappFoto (fetch simulado, sem envio real)", () => {
  it("1 envio por destinatário, com o texto do evento; não regrava o sino", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    const registrar = vi.fn().mockResolvedValue(undefined);
    const r = await enviarWhatsappFoto({
      ...comum,
      aviso: AVISO,
      evento: "marcada",
      destinos: [{ id: "fot", telefone: "15999990000", ativo: true, querWhatsapp: true }],
      registrar,
      apiKey: "chave-de-teste",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://zion.test");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("mobile_phone")).toBe("5515999990000");
    expect(body.get("msg")).toContain("Nova sessão de fotos para confirmar");
    expect(r.enviados).toBe(1);
    expect(registrar).toHaveBeenCalledOnce();
  });

  it("sem chave, sem telefone, inativo ou opt-out: nenhum fetch", async () => {
    const fetchImpl = vi.fn();
    const r = await enviarWhatsappFoto({
      ...comum,
      aviso: AVISO,
      evento: "recusada",
      destinos: [
        { id: "a", telefone: null, ativo: true, querWhatsapp: true },
        { id: "b", telefone: "1", ativo: false, querWhatsapp: true },
        { id: "c", telefone: "1", ativo: true, querWhatsapp: false },
      ],
      registrar: vi.fn().mockResolvedValue(undefined),
      apiKey: "chave-de-teste",
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ignorados).toBe(3);
    const semChave = await enviarWhatsappFoto({
      ...comum,
      aviso: AVISO,
      evento: "recusada",
      destinos: [{ id: "a", telefone: "15999990000", ativo: true, querWhatsapp: true }],
      registrar: vi.fn().mockResolvedValue(undefined),
      apiKey: undefined,
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(semChave.enviados).toBe(0);
  });

  it("falha da API vira erro registrado sem dados pessoais e nunca lança", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("tel 5515999990000 inválido", { status: 400 }));
    const r = await enviarWhatsappFoto({
      ...comum,
      aviso: AVISO,
      evento: "desmarcada",
      destinos: [{ id: "a", telefone: "15999990000", ativo: true, querWhatsapp: true }],
      registrar: vi.fn().mockRejectedValue(new Error("log fora")),
      apiKey: "chave-de-teste",
      fetchImpl,
    });
    expect(r.falhas).toBe(1);
    expect(r.erros[0].corpo).not.toMatch(/5515999990000/);
  });
});

describe("avisarFoto (tela)", () => {
  it("chama o servidor com sessão e evento; erro não derruba a ação", async () => {
    const ok = vi.fn().mockResolvedValue({ sent: 1 });
    expect(await avisarFoto("s1", "confirmada", ok)).toBe(true);
    expect(ok).toHaveBeenCalledWith({ data: { sessionId: "s1", evento: "confirmada" } });
    expect(await avisarFoto("s1", "confirmada", vi.fn().mockRejectedValue(new Error("x")))).toBe(false);
  });
});
