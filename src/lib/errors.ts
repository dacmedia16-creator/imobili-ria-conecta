// Tradutor único de erros (t_8ab6c348): transforma o erro do Postgres/PostgREST/Supabase em uma frase em
// português que diga o que fazer. Regras:
// 1) Mensagem em português escrita de propósito (RAISE do banco ou new Error do próprio app) passa como está.
// 2) Mensagem técnica ou em inglês vira a frase do código do erro.
// 3) Sem código conhecido: usa o texto de contexto da tela (fallback) ou a frase genérica.
// Nunca mostra SQL, nome de tabela/coluna, details nem hint.

export const MSG_ERRO_GENERICA =
  "Não foi possível concluir. Tente de novo; se continuar, fale com o suporte.";

const MSG_ATUALIZAR_SISTEMA =
  "O sistema foi atualizado. Recarregue a página; se continuar, fale com o suporte.";
const MSG_SESSAO = "Sua sessão expirou. Entre de novo para continuar.";
const MSG_REDE = "Sem conexão com o servidor. Confira a internet e tente de novo.";
const MSG_CONCORRENCIA = "Outra pessoa estava salvando ao mesmo tempo. Tente de novo em instantes.";
const MSG_FORMATO =
  "Algum campo está em formato inválido (número, data ou código). Confira e tente de novo.";

// Códigos do Postgres (SQLSTATE) e do PostgREST (PGRST*). Referência: docs.postgrest.org/en/v14/references/errors.
const POR_CODIGO: Record<string, string> = {
  "23505": "Já existe um registro igual. Confira os dados e tente de novo.",
  "23503":
    "Este registro está ligado a outro que não existe mais ou ainda está em uso. Atualize a página e confira.",
  "23502": "Falta preencher um campo obrigatório. Confira o formulário e tente de novo.",
  "23514": "Algum dado não passou na conferência do sistema. Revise os campos e tente de novo.",
  "23P01":
    "Já existe um registro no mesmo período ou com os mesmos dados. Confira e tente de novo.",
  "22001": "Um texto passou do tamanho permitido. Encurte e tente de novo.",
  "22003": "Um número está fora do limite permitido. Confira e tente de novo.",
  "22P02": MSG_FORMATO,
  "22007": MSG_FORMATO,
  "22008": MSG_FORMATO,
  "22023": MSG_FORMATO,
  "42501": "Você não tem permissão para fazer isso. Se precisar, peça a um responsável.",
  "57014": "O sistema demorou para responder. Tente de novo em instantes.",
  "40001": MSG_CONCORRENCIA,
  "40P01": MSG_CONCORRENCIA,
  "55P03": MSG_CONCORRENCIA,
  "53300": "O sistema está com muitos acessos agora. Tente de novo em instantes.",
  "42883": MSG_ATUALIZAR_SISTEMA,
  "42P01": MSG_ATUALIZAR_SISTEMA,
  "42703": MSG_ATUALIZAR_SISTEMA,
  PGRST200: MSG_ATUALIZAR_SISTEMA,
  PGRST202: MSG_ATUALIZAR_SISTEMA,
  PGRST203: MSG_ATUALIZAR_SISTEMA,
  PGRST204: MSG_ATUALIZAR_SISTEMA,
  PGRST205: MSG_ATUALIZAR_SISTEMA,
  PGRST116: "Registro não encontrado ou sem acesso. Atualize a página e confira.",
  PGRST301: MSG_SESSAO,
  PGRST302: MSG_SESSAO,
  PGRST303: MSG_SESSAO,
};

// Mensagens sem código (login, arquivos, rede), reconhecidas pelo texto em inglês da biblioteca.
const POR_TEXTO: [RegExp, string][] = [
  [/Failed to fetch|NetworkError|Load failed|Network request failed|fetch failed/i, MSG_REDE],
  [/JWT expired|invalid JWT|refresh token|session.*(missing|expired|not found)/i, MSG_SESSAO],
  [/Invalid login credentials/i, "E-mail ou senha incorretos. Confira e tente de novo."],
  [/Email not confirmed/i, "Seu e-mail ainda não foi confirmado. Veja a mensagem que enviamos."],
  [/User already registered|already been registered/i, "Já existe uma conta com este e-mail."],
  [/New password should be different/i, "A nova senha precisa ser diferente da atual."],
  [
    /Password should be|password is too weak|weak password/i,
    "A senha é fraca ou curta demais. Use uma senha maior.",
  ],
  [
    /rate limit|too many requests/i,
    "Muitas tentativas em pouco tempo. Espere um pouco e tente de novo.",
  ],
  [
    /resource already exists|Duplicate/i,
    "Já existe um arquivo com esse nome. Renomeie e envie de novo.",
  ],
  [
    /exceeded the maximum allowed size|Payload too large|too large/i,
    "Arquivo grande demais. Envie um arquivo menor.",
  ],
  [
    /mime type|invalid key|Invalid file/i,
    "Tipo ou nome de arquivo não aceito. Confira o arquivo e tente de novo.",
  ],
  [/timeout|timed out/i, "O sistema demorou para responder. Tente de novo em instantes."],
];

// Português escrito para a pessoa (letra acentuada ou palavra comum do português).
const PORTUGUES =
  /[áàâãéêíóôõúç]|\b(nao|voce|para|precisa|sem|com|ja|esta|venda|campo|preencha|confira|antes|somente|apenas|pode|deve|falta|informe|escolha|selecione|atualize|tente|registro|imobiliaria|usuario|corretor|vinculo|agencias)\b/i;
// Sinais de texto técnico: nome com _ ou tabela.coluna, SQL, termos do Postgres/PostgREST em inglês.
const TECNICO =
  /\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\b[a-z_]+\.[a-z_]+\b|\bSQL\b|\bselect\b|\binsert\b|\bdelete from\b|PGRST|JWT|schema cache|violates|constraint|relation|column|syntax|permission denied|duplicate key|row-level|null value|invalid input|stack|undefined|TypeError|\bat line\b/i;

function campo(error: unknown, nome: "message" | "code"): string {
  if (!error || typeof error !== "object" || !(nome in error)) return "";
  const v = (error as Record<string, unknown>)[nome];
  return typeof v === "string" ? v : "";
}

/** Texto de erro escrito em português para a pessoa (pode ir para a tela como está). */
export function ehMensagemEmPortugues(msg: string): boolean {
  const m = msg.trim();
  return m.length > 0 && PORTUGUES.test(m) && !TECNICO.test(m);
}

/** Frase em português, com orientação, para mostrar na tela. Nunca devolve detalhe interno. */
export function mensagemErro(error: unknown, fallback?: string): string {
  const message = typeof error === "string" ? error : campo(error, "message");
  const code = campo(error, "code");
  if (message && ehMensagemEmPortugues(message)) return message.trim();
  if (code && POR_CODIGO[code]) return POR_CODIGO[code];
  if (code.startsWith("08")) return MSG_REDE;
  for (const [re, frase] of POR_TEXTO) if (message && re.test(message)) return frase;
  return fallback?.trim() || MSG_ERRO_GENERICA;
}

/** Mesmo comportamento do tradutor; o fallback é o texto de contexto da tela. */
export function errorMessage(error: unknown, fallback: string): string {
  return mensagemErro(error, fallback);
}

/** Mensagem crua, só para decisões no código (ex.: nome de constraint). Nunca mostrar na tela. */
export function errorRawMessage(error: unknown): string {
  return typeof error === "string" ? error : campo(error, "message");
}

export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
