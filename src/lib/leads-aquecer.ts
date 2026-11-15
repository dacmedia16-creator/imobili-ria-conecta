// Aquecer leads parados (t_a2cae373, decisões de Denis em 15/11/2026). Chip ZionTalk SEPARADO do atendimento.
//
// ENVIO REAL DESLIGADO. Só envia se as TRÊS condições forem verdadeiras no servidor:
//   LEADS_AQUECER_ENVIO_REAL=on, ZIONTALK_LEADS_AQUECER_API_KEY preenchida e LEADS_AQUECER_CHIP_NUMERO válido
//   (o mesmo número cadastrado pela plataforma na imobiliária: lead_config.aquecer_chip_numero).
// Sem isso, é modo teste: o banco prepara a mensagem, grava na conversa como "não enviada" e nada sai do ADM.
// Nunca usa a chave do chip de atendimento (ZIONTALK_LEADS_IA_API_KEY), ZIONTALK_API_KEY, VISITA_PROVA_* nem
// ZIONTALK_MAX_API_KEY: sem fallback entre canais. Se o chip do aquecimento cair, o atendimento segue (e vice-versa).
import { canalTeste, canalZionTalk, type CanalIa, type ResultadoEnvio } from "./leads-ia-canal";

export const ENV_AQUECER_CHAVE = "ZIONTALK_LEADS_AQUECER_API_KEY";
export const ENV_AQUECER_FLAG = "LEADS_AQUECER_ENVIO_REAL";
export const ENV_AQUECER_CHIP = "LEADS_AQUECER_CHIP_NUMERO";

/** Número do chip (DDD + número, 10 ou 11 dígitos, sem 55). null = inválido. */
export function chipNumero(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  const n = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  return /^[1-9][0-9][0-9]{8,9}$/.test(n) ? n : null;
}

export type CanalAquecer = { canal: CanalIa; chip: string | null };

/**
 * Canal do aquecimento pelo ambiente do servidor. Falha FECHADA: qualquer coisa diferente de flag "on" + chave própria
 * + número do chip válido = modo teste (chip null). Só lê as variáveis do aquecimento.
 */
export function escolherCanalAquecer(
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
): CanalAquecer {
  const chave = env[ENV_AQUECER_CHAVE]?.trim();
  const chip = chipNumero(env[ENV_AQUECER_CHIP]);
  if (env[ENV_AQUECER_FLAG] !== "on" || !chave || !chip) return { canal: canalTeste, chip: null };
  return { canal: canalZionTalk(chave, fetchFn), chip };
}

/** Código curto do resultado para o banco (nunca o corpo da resposta da ZionTalk). */
export function codigoResultado(r: ResultadoEnvio): {
  status: "enviada" | "teste" | "falhou";
  erro: string | null;
} {
  if (r.status === "enviada") return { status: "enviada", erro: null };
  if (r.status === "teste") return { status: "teste", erro: null };
  const erro = /^[a-z0-9_]{1,40}$/.test(r.erro) ? r.erro : "erro";
  return { status: "falhou", erro };
}

type Rpc = Promise<{ data: unknown; error: { code?: string } | null }>;

export type DepsAquecer = {
  env: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  /** lead_aquecer_preparar(_chip): no máximo 1 envio por imobiliária por chamada. */
  preparar: (chip: string | null) => Rpc;
  /** lead_aquecer_resultado(_envio, _status, _erro): grava na conversa, avança o estado e aplica o freio. */
  resultado: (envioId: string, status: "enviada" | "teste" | "falhou", erro: string | null) => Rpc;
  /** lead_aquecer_pendentes(_chip): leads retomados com resposta da Nicole esperando o chip do aquecimento. */
  pendentes?: (chip: string) => Rpc;
  /** Envia as mensagens pendentes de um lead pelo canal do aquecimento (enviarPendentes com canal próprio). */
  enviarPendentesLead?: (leadId: string, canal: CanalIa) => Promise<number>;
};

export type ResultadoRodada = {
  r: "nada" | "erro" | "ok";
  preparados?: number;
  enviados?: number;
  teste?: number;
  falhas?: number;
  freio?: string[];
  respostas?: number;
};

/**
 * Uma rodada do aquecimento (chamada pelo pg_cron, rota /api/leads/reengajar, a cada 5 min). O banco escolhe tudo
 * (imobiliárias ligadas, horário, limite com rampa, intervalo, freio). Aqui só envia e devolve o resultado ao banco.
 * Falhou = fica "falhou"; nunca repete sozinho. Log só com códigos.
 */
export async function aquecerUmaRodada(deps: DepsAquecer): Promise<ResultadoRodada> {
  const { canal, chip } = escolherCanalAquecer(deps.env, deps.fetchFn);
  const out: ResultadoRodada = {
    r: "nada",
    preparados: 0,
    enviados: 0,
    teste: 0,
    falhas: 0,
    freio: [],
    respostas: 0,
  };
  const { data, error } = await deps.preparar(chip);
  if (error) {
    console.error("leads aquecer: preparar falhou", error.code ?? "sem_codigo");
    return { r: "erro" };
  }
  const lista =
    (data as Array<{
      envio_id: string;
      lead_id: string;
      telefone: string;
      texto: string;
      modo_real: boolean;
    }> | null) ?? [];
  for (const e of lista) {
    out.preparados!++;
    // Envio real só quando o BANCO marcou como real (imobiliária com este chip) e o canal é o do aquecimento.
    const r: ResultadoEnvio =
      e.modo_real && chip && canal.nome === "ziontalk"
        ? await canal.enviar(e.telefone, e.texto)
        : { status: "teste" };
    const c = codigoResultado(r);
    if (c.status === "enviada") out.enviados!++;
    else if (c.status === "teste") out.teste!++;
    else {
      out.falhas!++;
      console.error("leads aquecer: envio falhou", c.erro);
    }
    const g = await deps.resultado(e.envio_id, c.status, c.erro);
    if (g.error) console.error("leads aquecer: resultado falhou", g.error.code ?? "sem_codigo");
    const freio = (g.data as { freio?: string | null } | null)?.freio;
    if (freio) {
      out.freio!.push(freio);
      console.error("leads aquecer: freio automatico", freio);
    }
  }
  // Respostas da Nicole aos leads retomados pelo aquecimento: saem pelo MESMO chip do aquecimento.
  if (chip && canal.nome === "ziontalk" && deps.pendentes && deps.enviarPendentesLead) {
    const p = await deps.pendentes(chip);
    if (p.error) console.error("leads aquecer: pendentes falhou", p.error.code ?? "sem_codigo");
    for (const x of (p.data as Array<{ lead_id: string }> | null) ?? [])
      out.respostas! += await deps.enviarPendentesLead(x.lead_id, canal).catch(() => 0);
  }
  out.r = out.preparados || out.respostas ? "ok" : "nada";
  return out;
}

/** Link do retorno do chip do aquecimento (cola no painel da ZionTalk, canal do aquecimento). */
export function urlRetornoAquecer(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, "")}/api/leads/aquecer/${token}`;
}
