// Canal plugável da IA de atendimento (card t_8046ecb0). Decisão de Denis (25/10): canal = ZionTalk, com o
// chip dedicado da IA (canal "Emanuella Teste"). O adaptador da Cloud API da Meta NÃO é feito.
//
// ENVIO REAL DESLIGADO. Só envia se as DUAS condições forem verdadeiras no servidor:
//   LEADS_IA_ENVIO_REAL=on  e  ZIONTALK_LEADS_IA_API_KEY preenchida (segredo do Worker, nunca no repositório).
// Sem isso, devolve "teste" e nada sai do ADM. Nunca usa ZIONTALK_API_KEY (avisos do ADM),
// VISITA_PROVA_NOTIFICATION_* nem ZIONTALK_MAX_API_KEY: sem fallback entre produtos.
// Este arquivo ainda não é chamado por nenhuma tarefa agendada: ligar o envio é um passo separado.

export const ZIONTALK_SEND_URL = "https://app.ziontalk.com/api/send_message/";
export const ZIONTALK_TIMEOUT_MS = 10_000;
export const ENV_CHAVE = "ZIONTALK_LEADS_IA_API_KEY";
export const ENV_FLAG = "LEADS_IA_ENVIO_REAL";

export type ResultadoEnvio =
  | { status: "teste" } // modo teste: não enviado
  | { status: "enviada" }
  | { status: "falhou"; erro: string; repetir: boolean };

export interface CanalIa {
  readonly nome: "teste" | "ziontalk";
  enviar(telefoneE164: string, texto: string): Promise<ResultadoEnvio>;
}

/** Telefone brasileiro em E.164 (+55DDNNNNNNNNN). null = inválido (não envia). */
export function telefoneE164(t: string | null | undefined): string | null {
  const d = (t ?? "").replace(/\D/g, "");
  const n = d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
  return /^55[1-9][0-9][0-9]{8,9}$/.test(n) ? `+${n}` : null;
}

/** Canal de teste: nunca chama a rede. */
export const canalTeste: CanalIa = {
  nome: "teste",
  async enviar() {
    return { status: "teste" };
  },
};

export function canalZionTalk(apiKey: string, fetchFn: typeof fetch = fetch): CanalIa {
  return {
    nome: "ziontalk",
    async enviar(telefone, texto) {
      const fone = telefoneE164(telefone);
      if (!fone) return { status: "falhou", erro: "telefone_invalido", repetir: false };
      const msg = texto.trim();
      if (!msg || msg.length > 2000) return { status: "falhou", erro: "texto_invalido", repetir: false };
      try {
        const r = await fetchFn(ZIONTALK_SEND_URL, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${apiKey}:`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ msg, mobile_phone: fone }).toString(),
          signal: AbortSignal.timeout(ZIONTALK_TIMEOUT_MS),
        });
        if (r.status === 201) return { status: "enviada" };
        // A ZionTalk pode responder texto simples: não presumir JSON e não registrar o corpo (pode ter dado pessoal).
        return { status: "falhou", erro: `http_${r.status}`, repetir: r.status >= 500 || r.status === 429 };
      } catch (e) {
        return { status: "falhou", erro: (e as Error)?.name === "TimeoutError" ? "timeout" : "rede", repetir: true };
      }
    },
  };
}

/**
 * Escolhe o canal pelo ambiente do servidor. Falha FECHADA: qualquer coisa diferente de
 * flag "on" + chave própria = canal de teste.
 */
export function escolherCanal(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch): CanalIa {
  const chave = env[ENV_CHAVE]?.trim();
  if (env[ENV_FLAG] !== "on" || !chave) return canalTeste;
  return canalZionTalk(chave, fetchFn);
}

// Travas do envio real FUTURO por QR Code (chip comum). Ainda não são chamadas por nenhuma tarefa:
// a tarefa de envio (outro "sim" de Denis) deve usá-las antes de cada 1ª mensagem.
export const ENVIO_LIMITE_DIA_PADRAO = 10;
export const ENVIO_INTERVALO_PADRAO_S = { min: 60, max: 180 } as const;

/** true = ainda cabe mais uma 1ª mensagem hoje. */
export function cabePrimeiraHoje(enviadasHoje: number, limiteDia: number): boolean {
  return Number.isFinite(limiteDia) && limiteDia > 0 && enviadasHoje < limiteDia;
}

/** Espera aleatória (em ms) entre dois envios, dentro de [min, max] segundos. */
export function intervaloAleatorioMs(minS: number, maxS: number, rand: () => number = Math.random): number {
  const lo = Math.max(30, Math.min(minS, maxS));
  const hi = Math.max(lo, maxS);
  return Math.round((lo + rand() * (hi - lo)) * 1000);
}

/** Detecta link/endereço (a 1ª mensagem não pode ter nenhum). Mesma regra do CHECK no banco. */
export const LINK_RE = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|br|me|ly|io|app|site|link)(\b|\/))/i;
export function temLink(texto: string | null | undefined): boolean {
  return LINK_RE.test(texto ?? "");
}
