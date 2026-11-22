// Recebe o relato de erro do navegador e escreve UMA linha mascarada no Workers Logs (t_59e94d27).
// Não grava no banco e não chama terceiros. Mascara de novo no servidor (não confia no navegador).
import { mascarar, rotaSegura } from "./log-seguro";

const TAMANHO_MAX = 8 * 1024;
const ORIGENS_ACEITAS =
  /^(https:\/\/app\.(somosunihub|somosmaxhub)\.com\.br|https:\/\/adm-max-homolog\.dacmedia16\.workers\.dev|http:\/\/localhost(:\d+)?)$/;

type Log = (linha: string) => void;

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? mascarar(v).slice(0, max) : "";
}

export async function receberErroFront(
  request: Request,
  log: Log = (l) => console.error(l),
): Promise<Response> {
  const vazio = (status: number) => new Response(null, { status });
  const origem = request.headers.get("origin");
  // sendBeacon de mesma origem manda Origin; se vier de outro site, recusa.
  if (origem && !ORIGENS_ACEITAS.test(origem)) return vazio(403);
  const tamanho = Number(request.headers.get("content-length") ?? "0");
  if (tamanho > TAMANHO_MAX) return vazio(413);

  let bruto: string;
  try {
    bruto = await request.text();
  } catch {
    return vazio(400);
  }
  if (bruto.length > TAMANHO_MAX) return vazio(413);

  let dado: Record<string, unknown>;
  try {
    const j = JSON.parse(bruto);
    if (!j || typeof j !== "object" || Array.isArray(j)) return vazio(400);
    dado = j as Record<string, unknown>;
  } catch {
    return vazio(400);
  }
  const mensagem = texto(dado.mensagem, 300);
  if (!mensagem) return vazio(400);

  log(
    JSON.stringify({
      tipo: "erro",
      origem: "front",
      evento: texto(dado.origem, 40) || "desconhecido",
      nome: texto(dado.nome, 60) || "Error",
      mensagem,
      pilha: texto(dado.pilha, 1500) || undefined,
      rota: rotaSegura(dado.rota),
      navegador: texto(dado.navegador, 40),
    }),
  );
  return vazio(204);
}
