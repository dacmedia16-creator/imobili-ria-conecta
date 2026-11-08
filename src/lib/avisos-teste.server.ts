// Teste de WhatsApp dos avisos de exclusividade (cartão t_5f295777, autorizado por Denis 08/11).
// Manda 1 mensagem pelo ZionTalk do ADM (ZIONTALK_API_KEY) SÓ para o número de teste guardado como secret
// (AVISOS_TESTE_TELEFONE). O destino nunca vem da requisição. Sem o segredo AVISOS_TESTE_SEGREDO (>= 32
// caracteres) a rota fica desligada (404). Para desligar depois do teste: trocar o segredo por um valor curto.
import { segredoConfere } from "./leads-ia-retorno.server";
import { normalizePhone, whatsappText } from "./room-reservation-reminders";

export const ENV_TESTE_SEGREDO = "AVISOS_TESTE_SEGREDO";
export const ENV_TESTE_TELEFONE = "AVISOS_TESTE_TELEFONE";

export const TEXTO_TESTE =
  "*TESTE ADM MAX - avisos de exclusividade*\n" +
  "Faltam 30 dias para vencer a exclusividade do imóvel AP0008 / Jardim Gonçalves. " +
  "Bom momento para conversar com o proprietário sobre a renovação.\n" +
  "(Mensagem de teste enviada só para você. Imóvel fictício.)";

export type DepsTeste = {
  env: Record<string, string | undefined>;
  whatsapp: (apiKey: string, telefone: string, texto: string) => Promise<boolean>;
};

const json = (status: number, r: string) =>
  new Response(JSON.stringify({ r }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function receberTesteAvisos(request: Request, deps: DepsTeste): Promise<Response> {
  if (request.method !== "POST") return json(405, "metodo");
  if (!segredoConfere(request.headers.get("x-avisos-teste-segredo"), deps.env[ENV_TESTE_SEGREDO]?.trim()))
    return json(404, "desligado");
  const telefone = normalizePhone(deps.env[ENV_TESTE_TELEFONE] ?? null);
  const apiKey = deps.env.ZIONTALK_API_KEY?.trim();
  if (!telefone || !apiKey) return json(503, "sem_configuracao");
  const ok = await deps.whatsapp(apiKey, telefone, whatsappText(TEXTO_TESTE)).catch(() => false);
  return json(ok ? 200 : 502, ok ? "enviado" : "falhou");
}
