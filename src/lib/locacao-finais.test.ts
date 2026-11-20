// Documentos finais da Locação (t_dfc8daf2). A suíte do banco (acesso só do corretor da locação, isolamento entre
// imobiliárias, travas e envio sem duplicar) é supabase/tests/locacao-docs-finais.sql (run-locacao-docs-finais.sh,
// homologação). Aqui: regras puras, texto da migration/rollback e a server function de envio com ZionTalk falso.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (i: unknown) => unknown = (i) => i;
    const b = {
      middleware: () => b,
      validator: (v: (i: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const adminRpc = vi.fn();
const PDF = new Blob([new Uint8Array([37, 80, 68, 70, 45, 49])], { type: "application/pdf" });
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => adminRpc(...a),
    storage: { from: () => ({ download: async () => ({ data: PDF, error: null }) }) },
  },
}));
vi.mock("@/lib/sale-notifications.functions", async (orig) => ({
  ...(await orig<typeof import("@/lib/sale-notifications.functions")>()),
  avisosSuprimidosNoContexto: async () => false,
}));

import {
  destinosFinal,
  docsFinaisWhatsappLigado,
  mensagemFinal,
  nomeAnexoFinal,
} from "./locacao-finais";
import { enviarFinalLocacao } from "./locacao-finais.functions";

const MIG = readFileSync(
  "supabase/migrations/20261214130000_locacao_documentos_finais.sql",
  "utf8",
);
const RB = readFileSync("supabase/rollback/20261214130000_locacao_documentos_finais.sql", "utf8");
const DOC = "11111111-1111-4111-8111-111111111111";

describe("regras puras", () => {
  it("trava própria: só 'on' liga; ausente ou outro valor fica desligado", () => {
    expect(docsFinaisWhatsappLigado("on")).toBe(true);
    for (const v of [undefined, null, "", "ON", "true", "1", "off"])
      expect(docsFinaisWhatsappLigado(v)).toBe(false);
  });
  it("mensagem curta, ASCII e sem dados pessoais", () => {
    for (const t of ["contrato_locacao", "contrato_adm", "laudo"] as const) {
      const m = mensagemFinal(t);
      expect(m.length).toBeLessThan(120);
      expect(m).toMatch(/^[\x20-\x7E]+$/);
      expect(m).not.toMatch(/\d|LOC-|R\$|CPF|rua/i);
      expect(nomeAnexoFinal(t)).toBe(`${t}.pdf`);
    }
  });
  it("contrato de administração vai só ao proprietário", () => {
    expect(destinosFinal("contrato_adm")).toEqual(["proprietario"]);
    expect(destinosFinal("laudo")).toEqual(["locatario", "proprietario"]);
  });
});

describe("migration e rollback", () => {
  it("tabelas com RLS, fechadas para o navegador, e reserva só pelo servidor", () => {
    expect(MIG).toMatch(/ALTER TABLE public\.locacao_docs_finais ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(/ALTER TABLE public\.locacao_docs_finais_envios ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(
      /REVOKE ALL ON public\.locacao_docs_finais, public\.locacao_docs_finais_envios FROM PUBLIC, anon, authenticated/,
    );
    expect(MIG).toMatch(/locacao_final_concluir\(uuid, text, text\)\s+TO service_role/);
  });
  it("acesso: corretor DAQUELA locação + gestora/contratos/vistoria + gerência, sempre da mesma imobiliária", () => {
    const f = MIG.slice(
      MIG.indexOf("FUNCTION public.locacao_finais_pode_ver"),
      MIG.indexOf("locacao_final_exige"),
    );
    expect(f).toMatch(/_l\.organization_id = public\.current_org_id\(\)/);
    expect(f).toMatch(/_l\.corretor_id = auth\.uid\(\)/);
    expect(f).toMatch(/'gestora', 'contratos', 'vistoria'/);
    expect(f).not.toMatch(/financeiro|lider/);
  });
  it("envio automático idempotente por conteúdo + destinatário", () => {
    expect(MIG).toMatch(
      /UNIQUE INDEX locacao_docs_finais_envios_auto_uniq[\s\S]*\(locacao_id, tipo, sha256, destinatario\) WHERE origem = 'auto'/,
    );
    expect(MIG).toMatch(
      /CONSTRAINT locacao_docs_finais_conteudo_unico UNIQUE \(locacao_id, tipo, sha256\)/,
    );
  });
  it("assinatura e laudo travados sem o PDF", () => {
    expect(MIG).toMatch(
      /_doc = 'loc' AND NOT public\.locacao_final_tem\(_l\.id, 'contrato_locacao'\)/,
    );
    expect(MIG).toMatch(/_doc = 'vist' AND NOT public\.locacao_final_tem\(_l\.id, 'laudo'\)/);
    expect(MIG).toMatch(/laudo_assinado[\s\S]*NOT public\.locacao_final_tem\(_l\.id, 'laudo'\)/);
  });
  it("rollback devolve as 3 funções sem a trava e remove as tabelas novas", () => {
    expect((RB.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(3);
    expect(
      RB.slice(0, RB.indexOf("REVOKE ALL ON FUNCTION public.locacao_final_reservar")),
    ).not.toMatch(/locacao_final_tem/);
    expect(RB).toMatch(/TABLE public\.locacao_docs_finais_envios;/);
    expect(RB).toMatch(/TABLE public\.locacao_docs_finais;/);
  });
  it("nada aparece em 'Consultar imóvel'", () => {
    expect(MIG).not.toMatch(/locacao_consultar/);
  });
});

describe("envio pelo WhatsApp (ZionTalk falso)", () => {
  const fetchMock = vi.fn();
  const user = { rpc: vi.fn(async () => ({ data: { path: "x" }, error: null })) };
  const ctx = { supabase: user, userId: "22222222-2222-4222-8222-222222222222" };
  const chamar = () =>
    enviarFinalLocacao({
      data: { documentoId: DOC, origem: "reenvio", destinatario: "locatario" },
      context: ctx,
    } as never) as unknown as Promise<{
      desligado: boolean;
      enviados: number;
      falhas: number;
    }>;
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    adminRpc.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("trava desligada (padrão): não reserva nem chama o ZionTalk", async () => {
    vi.stubEnv("LOCACAO_DOCS_FINAIS_WHATSAPP", "");
    vi.stubEnv("ZIONTALK_API_KEY", "k");
    const r = await chamar();
    expect(r.desligado).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it("trava dos avisos internos ligada NÃO libera o envio aos clientes", async () => {
    vi.stubEnv("LOCACAO_AVISOS_WHATSAPP", "on");
    vi.stubEnv("ZIONTALK_API_KEY", "k");
    expect((await chamar()).desligado).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("ligada: manda o PDF em anexo, com nome genérico, e registra o status", async () => {
    vi.stubEnv("LOCACAO_DOCS_FINAIS_WHATSAPP", "on");
    vi.stubEnv("ZIONTALK_API_KEY", "k");
    adminRpc.mockImplementation(async (fn: string) =>
      fn === "locacao_final_reservar"
        ? {
            data: [
              {
                envio_id: "e1",
                destinatario: "locatario",
                telefone: "(15) 99999-0000",
                storage_path: "p",
                tipo: "contrato_locacao",
                codigo: "LOC-0001",
              },
            ],
            error: null,
          }
        : { data: true, error: null },
    );
    fetchMock.mockResolvedValue(new Response("", { status: 201 }));
    const r = await chamar();
    expect(r).toMatchObject({ desligado: false, enviados: 1, falhas: 0 });
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("mobile_phone")).toBe("5515999990000");
    expect((form.get("attachments") as File).name).toBe("contrato_locacao.pdf");
    expect(String(form.get("msg"))).not.toMatch(/LOC-|\d{4}/);
    expect(adminRpc).toHaveBeenCalledWith("locacao_final_concluir", {
      _envio: "e1",
      _status: "enviado",
      _erro: null,
    });
  });
  it("reserva vazia (já enviado / duplo clique / sem telefone): não chama o ZionTalk", async () => {
    vi.stubEnv("LOCACAO_DOCS_FINAIS_WHATSAPP", "on");
    vi.stubEnv("ZIONTALK_API_KEY", "k");
    adminRpc.mockResolvedValue({ data: [], error: null });
    const r = await chamar();
    expect(r.enviados).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("erro 5xx vira 'incerto' (sem repetir sozinho)", async () => {
    vi.stubEnv("LOCACAO_DOCS_FINAIS_WHATSAPP", "on");
    vi.stubEnv("ZIONTALK_API_KEY", "k");
    adminRpc.mockImplementation(async (fn: string) =>
      fn === "locacao_final_reservar"
        ? {
            data: [
              {
                envio_id: "e2",
                destinatario: "locatario",
                telefone: "15999990000",
                storage_path: "p",
                tipo: "laudo",
                codigo: "LOC-0001",
              },
            ],
            error: null,
          }
        : { data: true, error: null },
    );
    fetchMock.mockResolvedValue(new Response("", { status: 502 }));
    const r = await chamar();
    expect(r.falhas).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(adminRpc).toHaveBeenCalledWith("locacao_final_concluir", {
      _envio: "e2",
      _status: "incerto",
      _erro: "HTTP 502",
    });
  });
});
