/**
 * Avisos do módulo "Agendar fotos" (t_d86ab990 / t_ee532309). Regras puras, sem rede e sem banco,
 * para o servidor (photo-notifications.functions.ts) e para os testes.
 *
 * O sino já é gravado pelo banco na mesma transação da ação (photo_avisar_evento). Aqui só sai o
 * WhatsApp, pelo MESMO núcleo e a mesma chave ZionTalk das captações/vendas (enviarAvisosCaptacao),
 * 1 mensagem por destinatário do evento, sem envio em massa.
 */
import {
  enviarAvisosCaptacao,
  type DestinoAviso,
  type ResultadoAviso,
  type TextoAviso,
} from "@/lib/captacao-auditoria";

export const EVENTOS_FOTO = ["marcada", "confirmada", "recusada", "desmarcada"] as const;
export type EventoFoto = (typeof EVENTOS_FOTO)[number];

/** O que a RPC photo_aviso_para_envio devolve (null = nada a avisar). */
export type AvisoFoto = {
  organization_id: string;
  capture_id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  destinos: string[];
};

/** Texto do WhatsApp: o mesmo do sino + link para a tela certa. */
export function textoWhatsappFoto(aviso: AvisoFoto, evento: EventoFoto, appUrl: string): TextoAviso {
  const rota = evento === "marcada" ? "/fotografo" : "/agendar-fotos";
  return {
    titulo: aviso.titulo,
    mensagem: aviso.mensagem,
    whatsapp: `*${aviso.titulo}*\n\n${aviso.mensagem}\n\nAcesse: ${appUrl}${rota}`,
  };
}

/**
 * Destinos do WhatsApp: só perfis da agência (a lista já vem filtrada pela organização) que estão no
 * aviso. WhatsApp desligado em qualquer papel da pessoa nessa agência = só sino (opt-out vale).
 */
export function destinosWhatsappFoto(
  aviso: AvisoFoto,
  perfis: { id: string; telefone: string | null; ativo: boolean | null }[],
  papeis: { user_id: string; notificar_whatsapp: boolean | null }[],
): DestinoAviso[] {
  const alvo = new Set(aviso.destinos);
  return perfis
    .filter((p) => alvo.has(p.id))
    .map((p) => ({
      id: p.id,
      telefone: p.telefone,
      ativo: p.ativo,
      querWhatsapp: !papeis.some((r) => r.user_id === p.id && r.notificar_whatsapp === false),
    }));
}

/** Envia o WhatsApp do evento. O sino NÃO é regravado (o banco já gravou). Nunca lança. */
export async function enviarWhatsappFoto(p: {
  aviso: AvisoFoto;
  evento: EventoFoto;
  appUrl: string;
  destinos: DestinoAviso[];
  registrar: (r: ResultadoAviso) => Promise<void>;
  apiKey: string | undefined;
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  normalizePhone: (raw: string | null | undefined) => string | null;
  paraWhatsapp: (t: string) => string;
  semDadosPessoais: (t: string) => string;
}): Promise<ResultadoAviso> {
  return enviarAvisosCaptacao({
    texto: textoWhatsappFoto(p.aviso, p.evento, p.appUrl),
    destinos: p.destinos,
    gravarSino: async () => {
      /* sino já gravado pelo banco (photo_avisar_evento) */
    },
    registrar: p.registrar,
    apiKey: p.apiKey,
    fetchImpl: p.fetchImpl,
    url: p.url,
    timeoutMs: p.timeoutMs,
    normalizePhone: p.normalizePhone,
    paraWhatsapp: p.paraWhatsapp,
    semDadosPessoais: p.semDadosPessoais,
  });
}

/**
 * Chamado pela tela DEPOIS que a ação já foi gravada. Nunca lança: falha do aviso não desfaz a ação.
 */
export async function avisarFoto(
  sessionId: string,
  evento: EventoFoto,
  notify: (input: { data: { sessionId: string; evento: EventoFoto } }) => Promise<unknown>,
): Promise<boolean> {
  try {
    await notify({ data: { sessionId, evento } });
    return true;
  } catch {
    return false;
  }
}
