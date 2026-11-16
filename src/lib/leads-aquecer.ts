// Aquecer leads parados (t_a2cae373, decisões de Denis em 15/11/2026). Chips ZionTalk SEPARADOS do atendimento.
// t_879234c7 (16/11/2026): vários chips por imobiliária. Cada chip tem a própria chave (segredo do Worker):
//   chip 1: ZIONTALK_LEADS_AQUECER_API_KEY   + LEADS_AQUECER_CHIP_NUMERO
//   chip N: ZIONTALK_LEADS_AQUECER_API_KEY_N + LEADS_AQUECER_CHIP_NUMERO_N   (N = 2..9)
//
// ENVIO REAL só com LEADS_AQUECER_ENVIO_REAL=on E o par chave+número do chip preenchido. Chip sem chave não envia
// (o banco nem escolhe lead para ele). Sem nenhum par, é modo teste: nada sai do ADM.
// Nunca usa a chave do chip de atendimento (ZIONTALK_LEADS_IA_API_KEY), ZIONTALK_API_KEY, VISITA_PROVA_* nem
// ZIONTALK_MAX_API_KEY: sem fallback entre canais nem entre chips. Se um chip cair, os outros seguem.
import { canalTeste, canalZionTalk, type CanalIa, type ResultadoEnvio } from "./leads-ia-canal";

export const ENV_AQUECER_CHAVE = "ZIONTALK_LEADS_AQUECER_API_KEY";
export const ENV_AQUECER_FLAG = "LEADS_AQUECER_ENVIO_REAL";
export const ENV_AQUECER_CHIP = "LEADS_AQUECER_CHIP_NUMERO";
export const AQUECER_MAX_CHIPS = 9;

/** Nomes do par de segredos do chip n (1 = nomes originais, sem sufixo). */
export function envChip(n: number): { chave: string; numero: string } {
  const suf = n === 1 ? "" : `_${n}`;
  return { chave: ENV_AQUECER_CHAVE + suf, numero: ENV_AQUECER_CHIP + suf };
}

/** Número do chip (DDD + número, 10 ou 11 dígitos, sem 55). null = inválido. */
export function chipNumero(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  const n = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  return /^[1-9][0-9][0-9]{8,9}$/.test(n) ? n : null;
}

/**
 * Chips com envio real no servidor (número -> canal com a chave DELE). Falha FECHADA: flag diferente de "on" = vazio;
 * par incompleto ou número inválido = chip fora. Só lê as variáveis do aquecimento.
 */
export function chipsAquecer(
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
): Map<string, CanalIa> {
  const m = new Map<string, CanalIa>();
  if (env[ENV_AQUECER_FLAG] !== "on") return m;
  for (let n = 1; n <= AQUECER_MAX_CHIPS; n++) {
    const e = envChip(n);
    const chave = env[e.chave]?.trim();
    const chip = chipNumero(env[e.numero]);
    if (chave && chip && !m.has(chip)) m.set(chip, canalZionTalk(chave, fetchFn));
  }
  return m;
}

export type CanalAquecer = { canal: CanalIa; chip: string | null };

/** Canal de UM chip (o dono do lead ou do link de retorno). Chip sem chave no servidor = modo teste (chip null). */
export function canalDoChip(
  env: Record<string, string | undefined>,
  chip: string | null | undefined,
  fetchFn: typeof fetch = fetch,
): CanalAquecer {
  const c = chip ? chipsAquecer(env, fetchFn).get(chip) : undefined;
  return c && chip ? { canal: c, chip } : { canal: canalTeste, chip: null };
}

/** Compatibilidade: o 1º chip com chave (ou modo teste). */
export function escolherCanalAquecer(
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
): CanalAquecer {
  const [primeiro] = chipsAquecer(env, fetchFn);
  return primeiro ? { canal: primeiro[1], chip: primeiro[0] } : { canal: canalTeste, chip: null };
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
  /** lead_aquecer_preparar_chips(_chips): no máximo 1 envio por chip livre (ou 1 por imobiliária em modo teste). */
  preparar: (chips: string[] | null) => Rpc;
  /** lead_aquecer_resultado(_envio, _status, _erro): grava na conversa, avança o estado e aplica o freio do chip. */
  resultado: (envioId: string, status: "enviada" | "teste" | "falhou", erro: string | null) => Rpc;
  /** lead_aquecer_pendentes(_chip): leads retomados com resposta da Nicole esperando ESTE chip. */
  pendentes?: (chip: string) => Rpc;
  /** Envia as mensagens pendentes de um lead pelo canal do chip dele. */
  enviarPendentesLead?: (leadId: string, canal: CanalIa, chip: string) => Promise<number>;
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
 * (imobiliárias ligadas, chip livre, horário, limite com rampa por chip, intervalo, freio). Aqui só envia, cada
 * mensagem pela chave do chip que o banco marcou, e devolve o resultado. Falhou = "falhou"; nunca repete sozinho.
 */
export async function aquecerUmaRodada(deps: DepsAquecer): Promise<ResultadoRodada> {
  const chips = chipsAquecer(deps.env, deps.fetchFn);
  const out: ResultadoRodada = {
    r: "nada",
    preparados: 0,
    enviados: 0,
    teste: 0,
    falhas: 0,
    freio: [],
    respostas: 0,
  };
  const { data, error } = await deps.preparar(chips.size ? [...chips.keys()] : null);
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
      chip_numero?: string | null;
    }> | null) ?? [];
  for (const e of lista) {
    out.preparados!++;
    // Envio real só quando o BANCO marcou como real e o chip marcado tem chave no servidor (nunca outro chip).
    const canal = e.modo_real && e.chip_numero ? chips.get(e.chip_numero) : undefined;
    const r: ResultadoEnvio = canal
      ? await canal.enviar(e.telefone, e.texto)
      : e.modo_real
        ? { status: "falhou", erro: "chip_sem_chave", repetir: false }
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
  // Respostas da Nicole aos leads retomados: cada lead sai pelo MESMO chip que o aqueceu.
  if (deps.pendentes && deps.enviarPendentesLead) {
    for (const [chip, canal] of chips) {
      const p = await deps.pendentes(chip);
      if (p.error) console.error("leads aquecer: pendentes falhou", p.error.code ?? "sem_codigo");
      for (const x of (p.data as Array<{ lead_id: string }> | null) ?? [])
        out.respostas! += await deps.enviarPendentesLead(x.lead_id, canal, chip).catch(() => 0);
    }
  }
  out.r = out.preparados || out.respostas ? "ok" : "nada";
  return out;
}

/** Link do retorno de um chip do aquecimento (cola no painel da ZionTalk, no canal DESSE chip). */
export function urlRetornoAquecer(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, "")}/api/leads/aquecer/${token}`;
}
