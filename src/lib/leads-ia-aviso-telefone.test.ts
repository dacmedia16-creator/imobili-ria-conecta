import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { enviarAvisosCorretor } from "./leads-ia-retorno.server";

// t_50cf73f3 (Denis 31/10): aviso de passagem ao corretor com TELEFONE do cliente + histórico da conversa.
const MIG = readFileSync(
  "supabase/migrations/20261031010000_leads_ia_aviso_corretor_telefone_historico.sql",
  "utf8",
);
const ENV = { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "k" };
const fn = (nome: string) => {
  const i = MIG.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(i, nome).toBeGreaterThanOrEqual(0);
  return MIG.slice(i, MIG.indexOf("END $function$", i) + 20);
};

describe("migration: aviso com telefone e histórico", () => {
  it("aviso traz nome, telefone legível com wa.me, imóvel, resumo e o prazo de aceite", () => {
    const t = fn("lead_aviso_corretor_texto");
    expect(t).toMatch(/'Cliente: '/);
    expect(t).toMatch(/'Telefone: ' \|\| coalesce\(_tel, 'não informado'\)/);
    expect(t).toMatch(/'Imóvel: '/);
    expect(t).toMatch(/'Resumo: '/);
    expect(t).toMatch(/'Aceite no ADM em Meus leads em até ' \|\| public\.lead_prazo_txt/);
    expect(fn("lead_aviso_telefone_txt")).toMatch(/' · wa\.me\/55' \|\| d/);
  });
  it("histórico: só mensagens enviadas/recebidas (sem sistema), sem link, corta as mais antigas acima de 2000", () => {
    const h = fn("lead_aviso_corretor_historico");
    expect(h).toMatch(
      /m\.autor = 'ia' AND m\.status = 'enviada'\) OR \(m\.autor = 'cliente' AND m\.status = 'recebida'/,
    );
    expect(h).not.toMatch(/'sistema'/);
    expect(h).toMatch(/https\?:\/\//);
    expect(h).toMatch(/conversa completa no ADM/);
    expect(h).toMatch(/_linhas := _linhas\[2:\]/);
    expect(h).toMatch(/char_length\(_txt\) <= 2000/);
  });
  it("reserva monta o texto na hora; histórico único por lead logo depois do aviso; nunca repete", () => {
    const r = fn("lead_avisos_corretor_reservar");
    expect(r).toMatch(/a\.evento IN \('passagem', 'reenvio'\)/);
    expect(r).toMatch(/lead_aviso_corretor_texto\(_a\.lead_id, _a\.evento = 'reenvio'\)/);
    expect(r).toMatch(
      /'historico', _hist, 'enviando'\)\s+ON CONFLICT \(lead_id, evento\) DO NOTHING/,
    );
    expect(r).toMatch(/c\.ia_aviso_corretor_whats AND c\.ia_ativa/); // desliga junto com o rollback da liberação
    expect(r).toMatch(/SET status = 'sem_telefone'/);
    expect(MIG).toMatch(/CHECK \(evento IN \('passagem', 'reenvio', 'historico'\)\)/);
    expect(MIG).toMatch(/CHECK \(char_length\(texto\) BETWEEN 1 AND 2000\)/);
  });
  it("funções novas só para o servidor (service_role)", () => {
    for (const n of [
      "lead_aviso_telefone_txt(text)",
      "lead_aviso_corretor_texto(uuid, boolean)",
      "lead_aviso_corretor_historico(uuid)",
      "lead_avisos_corretor_reservar(uuid)",
    ]) {
      expect(MIG).toContain(`REVOKE ALL ON FUNCTION public.${n} FROM PUBLIC, anon, authenticated;`);
      expect(MIG).toContain(`GRANT EXECUTE ON FUNCTION public.${n} TO service_role;`);
    }
  });
});

describe("servidor: aviso e histórico em ordem, sem telefone/conteúdo no log", () => {
  it("envia na ordem devolvida pelo banco e não registra telefone nem texto quando falha", async () => {
    const enviados: string[] = [];
    let n = 0;
    const fetchFn = vi.fn(async (_u: unknown, init?: RequestInit) => {
      enviados.push(new URLSearchParams(String(init?.body)).get("msg") ?? "");
      return new Response("", { status: n++ === 0 ? 201 : 500 });
    }) as unknown as typeof fetch;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const resultado = vi.fn(async () => null);
    const ok = await enviarAvisosCorretor("lead-1", {
      env: ENV,
      fetchFn,
      avisosReservar: async () => ({
        data: [
          { aviso_id: "a1", telefone: "5515999990000", texto: "Telefone: (15) 99999-1234" },
          { aviso_id: "a2", telefone: "5515999990000", texto: "Conversa com a Nicole" },
        ],
        error: null,
      }),
      avisoResultado: resultado,
    });
    expect(ok).toBe(1);
    expect(enviados).toEqual(["Telefone: (15) 99999-1234", "Conversa com a Nicole"]);
    expect(resultado).toHaveBeenNthCalledWith(1, "a1", true);
    expect(resultado).toHaveBeenNthCalledWith(2, "a2", false);
    const log = JSON.stringify(err.mock.calls);
    expect(log).not.toMatch(/99999|5515|Conversa|Telefone/);
    err.mockRestore();
  });
});
