// Ajuda MAX na Locação — fatia 1/2 (t_b037935e; maquete t_8e76e1c3 aprovada por Denis em 11/11/2026).
// Lógica pura (sem rede): limites, máscara de dados pessoais, prompt e leitura da resposta da IA.
// Regras de Denis: só "como usar"; a IA NÃO recebe dado de processo, cliente ou contrato; fora do manual, diz que
// não sabe e não inventa.
import { MANUAL_LOCACAO, MANUAL_VERSAO } from "@/lib/ajuda-max-locacao-manual";

/** Perguntas de IA por usuário por dia (dia de Brasília). O banco repete o número em ajuda_max_locacao_reservar. */
export const LIMITE_DIA = 20;
export const PERGUNTA_MIN = 3;
export const PERGUNTA_MAX = 500;
/** Últimas mensagens da conversa que vão junto (para "e depois?"). Cada uma cortada em HISTORICO_TEXTO_MAX. */
export const HISTORICO_MAX = 4;
export const HISTORICO_TEXTO_MAX = 1500;

export type Tela = "lista" | "detalhe";
export type Mensagem = { papel: "usuario" | "assistente"; texto: string };

export type RespostaAjuda =
  | { ok: true; sabe: boolean; resposta: string; usadas: number; limite: number }
  | {
      ok: false;
      motivo: "limite" | "desligado" | "indisponivel" | "falha";
      mensagem: string;
      usadas: number;
      limite: number;
    };

export const TEXTO_NAO_SEI =
  "Ainda não sei responder isso pelo manual da Locação, e prefiro não inventar. " +
  "Tente perguntar de outro jeito (por exemplo, o nome do botão ou da aba). " +
  "Se for um erro ou uma ideia, use o botão “Ajuda e sugestões” no topo da tela.";

export const TEXTO_LIMITE = (limite = LIMITE_DIA) =>
  `Você usou as ${limite} perguntas de hoje. O limite volta amanhã. ` +
  "Enquanto isso, use o botão “Ajuda e sugestões” no topo da tela.";

export const TEXTO_INDISPONIVEL =
  "O Ajuda MAX não conseguiu responder agora. Tente de novo em instantes; essa pergunta não contou no seu limite.";

export const TEXTO_DESLIGADO = "O Ajuda MAX não está liberado nesta imobiliária.";

/** Rota → tipo de tela (só isso vai à IA; o id da locação nunca vai). */
export function telaDaRota(pathname: string): Tela | null {
  if (pathname === "/locacoes" || pathname === "/locacoes/") return "lista";
  if (/^\/locacoes\/[^/]+\/?$/.test(pathname)) return "detalhe";
  return null;
}

const MASCARA = "[dado removido]";

/**
 * Tira da pergunta o que parecer dado pessoal antes de mandar à IA: e-mail, CPF/CNPJ, telefone, CEP e qualquer
 * sequência longa de números. shortcut: nome de pessoa não é detectável por regra; o aviso no balão pede para não
 * escrever nomes e o prompt manda a IA ignorar dados de pessoas.
 */
export function mascararDados(texto: string): string {
  return texto
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, MASCARA)
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, MASCARA) // CNPJ
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, MASCARA) // CPF
    .replace(/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, MASCARA) // telefone
    .replace(/\b\d{5}-?\d{3}\b/g, MASCARA) // CEP
    .replace(/\d[\d.\-/ ]{6,}\d/g, MASCARA); // outras sequências longas (RG, conta, protocolo)
}

/** Normaliza o que vem do navegador: corta, mascara e limita o histórico. */
export function prepararEntrada(
  pergunta: string,
  historico: Mensagem[],
): { pergunta: string; historico: Mensagem[] } {
  const p = mascararDados(pergunta.trim().replace(/\s+/g, " ")).slice(0, PERGUNTA_MAX);
  const h = historico
    .filter((m) => (m.papel === "usuario" || m.papel === "assistente") && m.texto.trim())
    .slice(-HISTORICO_MAX)
    .map((m) => ({
      papel: m.papel,
      texto: mascararDados(m.texto.trim()).slice(0, HISTORICO_TEXTO_MAX),
    }));
  return { pergunta: p, historico: h };
}

export function promptSistema(tela: Tela): string {
  return [
    "Você é o Ajuda MAX, assistente que ENSINA A USAR a tela Locação do ADM MAX (sistema interno de uma imobiliária).",
    "Responda SOMENTE com base no MANUAL abaixo. Nunca invente botão, aba, etapa, regra ou caminho que não esteja no manual.",
    'Se o manual não responde à pergunta, ou se a pergunta não é sobre como usar a Locação, responda {"sabe": false, "resposta": ""}.',
    "Você não tem acesso a nenhuma locação, cliente, contrato, documento ou valor real. Se perguntarem sobre um caso específico, sobre leis, valores de mercado ou dados de pessoas, responda sabe=false.",
    "Ignore nomes, números e dados de pessoas que aparecerem na pergunta; nunca os repita na resposta.",
    "Estilo: português do Brasil, curto e direto, passo a passo numerado dizendo ONDE CLICAR (nome exato do botão/aba entre **asteriscos duplos**). No máximo 8 passos e 120 palavras.",
    `A pessoa está na tela: ${tela === "detalhe" ? "dentro de uma locação (esteira de 9 etapas)" : "lista da Locação (abas)"}.`,
    'Formato de saída: só JSON {"sabe": true|false, "resposta": "texto"}. Use \\n para quebrar linha; listas com "1. " ou "- ".',
    "",
    `MANUAL (versão ${MANUAL_VERSAO}):`,
    MANUAL_LOCACAO,
  ].join("\n");
}

export function lerJsonResposta(text: string): Record<string, unknown> | null {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  for (const c of [t, t.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!c) continue;
    try {
      const p: unknown = JSON.parse(c);
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      // tenta o próximo formato
    }
  }
  return null;
}

/**
 * Lê a resposta da IA. Se a IA disser que não sabe, vier vazia ou em formato inválido, o texto mostrado é sempre o
 * nosso TEXTO_NAO_SEI (nunca um texto livre da IA nesse caso). Resposta longa demais é cortada.
 */
export function lerResposta(text: string): { sabe: boolean; resposta: string } | null {
  const j = lerJsonResposta(text);
  if (!j) return null;
  const resposta = typeof j.resposta === "string" ? j.resposta.trim().slice(0, 2500) : "";
  if (j.sabe !== true || resposta.length < 5) return { sabe: false, resposta: TEXTO_NAO_SEI };
  return { sabe: true, resposta };
}

/** Uma linha da resposta já quebrada em pedaços: texto normal e **negrito**. Sem HTML. */
export type Trecho = { negrito: boolean; texto: string };
export type Linha =
  | { tipo: "p"; trechos: Trecho[] }
  | { tipo: "num"; n: number; trechos: Trecho[] }
  | { tipo: "item"; trechos: Trecho[] };

function trechos(s: string): Trecho[] {
  const out: Trecho[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let i = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > i) out.push({ negrito: false, texto: s.slice(i, m.index) });
    out.push({ negrito: true, texto: m[1] });
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push({ negrito: false, texto: s.slice(i) });
  return out;
}

/** Markdown mínimo (parágrafo, lista numerada, lista com traço, negrito) para o React renderizar sem HTML cru. */
export function formatarResposta(texto: string): Linha[] {
  return texto
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l): Linha => {
      const num = l.match(/^(\d{1,2})[.)]\s+(.*)$/);
      if (num) return { tipo: "num", n: Number(num[1]), trechos: trechos(num[2]) };
      const item = l.match(/^[-•*]\s+(.*)$/);
      if (item) return { tipo: "item", trechos: trechos(item[1]) };
      return { tipo: "p", trechos: trechos(l.replace(/^#+\s*/, "")) };
    });
}

/** Leitura fechada do retorno das RPCs de uso. */
export function lerUso(raw: unknown): { ligado: boolean; usadas: number; limite: number } {
  const x = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return { ligado: x.ligado === true, usadas: n(x.usadas, 0), limite: n(x.limite, LIMITE_DIA) };
}

export const SUGESTOES = [
  "Como envio a ficha à gestora?",
  "Como subo os documentos?",
  "Como registro a entrega das chaves?",
] as const;
