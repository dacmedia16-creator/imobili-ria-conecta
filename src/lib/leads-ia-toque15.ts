// Lembrete rápido de 15 min da Nicole (t_b3f753a5). O banco escolhe a conversa (lead_ia_toque15_candidatas) e
// grava o toque (lead_ia_toque15_gravar); aqui só se escreve o TEXTO: curto, útil, retomando o ponto em que a
// conversa parou. Nunca "oi?" seco, nunca link, preço ou número (nada inventado). Com a redação da imobiliária
// ligada (lead_config.ia_redige), o modelo escreve e a trava confere; se o modelo falhar ou a trava barrar, sai a
// frase fixa montada pelo assunto da última mensagem da Nicole. LGPD: o histórico vai mascarado ao modelo.
import { mascararContato, type EscolhaModelo, type UsoModelo, ENV_OPENROUTER, GEMINI_MODELO, MODELO_RE } from "./leads-ia-modelo";
import { redigirGemini, redigirOpenRouter, type FalaHistorico } from "./leads-ia-redacao";
import { temLink } from "./leads-ia-canal";

export const TOQUE15_MIN_CHARS = 20;
export const TOQUE15_MAX_CHARS = 220;
const TOQUE15_TIMEOUT_MS = 10_000;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export type AssuntoToque15 = "opcao" | "visita" | "detalhes" | "pergunta" | "geral";

/** Do que falava a última mensagem da Nicole (decide a frase fixa e orienta o modelo). */
export function assuntoToque15(ultimaIa: string): AssuntoToque15 {
  const n = norm(ultimaIa);
  if (/(da uma olhada|gostou\?|outra opcao|mais uma (opcao|no)|tenho (uma|outra|outro|mais)|achei (uma|um))/.test(n)) return "opcao";
  if (/(visita|visitar|qual dia|que dia|manha ou (a )?tarde|horario)/.test(n)) return "visita";
  if (/(quartos?|suites?|vagas?|condominio|iptu|m²|metros)/.test(n)) return "detalhes";
  if (/\?\s*$/.test(ultimaIa.trim())) return "pergunta";
  return "geral";
}

/** Tipo que o cliente pediu por último (ex.: "me manda casas"); sem pedido, o da última fala da Nicole. */
export function tipoToque15(ultimoCliente: string, ultimaIa: string): "casas" | "apartamentos" | null {
  for (const t of [ultimoCliente, ultimaIa]) {
    const n = norm(t);
    const casa = /\bcasas?\b/.test(n);
    const ap = /\b(ap|aps|apto|aptos|apartamentos?)\b/.test(n);
    if (casa && !ap) return "casas";
    if (ap && !casa) return "apartamentos";
  }
  return null;
}

/** Primeiro nome só com letras (nome com número, e-mail ou apelido estranho = sem nome; o banco recusa número). */
export function nomeToque15(cliente: string): string {
  const n = (cliente ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}][\p{L}'-]{0,29}$/u.test(n) && !/^lead$/i.test(n) ? n : "";
}

/** Frase fixa (plano B): sem número, sem link, sem preço e SEM convite de visita/agendamento (regra de Denis,
 * t_5335cd2b): só retoma o assunto e oferece ajuda (mais opções ou tirar dúvida). */
export function textoFixoToque15(cliente: string, ultimaIa: string, ultimoCliente = ""): string {
  const nome = nomeToque15(cliente);
  const oi = nome ? `${nome}, ` : "";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const tipo = tipoToque15(ultimoCliente, ultimaIa);
  const mais = tipo ? `mais ${tipo}` : "mais opções parecidas";
  switch (assuntoToque15(ultimaIa)) {
    case "opcao":
    case "detalhes":
      return cap(`${oi}fico por aqui. Se quiser, te mando ${mais} nessa faixa ou tiro alguma dúvida sobre o imóvel.`);
    case "visita":
      return cap(`${oi}fico por aqui. Se ficou alguma dúvida sobre o imóvel, é só me chamar que eu te ajudo.`);
    default:
      return cap(`${oi}fico por aqui. Quando puder, é só me responder que eu continuo te ajudando com o imóvel.`);
  }
}

export type BloqueioToque15 = "vazio" | "tamanho" | "link" | "numero" | "seco" | "perguntas" | "promessa" | "visita" | "robo";

/** O toque de 15 min NÃO convida para visita nem oferece (pré-)agendamento/horário (t_5335cd2b). Texto já normalizado. */
export const TOQUE15_VISITA_RE =
  /(visit|agend|marcar|marcamos|horario|conhecer (o|a|esse|essa|este|esta) (imovel|casa|apartamento|ap|apto|lugar)|pessoalmente|ir ate (o imovel|la))/;

/** Trava do texto do toque (vale para o modelo; a frase fixa passa por ela nos testes). */
export function validarToque15(texto: string): BloqueioToque15 | null {
  const t = texto.trim();
  if (!t) return "vazio";
  if (t.length < TOQUE15_MIN_CHARS || t.length > TOQUE15_MAX_CHARS) return "tamanho";
  if (temLink(t) || /h[t]tps?:|www\./i.test(t)) return "link";
  // Nada de preço, metragem, quantidade, data ou telefone inventado: o toque não traz número nenhum.
  if (/\p{Nd}/u.test(t) || /r\$/i.test(t) || /\b(mil|milh(ao|oes|ão|ões)|reais)\b/i.test(t)) return "numero";
  const n = norm(t);
  // "Oi?", "Ainda está aí?", "Sumiu?": cobrança seca, sem retomar nada.
  if (n.split(/\s+/).filter(Boolean).length < 6 || /^(oi|ola|e ai)[\s,!?.]*$/.test(n) || /(sumiu|ainda (esta|ta) ai|cade voce)/.test(n))
    return "seco";
  if ((t.match(/\?/g) ?? []).length > 1) return "perguntas";
  // Não promete o que só o corretor confirma (desconto, reserva, disponibilidade, horário marcado).
  if (/(desconto|reservad|garant|ja (esta|ta) marcad|confirmad[oa] para|esta disponivel)/.test(n)) return "promessa";
  if (TOQUE15_VISITA_RE.test(n)) return "visita";
  if (/(sou (um|uma) (robo|ia|inteligencia)|como (um|uma) ia)/.test(n)) return "robo";
  return null;
}

export const INSTRUCAO_TOQUE15 = `Você é {NOME}, da equipe de atendimento da {ORG}, uma imobiliária. O cliente parou de responder no meio da conversa pelo WhatsApp há uns 15 minutos. Escreva UMA mensagem curta (1 ou 2 frases, até 200 caracteres) que retome exatamente o ponto em que a conversa parou e ofereça ajuda (ex.: mandar mais opções parecidas ou tirar uma dúvida sobre o imóvel).
Regras:
- Não é cobrança: nada de "oi?", "sumiu?", "ainda está aí?". Tom leve, de quem está à disposição. Pode começar com "Fico por aqui." ou parecido.
- NÃO escreva nenhum número: sem preço, valor, metragem, quantidade de quartos, data, hora ou telefone.
- NÃO cite nome de bairro, condomínio, rua ou cidade: fale só do tipo (casa, apartamento) e de "nessa faixa" / "parecidos".
- NÃO coloque link. NÃO repita o anúncio nem a ficha.
- NÃO convide para visita e NÃO ofereça agendamento, pré-agendamento, horário nem "conhecer o imóvel": este lembrete só retoma o assunto e oferece ajuda. Não use as palavras visita, visitar, agendar, agendamento, marcar, horário nem pessoalmente.
- Não prometa desconto, disponibilidade nem reserva.
- No máximo 1 pergunta. Use o primeiro nome do cliente só se ele for informado.
Responda só JSON: {"mensagem":"..."}`;

export function montarMensagensToque15(
  e: { ia_nome: string; org_nome: string; cliente: string },
  historico: FalaHistorico[],
): { sistema: string; usuario: string } {
  const sistema = INSTRUCAO_TOQUE15.replace("{NOME}", e.ia_nome || "Nicole").replace("{ORG}", e.org_nome || "imobiliária");
  const falas = historico
    .slice(-8)
    .map((f) => `${f.autor === "cliente" ? "Cliente" : e.ia_nome || "Nicole"}: ${mascararContato(f.texto).replace(/https?:\/\/\S+/g, "[link]")}`)
    .join("\n");
  return {
    sistema,
    usuario: `Primeiro nome do cliente: ${e.cliente || "(não informado)"}\nÚltimas mensagens (a última é sua, sem resposta):\n${falas}`,
  };
}

function lerMensagem(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  try {
    const o = JSON.parse(bruto.replace(/^```(json)?|```$/g, "").trim()) as { mensagem?: unknown };
    return typeof o?.mensagem === "string" ? o.mensagem.replace(/\s+/g, " ").trim() : null;
  } catch {
    return null;
  }
}

export type OpcoesToque15 = {
  ia_nome: string;
  org_nome: string;
  cliente: string;
  historico: FalaHistorico[];
  /** lead_config.ia_redige: com a chave desligada sai sempre a frase fixa (sem custo). */
  redige: boolean;
  escolha: EscolhaModelo;
  env: Record<string, string | undefined>;
  registrar?: (u: UsoModelo) => void;
  fetchFn?: typeof fetch;
};

export type TextoToque15 = { texto: string; origem: "modelo" | "fixo"; bloqueio?: BloqueioToque15 | "modelo_falhou" | null };

/** Escreve o toque: modelo (se ligado e aprovado pela trava) ou frase fixa. Nunca lança erro. */
export async function textoToque15(o: OpcoesToque15): Promise<TextoToque15> {
  const ultimaIa = [...o.historico].reverse().find((f) => f.autor === "ia")?.texto ?? "";
  const ultimoCliente = [...o.historico].reverse().find((f) => f.autor === "cliente")?.texto ?? "";
  const fixo = textoFixoToque15(o.cliente, ultimaIa, ultimoCliente);
  if (!o.redige) return { texto: fixo, origem: "fixo", bloqueio: null };
  const m = montarMensagensToque15({ ...o, cliente: nomeToque15(o.cliente) }, o.historico);
  const orKey = o.env[ENV_OPENROUTER]?.trim();
  const gKey = o.env.GEMINI_API_KEY?.trim();
  const usaOr = o.escolha.provedor === "openrouter" && !!orKey && !!o.escolha.modelo && MODELO_RE.test(o.escolha.modelo);
  const usaGemini = !usaOr && !!gKey && o.env.LEADS_IA_MODELO === "gemini";
  if (!usaOr && !usaGemini) return { texto: fixo, origem: "fixo", bloqueio: "modelo_falhou" };
  const c = usaOr
    ? await redigirOpenRouter(orKey!, o.escolha.modelo!, m, o.fetchFn, TOQUE15_TIMEOUT_MS)
    : await redigirGemini(gKey!, m, o.fetchFn, TOQUE15_TIMEOUT_MS);
  const texto = c.ok ? lerMensagem(c.texto) : null;
  const bloqueio = texto ? validarToque15(texto) : "modelo_falhou";
  o.registrar?.({
    provedor: usaOr ? "openrouter" : "gemini",
    modelo: usaOr ? o.escolha.modelo! : GEMINI_MODELO,
    ok: c.ok,
    fallback: false,
    erro: c.erro,
    tokens_entrada: c.tokens_entrada,
    tokens_saida: c.tokens_saida,
    custo_usd: c.custo_usd,
    rota: c.rota ?? null,
    uso: "redigir",
    bloqueado: !!texto && !!bloqueio,
    bloqueio: texto && bloqueio ? `toque_${bloqueio}`.slice(0, 20) : null,
  });
  if (texto && !bloqueio) return { texto, origem: "modelo", bloqueio: null };
  return { texto: fixo, origem: "fixo", bloqueio };
}
