// Agendamento da vistoria + avisos ao corretor (t_c3ea1b18). O banco (agenda, lembretes, reagendamento, laudo,
// permissões e isolamento) está em supabase/tests/locacao-vistoria-agenda.sql (homologação, transação revertida).
// Aqui: texto, trava, rodada do pg_cron e tela, com banco e ZionTalk SIMULADOS (nenhuma rede real).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TITULO_AVISO_LOCACAO, textoAvisoLocacao, type AvisoReservado } from "./locacao-avisos";
import { enviarFilaLocacao, lembretesVistoriaRodada } from "./locacao-avisos.server";
import { agendaParaCampo, lerDetalhe, lerVistoriaAgenda, quandoVistoria } from "./locacao";
import { receberReengajar } from "./leads-ia-retorno.server";
import { faltasAgenda } from "@/components/locacao/LocacaoVistoriaAgenda";

const MIG = readFileSync("supabase/migrations/20261214120000_locacao_vistoria_agenda.sql", "utf8");
const RB = readFileSync("supabase/rollback/20261214120000_locacao_vistoria_agenda.sql", "utf8");

const aviso = (evento: AvisoReservado["evento"], texto: string): AvisoReservado => ({
  aviso_id: "a1",
  evento,
  texto,
  codigo: "LOC-0012",
  endereco: "Rua da Vistoria, 10 — Casa 2",
  telefone: "(15) 90000-0000",
  ativo: true,
  quer_whatsapp: true,
  locacao_id: "11111111-1111-4111-8111-111111111111",
});

/** Banco simulado: devolve o que cada RPC deve devolver e registra as chamadas. */
function banco(resp: Record<string, unknown>) {
  const chamadas: Array<[string, Record<string, unknown>]> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    chamadas.push([fn, args]);
    return { data: resp[fn] ?? null, error: null };
  });
  return { rpc, chamadas };
}

describe("texto dos avisos de vistoria", () => {
  it("títulos novos sem acento (ZionTalk recusa acento)", () => {
    for (const k of ["vistoria_vespera", "vistoria_2h", "vistoria_concluida"] as const)
      expect(TITULO_AVISO_LOCACAO[k]).toMatch(/^[\x20-\x7E]+$/);
  });
  it("lembrete leva código, endereço, horário e se acompanha; sem dado de cliente", () => {
    const t = textoAvisoLocacao(
      aviso(
        "vistoria_vespera",
        "Lembrete: vistoria 21/11 (sáb) às 14:00. Você vai ACOMPANHAR a vistoria (vistoriador: Fulano).",
      ),
      "https://adm.exemplo/locacoes/x",
    );
    expect(t).toContain("*Vistoria agendada*");
    expect(t).toContain("Locacao: LOC-0012 - Rua da Vistoria, 10 — Casa 2");
    expect(t).toContain("às 14:00");
    expect(t).toContain("ACOMPANHAR");
    expect(t).not.toMatch(/\d{3}\.\d{3}\.\d{3}|@/);
  });
  it("migration: os 3 eventos novos na lista do banco e no rollback a lista antiga", () => {
    expect(MIG).toContain("'vistoria_vespera', 'vistoria_2h', 'vistoria_concluida'");
    expect(RB).toContain(
      "CHECK (evento IN ('minuta_enviada', 'pendencia', 'ajuste', 'devolvida', 'andamento'))",
    );
    expect(MIG).toMatch(/10 dias corridos/);
  });
});

describe("rodada dos lembretes (mesma rota do pg_cron)", () => {
  it("trava desligada: não gera nem reserva nada (nada acumula para quando religar)", async () => {
    const { rpc } = banco({});
    const fetchFn = vi.fn();
    const r = await lembretesVistoriaRodada({ rpc, env: { ZIONTALK_API_KEY: "k" }, fetchFn });
    expect(r.desligado).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("trava diferente de 'on' também é desligada", async () => {
    const { rpc } = banco({});
    await lembretesVistoriaRodada({
      rpc,
      env: { LOCACAO_AVISOS_WHATSAPP: "ON " },
      fetchFn: vi.fn(),
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("ligada: gera, envia pela fila de cada locação e conclui (ZionTalk simulado)", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const { rpc, chamadas } = banco({
      locacao_vistoria_lembretes_gerar: [id],
      locacao_avisos_reservar: [
        aviso(
          "vistoria_2h",
          "Vistoria daqui a pouco: 21/11 (sáb) às 14:00. Você NÃO precisa acompanhar.",
        ),
      ],
      locacao_vistoria_aviso_atual: true,
      locacao_avisos_concluir: true,
    });
    const fetchFn = vi.fn(async () => new Response("", { status: 201 }));
    const r = await lembretesVistoriaRodada({
      rpc,
      env: { LOCACAO_AVISOS_WHATSAPP: "on", ZIONTALK_API_KEY: "chave-falsa" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(r).toEqual({ enviados: 1, falhas: 0, ignorados: 0 });
    expect(chamadas.map((c) => c[0])).toEqual([
      "locacao_vistoria_lembretes_gerar",
      "locacao_avisos_reservar",
      "locacao_vistoria_aviso_atual",
      "locacao_avisos_concluir",
    ]);
    expect(chamadas[1][1]).toEqual({ _id: id, _limite: 5 });
    const body = String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(decodeURIComponent(body.replace(/\+/g, " "))).toContain("Vistoria em 2 horas");
    expect(body).toContain("mobile_phone=5515900000000");
  });
  it("sem chave do ZionTalk: nada sai e a fila fica pendente", async () => {
    const { rpc } = banco({});
    const r = await enviarFilaLocacao("x", {
      rpc,
      env: { LOCACAO_AVISOS_WHATSAPP: "on" },
      fetchFn: vi.fn(),
    });
    expect(r.enviados).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reagendamento depois da reserva: não envia o lembrete antigo", async () => {
    const { rpc, chamadas } = banco({
      locacao_avisos_reservar: [aviso("vistoria_2h", "Vistoria antiga às 14:00")],
      locacao_vistoria_aviso_atual: false,
      locacao_avisos_concluir: true,
    });
    const fetchFn = vi.fn();
    const r = await enviarFilaLocacao("x", {
      rpc,
      env: { LOCACAO_AVISOS_WHATSAPP: "on", ZIONTALK_API_KEY: "chave-falsa" },
      fetchFn,
    });
    expect(r).toEqual({ enviados: 0, falhas: 0, ignorados: 1 });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(chamadas.at(-1)?.[1]).toMatchObject({ _status: "ignorado" });
  });
  it("5xx do ZionTalk fica 'incerto' (sem reenvio)", async () => {
    const { rpc, chamadas } = banco({
      locacao_avisos_reservar: [aviso("vistoria_concluida", "Vistoria concluída.")],
    });
    const fetchFn = vi.fn(async () => new Response("erro 15 99999-0000", { status: 502 }));
    await enviarFilaLocacao("x", {
      rpc,
      env: { LOCACAO_AVISOS_WHATSAPP: "on", ZIONTALK_API_KEY: "k" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(chamadas[1][1]).toMatchObject({ _status: "incerto" });
    expect(String(chamadas[1][1]._erro)).not.toContain("99999");
  });
  it("rota do pg_cron: roda os lembretes depois do resto; erro neles não muda a resposta", async () => {
    const SEG = "S".repeat(40);
    const locacaoVistoria = vi.fn(async () => {
      throw new Error("migration ausente");
    });
    const d = {
      reengajarReservar: vi.fn(async () => ({ data: [], error: null })),
      reservar: vi.fn(async () => ({ data: [], error: null })),
      resultado: vi.fn(async () => undefined),
      env: { LEADS_IA_REENGAJAR_SEGREDO: SEG },
      locacaoVistoria,
    };
    const req = new Request("https://x/api/leads/reengajar", {
      method: "POST",
      headers: { "x-leads-ia-segredo": SEG },
    });
    const r = await receberReengajar(req, d as unknown as Parameters<typeof receberReengajar>[1]);
    expect(r.status).toBe(200);
    expect(locacaoVistoria).toHaveBeenCalledOnce();
  });
  it("rota sem segredo: 404 e os lembretes nem rodam", async () => {
    const locacaoVistoria = vi.fn(async () => null);
    const d = {
      reengajarReservar: vi.fn(),
      reservar: vi.fn(),
      resultado: vi.fn(),
      env: {},
      locacaoVistoria,
    };
    const req = new Request("https://x/api/leads/reengajar", { method: "POST" });
    expect(
      (await receberReengajar(req, d as unknown as Parameters<typeof receberReengajar>[1])).status,
    ).toBe(404);
    expect(locacaoVistoria).not.toHaveBeenCalled();
  });
});

describe("tela", () => {
  it("lê a agenda do detalhe (e ignora formato estranho)", () => {
    expect(
      lerVistoriaAgenda({
        em: "2026-11-21T17:00:00+00:00",
        vistoriador: "Fulano",
        acompanha: true,
      }),
    ).toEqual({
      em: "2026-11-21T17:00:00+00:00",
      vistoriador: "Fulano",
      acompanha: true,
    });
    expect(lerVistoriaAgenda({ em: "ontem" })).toBeNull();
    expect(lerVistoriaAgenda("x")).toBeNull();
    expect(lerDetalhe({ pos: {} }).pos.vistoriaAgenda).toBeNull();
  });
  it("mostra e reabre no horário de Brasília", () => {
    expect(quandoVistoria("2026-11-21T17:00:00+00:00")).toContain("14:00");
    expect(agendaParaCampo("2026-11-21T17:00:00+00:00")).toBe("2026-11-21T14:00");
    expect(agendaParaCampo(null)).toBe("");
  });
  it("cobra data/hora e vistoriador antes de salvar", () => {
    expect(faltasAgenda({ quando: "", vistoriador: "", acompanha: false })).toEqual([
      "data e hora",
      "nome do vistoriador",
    ]);
    expect(
      faltasAgenda({ quando: "2026-11-21T14:00", vistoriador: "Fulano", acompanha: true }),
    ).toEqual([]);
  });
});
