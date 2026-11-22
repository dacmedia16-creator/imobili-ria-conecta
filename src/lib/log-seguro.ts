// Registro de erros sem dados pessoais (t_59e94d27). Usado no Worker e no navegador.
// Mascara e-mail, CPF, CNPJ, telefone, tokens/chaves e ids longos ANTES de qualquer log.
// Sem dependências: o script do resumo diário (scripts/resumo-erros-diario.ts) importa daqui.

const LIMITE_MENSAGEM = 300;
const LIMITE_LINHAS_PILHA = 8;
const LIMITE_PILHA = 1500;

const REGRAS: [RegExp, string][] = [
  // Tokens e chaves primeiro (podem conter números que parecem CPF/telefone).
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[token]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [token]"],
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[chave]"],
  [/\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{16,}/g, "[chave]"],
  [
    /([?&;\s"']?(?:access_token|refresh_token|token|apikey|api_key|key|secret|senha|password|code)["']?\s*[=:]\s*["']?)[^&\s"',;}]+/gi,
    "$1[oculto]",
  ],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[cnpj]"],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]"],
  [/(?:\+?55[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g, "[telefone]"],
];

/** Troca dados pessoais e segredos por marcadores. Nunca lança erro. */
export function mascarar(texto: unknown): string {
  let s = typeof texto === "string" ? texto : String(texto ?? "");
  for (const [re, troca] of REGRAS) s = s.replace(re, troca);
  return s;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Caminho da tela sem query/hash e com ids/tokens trocados por ":id" (agrupa e não vaza link de convite). */
export function rotaSegura(caminho: unknown): string {
  const bruto = typeof caminho === "string" ? caminho : "";
  const semQuery = bruto.split(/[?#]/)[0] || "/";
  const partes = semQuery.split("/").map((p) => {
    if (!p) return p;
    let seg = p;
    try {
      seg = decodeURIComponent(p);
    } catch {
      /* mantém como veio */
    }
    if (UUID.test(seg) || /^\d{4,}$/.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg)) return ":id";
    const m = mascarar(seg);
    return m === seg ? p : m;
  });
  return partes.join("/").slice(0, 200);
}

function pilhaCurta(stack: unknown): string | undefined {
  if (typeof stack !== "string" || !stack) return undefined;
  const linhas = stack
    .split("\n")
    .slice(0, LIMITE_LINHAS_PILHA)
    // Tira query string dos arquivos (ex.: ?v=hash ou ?token=...).
    .map((l) => l.replace(/\?[^\s):]*/g, ""));
  return mascarar(linhas.join("\n")).slice(0, LIMITE_PILHA);
}

export type ResumoErro = {
  nome: string;
  mensagem: string;
  pilha?: string;
  codigo?: string;
};

/** Reduz qualquer coisa lançada a um resumo pequeno e mascarado. */
export function resumirErro(erro: unknown): ResumoErro {
  if (erro instanceof Error || (erro && typeof erro === "object" && "message" in erro)) {
    const e = erro as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown };
    const codigo =
      typeof e.code === "string" || typeof e.code === "number"
        ? mascarar(String(e.code)).slice(0, 40)
        : undefined;
    return {
      nome: mascarar(typeof e.name === "string" && e.name ? e.name : "Error").slice(0, 60),
      mensagem: mascarar(e.message).slice(0, LIMITE_MENSAGEM),
      pilha: pilhaCurta(e.stack),
      ...(codigo ? { codigo } : {}),
    };
  }
  return { nome: "NaoErro", mensagem: mascarar(erro).slice(0, LIMITE_MENSAGEM) };
}

/** Linha única de log (JSON) para o Workers Logs. Origem curta: "ssr", "middleware", "front"... */
export function linhaDeErro(origem: string, erro: unknown, extra?: Record<string, string>): string {
  const extraSeguro: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra ?? {})) extraSeguro[k] = mascarar(v).slice(0, 200);
  return JSON.stringify({ tipo: "erro", origem, ...resumirErro(erro), ...extraSeguro });
}

/** Registra no console do Worker (vai para o Workers Logs) já mascarado. */
export function registrarErroServidor(
  origem: string,
  erro: unknown,
  extra?: Record<string, string>,
): void {
  try {
    console.error(linhaDeErro(origem, erro, extra));
  } catch {
    console.error(`{"tipo":"erro","origem":"${origem}","mensagem":"falha ao resumir erro"}`);
  }
}
