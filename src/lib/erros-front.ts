// Captura simples de erros do navegador (t_59e94d27). Sem Sentry e sem terceiros:
// manda um resumo MASCARADO para /api/erros-front, que só escreve no Workers Logs da Cloudflare.
// Nada de dado do formulário, usuário, token ou query string.
import { mascarar, resumirErro, rotaSegura } from "./log-seguro";

export const ROTA_ERROS_FRONT = "/api/erros-front";
const MAX_POR_PAGINA = 5;

export type RelatoFront = {
  origem: string;
  nome: string;
  mensagem: string;
  pilha?: string;
  rota: string;
  navegador: string;
};

/** Navegador resumido (família + celular/computador), sem a string completa do User-Agent. */
export function navegadorResumido(ua: string): string {
  const fam = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "outro";
  const tipo = /Mobi|Android|iPhone|iPad/.test(ua) ? "celular" : "computador";
  return `${fam}/${tipo}`;
}

// Erros que não são do sistema: extensão do navegador, script de terceiro sem detalhe, aba fechando.
const IGNORAR = [
  /^Script error\.?$/i,
  /ResizeObserver loop/i,
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /^AbortError/i,
  /The user aborted a request/i,
];

export function deveIgnorar(mensagem: string, pilha?: string): boolean {
  return IGNORAR.some((re) => re.test(mensagem) || (pilha ? re.test(pilha) : false));
}

export function montarRelato(
  origem: string,
  erro: unknown,
  caminho: string,
  ua: string,
): RelatoFront | null {
  const r = resumirErro(erro);
  if (deveIgnorar(r.mensagem, r.pilha)) return null;
  return {
    origem: mascarar(origem).slice(0, 40),
    nome: r.nome,
    mensagem: r.mensagem,
    ...(r.pilha ? { pilha: r.pilha } : {}),
    rota: rotaSegura(caminho),
    navegador: navegadorResumido(ua),
  };
}

let enviados = 0;
const vistos = new Set<string>();

/** Para os testes. */
export function _zerarContadores() {
  enviados = 0;
  vistos.clear();
}

/** Envia 1 relato (no máximo 5 por página e sem repetir a mesma mensagem). Nunca lança erro. */
export function registrarErroFront(origem: string, erro: unknown): boolean {
  try {
    if (typeof window === "undefined") return false;
    const relato = montarRelato(origem, erro, window.location.pathname, navigator.userAgent);
    if (!relato) return false;
    const chave = `${relato.nome}|${relato.mensagem}`;
    if (vistos.has(chave) || enviados >= MAX_POR_PAGINA) return false;
    vistos.add(chave);
    enviados += 1;
    const corpo = JSON.stringify(relato);
    if (typeof navigator.sendBeacon === "function") {
      return navigator.sendBeacon(
        ROTA_ERROS_FRONT,
        new Blob([corpo], { type: "application/json" }),
      );
    }
    void fetch(ROTA_ERROS_FRONT, {
      method: "POST",
      body: corpo,
      headers: { "content-type": "application/json" },
      keepalive: true,
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

let instalado = false;

/** Liga a captura de erros não tratados do navegador (1 vez). */
export function instalarCapturaErrosFront(): void {
  if (instalado || typeof window === "undefined") return;
  instalado = true;
  window.addEventListener("error", (ev) => {
    registrarErroFront("janela", ev.error ?? ev.message);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    registrarErroFront("promessa", ev.reason);
  });
}
