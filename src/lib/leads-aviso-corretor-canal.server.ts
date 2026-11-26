// Canal do aviso de lead AO CORRETOR (t_637c2c20, Denis 26/11): o MESMO WhatsApp dos avisos de status de venda,
// captação e proposta (chave ZIONTALK_API_KEY, helper enviarWhatsappZiontalk de avisos-canais.server.ts).
// NÃO é o chip da IA (ZIONTALK_LEADS_IA_API_KEY): esse fica só para a conversa com o cliente, para a resposta dele
// voltar para a IA. Nunca usa ZIONTALK_MAX_API_KEY nem VISITA_PROVA_*: sem fallback entre canais ou produtos.
// Arquivo separado de leads-ia-retorno.server.ts de propósito: a trava "a conversa da IA nunca usa a chave de
// vendas" (leads-ia-retorno.test.ts) continua valendo para aquele arquivo.
import { enviarWhatsappZiontalk } from "./avisos-canais.server";
import { normalizePhone, paraWhatsapp } from "./sale-notifications.functions";

/** "enviada" ou o código curto da falha (só o código vai para o log; nunca telefone, texto ou chave). */
export type EnviarAviso = (telefone: string, texto: string) => Promise<"enviada" | string>;

/**
 * null = envio desligado (nada é reservado; o aviso fica pendente). Mesma chave geral do envio real dos leads
 * (LEADS_IA_ENVIO_REAL=on) e a chave dos avisos de venda preenchida. Mesmo tratamento de telefone e texto dos avisos
 * de venda (sem acento: a ZionTalk desse canal recusa letra acentuada).
 */
export function canalAvisoCorretor(
  env: Record<string, string | undefined>,
  enviarReal: typeof enviarWhatsappZiontalk = enviarWhatsappZiontalk,
): EnviarAviso | null {
  const chave = env.ZIONTALK_API_KEY?.trim();
  if (env.LEADS_IA_ENVIO_REAL !== "on" || !chave) return null;
  return async (telefone, texto) => {
    const fone = normalizePhone(telefone);
    if (!fone) return "telefone_invalido";
    const msg = paraWhatsapp(texto).trim();
    if (!msg) return "texto_invalido";
    try {
      return (await enviarReal(chave, fone, msg)) ? "enviada" : "http_erro";
    } catch (e) {
      return (e as Error)?.name === "TimeoutError" ? "timeout" : "rede";
    }
  };
}
