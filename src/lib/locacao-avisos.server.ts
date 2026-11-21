/**
 * Envio da fila de avisos de WhatsApp da Locação (servidor). Usado por:
 *  - enviarAvisosLocacao (tela, logo depois de cada ação), e
 *  - lembretesVistoriaRodada (t_c3ea1b18): rodada da rota /api/leads/reengajar, que o pg_cron já chama a cada 5 min.
 * Mesmo ZionTalk das vendas (ZIONTALK_API_KEY), no máximo 5 avisos por locação e por chamada, e a MESMA trava
 * LOCACAO_AVISOS_WHATSAPP (sem "on", nada é reservado nem enviado: a fila fica "pendente").
 */
import {
  APP_URL,
  ZIONTALK_TIMEOUT_MS,
  ZIONTALK_URL,
  erroSemDadosPessoais,
  normalizePhone,
  paraWhatsapp,
} from "@/lib/sale-notifications.functions";
import {
  MAX_AVISOS_POR_CHAMADA,
  avisosLocacaoLigados,
  motivoParaNaoEnviar,
  textoAvisoLocacao,
  type AvisoReservado,
} from "@/lib/locacao-avisos";

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

export type DepsFilaLocacao = {
  rpc: Rpc;
  env: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
};

export type ResultadoFila = {
  enviados: number;
  falhas: number;
  ignorados: number;
  desligado?: boolean;
};

/** Reserva e envia os avisos pendentes de UMA locação (o chamador já conferiu quem pediu). */
export async function enviarFilaLocacao(
  locacaoId: string,
  deps: DepsFilaLocacao,
): Promise<ResultadoFila> {
  if (!avisosLocacaoLigados(deps.env.LOCACAO_AVISOS_WHATSAPP))
    return { enviados: 0, falhas: 0, ignorados: 0, desligado: true };
  const apiKey = deps.env.ZIONTALK_API_KEY;
  if (!apiKey) return { enviados: 0, falhas: 0, ignorados: 0 };
  const fetchFn = deps.fetchFn ?? fetch;
  const { data: reservados, error } = await deps.rpc("locacao_avisos_reservar", {
    _id: locacaoId,
    _limite: MAX_AVISOS_POR_CHAMADA,
  });
  if (error || !Array.isArray(reservados)) return { enviados: 0, falhas: 0, ignorados: 0 };

  let enviados = 0;
  let falhas = 0;
  let ignorados = 0;
  for (const a of (reservados as AvisoReservado[]).slice(0, MAX_AVISOS_POR_CHAMADA)) {
    // A reserva pode anteceder um reagendamento. Sem confirmação atual do banco, nunca envia uma data antiga.
    if (a.evento === "vistoria_vespera" || a.evento === "vistoria_2h") {
      const { data: atual, error: errAtual } = await deps.rpc("locacao_vistoria_aviso_atual", {
        _aviso: a.aviso_id,
      });
      if (errAtual || atual !== true) {
        ignorados++;
        await deps.rpc("locacao_avisos_concluir", {
          _aviso: a.aviso_id,
          _status: "ignorado",
          _erro: "vistoria alterada ou indisponivel",
        });
        continue;
      }
    }
    const phone = normalizePhone(a.telefone);
    const motivo = motivoParaNaoEnviar(a, phone);
    if (motivo) {
      ignorados++;
      await deps.rpc("locacao_avisos_concluir", {
        _aviso: a.aviso_id,
        _status: "ignorado",
        _erro: motivo,
      });
      continue;
    }
    const texto = textoAvisoLocacao(a, `${APP_URL}/locacoes/${a.locacao_id}`);
    try {
      const res = await fetchFn(ZIONTALK_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${apiKey}:`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          msg: paraWhatsapp(texto),
          mobile_phone: phone as string,
        }).toString(),
        signal: AbortSignal.timeout(ZIONTALK_TIMEOUT_MS),
      });
      if (res.status === 201) {
        enviados++;
        await deps.rpc("locacao_avisos_concluir", { _aviso: a.aviso_id, _status: "enviado" });
      } else {
        falhas++;
        const corpo = await res.text().catch(() => "");
        // Resposta 5xx pode ter sido enviada apesar da falha; não reenvia automaticamente.
        await deps.rpc("locacao_avisos_concluir", {
          _aviso: a.aviso_id,
          _status: res.status >= 500 ? "incerto" : "falhou",
          _erro: `${res.status} ${erroSemDadosPessoais(corpo)}`,
        });
      }
    } catch (e) {
      // A rede pode falhar após a entrega. Todo erro sem resposta confirmada fica "incerto" (sem reenvio).
      const timeout = e instanceof Error && e.name === "TimeoutError";
      falhas++;
      await deps.rpc("locacao_avisos_concluir", {
        _aviso: a.aviso_id,
        _status: "incerto",
        _erro: timeout
          ? `timeout ${ZIONTALK_TIMEOUT_MS / 1000}s`
          : erroSemDadosPessoais(e instanceof Error ? e.message : String(e)),
      });
    }
  }
  return { enviados, falhas, ignorados };
}

/** Máximo de locações com lembrete de vistoria atendidas por rodada (5 min). */
export const MAX_LOCACOES_LEMBRETE_POR_RODADA = 10;

/**
 * Lembretes da vistoria (véspera e ~2 h antes). Com a trava desligada não faz NADA (nem gera o aviso): assim, ao
 * religar, não há lembrete acumulado de vistoria antiga. Ligada: o banco grava os lembretes que venceram (chave com a
 * data agendada, então nunca duplica) e devolve as locações com aviso pendente; envia pela fila de cada uma.
 */
export async function lembretesVistoriaRodada(deps: DepsFilaLocacao): Promise<ResultadoFila> {
  const total: ResultadoFila = { enviados: 0, falhas: 0, ignorados: 0 };
  if (!avisosLocacaoLigados(deps.env.LOCACAO_AVISOS_WHATSAPP)) return { ...total, desligado: true };
  const { data, error } = await deps.rpc("locacao_vistoria_lembretes_gerar", {
    _limite: MAX_LOCACOES_LEMBRETE_POR_RODADA,
  });
  if (error || !Array.isArray(data)) return total;
  for (const id of (data as unknown[]).slice(0, MAX_LOCACOES_LEMBRETE_POR_RODADA)) {
    if (typeof id !== "string") continue;
    const r = await enviarFilaLocacao(id, deps);
    total.enviados += r.enviados;
    total.falhas += r.falhas;
    total.ignorados += r.ignorados;
  }
  return total;
}
