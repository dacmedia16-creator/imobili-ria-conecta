// Nicole "conversando de verdade" (card t_7b59589c, "caminho 2" de Denis 27/10/2026, tópico 6238).
//
// O modelo ESCREVE a resposta ao cliente, mas com travas:
//   1) ANTES do modelo, as regras de sempre decidem (leads-ia.ts / banco): opt-out, assunto sensível, pedido de
//      pessoa, quem não é lead, recusa, permuta, mídia e "é robô?" saem com o texto fixo. Nada disso muda.
//   2) O roteiro fixo (proximaResposta) roda SEMPRE primeiro: a resposta dele é o PLANO B.
//   3) O modelo recebe só: histórico curto (telefone/e-mail mascarados), a ficha do imóvel do lead, os imóveis
//      parecidos do XML da própria imobiliária, o que já foi qualificado e as opções de visita.
//   4) DEPOIS do modelo e ANTES do envio, um validador determinístico (validarRedacao) confere cada número,
//      link e afirmação. Qualquer falha (erro, demora, JSON ruim, bloqueio) = sai o plano B.
// Ligado por imobiliária (lead_config.ia_redige, padrão DESLIGADO). Uso (tokens/custo) e bloqueios vão para
// lead_ia_uso SEM conteúdo (só o código do motivo).
import {
  mascararContato,
  MODELO_RE,
  OPENROUTER_URL,
  ENV_OPENROUTER,
  GEMINI_MODELO,
  GEMINI_PRECO_USD_M,
  type EscolhaModelo,
  type UsoModelo,
} from "./leads-ia-modelo";
import {
  CORRETOR,
  categoriaNaoLead,
  ehPergunta,
  ehSensivel,
  falaPermuta,
  norm,
  opcoesVisita,
  pediuPessoa,
  perguntouSeRobo,
  prazoConfirmacao,
  resumoQualificacao,
  type ContextoIa,
  type DadosQualificacao,
  type FichaIa,
  type FiltroParecido,
  type ImovelParecido,
  type RespostaIa,
  type ResultadoParecidos,
} from "./leads-ia";

/** Tempo máximo do modelo para escrever (curto: depois disso sai o plano B, sem deixar o cliente esperando). */
export const REDACAO_TIMEOUT_MS = 12_000;
/** Modo observar: a 2ª tentativa tem tempo menor (o trabalho em segundo plano do Worker tem ~30 s no total). */
export const REDACAO_RETRY_TIMEOUT_MS = 6_000;
/** Validador por imobiliária (lead_config.ia_validador_modo, t_3a4bf078): "bloquear" (padrão) troca a mensagem
 * barrada pelo plano B; "observar" envia SEMPRE a mensagem do modelo e só registra o que teria barrado. */
export type ModoValidador = "bloquear" | "observar";
/** Aviso na conversa (não vai ao cliente) quando, no modo observar, o modelo falha 2 vezes. */
export const AVISO_SEM_RESPOSTA = "Sem resposta da IA: o modelo falhou 2 vezes nesta mensagem do cliente. Responda o cliente por aqui.";
export const REDACAO_MAX_CHARS = 400;
const HISTORICO_MAX = 10;

export type FalaHistorico = { autor: "ia" | "cliente" | "sistema"; texto: string };

/** Resposta honesta, curta, quando o cliente pergunta DIRETAMENTE se é robô/IA (limite decidido com Denis). */
export function textoRobo(ctx: Pick<ContextoIa, "ia_nome" | "org_nome">): string {
  const nome = (ctx.ia_nome || "Nicole").trim();
  return `Sou a ${nome}, assistente${ctx.org_nome ? ` da ${ctx.org_nome}` : ""}, e respondo por aqui com ajuda de um sistema. Se preferir falar com um corretor, te passo agora. Quer?`;
}

// --- Dados que o modelo pode usar ------------------------------------------------------------------------

/** "R$ 420,00" -> "R$ 420"; "R$ 100,00 por mês" -> "R$ 100 por mês" (um padrão só de valor). */
export function valorCurto(s: string | undefined): string | undefined {
  return s ? s.replace(/(R\$\s*[\d.]+),00\b/g, "$1") : s;
}

/** Ficha enxuta para o modelo (sem código, sem disponibilidade, sem nada que o XML não trouxe). */
function fichaModelo(f: FichaIa | null | undefined) {
  if (!f) return null;
  return limpa({
    tipo: f.tipo,
    bairro: f.bairro,
    cidade: f.cidade,
    quartos: f.quartos,
    suites: f.suites,
    banheiros: f.banheiros,
    vagas: f.vagas,
    area_m2: f.area_util_m2 ?? f.area_construida_m2,
    terreno_m2: f.area_terreno_m2,
    preco: f.negocio !== "locacao" ? valorCurto(f.preco) : undefined,
    aluguel: valorCurto(f.aluguel),
    condominio: valorCurto(f.condominio),
    iptu: valorCurto(f.iptu),
    link: f.link,
  });
}
function parecidoModelo(p: ImovelParecido) {
  return limpa({
    codigo: p.codigo,
    tipo: p.tipo,
    bairro: p.bairro,
    quartos: p.quartos,
    suites: p.suites,
    vagas: p.vagas,
    area_m2: p.area_util_m2,
    terreno_m2: p.area_terreno_m2,
    preco: valorCurto(p.preco),
    aluguel: valorCurto(p.aluguel),
    link: p.url,
    mesmo_condominio: p.mesmo_condominio,
    mesmo_bairro: p.mesmo_bairro,
  });
}
function limpa<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as Partial<T>;
}

/** Opções de visita sem parênteses ("amanhã, quarta, 28/10, de manhã"). */
export function visitaSemParenteses(agora: Date): string[] {
  return opcoesVisita(agora).map((o) =>
    o
      .replace(/\s*\(([^)]*)\)\s*/, ", $1, ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export type EntradaModelo = {
  ctx: ContextoIa;
  texto: string;
  historico: FalaHistorico[];
  candidatos: ImovelParecido[];
  visita: string[];
};

export const INSTRUCAO = `Você é {NOME}, da equipe de atendimento da {ORG}, uma imobiliária. Você conversa pelo WhatsApp com um cliente que se interessou por um imóvel. Escreva como uma atendente humana experiente: simpática, direta, frases curtas, tom de conversa (nada de ficha técnica).

REGRAS (todas obrigatórias):
1. Responda PRIMEIRO exatamente o que o cliente perguntou, em 1 ou 2 frases. Não repita dados que você já mandou no histórico.
2. No máximo 1 pergunta, no fim, de quem conduz a venda: visita, "gostou?", "quer ver mais alguma?". Nunca ofereça "pedir para alguém".
3. Use SOMENTE os dados do bloco DADOS, escritos exatamente como lá (valores no mesmo formato). Nunca invente valor, metragem, quartos, vagas, link, código ou bairro. Sem o dado: "vou confirmar e já te falo".
4. Nunca afirme disponibilidade, que aceita financiamento, FGTS ou permuta, andar, desconto, prazo ou qualquer promessa. Nesses casos diga que vai confirmar e já te retorna, e convide para a visita. Não use as palavras "disponível" nem "disponíveis" (nem para opções de horário ou de imóveis).
5. Não fale em corretor, sistema, robô, IA ou assistente. Não diga que é humana. Quando for passar o atendimento, use "acao":"passar" e NÃO escreva a frase de passagem (ela é colocada depois).
6. Sem parênteses, sem código do imóvel, sem markdown, sem lista, no máximo 1 emoji. Não comece com "Obrigada" quando o cliente fez uma pergunta. Concorde o gênero com o tipo (casa anunciada, apartamento anunciado).
7. Pedido de mais opções, "outra", "parecido", "mesma faixa", "nesse valor": ofereça UM imóvel de CANDIDATOS (o primeiro que servir), com tipo, 1 ou 2 características, valor e o link exato, e use "acao":"oferecer" com o "codigo" dele. Se não houver candidato, diga com naturalidade que essas são as opções que você tem nessa faixa agora e pergunte qual delas mais gostou ou se quer visitar (sem "passar"); use "acao":"passar" só se o cliente insistir em mais opções depois disso.
8. Busca nova (outra pessoa, outro tipo de imóvel, outra finalidade): responda que sim, trabalham com isso, e faça 1 pergunta curta por vez para entender (compra ou aluguel, região, quartos, faixa). Registre em "registro.nova_busca" um resumo curto de tudo o que já sabe dessa busca. Com 2 ou 3 respostas, diga que vai separar opções e use "acao":"passar". Não perca o interesse no imóvel original.
9. Visita: ofereça só depois de responder o que o cliente perguntou, usando as opções de VISITA. Quando o cliente escolher dia e período, registre em "registro.visita" e use "acao":"passar". Se ele pedir outro dia ou horário, aceite e anote, sem repetir as opções.
10. Forma de pagamento: pergunte só se o cliente já mostrou interesse num imóvel específico, uma vez só, e nunca no meio de um pedido dele.
11. Máximo de 350 caracteres.

Responda SÓ com JSON neste formato:
{"mensagem":"texto ao cliente","acao":"responder"|"oferecer"|"passar","codigo":null ou "codigo do candidato oferecido","registro":{"finalidade":"comprar"|"alugar","faixa":"como o cliente disse","pagamento":["à vista"|"financiamento"|"FGTS"|"consórcio"],"visita":"dia e período escolhidos","nova_busca":"resumo curto","interesse":"codigo do imóvel em que o cliente se interessou"}}
Inclua em "registro" só o que o cliente disse nesta conversa.

Exemplos de tom (não copie dados):
Cliente: "qual o valor do condomínio?" -> "O condomínio é R$ 500 por mês. Quer marcar uma visita para conhecer?"
Cliente: "tem outras?" -> "Tenho sim! Tem outra casa no mesmo bairro, com 3 quartos e 170 m², por R$ 900.000. Dá uma olhada: https://exemplo/imovel/1 Gostou?"
Cliente: "aceita financiamento?" -> "Vou confirmar isso e já te falo! Enquanto isso, quer marcar uma visita para conhecer?"`;

export function montarMensagens(e: EntradaModelo): { sistema: string; usuario: string } {
  const { ctx } = e;
  const sistema = INSTRUCAO.replace("{NOME}", (ctx.ia_nome || "Nicole").trim()).replace(
    "{ORG}",
    ctx.org_nome?.trim() || "imobiliária",
  );
  const d = ctx.dados ?? {};
  const atual = d.parecido_atual ? parecidoModelo(d.parecido_atual) : null;
  const dados = limpa({
    imovel_do_cliente: fichaModelo(ctx.ficha),
    candidatos: e.candidatos.map(parecidoModelo),
    ultimo_oferecido: atual,
    ja_oferecidos: d.parecidos?.length ? d.parecidos : undefined,
    qualificacao: limpa({
      finalidade:
        d.finalidade ??
        (ctx.transacao === "venda"
          ? "comprar"
          : ctx.transacao === "aluguel"
            ? "alugar"
            : undefined),
      faixa: d.faixa,
      pagamento: d.pagamento?.length ? d.pagamento : undefined,
      nova_busca: d.outras_buscas?.length ? d.outras_buscas : undefined,
    }),
    visita: e.visita,
  });
  const hist = e.historico
    .filter((m) => m.autor !== "sistema" && m.texto.trim())
    .slice(-HISTORICO_MAX)
    .map((m) => `${m.autor === "ia" ? "Você" : "Cliente"}: ${mascararContato(m.texto)}`);
  const ultima = mascararContato(e.texto);
  if (!hist.length || hist[hist.length - 1] !== `Cliente: ${ultima}`)
    hist.push(`Cliente: ${ultima}`);
  const usuario = `DADOS:\n${JSON.stringify(dados)}\n\nHISTÓRICO (a última fala é a que você responde agora):\n${hist.join("\n")}`;
  return { sistema, usuario };
}

// --- Saída do modelo ---------------------------------------------------------------------------------

export type SaidaModelo = {
  mensagem: string;
  acao: "responder" | "oferecer" | "passar";
  codigo: string | null;
  registro: {
    finalidade?: "comprar" | "alugar";
    faixa?: string;
    pagamento?: string[];
    visita?: string;
    nova_busca?: string;
    interesse?: string;
  };
};

const curto = (t: string, n: number) => t.replace(/\s+/g, " ").trim().slice(0, n);
const PAGAMENTOS = new Set(["à vista", "financiamento", "FGTS", "consórcio"]);

/** Lê o JSON do modelo e só aceita chaves conhecidas, em formato seguro. null = inválido. */
export function lerSaida(bruto: string | undefined): SaidaModelo | null {
  let o: unknown;
  try {
    o = JSON.parse(
      (bruto ?? "")
        .trim()
        .replace(/^```(json)?/i, "")
        .replace(/```$/, "")
        .trim(),
    );
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const x = o as Record<string, unknown>;
  if (typeof x.mensagem !== "string" || !x.mensagem.trim()) return null;
  const acao = x.acao === "oferecer" || x.acao === "passar" ? x.acao : "responder";
  const r =
    x.registro && typeof x.registro === "object" && !Array.isArray(x.registro)
      ? (x.registro as Record<string, unknown>)
      : {};
  const txt = (v: unknown, n: number) =>
    typeof v === "string" && v.trim() ? curto(v, n) : undefined;
  const registro: SaidaModelo["registro"] = limpa({
    finalidade: r.finalidade === "comprar" || r.finalidade === "alugar" ? r.finalidade : undefined,
    faixa: txt(r.faixa, 80),
    pagamento: Array.isArray(r.pagamento)
      ? r.pagamento
          .filter((p): p is string => typeof p === "string" && PAGAMENTOS.has(p))
          .slice(0, 4)
      : undefined,
    visita: txt(r.visita, 60),
    nova_busca: txt(r.nova_busca, 160),
    interesse: txt(r.interesse, 60),
  });
  if (registro.pagamento && !registro.pagamento.length) delete registro.pagamento;
  return {
    mensagem: x.mensagem.replace(/\s+/g, " ").trim(),
    acao,
    codigo: txt(x.codigo, 60) ?? null,
    registro,
  };
}

// --- Validador determinístico (DEPOIS do modelo, ANTES do envio) ----------------------------------------

export type Bloqueio =
  | "vazio"
  | "tamanho"
  | "perguntas"
  | "parenteses"
  | "formato"
  | "link"
  | "valor"
  | "area"
  | "contagem"
  | "numero"
  | "disponibilidade"
  | "condicao"
  | "andar"
  | "desconto"
  | "promessa"
  | "identidade"
  | "corretor"
  | "obrigada"
  | "oferta";

export type Permitidos = {
  links: Set<string>;
  valores: number[];
  areas: number[];
  quartos: Set<number>;
  suites: Set<number>;
  vagas: Set<number>;
  banheiros: Set<number>;
  datas: Set<string>;
  codigos: Map<string, ImovelParecido>;
};

const numBr = (s: string): number => {
  const t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)
    ? s.replace(/\./g, "").replace(",", ".")
    : s.replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
};
/** "R$ 1.199.000" / "R$ 420,00 por mês" -> número. */
const valorDe = (s: string | undefined): number | null => {
  const m = s ? /R\$\s*([\d.,]+)/.exec(s) : null;
  if (!m) return null;
  const v = numBr(m[1].replace(/[.,]$/, ""));
  return Number.isFinite(v) ? v : null;
};
const inteiro = (s: string | undefined): number | null =>
  s && /^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : null;
const area = (s: string | undefined): number | null => {
  if (!s) return null;
  const v = numBr(s.trim());
  return Number.isFinite(v) && v > 0 ? v : null;
};

export function permitidosDe(
  ficha: FichaIa | null | undefined,
  parecidos: ImovelParecido[],
  visita: string[],
): Permitidos {
  const p: Permitidos = {
    links: new Set(),
    valores: [],
    areas: [],
    quartos: new Set(),
    suites: new Set(),
    vagas: new Set(),
    banheiros: new Set(),
    datas: new Set(),
    codigos: new Map(),
  };
  const add = <T>(s: Set<T>, v: T | null) => {
    if (v !== null) s.add(v);
  };
  const imoveis: Array<Partial<FichaIa> & { url?: string }> = [ficha ?? {}, ...parecidos];
  for (const i of imoveis) {
    if (i.link && /^https:\/\//.test(i.link)) p.links.add(i.link);
    if (i.url && /^https:\/\//.test(i.url)) p.links.add(i.url);
    for (const v of [i.preco, i.aluguel, i.condominio, i.iptu].map(valorDe))
      if (v !== null) p.valores.push(v);
    if (typeof i.preco_valor === "number") p.valores.push(i.preco_valor);
    if (typeof i.aluguel_valor === "number") p.valores.push(i.aluguel_valor);
    for (const a of [i.area_util_m2, i.area_construida_m2, i.area_terreno_m2].map(area))
      if (a !== null) p.areas.push(a);
    add(p.quartos, inteiro(i.quartos));
    add(p.suites, inteiro(i.suites));
    add(p.vagas, inteiro(i.vagas));
    add(p.banheiros, inteiro(i.banheiros));
  }
  for (const x of parecidos) p.codigos.set(x.codigo, x);
  for (const o of visita) for (const d of o.match(/\d{2}\/\d{2}/g) ?? []) p.datas.add(d);
  return p;
}

const PALAVRA_NUM: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
};
const LINK_RE =
  /(https?:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9-]+\.(?:com|net|org|br|io|app|me|ly|site|link|info)(?:\/[^\s]*)?)/gi;
/** Confirmação honesta ("vou confirmar", "te confirmo", "vou verificar") libera falar do assunto sem afirmar. */
const CONFIRMA =
  /(vou (confirmar|verificar|checar|ver)|deixa eu (confirmar|verificar|ver)|preciso (confirmar|verificar)|te confirmo|confirmo (com|e|pra|para|isso)|vou te confirmar|ja te (falo|retorno|confirmo))/;
const AFIRMA =
  /(\bsim\b|aceita sim|aceitamos|\bpode sim\b|da sim|e possivel|com certeza|claro que)/;

/**
 * Confere a mensagem do modelo. Devolve o motivo do bloqueio (código curto, sem conteúdo) ou null = pode enviar.
 * `textoCliente` só serve para a regra do "Obrigada" em resposta a pergunta.
 */
export function validarRedacao(
  s: SaidaModelo,
  perm: Permitidos,
  textoCliente: string,
  jaOferecidos: string[] = [],
): Bloqueio | null {
  return validarRedacaoDetalhe(s, perm, textoCliente, jaOferecidos)?.motivo ?? null;
}

const RE_IDENTIDADE =
  /(assistente virtual|inteligencia artificial|\bia\b|\brobo|\bbot\b|chatbot|\bsistema\b|automatic|\bsou (uma |um )?(pessoa|humana|humano|gente)|de carne e osso|nao sou (um |uma )?(robo|bot|ia|maquina))/;
const RE_DISPONIB =
  /(disponiv|ja (foi )?(vendid|alugad)|ainda (esta|ta|tem|e) a venda|continua a venda|nao foi vendid|livre para)/;
const RE_CONDICAO =
  /(financ|fgts|permut|\btroca\b|consorcio|carta de credito|minha casa minha vida|\bmcmv\b)/;
const RE_DESCONTO =
  /(desconto|abaix\w* o (valor|preco)|baixar o (valor|preco)|negociavel|aceita (proposta|oferta)|faz por|fazer por|menor valor|preco especial|condicao especial)/;
const RE_PROMESSA =
  /(garant|prometo|promessa|sem duvida|com certeza (vai|fica|consegue|da)|fica pronto|entrega (em|ate)|chaves? em|em ate \d+ dias|hoje mesmo|aprovad|liberad|isento|sem custo|de graca|gratis)/;
/** Trecho que motivou o bloqueio (o número, o link ou as palavras), curto e sem telefone/e-mail. */
export const TRECHO_MAX = 60;
const trechoCurto = (t: string | null | undefined): string | null => {
  const x = mascararContato((t ?? "").replace(/\s+/g, " ").trim()).slice(0, TRECHO_MAX).trim();
  return x || null;
};

export type DetalheBloqueio = { motivo: Bloqueio; trecho: string | null };

/** Igual a validarRedacao, mas diz também QUAL trecho barrou (modo observar, t_3a4bf078). */
export function validarRedacaoDetalhe(
  s: SaidaModelo,
  perm: Permitidos,
  textoCliente: string,
  jaOferecidos: string[] = [],
): DetalheBloqueio | null {
  const b = (motivo: Bloqueio, trecho?: string | null): DetalheBloqueio => ({ motivo, trecho: trechoCurto(trecho) });
  const achou = (re: RegExp, t: string) => re.exec(t)?.[0] ?? null;
  const msg = s.mensagem;
  if (!msg.trim()) return b("vazio");
  if (msg.length > REDACAO_MAX_CHARS) return b("tamanho", `${msg.length} caracteres`);
  const nPerg = (msg.match(/\?/g) ?? []).length;
  if (nPerg > 1) return b("perguntas", `${nPerg} perguntas`);
  if (/[()]/.test(msg)) return b("parenteses", achou(/\([^)]{0,50}\)?|\)/, msg));
  if (/[{}[\]<>]|\*\*|__|^#|\n\s*[-*•]\s/.test(msg)) return b("formato", achou(/[{}[\]<>]|\*\*|__|^#|\n\s*[-*•]\s/, msg));

  // Links: só o url exato do XML da própria imobiliária (ficha ou parecidos fornecidos).
  let resto = msg;
  const links = msg.match(LINK_RE) ?? [];
  for (const bruto of links) {
    const l = bruto.replace(/[.,;:!?]+$/, "");
    if (!perm.links.has(l)) return b("link", l);
    resto = resto.split(l).join(" ");
  }
  // Oferta: o código tem que ser de um candidato fornecido, ainda não oferecido; link de candidato = esse código.
  const linksCand = [...perm.codigos.values()].filter(
    (c) => c.url && links.some((l) => l.replace(/[.,;:!?]+$/, "") === c.url),
  );
  if (s.acao === "oferecer") {
    const c = s.codigo ? perm.codigos.get(s.codigo) : undefined;
    if (!c || jaOferecidos.includes(c.codigo)) return b("oferta", s.codigo ?? "sem código");
    if (linksCand.some((x) => x.codigo !== c.codigo)) return b("oferta", linksCand.find((x) => x.codigo !== c.codigo)?.url);
  } else if (linksCand.length > 1) return b("oferta", `${linksCand.length} links de opções`);

  const n = norm(resto);
  // Identidade: nunca "IA/robô/sistema/assistente virtual" e nunca dizer que é humana (a pergunta direta tem
  // resposta fixa antes do modelo).
  if (
    RE_IDENTIDADE.test(
      n,
    )
  )
    return b("identidade", achou(RE_IDENTIDADE, n));
  // Corretor só na frase de passagem, que o código coloca depois.
  if (/(corretor|corretora|consultor)/.test(n)) return b("corretor", achou(/(corretor|corretora|consultor)\w*/, n));
  if (/^(obrigad|muito obrigad)/.test(n) && ehPergunta(textoCliente)) return b("obrigada", achou(/^(muito )?obrigad\w*/, n));

  // Afirmações proibidas.
  const confirma = CONFIRMA.test(n);
  if (
    RE_DISPONIB.test(
      n,
    ) &&
    !(/disponibilidade/.test(n) && confirma && !/(esta|ta|continua|segue) disponivel/.test(n))
  )
    return b("disponibilidade", achou(RE_DISPONIB, n));
  const condicao =
    RE_CONDICAO.test(
      n,
    );
  if (condicao) {
    const perguntaAoCliente =
      /\?/.test(msg) && /(voce|vc|seria|pretende|vai|prefere)/.test(n) && !/aceit/.test(n);
    if (!(confirma && !AFIRMA.test(n)) && !perguntaAoCliente) return b("condicao", achou(RE_CONDICAO, n));
  }
  if (/\bandar(es)?\b|\d+\s*o? andar|cobertura duplex/.test(n) && !confirma) return b("andar", achou(/\d*\s*o? ?andar(es)?|cobertura duplex/, n));
  if (
    RE_DESCONTO.test(
      n,
    ) &&
    !confirma
  )
    return b("desconto", achou(RE_DESCONTO, n));
  if (
    RE_PROMESSA.test(
      n,
    )
  )
    return b("promessa", achou(RE_PROMESSA, n));

  // Números: todo valor, área e contagem tem que existir nos dados fornecidos. Número solto = bloqueia.
  let semDatas = n;
  for (const d of n.match(/\b\d{1,2}\/\d{1,2}\b/g) ?? []) {
    if (
      !perm.datas.has(
        d
          .split("/")
          .map((x) => x.padStart(2, "0"))
          .join("/"),
      )
    )
      return b("numero", d);
    semDatas = semDatas.split(d).join(" ");
  }
  const perto = (xs: number[], v: number, tol: number) => xs.some((x) => Math.abs(x - v) <= tol);
  const NUM_RE =
    /(r\$\s*)?(\d+(?:[.,]\d+)*)\s*(milhoes|milhao|mil\b|reais|m2|m²|metros quadrados|metros|m\b|quartos?|dormitorios?|suites?|vagas?|banheiros?)?/g;
  for (const m of semDatas.matchAll(NUM_RE)) {
    const unidade = m[3] ?? "";
    let v = numBr(m[2].replace(/[.,]$/, ""));
    if (!Number.isFinite(v)) return b("numero", m[0]);
    if (m[1] || /^(mil|milhao|milhoes|reais)/.test(unidade)) {
      if (unidade === "mil") v *= 1e3;
      else if (unidade.startsWith("milh")) v *= 1e6;
      if (!perto(perm.valores, v, 0.5)) return b("valor", m[0]);
    } else if (/^(m2|m²|metros|m$)/.test(unidade)) {
      if (!perto(perm.areas, v, 0.01)) return b("area", m[0]);
    } else if (/^(quarto|dormitorio)/.test(unidade)) {
      if (!perm.quartos.has(v)) return b("contagem", m[0]);
    } else if (/^suite/.test(unidade)) {
      if (!perm.suites.has(v)) return b("contagem", m[0]);
    } else if (/^vaga/.test(unidade)) {
      if (!perm.vagas.has(v)) return b("contagem", m[0]);
    } else if (/^banheiro/.test(unidade)) {
      if (!perm.banheiros.has(v)) return b("contagem", m[0]);
    } else return b("numero", m[0]);
  }
  for (const m of semDatas.matchAll(
    /\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito) (quartos?|dormitorios?|suites?|vagas?|banheiros?)\b/g,
  )) {
    const v = PALAVRA_NUM[m[1]];
    const u = m[2];
    const set = /^(quarto|dormitorio)/.test(u)
      ? perm.quartos
      : /^suite/.test(u)
        ? perm.suites
        : /^vaga/.test(u)
          ? perm.vagas
          : perm.banheiros;
    if (!set.has(v)) return b("contagem", m[0]);
  }
  return null;
}

// --- Chamada ao modelo (Gemini direto ou OpenRouter), só texto ---------------------------------------

type Chamada = {
  ok: boolean;
  texto: string | null;
  erro: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  custo_usd: number | null;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const falha = (erro: string): Chamada => ({
  ok: false,
  texto: null,
  erro,
  tokens_entrada: null,
  tokens_saida: null,
  custo_usd: null,
});
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELO}:generateContent`;

/** Gemini direto (doc oficial: generateContent + thinkingConfig.thinkingLevel; o \"pensamento\" é cobrado como saída). */
export async function redigirGemini(
  apiKey: string,
  m: { sistema: string; usuario: string },
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = REDACAO_TIMEOUT_MS,
): Promise<Chamada> {
  try {
    const res = await fetchFn(GEMINI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: m.sistema }] },
        contents: [{ role: "user", parts: [{ text: m.usuario }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    });
    if (!res.ok) return falha(`http_${res.status}`);
    const j = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };
    const ent = num(j.usageMetadata?.promptTokenCount);
    const sai =
      (num(j.usageMetadata?.candidatesTokenCount) ?? 0) +
      (num(j.usageMetadata?.thoughtsTokenCount) ?? 0);
    const texto = (j.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    return {
      ok: true,
      texto,
      erro: null,
      tokens_entrada: ent,
      tokens_saida: sai,
      custo_usd: ((ent ?? 0) * GEMINI_PRECO_USD_M.entrada + sai * GEMINI_PRECO_USD_M.saida) / 1e6,
    };
  } catch (e) {
    return falha((e as Error)?.name === "TimeoutError" ? "timeout" : "rede");
  }
}

/** OpenRouter (mesmas proteções de LGPD da extração: só provedores que não guardam/treinam, retenção zero). */
export async function redigirOpenRouter(
  apiKey: string,
  modelo: string,
  m: { sistema: string; usuario: string },
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = REDACAO_TIMEOUT_MS,
): Promise<Chamada> {
  if (!MODELO_RE.test(modelo)) return falha("modelo_invalido");
  try {
    const res = await fetchFn(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "ADM MAX - IA de atendimento",
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: "system", content: m.sistema },
          { role: "user", content: m.usuario },
        ],
        max_tokens: 1024,
        temperature: 0.4,
        response_format: { type: "json_object" },
        provider: {
          data_collection: "deny",
          zdr: true,
          allow_fallbacks: true,
          max_price: { prompt: 3, completion: 15 },
        },
        reasoning: { effort: "low", exclude: true },
        usage: { include: true },
      }),
    });
    if (!res.ok) return falha(`http_${res.status}`);
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { code?: number };
    };
    if (j.error) return falha(`erro_${num(j.error.code) ?? "x"}`);
    return {
      ok: true,
      texto: j.choices?.[0]?.message?.content ?? null,
      erro: null,
      tokens_entrada: num(j.usage?.prompt_tokens),
      tokens_saida: num(j.usage?.completion_tokens),
      custo_usd: num(j.usage?.cost),
    };
  } catch (e) {
    return falha((e as Error)?.name === "TimeoutError" ? "timeout" : "rede");
  }
}

// --- Orquestração ---------------------------------------------------------------------------------

export type OpcoesRedacao = {
  escolha: EscolhaModelo;
  env: Record<string, string | undefined>;
  historico: FalaHistorico[];
  /** Busca parecidos no XML da própria imobiliária (mesma RPC do roteiro). Sem ela, não há candidatos. */
  buscarParecidos?: (f: FiltroParecido) => Promise<ResultadoParecidos | null>;
  registrar: (u: UsoModelo) => void;
  fetchFn?: typeof fetch;
  agora?: Date;
  /** Padrão "bloquear". */
  modo?: ModoValidador;
};

/** A mensagem tem que sair com o texto fixo (regras de antes do modelo)? */
export function exigeTextoFixo(ctx: ContextoIa, texto: string, base: RespostaIa): boolean {
  const n = norm(texto);
  if (
    ehSensivel(texto) ||
    pediuPessoa(texto) ||
    perguntouSeRobo(texto) ||
    categoriaNaoLead(texto) ||
    falaPermuta(n)
  )
    return true;
  if (ctx.dados?.ofereceu_corretor) return true; // resposta à oferta de passar depois de "é robô?"
  // Passagens decididas pelas regras (sensível, pessoa, não lead, sem interesse) seguem fixas.
  return (
    base.fim === "sensivel" ||
    base.fim === "pediu_pessoa" ||
    base.fim === "nao_lead" ||
    base.fim === "sem_interesse" ||
    // Dia/horário fora das opções: anota com o texto fixo e não repete as opções (t_2aecef49).
    (base.fim === "visita" && !!base.dados.visita_livre)
  );
}

const PASSAR_OK = `Já pedi para ${CORRETOR}, que vai te chamar aqui para combinar.`;
const PASSAR_FALHA = "Anotei tudo aqui e já te retorno por aqui.";
const VISITA_OK = `Já pedi para ${CORRETOR}, que vai te chamar aqui para confirmar o horário certinho.`;
const VISITA_FALHA = "Anotei aqui e já te confirmo o horário por aqui.";

/**
 * Resposta com o modelo escrevendo. `base` = o roteiro fixo (plano B), já calculado.
 * Devolve SEMPRE uma resposta válida: a do modelo (aprovada pelo validador) ou a base.
 */
export async function redigirResposta(
  ctx: ContextoIa,
  texto: string,
  base: RespostaIa,
  op: OpcoesRedacao,
): Promise<RespostaIa & { redigida: boolean; bloqueio: Bloqueio | null; sem_resposta?: boolean }> {
  const plano = (bloqueio: Bloqueio | null = null) => ({ ...base, redigida: false, bloqueio });
  const observar = op.modo === "observar";
  // Modo observar: sem frase pronta. Se o modelo não responder, nada vai ao cliente (o servidor registra o aviso).
  // O estado da conversa fica como estava (o plano B não "aconteceu" para o cliente).
  const semResposta = () => ({
    passo: ctx.passo === "fim" ? ("visita" as const) : ctx.passo,
    dados: ctx.dados ?? {},
    resposta: "",
    resposta_falha: null,
    fim: null,
    resumo: null,
    redigida: false,
    bloqueio: null,
    sem_resposta: true,
  });
  if (perguntouSeRobo(texto) && !base.fim)
    return { ...base, resposta: textoRobo(ctx), redigida: false, bloqueio: null };
  if (exigeTextoFixo(ctx, texto, base)) return plano();

  const fetchFn = op.fetchFn ?? fetch;
  const orKey = op.env[ENV_OPENROUTER]?.trim();
  const usaOr =
    op.escolha.provedor === "openrouter" &&
    !!orKey &&
    !!op.escolha.modelo &&
    MODELO_RE.test(op.escolha.modelo);
  const gKey = op.env.GEMINI_API_KEY?.trim();
  const usaGemini = op.env.LEADS_IA_MODELO === "gemini" && !!gKey;
  if (!usaOr && !usaGemini) return observar ? semResposta() : plano();

  const dadosIn: DadosQualificacao = ctx.dados ?? {};
  const ja = dadosIn.parecidos ?? [];
  const negocio =
    dadosIn.finalidade === "alugar" || (!dadosIn.finalidade && ctx.transacao === "aluguel")
      ? "locacao"
      : "venda";
  // Candidatos: até 3 parecidos do XML ainda não oferecidos (o banco aplica as regras de parecido).
  const res =
    op.buscarParecidos && ja.length < 3
      ? await op
          .buscarParecidos({
            excluir: ja,
            negocio,
            limite: 3,
            codigo_ref: dadosIn.imovel_xml_codigo ?? dadosIn.anuncio_informado ?? null,
          })
          .catch(() => null)
      : null;
  const candidatos = (res?.itens ?? []).filter((i) => !ja.includes(i.codigo)).slice(0, 3);
  const visita = visitaSemParenteses(op.agora ?? new Date());
  const msgs = montarMensagens({
    ctx: { ...ctx, dados: dadosIn },
    texto,
    historico: op.historico,
    candidatos,
    visita,
  });

  let saida: SaidaModelo | null = null;
  let uso: Omit<UsoModelo, "ok" | "erro" | "tokens_entrada" | "tokens_saida" | "custo_usd"> | null =
    null;
  let chamada: Chamada | null = null;
  const perm = permitidosDe(
    ctx.ficha,
    [...candidatos, ...(dadosIn.parecido_atual ? [dadosIn.parecido_atual] : [])],
    visita,
  );
  // Modo observar: erro, demora ou JSON ruim = 1 nova tentativa (t_3a4bf078). Modo bloquear: 1 tentativa (como antes).
  const tentativas = observar ? 2 : 1;
  let detalhe: DetalheBloqueio | null = null;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    const tempo = tentativa === 1 ? REDACAO_TIMEOUT_MS : REDACAO_RETRY_TIMEOUT_MS;
    chamada = null;
    uso = null;
    if (usaOr) {
      chamada = await redigirOpenRouter(orKey!, op.escolha.modelo!, msgs, fetchFn, tempo);
      uso = { provedor: "openrouter", modelo: op.escolha.modelo!, fallback: false };
      if (!chamada.ok && usaGemini) {
        op.registrar({
          ...uso,
          ...semTexto(chamada),
          uso: "redigir",
          bloqueado: false,
          bloqueio: null,
        });
        chamada = null;
      }
    }
    if (!chamada && usaGemini) {
      chamada = await redigirGemini(gKey!, msgs, fetchFn, tempo);
      uso = { provedor: "gemini", modelo: GEMINI_MODELO, fallback: usaOr };
    }
    if (!chamada || !uso) return observar ? semResposta() : plano();
    saida = chamada.ok ? lerSaida(chamada.texto ?? undefined) : null;
    // Último oferecido pode ser citado de novo, mas não "oferecido" outra vez.
    detalhe = !chamada.ok
      ? null
      : !saida
        ? { motivo: "formato", trecho: "JSON inválido" }
        : validarRedacaoDetalhe(saida, perm, texto, ja);
    // No modo observar a mensagem sai mesmo barrada; "observado" marca que a trava só registrou.
    const observado = observar && !!saida && !!detalhe;
    op.registrar({
      ...uso,
      ...semTexto(chamada),
      ok: chamada.ok && !!saida,
      erro: chamada.ok ? (saida ? null : "json") : chamada.erro,
      uso: "redigir",
      bloqueado: !!detalhe,
      bloqueio: detalhe?.motivo ?? null,
      ...(observar ? { bloqueio_trecho: detalhe?.trecho ?? null, observado, tentativa } : {}),
    });
    if (saida) break; // resposta legível: não tenta de novo (bloqueio só registra no modo observar)
  }
  if (!chamada || !saida) return observar ? semResposta() : plano(detalhe?.motivo ?? null);
  const bloqueio: Bloqueio | null = detalhe?.motivo ?? null;
  if (bloqueio && !observar) return plano(bloqueio);
  // Observar: limite do banco (2000) e oferta com código fora dos candidatos não vira "oferecido".
  if (observar) saida = { ...saida, mensagem: saida.mensagem.slice(0, 1500) };
  const ofertaValida = saida.acao === "oferecer" && !!saida.codigo && perm.codigos.has(saida.codigo);

  // Aprovada: monta o estado a partir do que a conversa já tinha + o que o cliente disse (registro).
  const dados: DadosQualificacao = {
    ...dadosIn,
    repeticoes: { ...(dadosIn.repeticoes ?? {}) },
    perguntas: [...(dadosIn.perguntas ?? [])],
  };
  dados.ofereceu_corretor = undefined;
  dados.interesse = true;
  const r = saida.registro;
  if (r.finalidade && !dados.finalidade) dados.finalidade = r.finalidade;
  if (r.faixa) dados.faixa = r.faixa;
  if (r.pagamento?.length) dados.pagamento = r.pagamento;
  if (r.nova_busca)
    dados.outras_buscas = [
      r.nova_busca,
      ...(dados.outras_buscas ?? []).filter((b) => b !== r.nova_busca),
    ].slice(0, 3);
  if (
    r.interesse &&
    (perm.codigos.has(r.interesse) || r.interesse === dadosIn.parecido_atual?.codigo)
  )
    dados.parecido_interesse = r.interesse;
  if (
    /\?/.test(saida.mensagem) &&
    /(a vista|financ)/.test(norm(saida.mensagem)) &&
    !dados.perguntas!.includes("pagamento")
  )
    dados.perguntas!.push("pagamento");
  // Já falou em visita: "sábado pode ser?" no turno seguinte é pedido de dia (t_2aecef49).
  if (/visita/.test(norm(saida.mensagem))) dados.convite_visita = true;
  if (ofertaValida) {
    const c = perm.codigos.get(saida.codigo!)!;
    dados.parecidos = [...ja.filter((x) => x !== c.codigo), c.codigo].slice(0, 3);
    dados.parecido_atual = c;
  }
  // shortcut: o passo do roteiro fica como estava (o modelo conduz); se o modelo falhar no próximo turno, o
  // roteiro fixo continua de onde a conversa estava.
  const passo = ctx.passo === "fim" ? "visita" : ctx.passo;
  if (saida.acao === "passar") {
    const visitaEscolhida = !!r.visita;
    if (visitaEscolhida) {
      dados.visita = r.visita;
      dados.visita_ate = prazoConfirmacao(op.agora ?? new Date());
    }
    const resumo = [
      resumoQualificacao(dados, ctx),
      dados.outras_buscas?.length
        ? `OUTRA BUSCA do cliente: ${dados.outras_buscas.join(" | ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      passo: "fim",
      dados,
      resposta: `${saida.mensagem} ${visitaEscolhida ? VISITA_OK : PASSAR_OK}`,
      resposta_falha: `${saida.mensagem} ${visitaEscolhida ? VISITA_FALHA : PASSAR_FALHA}`,
      fim: visitaEscolhida ? "visita" : "qualificado",
      resumo: resumo.slice(0, 1000),
      redigida: true,
      bloqueio,
    };
  }
  return {
    passo,
    dados,
    resposta: saida.mensagem,
    resposta_falha: null,
    fim: null,
    resumo: null,
    redigida: true,
    bloqueio,
  };
}

// --- Leitura no banco (servidor, service_role) -----------------------------------------------------------

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Chave da imobiliária (lead_config.ia_redige). Coluna ausente (migration não aplicada) ou erro = desligado. */
export async function redacaoLigadaDb(db: Db, orgId: string): Promise<boolean> {
  const { data, error } = await db
    .from("lead_config")
    .select("ia_redige")
    .eq("organization_id", orgId)
    .maybeSingle();
  return !error && (data as { ia_redige?: boolean } | null)?.ia_redige === true;
}

/** Modo do validador (lead_config.ia_validador_modo). Coluna ausente, erro ou valor estranho = "bloquear". */
export async function modoValidadorDb(db: Db, orgId: string): Promise<ModoValidador> {
  const { data, error } = await db
    .from("lead_config")
    .select("ia_validador_modo")
    .eq("organization_id", orgId)
    .maybeSingle();
  return !error && (data as { ia_validador_modo?: string } | null)?.ia_validador_modo === "observar"
    ? "observar"
    : "bloquear";
}

/** Últimas falas da conversa, da mais antiga para a mais nova (o texto é mascarado em montarMensagens). */
export async function historicoDb(db: Db, conversaId: string): Promise<FalaHistorico[]> {
  const { data, error } = await db
    .from("lead_mensagens")
    .select("autor,texto")
    .eq("conversa_id", conversaId)
    .order("created_at", { ascending: false })
    .limit(HISTORICO_MAX + 2);
  if (error || !Array.isArray(data)) return [];
  return (data as FalaHistorico[]).reverse();
}

function semTexto(c: Chamada) {
  return {
    ok: c.ok,
    erro: c.erro,
    tokens_entrada: c.tokens_entrada,
    tokens_saida: c.tokens_saida,
    custo_usd: c.custo_usd,
  };
}
