// IA de atendimento dos leads (Nicole) — cards t_8046ecb0 e t_fc4d9b27 (roteiro novo a partir do estudo
// de 1.347 conversas da Lais). Lógica pura, sem rede.
// O banco decide quem vê, opt-out, deduplicação e a passagem ao corretor (migrations 20261025180000 e
// 20261026170000). Aqui fica o roteiro. Todos os textos que vão ao cliente são FIXOS ou montados SÓ com
// dados da ficha da captação: a IA nunca inventa preço, condição, disponibilidade ou dado do imóvel.
// Um modelo de linguagem, quando ligado, só ajuda a ENTENDER a resposta do cliente; nunca escreve a resposta.
//
// Roteiro (t_fc4d9b27):
//  1) 1ª mensagem: uma bolha, \"Aqui é a Nicole, da <imobiliária>\" + imóvel do XML (tipo, quartos, bairro,
//     cidade e valor anunciado) + só o link do anúncio validado + pergunta fechada (banco, t_25fe1197).
//     Se o cliente perguntar diretamente se é robô/IA, ela confirma que é assistente virtual e oferece o
//     corretor. A apresentação normal nunca usa "assistente virtual".
//  2) Responde primeiro a dúvida; depois no máximo 3 perguntas, uma por turno: finalidade (só se o anúncio
//     não disser), faixa de valor e forma de pagamento.
//  3) Dúvidas respondidas pela ficha da captação; sem o dado: "não tenho esse dado confirmado, vou confirmar
//     com o corretor". Nunca estima.
//  4) Visita: 2 opções de dia/período, pré-agendamento que o corretor confirma, com prazo.
//  5) "Encaminhei" só se o banco gravou o registro e o aviso: a resposta leva {corretor} e um texto de falha;
//     quem escolhe é lead_ia_aplicar.
//  7) Código do anúncio: usa o que veio do portal; se faltar tudo, pede UMA vez, com exemplo.
//  8) Proprietário, parceiro, fornecedor ou assunto pessoal: passa ao humano sem questionário.

import { temLink } from "./leads-ia-canal";

export const PASSOS = [
  "interesse",
  "codigo",
  "finalidade",
  "faixa",
  "pagamento",
  "visita",
  "fim",
  // Passos do roteiro antigo: só para conversas que já estavam abertas.
  "prazo",
  "regiao",
  "proximo_passo",
] as const;
export type Passo = (typeof PASSOS)[number];
/** As perguntas de qualificação (no máximo estas 3, uma por turno). */
export type Pergunta = "finalidade" | "faixa" | "pagamento";

export type FimConversa = "qualificado" | "pediu_pessoa" | "sensivel" | "sem_interesse" | "visita" | "nao_lead";

/** Ficha do imóvel que o banco entrega: pelo XML da imobiliária (lead_ia_ficha_xml, prioridade) ou pela
 * captação (lead_ia_ficha). Só o que existe e está preenchido. Os campos marcados como "futuro" ainda NÃO
 * vêm de nenhuma das duas fontes; o roteiro já sabe usá-los quando existirem. */
export type FichaIa = {
  tipo?: string;
  bairro?: string;
  cidade?: string;
  quartos?: string;
  suites?: string;
  banheiros?: string;
  vagas?: string;
  area_util_m2?: string;
  area_construida_m2?: string;
  area_terreno_m2?: string;
  /** Ignorado de propósito: a disponibilidade NUNCA é garantida pela IA (t_76243950). */ disponivel?: boolean;
  /** XML (texto já formatado, ex.: "R$ 650,00") */ condominio?: string;
  /** XML (ex.: "R$ 140,00 por mês") */ iptu?: string;
  /** futuro */ aceita_permuta?: boolean;
  /** futuro */ aceita_financiamento?: boolean;
  /** futuro (ex.: "5º andar, frente") */ andar?: string;
  // XML (t_25fe1197): negócio, valor anunciado e link do anúncio, só quando vieram do XML.
  /** "venda" | "locacao" | "venda_locacao" */ negocio?: string;
  /** Preço de venda anunciado, formatado ("R$ 430.000"). */ preco?: string;
  /** O mesmo, em número (para conferir a faixa do cliente). */ preco_valor?: number;
  /** Aluguel mensal anunciado, formatado ("R$ 2.500"). */ aluguel?: string;
  aluguel_valor?: number;
  /** Link do anúncio (https, validado no banco). */ link?: string;
};

export type DadosQualificacao = {
  interesse?: boolean;
  finalidade?: "comprar" | "alugar" | string;
  faixa?: string;
  pagamento?: string[];
  /** Perguntas de qualificação já feitas (cada uma no máximo uma vez, mais uma repetição após dúvida). */
  perguntas?: Pergunta[];
  /** Temas que o cliente perguntou e a ficha não tinha: o corretor confirma. */
  pendentes?: string[];
  /** Código do anúncio pedido ao cliente (só uma vez) e o que ele informou. */
  codigo_pedido?: boolean;
  anuncio_informado?: string;
  imovel_capture_id?: string;
  /** Código achado no XML da imobiliária (o banco usa para montar a ficha nos turnos seguintes). */
  imovel_xml_codigo?: string;
  /** Visita: opções oferecidas, escolha e prazo de confirmação. */
  visita_opcoes?: string[];
  visita?: string;
  visita_ate?: string;
  /** Reengajamento (toque 2): alternativa oferecida pelo banco. */
  alternativa?: string;
  /** Categoria de quem não é comprador/locatário. */
  categoria?: "proprietario" | "parceiro" | "fornecedor" | "pessoal";
  /** Roteiro antigo (conversas já abertas). */
  prazo?: string;
  regiao?: string;
  proximo_passo?: "visita" | "contato";
  /** Quantas vezes o mesmo passo já foi repetido (máx. 1 repetição). */
  repeticoes?: Partial<Record<Passo, number>>;
  /** Áudios/arquivos recebidos pelo WhatsApp (2º = passa ao corretor). */
  midias?: number;
  // Imóvel parecido do XML (t_232e13cb). Nada disso vai ao cliente além do que o XML trouxe.
  /** Códigos dos parecidos já oferecidos nesta conversa (nunca repete; no máximo 3). */
  parecidos?: string[];
  /** Parecido oferecido no último turno, esperando a reação do cliente. */
  parecido_atual?: ImovelParecido;
  /** A Nicole já perguntou "quer ver uma opção parecida?" (uma vez por conversa). */
  parecido_perguntado?: boolean;
  /** A pergunta acima está esperando resposta. */
  parecido_pergunta?: boolean;
  /** Conferências de "o pedido não serve" já feitas (cada uma no máximo uma vez): locacao, saiu, faixa, bairro. */
  parecido_conferido?: string[];
  /** Código do parecido em que o cliente se interessou (vai para o corretor). */
  parecido_interesse?: string;
  /** A Nicole confirmou ser assistente virtual e ofereceu o corretor no último turno (t_25fe1197). */
  ofereceu_corretor?: boolean;
  /** Faixa muito longe do valor anunciado já foi conferida com o cliente (uma vez por conversa). */
  faixa_conferida?: boolean;
  /** A pergunta "Só confirmando: sua faixa é de R$ X?" espera resposta (vale só no turno seguinte). */
  faixa_pendente?: boolean;
  /** Outras buscas do cliente na mesma conversa (ex.: apartamento para o filho), resumo para o corretor (t_7b59589c). */
  outras_buscas?: string[];
};

export type ContextoIa = {
  conversa_id: string;
  estado: string;
  versao: number;
  passo: Passo;
  dados: DadosQualificacao;
  ia_nome: string;
  lead_nome: string;
  imovel: string | null;
  // Roteiro novo (lead_ia_registrar_cliente, migration 20261026170000). Opcionais: banco antigo não manda.
  org_nome?: string | null;
  /** Do portal (Grupo ZAP): venda/aluguel. Com isso a finalidade não é perguntada. */
  transacao?: "venda" | "aluguel" | null;
  /** Código do anúncio que veio do portal. Com ele, o código nunca é pedido ao cliente. */
  anuncio_codigo?: string | null;
  tem_captacao?: boolean;
  /** "o apartamento do bairro Campolim" */
  imovel_frase?: string | null;
  ficha?: FichaIa | null;
  /** De onde veio a ficha (lead_ia_registrar_cliente): o XML guardado só tem imóveis de VENDA. */
  imovel_fonte?: "xml" | "captacao" | null;
};

export type RespostaIa = {
  passo: Passo;
  dados: DadosQualificacao;
  /** Texto ao cliente. Na passagem ao humano traz {corretor}, que o banco troca por quem retorna. */
  resposta: string;
  /** Texto usado pelo banco se o registro/aviso da passagem NÃO foi gravado (nunca afirma o envio). */
  resposta_falha: string | null;
  fim: FimConversa | null;
  resumo: string | null;
};

/** Ajuda opcional de um modelo de linguagem para entender a resposta. Sem modelo = só regras. */
export type Extrator = (
  passo: Passo,
  texto: string,
) => Promise<Partial<DadosQualificacao> | null | undefined>;

/** Imóvel achado pelo código: no XML (xml_codigo, sem captação) ou na captação (capture_id). */
export type ImovelEncontrado = {
  capture_id: string | null;
  xml_codigo?: string | null;
  frase: string | null;
  ficha: FichaIa | null;
};

/** Imóvel parecido vindo do XML da própria imobiliária (lead_ia_imoveis_parecidos). Só dados do XML. */
export type ImovelParecido = Pick<FichaIa, "tipo" | "bairro" | "cidade" | "quartos" | "suites" | "vagas" | "area_util_m2" | "area_terreno_m2"> & {
  codigo: string;
  /** Preço anunciado no XML, já formatado ("R$ 640.000"). */
  preco?: string;
  /** Aluguel mensal anunciado (parecido de locação, t_25fe1197). */
  aluguel?: string;
  /** Link do anúncio, só se o XML guardou um link https. */
  url?: string;
  mesmo_condominio?: boolean;
  mesmo_bairro?: boolean;
};
export type NegocioParecido = "venda" | "locacao";
export type FiltroParecido = {
  /** Códigos que não podem voltar (já oferecidos). */
  excluir: string[];
  preco_min?: number | null;
  preco_max?: number | null;
  bairro?: string | null;
  negocio: NegocioParecido;
  limite?: number;
  /** Cliente pediu algo mais barato: só abaixo do preço do pedido. */
  mais_barato?: boolean;
  /** Código do imóvel pedido quando ainda não foi gravado na conversa (código informado neste turno). */
  codigo_ref?: string | null;
};
/** O banco devolve também o que sabe do imóvel PEDIDO, para a regra "o pedido não serve". */
export type ResultadoParecidos = {
  referencia: { codigo?: string; no_xml?: boolean; saiu?: boolean; tipo?: string; bairro?: string; cidade?: string; preco?: number };
  itens: ImovelParecido[];
};

export type OpcoesRoteiro = {
  /** Relógio (testes). */
  agora?: Date;
  /** Procura a captação pelo código que o cliente informou (servidor: lead_ia_imovel_por_codigo). */
  buscarImovel?: (codigo: string) => Promise<ImovelEncontrado | null>;
  /** Procura imóvel parecido no XML da própria imobiliária (servidor: lead_ia_imoveis_parecidos).
   * Sem esta função a Nicole não oferece parecido (comportamento de antes). */
  buscarParecidos?: (filtro: FiltroParecido) => Promise<ResultadoParecidos | null>;
};

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Igual à função lead_ia_e_optout do banco (o banco é quem decide; aqui é só para testes/tela). */
export function ehOptOut(t: string): boolean {
  const n = norm(t);
  return (
    /^\s*(quero |pode )?(sair|parar|pare|stop|cancelar|descadastrar|remover)[\s,.!]*(por favor|pf|pfv|obrigad[oa])?[\s.!]*$/.test(n) ||
    /(nao (quero|desejo) (mais )?(receber|mensage)|nao me (mande|envie|chame|procure)|(para|parar|pare) de (me )?(mandar|enviar)|remov(a|e|er) (o )?meu (numero|contato|telefone)|(me )?(tira|tire|remove|remova) (da|dessa|desta|de sua|da sua) lista|descadastr)/.test(
      n,
    )
  );
}

/** Reclamação, jurídico ou dinheiro (transferência, cobrança, reembolso): vai direto para pessoa. */
export function ehSensivel(t: string): boolean {
  return /(reclama|process(o|ar)|advogad|justica|juridic|procon|golpe|fraude|denunci|absurd|pessimo|desrespeit|reembols|dinheiro de volta|devolv\w* (o |meu )?dinheiro|estorno|cobranc|me cobr|pix|transferencia|deposit|boleto|paguei|sinal de|calote|enganad)/.test(
    norm(t),
  );
}

/** Cliente pede uma pessoa. */
export function pediuPessoa(t: string): boolean {
  return /(falar com (um |uma |o |a )?(corretor|corretora|atendente|humano|pessoa|alguem|gerente|responsavel)|quero (um |uma |falar com )?(pessoa|humano|atendente|corretor)|atendimento humano|me (liga|ligue|ligar)|ligue pra mim|liga pra mim)/.test(
    norm(t),
  );
}

/**
 * Cliente pergunta se está falando com robô/IA (t_25fe1197). A Nicole NÃO mente: confirma que é uma
 * assistente virtual e oferece passar para um corretor. \"ia\" sozinho não conta (\"eu ia visitar\").
 */
export function perguntouSeRobo(t: string): boolean {
  const n = norm(t);
  // Precisa ser pergunta sobre QUEM responde: "robô aspirador", "e ia ver" e "o proprietário é humano?" não contam.
  if (!ehPergunta(t) || /robo (aspirador|de (limpeza|cozinha|piscina))/.test(n)) return false;
  return ROBO_RE.test(n);
}
const QUEM_ROBO = "(^|voce |vc |isso |aqui |ta |esta |estou |to )";
const ROBO_RE = new RegExp(
  `(\\b(falando|conversando) com (uma |um )?(robo|bot|ia|maquina|inteligencia artificial)\\b` +
    `|${QUEM_ROBO}(e |eh |sou |seria )?(uma |um )?(robo|bot|chatbot|inteligencia artificial)\\b` +
    // "ia" só como "uma ia" ou "é ia?" no fim: "e ia ver amanhã?" não conta.
    `|${QUEM_ROBO}(e |eh |seria )?uma ia\\b|${QUEM_ROBO}(e |eh )?ia\\s*\\?` +
    `|${QUEM_ROBO}(e |eh )?(uma )?(resposta|mensagem) automatica` +
    `|${QUEM_ROBO}(e |eh )(um |uma )?(humano|humana|pessoa (de verdade|real)|gente de verdade))`,
);

/** Cliente fala em permuta (dar um bem como parte do pagamento). \"trocar o dia\" não conta. */
const BENS = "(carro|imovel|apartamento|apto|casa|terreno|moto|lote|sobrado|chacara)";
const FALA_PERMUTA_RE = new RegExp(
  `(permut|\\baceita(m)? troca|\\btroca(r)? (por|pelo|pela|com) (o |a )?(meu|minha) ${BENS}|(dar|dou|dando|aceita|aceitam|entrar com|entro com) (o |a )?(meu |minha )?${BENS}\\b)`,
);
/** Fala em permuta, sem negação ("sem permuta", "não tenho imóvel para permuta" não contam). Revisão t_e520a9bb. */
export function falaPermuta(n: string): boolean {
  if (!FALA_PERMUTA_RE.test(n)) return false;
  return !/(\bsem\b|\bnao\b|\bnada de\b|\bnenhum)( \S+){0,4} (permut|troca)/.test(n);
}

/** Pergunta sobre preço/condição/disponibilidade/característica (detector usado também pela tela). */
export function perguntaComercial(t: string): boolean {
  return /(qual (o |e o )?(valor|preco)|quanto (custa|e|fica|esta)|preco|valor do|condo(minio)?|iptu|aceita (permuta|proposta|financiamento|fgts|carro)|desconto|negocia|(esta|ta|continua) disponivel|ainda (esta|ta) (a venda|disponivel)|metragem|quantos (quartos|m2|metros)|vaga)/.test(
    norm(t),
  );
}

/**
 * Quem NÃO é comprador nem locatário (item 8): proprietário oferecendo imóvel, parceiro (corretor/imobiliária),
 * fornecedor ou assunto pessoal. null = trata como lead. Permuta (\"dou meu apê como parte\") é lead.
 */
export function categoriaNaoLead(t: string): DadosQualificacao["categoria"] | null {
  const n = norm(t);
  if (/(permut|troca|como (parte|entrada)|de entrada|(para|pra) (comprar|dar entrada|pegar)|quero (comprar|alugar) (esse|este|essa|esta|o |a ))/.test(n))
    return null;
  if (
    /((quero|gostaria de|preciso|desejo|queria) (vender|alugar|anunciar|colocar (a venda|para alugar|pra alugar)) (o |a )?(meu|minha)|tenho (um|uma) (imovel|casa|apartamento|apto|terreno|sala|lote|chacara|sobrado)[^.?!]{0,40}(para|pra) (vender|alugar|venda|locacao|anunciar)|sou (o |a )?(proprietari|dono |dona )|quero anunciar|anunciar (o |a )?(meu|minha)|avaliar (o |a )?(meu|minha))/.test(
      n,
    )
  )
    return "proprietario";
  if (/((sou|somos) (corretor|corretora|da imobiliaria|uma imobiliaria|imobiliaria|parceir)|parceria|\bcreci\b|tenho (um |uma )?cliente (para|pra|interessad)|meu cliente|minha cliente)/.test(n))
    return "parceiro";
  if (/((ofereco|oferecemos|prestamos|presto|vendemos) (servic|solucoes|solucao|produto)|sou (fornecedor|representante)|(trabalho|trabalhamos) com (marketing|fotografia|seguro|reforma|limpeza|trafego|anuncio)|proposta comercial|divulgar (meu|nosso) (servico|produto))/.test(n))
    return "fornecedor";
  if (/(assunto pessoal|e pessoal|particular|sou (amigo|amiga|parente|familiar|filho|filha|esposa|marido|mae|pai) d|vaga de emprego|curriculo|trabalhar (ai|com voces))/.test(n))
    return "pessoal";
  return null;
}

const SEM_INTERESSE =
  /^(nao|n|nao obrigad\w*|sem interesse|nao tenho (mais )?interesse|ja (comprei|aluguei|resolvi|fechei)|nao procuro mais|desisti)\b/;
/** Recusa clara em qualquer passo (para o roteiro e o reengajamento). */
const RECUSA =
  /(nao tenho (mais )?interesse(?! (em|no|na|nesse|nessa) )|sem interesse|ja (comprei|aluguei|resolvi|fechei)|nao procuro mais|desisti|nao quero mais(?! (receber|mensage))|perdi o interesse)/;
const SIM = /^(sim|s|tenho|claro|isso|quero|ok|pode|com certeza|tenho sim|sim tenho|ainda tenho|opa|oi|ola|bom dia|boa tarde|boa noite|gostaria|quero sim|pode ser)\b/;
const QUER_VISITA = /(visit|conhecer|agendar|marcar|ver (o |a )?(imovel|casa|ap|apartamento|terreno)|ver pessoalmente|ir ver|dar uma olhada)/;

export const PERGUNTA: Record<Pergunta, string> = {
  finalidade: "Você procura para comprar ou para alugar?",
  faixa: "Para eu já separar o que combina com você: qual faixa de valor você tem em mente?",
  // t_59ab47d4: sem "permuta" nas opções sugeridas (não dar a entender que o imóvel aceita).
  pagamento: "E a forma de pagamento seria à vista ou com financiamento?",
};

const NAO_SEI = "não tenho esse dado confirmado, vou confirmar com o corretor";
/** Resposta fixa sobre disponibilidade (t_76243950): a IA nunca garante que o imóvel está disponível. */
export const CONFIRMO_DISPONIBILIDADE = "confirmo a disponibilidade com o corretor";
/** Texto de quem retorna: o banco troca {corretor} só depois de gravar registro e aviso. */
export const CORRETOR = "{corretor}";

const curto = (t: string, n = 80) => t.replace(/\s+/g, " ").trim().slice(0, n);
const juntar = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
const maiuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// --- Extração das respostas de qualificação (só regras; o modelo é plano B) ---------------------------

function finalidadeDe(n: string): "comprar" | "alugar" | null {
  const c = /(compr|adquirir|investir)/.test(n);
  const a = /(alug|locar|locacao|arrend)/.test(n);
  if (c && !a) return "comprar";
  if (a && !c) return "alugar";
  return null;
}
function pagamentoDe(n: string): string[] | null {
  const p: string[] = [];
  if (/(a vista|avista|dinheiro|recurso proprio)/.test(n)) p.push("à vista");
  if (/financ/.test(n)) p.push("financiamento");
  if (falaPermuta(n)) p.push("permuta");
  if (/fgts/.test(n)) p.push("FGTS");
  if (/consorcio/.test(n)) p.push("consórcio");
  return p.length ? p : null;
}
/**
 * Valor dito pelo cliente: guarda como ele disse (curto), nunca interpreta. `numeroSolto` (só quando a
 * pergunta da faixa foi feita): "120000" sozinho também vale (t_59ab47d4: "120000 aceita financiamento ?").
 */
function faixaDe(texto: string, n: string, numeroSolto = false): string | null {
  if (/\bcep\b/.test(n)) return null;
  if (/(\d[\d.,]*\s*(mil|milhao|milhoes|mi\b|k\b|reais)|r\$\s*\d|\bate \d|\d{3}\.\d{3})/.test(n)) return curto(texto);
  // Número solto: 5 a 7 dígitos (10 mil a 9,9 milhões). Fora: CEP (8 dígitos), telefone (com hífen ou 8+
  // dígitos), código com letra e "50000 de entrada" (entrada não é a faixa). Revisão t_e520a9bb.
  if (!numeroSolto || /entrada/.test(n)) return null;
  return /(^|[^\w.,-])\d{5,7}(?![\w.,-])/.test(n) ? curto(texto) : null;
}

/** "R$ 1.200.000" (inteiro, separador de milhar). */
export const reais = (v: number) => `R$ ${Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/**
 * Faixa muito longe do valor anunciado (mais que o dobro ou menos da metade)? Devolve o valor do cliente
 * para a Nicole confirmar com naturalidade; null = perto o bastante (ou sem dado para comparar).
 */
export function faixaLonge(faixa: string | undefined, precoAnunciado: number | undefined): number | null {
  if (!faixa || !precoAnunciado || precoAnunciado <= 0) return null;
  const v = valorFaixa(faixa);
  if (!v) return null;
  const rep = v.min != null && v.max != null ? Math.round((v.min + v.max) / 2) : (v.max ?? v.min ?? null);
  if (rep == null) return null;
  return rep > precoAnunciado * 2 || rep < precoAnunciado / 2 ? rep : null;
}

/** Entende a resposta de cada passo só por regras. null = não entendeu. */
export function extrairPorRegras(passo: Passo, texto: string): Partial<DadosQualificacao> | null {
  const n = norm(texto);
  switch (passo) {
    case "finalidade": {
      const f = finalidadeDe(n);
      return f ? { finalidade: f } : null;
    }
    case "pagamento": {
      const p = pagamentoDe(n);
      return p ? { pagamento: p } : null;
    }
    case "faixa":
      return n.length >= 2 ? { faixa: curto(texto) } : null;
    case "prazo":
    case "regiao":
      return n.length >= 2 ? { [passo]: curto(texto) } : null;
    case "proximo_passo":
      if (/visit/.test(n)) return { proximo_passo: "visita" };
      if (/(contato|liga|whats|mensage|conversar|corretor|tanto faz|pode ser)/.test(n)) return { proximo_passo: "contato" };
      return null;
    default:
      return null;
  }
}

/** Só aceita do extrator (modelo) o campo do passo, em formato seguro. */
function sanitizar(passo: Passo, d: Partial<DadosQualificacao>): Partial<DadosQualificacao> {
  switch (passo) {
    case "finalidade":
      return d.finalidade === "comprar" || d.finalidade === "alugar" ? { finalidade: d.finalidade } : {};
    case "pagamento":
      return Array.isArray(d.pagamento)
        ? { pagamento: d.pagamento.filter((x) => typeof x === "string").slice(0, 4).map((x) => curto(x, 30)) }
        : {};
    case "faixa":
      return typeof d.faixa === "string" && d.faixa.trim() ? { faixa: curto(d.faixa) } : {};
    default:
      return {};
  }
}

// --- Dúvidas sobre o imóvel (item 3) ---------------------------------------------------------------

export const TEMAS = [
  "preco",
  "disponibilidade",
  "condominio",
  "iptu",
  "permuta",
  "financiamento",
  "andar",
  "quartos",
  "banheiros",
  "vagas",
  "area",
  "localizacao",
] as const;
export type Tema = (typeof TEMAS)[number];

const TEMA_RE: Record<Tema, RegExp> = {
  preco: /(valor|preco|quanto (custa|e|fica|esta|sai)|desconto|negoci|proposta|aceita oferta|condicoes|condicao de pagamento)/,
  disponibilidade: /((esta|ta|continua|segue) disponivel|ainda (esta|ta|tem|existe|e) (a venda|disponivel|para alugar|pra alugar)?|ja (foi )?(vendid|alugad)|disponibilidade|ainda (a venda|para alugar)|ainda esta a venda)/,
  condominio: /(condominio|condo\b|taxa condominial)/,
  iptu: /\biptu\b/,
  permuta: /(permut|aceita(m)? troca|aceita (carro|imovel|terreno|apartamento|casa|moto)|(carro|imovel|moto) como (parte|entrada))/,
  financiamento: /(financ|fgts|aceita banco|minha casa minha vida|\bmcmv\b)/,
  andar: /(\bandar\b|posicao|sol da (manha|tarde)|\bface\b|nascente|poente|elevador|vista (para|pro|pra))/,
  quartos: /(quarto|dormitorio|\bdorms?\b|suite)/,
  banheiros: /(banheiro|lavabo)/,
  vagas: /(\bvagas?\b|garagem)/,
  area: /(metragem|\bm2\b|m²|metros|tamanho|area (util|construida|total|do terreno|privativa))/,
  localizacao: /(onde fica|endereco|localiza|qual (o )?bairro|qual (a )?rua|que bairro|perto de)/,
};

/** A fala é uma pergunta/pedido de informação (e não uma afirmação como \"vou financiar\")? */
export function ehPergunta(texto: string): boolean {
  const n = norm(texto);
  return (
    /\?/.test(texto) ||
    /^(e |e o |e a )?(aceita|tem|qual|quais|quanto|quantos|quantas|onde|pode|da pra|ainda|esta|ta |como|fica|possui|gostaria de saber|queria saber|quero saber|me (passa|fala|diz|informa|manda))/.test(n) ||
    /(quero|gostaria de|queria) (saber|mais informac|informac)/.test(n)
  );
}

/** Temas perguntados pelo cliente (só quando a fala é pergunta). */
export function detectarTemas(texto: string): Tema[] {
  if (!ehPergunta(texto)) return [];
  const n = norm(texto);
  return TEMAS.filter((t) => TEMA_RE[t].test(n));
}

const ROTULO: Record<Tema, string> = {
  preco: "valor",
  disponibilidade: "disponibilidade",
  condominio: "condomínio",
  iptu: "IPTU",
  permuta: "permuta",
  financiamento: "financiamento",
  andar: "andar/posição",
  quartos: "quartos",
  banheiros: "banheiros",
  vagas: "vagas",
  area: "metragem",
  localizacao: "localização",
};

const plural = (n: string, um: string, varios: string) => `${n} ${n === "1" ? um : varios}`;

/** Resposta de UM tema só com o que está na ficha. null = a ficha não tem o dado. */
function respostaTema(t: Tema, f: FichaIa | null | undefined): string | null {
  if (!f) return null;
  switch (t) {
    case "quartos":
      if (!f.quartos) return null;
      return `tem ${plural(f.quartos, "quarto", "quartos")}${f.suites && f.suites !== "0" ? ` (${plural(f.suites, "suíte", "suítes")})` : ""}`;
    case "banheiros":
      return f.banheiros ? `tem ${plural(f.banheiros, "banheiro", "banheiros")}` : null;
    case "vagas":
      return f.vagas ? (f.vagas === "0" ? "não tem vaga de garagem" : `tem ${plural(f.vagas, "vaga", "vagas")} de garagem`) : null;
    case "area":
      if (f.area_util_m2) return `tem ${f.area_util_m2} m² de área útil`;
      if (f.area_construida_m2) return `tem ${f.area_construida_m2} m² de área construída`;
      if (f.area_terreno_m2) return `tem ${f.area_terreno_m2} m² de terreno`;
      return null;
    case "localizacao":
      return f.bairro ? `fica no bairro ${f.bairro}${f.cidade ? `, em ${f.cidade}` : ""} (o endereço exato o corretor passa na visita)` : null;
    case "condominio":
      return f.condominio ? `o condomínio é de ${f.condominio}` : null;
    case "iptu":
      return f.iptu ? `o IPTU é de ${f.iptu}` : null;
    case "permuta":
      return typeof f.aceita_permuta === "boolean" ? (f.aceita_permuta ? "aceita permuta (o corretor avalia o imóvel oferecido)" : "não aceita permuta") : null;
    case "financiamento":
      return typeof f.aceita_financiamento === "boolean" ? (f.aceita_financiamento ? "aceita financiamento" : "não aceita financiamento") : null;
    case "andar":
      return f.andar ? `fica no ${f.andar}` : null;
    case "disponibilidade":
      return null; // nunca garante: tratado em responderDuvidas ("confirmo a disponibilidade com o corretor")
    case "preco":
      // t_25fe1197: o valor ANUNCIADO no XML é dito (venda e/ou aluguel). Negociação/desconto: corretor.
      return valorAnunciado(f);
  }
}

/** "está anunciado por R$ 430.000" / "o aluguel anunciado é de R$ 2.500 por mês". null = XML sem valor. */
export function valorAnunciado(f: FichaIa | null | undefined, finalidade?: string): string | null {
  if (!f) return null;
  const venda = f.negocio !== "locacao" && f.preco ? `está anunciado por ${f.preco}` : null;
  const alug = f.aluguel ? `o aluguel anunciado é de ${f.aluguel} por mês` : null;
  if (finalidade === "alugar") return alug ?? venda;
  if (finalidade === "comprar") return venda ?? alug;
  return venda && alug ? `${venda}, e ${alug}` : (venda ?? alug);
}

/** Responde as dúvidas do cliente (no máximo uma frase de \"sei\" e uma de \"não sei\"). */
export function responderDuvidas(
  temas: Tema[],
  ficha: FichaIa | null | undefined,
  dados: DadosQualificacao,
): string {
  if (!temas.length) return "";
  const sei: string[] = [];
  const naoSei: Tema[] = [];
  for (const t of temas) {
    const r = respostaTema(t, ficha);
    if (r) sei.push(r);
    else naoSei.push(t);
  }
  const partes: string[] = [];
  if (sei.length) partes.push(`${maiuscula(juntar(sei))}.`);
  // Valor anunciado dito: proposta e negociação continuam com o corretor (t_25fe1197).
  if (temas.includes("preco") && !naoSei.includes("preco")) partes.push("Proposta e negociação, quem conversa com você é o corretor.");
  const semPreco = naoSei.filter((t) => t !== "preco" && t !== "disponibilidade");
  if (naoSei.includes("preco"))
    partes.push("O valor e as condições de negociação quem confirma é o corretor, para não te passar nada desatualizado.");
  // Disponibilidade: nunca garante (nem pelo XML, que pode estar até 1 h atrasado).
  if (naoSei.includes("disponibilidade")) partes.push(`${maiuscula(CONFIRMO_DISPONIBILIDADE)}.`);
  if (semPreco.length) partes.push(`Sobre ${juntar(semPreco.map((t) => ROTULO[t]))}, ${NAO_SEI}.`);
  dados.pendentes = [...new Set([...(dados.pendentes ?? []), ...naoSei.map((t) => ROTULO[t])])].slice(0, 12);
  return partes.join(" ");
}

/** \"É um apartamento de 3 quartos (1 suíte), 2 vagas e 80 m² de área útil, no bairro Campolim.\" */
export function resumoFicha(f: FichaIa | null | undefined): string {
  if (!f) return "";
  const caract = [
    f.quartos ? `${plural(f.quartos, "quarto", "quartos")}${f.suites && f.suites !== "0" ? ` (${plural(f.suites, "suíte", "suítes")})` : ""}` : null,
    f.vagas && f.vagas !== "0" ? plural(f.vagas, "vaga", "vagas") : null,
    f.area_util_m2 ? `${f.area_util_m2} m² de área útil` : f.area_terreno_m2 && f.tipo === "terreno" ? `${f.area_terreno_m2} m²` : null,
  ].filter(Boolean) as string[];
  if (!f.tipo && !caract.length) return "";
  const tipo = f.tipo ?? "imóvel";
  const art = tipo === "casa" || tipo === "cobertura" ? "uma" : "um";
  return `É ${art} ${tipo}${caract.length ? ` com ${juntar(caract)}` : ""}${f.bairro ? `, no bairro ${f.bairro}` : ""}.`;
}

// --- Visita (item 4) -------------------------------------------------------------------------------

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
// shortcut: horário de Brasília fixo em UTC-3 (sem horário de verão desde 2019).
const sp = (d: Date) => new Date(d.getTime() - 3 * 3600_000);
const ddmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const proximoDiaUtil = (d: Date) => {
  const x = new Date(d.getTime() + 86400_000);
  return x.getUTCDay() === 0 ? new Date(x.getTime() + 86400_000) : x;
};

/** 2 opções de dia e período (segunda a sábado), a partir de amanhã. */
export function opcoesVisita(agora: Date): string[] {
  const hoje = sp(agora);
  const d1 = proximoDiaUtil(hoje);
  const d2 = proximoDiaUtil(d1);
  const amanha = d1.getUTCDate() === new Date(hoje.getTime() + 86400_000).getUTCDate();
  return [
    `${amanha ? "amanhã" : DIAS[d1.getUTCDay()]} (${amanha ? `${DIAS[d1.getUTCDay()]}, ` : ""}${ddmm(d1)}) de manhã`,
    `${DIAS[d2.getUTCDay()]} (${ddmm(d2)}) à tarde`,
  ];
}

/** Até quando o corretor confirma o pré-agendamento. */
export function prazoConfirmacao(agora: Date): string {
  const h = sp(agora);
  if (h.getUTCDay() !== 0 && h.getUTCHours() < 16) return "até as 18h de hoje";
  const d = proximoDiaUtil(h);
  const amanha = d.getUTCDate() === new Date(h.getTime() + 86400_000).getUTCDate();
  return `até as 12h de ${amanha ? "amanhã" : DIAS[d.getUTCDay()]}`;
}

const DIAS_N = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function escolhaVisita(texto: string, opcoes: string[]): string | null {
  const n = norm(texto);
  if (/^(a )?(1|primeira|opcao 1)\b/.test(n) || /\b(a primeira|opcao 1)\b/.test(n)) return opcoes[0] ?? null;
  if (/^(a )?(2|segunda opcao|opcao 2)\b/.test(n) || /\b(a segunda|opcao 2)\b/.test(n)) return opcoes[1] ?? null;
  const dias = DIAS_N.filter((d) => n.includes(d));
  const amanha = /\bamanha\b/.test(n);
  const achou = opcoes.filter((o) => {
    const on = norm(o);
    const data = on.match(/\d{2}\/\d{2}/)?.[0];
    if (data && n.includes(data)) return true;
    // Citou um dia: só vale se for o dia de uma das opções (\"quinta à tarde\" não vira \"quarta à tarde\").
    if (dias.length || amanha) return dias.some((d) => on.includes(d)) || (amanha && on.startsWith("amanha"));
    if (/manha/.test(n) && !/tarde/.test(n)) return on.includes("manha");
    if (/tarde/.test(n) && !/manha/.test(n)) return on.includes("tarde");
    return false;
  });
  return achou.length === 1 ? achou[0] : null;
}
const PREFERE_CORRETOR = /(prefiro (falar|conversar|o corretor|que o corretor)|so (o )?corretor|corretor (me )?(chama|liga|fala)|nao (precisa|quero visitar|quero visita)|agora nao|mais pra frente|depois eu vejo)/;
const OUTRO_DIA = /(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|hoje|semana que vem|fim de semana|final de semana|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|manha|tarde|noite)/;

// --- Resumo e passagem -------------------------------------------------------------------------------

/** Resumo para o sino do corretor (sem telefone/e-mail; o banco ainda mascara). */
export function resumoQualificacao(d: DadosQualificacao, ctx?: Pick<ContextoIa, "anuncio_codigo" | "imovel_frase">): string {
  const partes = [
    ctx?.imovel_frase ? `Imóvel: ${ctx.imovel_frase}` : null,
    ctx?.anuncio_codigo ? `anúncio ${ctx.anuncio_codigo}` : d.anuncio_informado ? `código informado pelo cliente: ${d.anuncio_informado}` : null,
    d.finalidade ? `Quer ${d.finalidade}` : null,
    d.faixa ? `faixa: ${d.faixa}` : null,
    d.pagamento?.length ? `pagamento: ${d.pagamento.join(", ")}` : null,
    d.prazo ? `prazo: ${d.prazo}` : null,
    d.regiao ? `região: ${d.regiao}` : null,
    d.visita ? `PRÉ-AGENDAMENTO: ${d.visita} (confirmar com o cliente ${d.visita_ate ?? ""})`.replace(/ \)$/, ")") : null,
    d.pendentes?.length ? `confirmar com o cliente: ${d.pendentes.join(", ")}` : null,
    d.alternativa ? `quer detalhes de ${d.alternativa}` : null,
    d.parecido_interesse ? `INTERESSE NO IMÓVEL PARECIDO código ${d.parecido_interesse} (oferecido pela IA a partir do XML; confirmar disponibilidade)` : null,
    d.parecidos?.length ? `parecidos oferecidos pela IA: ${d.parecidos.join(", ")}` : null,
  ].filter(Boolean);
  return partes.length ? `${partes.join("; ")}.` : "Sem dados de qualificação.";
}

function fim(
  dados: DadosQualificacao,
  motivo: FimConversa,
  resposta: string,
  resposta_falha: string | null,
  resumo: string,
): RespostaIa {
  return { passo: "fim", dados, resposta, resposta_falha, fim: motivo, resumo: resumo.slice(0, 1000) };
}

/** Passagem ao corretor com \"encaminhei\" verificável (o banco escolhe entre os dois textos). */
function passar(
  dados: DadosQualificacao,
  motivo: FimConversa,
  inicio: string,
  fimOk: string,
  fimFalha: string,
  resumo: string,
): RespostaIa {
  const i = inicio ? `${inicio} ` : "";
  return fim(dados, motivo, `${i}${fimOk}`, `${i}${fimFalha}`, resumo);
}

const FALHA_PADRAO = "Registrei aqui e estou confirmando o encaminhamento para o corretor. Já te retorno por aqui.";

// --- Imóvel parecido do XML (t_232e13cb, regra tirada das conversas da Laís) ------------------------------
// Quando: (a) depois da qualificação, PERGUNTA antes se o cliente quer ver uma opção parecida (só se existir);
// (b) o pedido não serve (venda x locação, acima da faixa, fora do bairro desejado, saiu do XML);
// (c) o cliente pede outras opções. Parecido = mesma imobiliária, mesmo negócio, tipo e cidade, preferência
// pelo mesmo condomínio/bairro, preço na faixa do cliente ou ±15% (o banco decide: lead_ia_imoveis_parecidos).
// 1 por vez, até 3 por conversa, nunca repete. Texto só com dados do XML; disponibilidade, permuta,
// financiamento e andar ficam com o corretor. Sem parecido: diz com franqueza e passa ao corretor.

export const MAX_PARECIDOS = 3;
export const PERGUNTA_PARECIDO = "Antes de falarmos da visita: quer que eu te mostre também uma opção parecida com esse imóvel?";

/** Cliente pede outras opções ("tem outras?", "algo parecido", "mais barato"). */
export function pedeOutrasOpcoes(texto: string): boolean {
  return /(outr[ao]s? (opc|imove|casa|apartament|ap\b|apto|alternativ|sugest|unidade|parecid)|outra opcao|mais (opcoes|opcao|imoveis|alguma opcao|algum imovel|sugest)|^(e )?(tem|teria|tens|voce tem|vc tem) (outr[ao]s?|mais)\s*\??$|(algo|algum|alguma|outro|outra|imovel|opcao|casa|apartamento) (parecid|similar|semelhant)|mais (barat|em conta)|alternativa)/.test(
    norm(texto),
  );
}
const NAO_QUER_MAIS = /nao (quero|precisa|preciso|vou querer)( ver)? (outr|mais)/;
/** Diante de um parecido já mostrado, qualquer "outra/mais uma/próxima" pede o próximo. */
const MAIS_UM = /\b(outr[ao]s?|mais uma|mais um|proxim[ao]|seguinte)\b/;
const GOSTOU = /(gostei|me interess|tenho interesse|interessei|quero (esse|essa|este|esta|saber mais|mais detalhes|detalhes|ver (esse|essa|este|esta))|pode (passar|pedir|mandar|ser)|esse (mesmo|ai)|essa (mesma|ai)|manda (mais|os detalhes)|perfeito|gostaria)/;
const NAO_GOSTOU = /^(nao|n|nao obrigad\w*|nao gostei|nao curti|nao me interess\w*|nao (e|eh) (bem )?isso|nenhum|nenhuma)\b/;
/** "Sim" para a oferta/pergunta do parecido (sem cumprimentos, que no SIM geral contam como interesse). */
const SIM_P = /^(sim|s|claro|quero|ok|pode|com certeza|quero sim|pode ser|gostaria|isso|opa|manda|mostra)\b/;
const MAIS_BARATO = /(mais (barat|em conta|acessivel)|menor (valor|preco)|mais em conta)/;

/**
 * Faixa de valor dita pelo cliente, em reais: "até 500 mil" -> {max}; "entre 400 e 600 mil" -> {min,max};
 * "a partir de 1 milhão" -> {min}; "uns 500 mil" -> ±15%. null = não deu para entender (não chuta).
 */
export function valorFaixa(texto: string): { min?: number; max?: number } | null {
  const n = norm(texto).replace(/r\$\s*/g, "");
  const UN = "(milhoes|milhao|mi\\b|mil\\b|k\\b)";
  const mult = (u?: string) => (!u ? 1 : u.startsWith("mi") && u !== "mil" ? 1e6 : 1e3);
  const num = (s: string) => {
    const t = /^\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, "") : /^\d{1,3}(\.\d{3})+,\d+$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  };
  const ok = (v: number) => Number.isFinite(v) && v >= 1000 && v < 1e11;
  const r = new RegExp(`(\\d[\\d.,]*)\\s*${UN}?\\s*(?:a|e|ate|-)\\s*(\\d[\\d.,]*)\\s*${UN}?`).exec(n);
  if (r) {
    const u2 = r[4];
    const a = num(r[1]) * mult(r[2] ?? u2);
    const b = num(r[3]) * mult(u2);
    if (ok(a) && ok(b)) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  for (const m of n.matchAll(new RegExp(`(\\d[\\d.,]*)\\s*${UN}?`, "g"))) {
    const v = num(m[1]) * mult(m[2]);
    if (!ok(v) || (!m[2] && v < 10_000)) continue; // "3 quartos", "2 vagas": não é valor
    const antes = n.slice(0, m.index);
    if (/(ate|no maximo|maximo de|teto|limite|nao passar de|abaixo de|menos de)\s*(uns |umas |de )?$/.test(antes)) return { max: v };
    if (/(a partir de|acima de|minimo de|pelo menos|mais de)\s*(uns |umas )?$/.test(antes)) return { min: v };
    return { min: Math.round(v * 0.85), max: Math.round(v * 1.15) };
  }
  return null;
}

/** "prefiro no bairro Campolim", "queria em condomínio X" -> "campolim" (normalizado, curto). */
export function bairroDesejado(texto: string): string | null {
  const n = norm(texto);
  if (!/(prefir|preferencia|queria|quero|procuro|busco|gostaria|precisa ser|tem que ser|teria)/.test(n)) return null;
  const m = /\b(?:no|na|em|do|da|pelo|pela)\s+(?:bairro|regiao|condominio)\s+(?:d[oa]s?\s+)?([a-z0-9][a-z0-9 ]{2,38}?)(?=\s*(?:[,.!?;]|$|\se\s|\sou\s|\smas\s|\sporque\s|\spor\s))/.exec(n);
  return m ? m[1].trim().slice(0, 40) : null;
}

/** Ficha (só o que o XML trouxe) do parecido, para descrever e responder dúvidas sobre ele. */
const fichaDoParecido = (p: ImovelParecido): FichaIa => ({
  tipo: p.tipo,
  bairro: p.bairro,
  cidade: p.cidade,
  quartos: p.quartos,
  suites: p.suites,
  vagas: p.vagas,
  area_util_m2: p.area_util_m2,
  area_terreno_m2: p.area_terreno_m2,
});

/** Texto da oferta: só dados do XML. Nunca fala de disponibilidade, permuta, financiamento ou andar. */
export function textoParecido(p: ImovelParecido, jaMostrados: number): string {
  const r = resumoFicha(fichaDoParecido(p));
  const desc = r ? r.replace(/^É /, "é ").replace(/\.$/, "") : "é um imóvel";
  const onde = p.mesmo_condominio ? ", no mesmo condomínio" : "";
  const preco = p.aluguel ? ` O aluguel anunciado é de ${p.aluguel} por mês.` : p.preco ? ` Está anunciado por ${p.preco}.` : "";
  const link = p.url ? ` Anúncio: ${p.url}` : "";
  const fim =
    jaMostrados < MAX_PARECIDOS
      ? "Quer que eu peça ao corretor os detalhes desse imóvel, ou prefere ver outra opção?"
      : "Quer que eu peça ao corretor os detalhes desse imóvel?";
  return `Tenho uma opção parecida (código ${p.codigo}): ${desc}${onde}.${preco}${link} ${fim}`.replace(/\s+/g, " ").trim();
}

/** Argumentos da RPC lead_ia_imoveis_parecidos (mesma chamada na tela de teste e no WhatsApp). */
export function argsParecidos(conversaId: string, f: FiltroParecido) {
  const valor = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e11 ? Math.round(v) : null);
  return {
    _conversa: conversaId,
    _excluir: (f.excluir ?? []).filter((c) => typeof c === "string" && c.trim()).slice(0, 20).map((c) => c.trim().slice(0, 60)),
    _preco_min: valor(f.preco_min),
    _preco_max: valor(f.preco_max),
    _bairro: f.bairro ? f.bairro.slice(0, 60) : null,
    _negocio: f.negocio === "locacao" ? "locacao" : "venda",
    _limite: Math.min(Math.max(Math.trunc(f.limite ?? 1), 1), MAX_PARECIDOS),
    _mais_barato: f.mais_barato === true,
    _codigo: f.codigo_ref ? f.codigo_ref.trim().slice(0, 60) || null : null,
  };
}

/** Só aceita do banco as chaves conhecidas, como texto curto (nada inesperado chega ao cliente). */
export function normalizarParecidos(data: unknown): ResultadoParecidos | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { referencia?: Record<string, unknown>; itens?: unknown };
  const txt = (v: unknown, n = 60) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const ref = d.referencia && typeof d.referencia === "object" ? d.referencia : {};
  const itens = (Array.isArray(d.itens) ? d.itens : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object" && typeof (i as { codigo?: unknown }).codigo === "string")
    .slice(0, MAX_PARECIDOS)
    .map((i) => {
      const url = txt(i.url, 300);
      return {
        codigo: (i.codigo as string).trim().slice(0, 60),
        tipo: txt(i.tipo, 30),
        bairro: txt(i.bairro),
        cidade: txt(i.cidade),
        quartos: txt(i.quartos, 3),
        suites: txt(i.suites, 3),
        vagas: txt(i.vagas, 3),
        area_util_m2: txt(i.area_util_m2, 15),
        area_terreno_m2: txt(i.area_terreno_m2, 15),
        preco: txt(i.preco, 30),
        aluguel: txt(i.aluguel, 30),
        url: url && /^https:\/\/[A-Za-z0-9.-]+\/\S*$/.test(url) ? url : undefined,
        mesmo_condominio: i.mesmo_condominio === true || undefined,
        mesmo_bairro: i.mesmo_bairro === true || undefined,
      } satisfies ImovelParecido;
    })
    .map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as ImovelParecido);
  return {
    referencia: {
      codigo: txt(ref.codigo),
      no_xml: ref.no_xml === true,
      saiu: ref.saiu === true,
      tipo: txt(ref.tipo, 30),
      bairro: txt(ref.bairro),
      cidade: txt(ref.cidade),
      preco: typeof ref.preco === "number" && Number.isFinite(ref.preco) ? ref.preco : undefined,
    },
    itens,
  };
}

// --- Roteiro --------------------------------------------------------------------------------------------

/** Próxima pergunta de qualificação (no máximo 3, cada uma uma vez). null = qualificação feita. */
export function proximaPergunta(dados: DadosQualificacao, ctx: Pick<ContextoIa, "transacao">): Pergunta | null {
  const feitas = dados.perguntas ?? [];
  const finalidade = dados.finalidade ?? (ctx.transacao === "venda" ? "comprar" : ctx.transacao === "aluguel" ? "alugar" : undefined);
  if (!finalidade && !feitas.includes("finalidade")) return "finalidade";
  if (!dados.faixa && !feitas.includes("faixa")) return "faixa";
  // Aluguel: \"à vista, financiamento ou permuta\" não se aplica.
  if (finalidade !== "alugar" && !dados.pagamento?.length && !feitas.includes("pagamento")) return "pagamento";
  return null;
}

function extrairCodigo(texto: string): string | null {
  const m = texto.toUpperCase().match(/\b(?=[A-Z0-9-]*\d)[A-Z]{0,5}-?[0-9][A-Z0-9-]{2,30}\b/);
  return m ? m[0].slice(0, 40) : null;
}

/**
 * Próxima resposta da IA para a mensagem do cliente. Ordem de prioridade:
 * sensível -> pediu pessoa -> não é lead -> recusa -> roteiro (dúvida primeiro, depois 1 pergunta).
 * (Opt-out já foi tratado no banco antes de chegar aqui.)
 */
export async function proximaResposta(
  ctx: ContextoIa,
  texto: string,
  extrator?: Extrator,
  op: OpcoesRoteiro = {},
): Promise<RespostaIa> {
  const agora = op.agora ?? new Date();
  const dados: DadosQualificacao = {
    ...ctx.dados,
    repeticoes: { ...(ctx.dados.repeticoes ?? {}) },
    perguntas: [...(ctx.dados.perguntas ?? [])],
  };
  const n = norm(texto);
  const parcial = () => resumoQualificacao(dados, ctx);

  if (ehSensivel(texto))
    return passar(
      dados,
      "sensivel",
      "Entendi.",
      `Encaminhei sua mensagem para ${CORRETOR}, que vai cuidar disso com você por aqui.`,
      "Registrei sua mensagem e estou confirmando o encaminhamento para uma pessoa da nossa equipe. Já te retorno por aqui.",
      `Assunto sensível: \"${curto(texto, 160)}\". Atender com prioridade. Dados até aqui: ${parcial()}`,
    );
  // \"Sim\" para a oferta de passar ao corretor feita depois de \"é robô?\": passa (t_25fe1197).
  const ofereceuCorretor = dados.ofereceu_corretor;
  dados.ofereceu_corretor = undefined;
  if (pediuPessoa(texto) || (ofereceuCorretor && SIM_P.test(n) && !detectarTemas(texto).length))
    return passar(
      dados,
      "pediu_pessoa",
      "Claro!",
      `Encaminhei seu contato para ${CORRETOR}, que vai falar com você por aqui.`,
      FALHA_PADRAO,
      `Cliente pediu para falar com uma pessoa. Dados até aqui: ${parcial()}`,
    );
  // \"É robô?\": não mente. Confirma que é assistente virtual e oferece o corretor; a conversa segue (t_25fe1197).
  if (perguntouSeRobo(texto)) {
    dados.ofereceu_corretor = true;
    // Só aqui (pergunta direta) ela diz "assistente virtual"; a apresentação normal nunca usa o termo.
    const quem = `Sou a ${(ctx.ia_nome || "Nicole").trim()}, assistente virtual${ctx.org_nome ? ` da ${ctx.org_nome}` : ""} (não sou uma pessoa).`;
    return {
      passo: ctx.passo === "fim" ? "visita" : ctx.passo,
      dados,
      resposta: `${quem} Se preferir, passo agora para um corretor falar com você. Quer?`,
      resposta_falha: null,
      fim: null,
      resumo: null,
    };
  }
  const cat = categoriaNaoLead(texto);
  if (cat) {
    dados.categoria = cat;
    const quem = { proprietario: "Proprietário oferecendo imóvel", parceiro: "Parceiro (corretor/imobiliária)", fornecedor: "Fornecedor", pessoal: "Assunto pessoal" }[cat];
    return passar(
      dados,
      "nao_lead",
      "Entendi, obrigada!",
      `Encaminhei sua mensagem para ${CORRETOR}, que vai te responder por aqui.`,
      "Registrei sua mensagem e estou confirmando o encaminhamento para a nossa equipe. Já te retorno por aqui.",
      `${quem}, não é comprador nem locatário: \"${curto(texto, 160)}\". Atender sem o roteiro de qualificação.`,
    );
  }
  const parecidoPendente = !!(dados.parecido_atual || dados.parecido_pergunta);
  if (RECUSA.test(n) || (ctx.passo === "interesse" && !parecidoPendente && SEM_INTERESSE.test(n) && !SIM.test(n)))
    return fim(
      dados,
      "sem_interesse",
      "Tudo bem, obrigada pelo retorno! Se precisar de algo, é só chamar.",
      null,
      `Cliente disse que não tem interesse: \"${curto(texto, 160)}\".`,
    );

  // Imóvel: ficha do banco, ou a achada pelo código que o cliente informou (pedido uma única vez).
  let ficha = ctx.ficha ?? null;
  let frase = ctx.imovel_frase ?? null;
  if (ctx.passo === "codigo") {
    const cod = extrairCodigo(texto);
    if (cod) {
      dados.anuncio_informado = cod;
      const achou = op.buscarImovel ? await op.buscarImovel(cod).catch(() => null) : null;
      if (achou) {
        // XML da imobiliária (prioridade no banco) ou captação.
        if (achou.capture_id) dados.imovel_capture_id = achou.capture_id;
        if (achou.xml_codigo) dados.imovel_xml_codigo = achou.xml_codigo.slice(0, 60);
        ficha = achou.ficha;
        frase = achou.frase;
      }
    }
  }

  // --- Imóvel parecido do XML (t_232e13cb). Sem op.buscarParecidos: nada muda (comportamento de antes). ---
  const busca = op.buscarParecidos;
  const passoP: Passo = ctx.passo === "fim" ? "visita" : ctx.passo;
  const negocio = (): NegocioParecido =>
    dados.finalidade === "alugar" || (!dados.finalidade && ctx.transacao === "aluguel") ? "locacao" : "venda";
  const continuar = (intro: string, extra: Partial<RespostaIa> = {}): RespostaIa => ({
    passo: passoP,
    dados,
    resposta: intro,
    resposta_falha: null,
    fim: null,
    resumo: null,
    ...extra,
  });
  /** Oferece o próximo parecido (1 por vez, até 3, nunca repete) ou diz com franqueza que não há e passa. */
  const ofertar = async (intro: string, extra: Partial<FiltroParecido> = {}, pre?: ResultadoParecidos | null): Promise<RespostaIa> => {
    const ja = dados.parecidos ?? [];
    dados.parecido_atual = undefined;
    dados.parecido_pergunta = undefined;
    const juntarTxt = (...xs: string[]) => xs.filter(Boolean).join(" ");
    if (ja.length >= MAX_PARECIDOS)
      return passar(
        dados,
        "qualificado",
        juntarTxt(intro, "Já te mostrei as opções parecidas que separei por aqui."),
        `Encaminhei seu contato para ${CORRETOR}, que pode procurar mais opções para você por aqui.`,
        FALHA_PADRAO,
        resumoQualificacao(dados, ctx),
      );
    const res =
      pre !== undefined
        ? pre
        : await busca!({
            excluir: ja,
            negocio: negocio(),
            preco_min: valorFaixa(dados.faixa ?? "")?.min ?? null,
            preco_max: valorFaixa(dados.faixa ?? "")?.max ?? null,
            codigo_ref: dados.imovel_xml_codigo ?? dados.anuncio_informado ?? null,
            ...extra,
          }).catch(() => null);
    const p = res?.itens.find((i) => !ja.includes(i.codigo));
    if (!p) {
      const franco = !res
        ? ""
        : extra.negocio === "locacao" || negocio() === "locacao"
          ? "Não encontrei agora uma opção de locação parecida no nosso catálogo, então vou pedir para um corretor entrar em contato com você."
          : ja.length
            ? "Não encontrei mais nenhuma opção parecida no nosso catálogo além da que te mostrei."
            : "No momento não encontrei outra opção parecida com essa no nosso catálogo.";
      return passar(
        dados,
        "qualificado",
        juntarTxt(intro, franco),
        `Encaminhei seu contato para ${CORRETOR}, que pode procurar outras opções para você por aqui.`,
        FALHA_PADRAO,
        resumoQualificacao(dados, ctx),
      );
    }
    dados.parecidos = [...ja, p.codigo].slice(0, MAX_PARECIDOS);
    dados.parecido_atual = p;
    if (passoP === "interesse" || passoP === "codigo") dados.interesse = true;
    return continuar(juntarTxt(intro, textoParecido(p, dados.parecidos.length)));
  };

  // Resposta a uma oferta/pergunta de parecido feita no turno anterior.
  let respParecido = false;
  let abertura: string | null = null;
  if (busca && dados.parecido_atual) {
    const p = dados.parecido_atual;
    const temasP = detectarTemas(texto);
    if (NAO_QUER_MAIS.test(n) || (NAO_GOSTOU.test(n) && !MAIS_UM.test(n) && !pedeOutrasOpcoes(texto))) {
      dados.parecido_atual = undefined;
      respParecido = true;
      abertura = "Tudo bem!";
    } else if (MAIS_UM.test(n) || pedeOutrasOpcoes(texto)) {
      return ofertar("", { mais_barato: MAIS_BARATO.test(n) });
    } else if (QUER_VISITA.test(n) || GOSTOU.test(n) || SIM_P.test(n)) {
      dados.parecido_interesse = p.codigo;
      dados.parecido_atual = undefined;
      const visita = QUER_VISITA.test(n);
      return passar(
        dados,
        "qualificado",
        "Combinado!",
        `Encaminhei seu interesse ${visita ? "em visitar o" : "no"} imóvel código ${p.codigo} para ${CORRETOR}, que confirma a disponibilidade e ${visita ? "combina a visita" : "te passa os detalhes"} com você por aqui.`,
        FALHA_PADRAO,
        resumoQualificacao(dados, ctx),
      );
    } else if (temasP.length) {
      // Dúvida sobre o parecido: só o que o XML trouxe; o resto é com o corretor (não mistura pendências).
      const r = responderDuvidas(temasP, fichaDoParecido(p), {});
      const fimP =
        (dados.parecidos?.length ?? 0) < MAX_PARECIDOS
          ? "Quer que eu peça ao corretor os detalhes desse imóvel, ou prefere ver outra opção?"
          : "Quer que eu peça ao corretor os detalhes desse imóvel?";
      return continuar(`${r} ${fimP}`);
    } else {
      dados.parecido_atual = undefined; // mudou de assunto: segue o roteiro normal
    }
  } else if (busca && dados.parecido_pergunta) {
    dados.parecido_pergunta = undefined;
    if ((SIM_P.test(n) || pedeOutrasOpcoes(texto) || MAIS_UM.test(n)) && !NAO_QUER_MAIS.test(n) && !NAO_GOSTOU.test(n))
      return ofertar("", { mais_barato: MAIS_BARATO.test(n) });
    respParecido = true;
    abertura = "Tudo bem!";
  }

  // Alternativa do reengajamento (toque 2): \"sim\" = passa os detalhes ao corretor.
  if (dados.alternativa && SIM.test(n) && !detectarTemas(texto).length)
    return passar(
      dados,
      "qualificado",
      "Combinado!",
      `Encaminhei seu interesse em ${dados.alternativa} para ${CORRETOR}, que vai te passar os detalhes por aqui.`,
      FALHA_PADRAO,
      resumoQualificacao(dados, ctx),
    );

  const passoAtual: Passo = ctx.passo === "fim" ? "visita" : ctx.passo;
  const temas = detectarTemas(texto);
  // Resposta à 1ª mensagem (\"Quer saber valores e condições...?\"): \"valores\" já é a dúvida de preço.
  if (passoAtual === "interesse" && !temas.length && /(valor|preco|condic|informac)/.test(n)) temas.push("preco");
  const ehDuvida = temas.length > 0 || /\?\s*$/.test(texto.trim());

  // Resposta à pergunta do passo (ou dita espontaneamente).
  const faixaAntes = dados.faixa;
  const finalidadeAntes = dados.finalidade;
  const fin = finalidadeDe(n);
  if (fin && !dados.finalidade) dados.finalidade = fin;
  const pag = pagamentoDe(n);
  // \"Aceita financiamento?\" é dúvida, não forma de pagamento; \"vou financiar\" é forma de pagamento.
  if (pag && !dados.pagamento?.length && (passoAtual === "pagamento" || !ehPergunta(texto))) dados.pagamento = pag;
  // Na pergunta da faixa, um número solto (\"120000 aceita financiamento?\") também é a faixa (t_59ab47d4).
  const fx = faixaDe(texto, n, passoAtual === "faixa");
  // Depois de \"Só confirmando: sua faixa é de R$ X?\", um novo valor substitui o anterior.
  // Só no turno logo depois da pergunta, uma vez (revisão t_e520a9bb).
  const confirmandoFaixa = passoAtual === "faixa" && !!ctx.dados.faixa_pendente;
  dados.faixa_pendente = undefined;
  if (fx && (!dados.faixa || (confirmandoFaixa && valorFaixa(fx)))) dados.faixa = fx;
  // "na verdade quero alugar" no passo da faixa muda a finalidade; não vira faixa de valor (t_232e13cb).
  const soFinalidade = passoAtual === "faixa" && !!fin && fin !== finalidadeAntes && !fx;
  if ((passoAtual === "finalidade" || passoAtual === "faixa" || passoAtual === "pagamento") && !ehDuvida && !respParecido && !soFinalidade) {
    const respondeu =
      (passoAtual === "finalidade" && dados.finalidade) || (passoAtual === "faixa" && dados.faixa) || (passoAtual === "pagamento" && dados.pagamento?.length);
    if (!respondeu) {
      let ex = extrairPorRegras(passoAtual, texto);
      if (!ex && extrator) {
        try {
          ex = (await extrator(passoAtual, texto)) ?? null;
        } catch {
          ex = null; // modelo fora do ar: segue só com regras
        }
      }
      if (ex) Object.assign(dados, sanitizar(passoAtual, ex));
      // Não entendeu: anota como veio e segue (sem repetir a pergunta: máximo de 3 perguntas).
      if (passoAtual === "finalidade" && !dados.finalidade) dados.finalidade = curto(texto, 20);
      if (passoAtual === "pagamento" && !dados.pagamento?.length) dados.pagamento = [curto(texto, 30)];
    }
  }
  // Roteiro antigo (conversa aberta antes do ajuste).
  if ((passoAtual === "prazo" || passoAtual === "regiao") && !ehDuvida && n.length >= 2) dados[passoAtual] = curto(texto);
  if (passoAtual === "proximo_passo") {
    const ex = extrairPorRegras("proximo_passo", texto);
    if (ex?.proximo_passo === "contato")
      return passar(dados, "qualificado", "Perfeito, obrigada!", `Encaminhei suas informações para ${CORRETOR}, que vai falar com você por aqui.`, FALHA_PADRAO, resumoQualificacao(dados, ctx));
  }

  const duvida = responderDuvidas(temas, ficha, dados);

  // Permuta: a Nicole nunca diz se aceita. Registra e passa ao corretor, que avalia (t_59ab47d4).
  if (falaPermuta(n) && !respParecido) {
    dados.pagamento = [...new Set([...(dados.pagamento ?? []), "permuta"])];
    const outras = responderDuvidas(temas.filter((t) => t !== "permuta"), ficha, dados);
    return passar(
      dados,
      "qualificado",
      [outras, "Anotei a permuta: quem avalia essa possibilidade é o corretor."].filter(Boolean).join(" "),
      `Encaminhei suas informações para ${CORRETOR}, que vai falar com você por aqui.`,
      FALHA_PADRAO,
      `Cliente falou em PERMUTA: \"${curto(texto, 160)}\". ${resumoQualificacao(dados, ctx)}`,
    );
  }

  // Faixa muito longe do valor anunciado no XML (mais que o dobro ou menos da metade): confirma uma vez,
  // com naturalidade, em vez de aceitar calada (t_59ab47d4). A dúvida do mesmo turno é respondida junto.
  if (dados.faixa && dados.faixa !== faixaAntes && !dados.faixa_conferida && !respParecido) {
    const alugar = dados.finalidade === "alugar" || (!dados.finalidade && ctx.transacao === "aluguel");
    const anunciado = alugar ? ficha?.aluguel_valor : ficha?.preco_valor;
    const longe = faixaLonge(dados.faixa, anunciado);
    if (longe != null && anunciado) {
      dados.faixa_conferida = true;
      dados.faixa_pendente = true;
      if (!dados.perguntas!.includes("faixa")) dados.perguntas!.push("faixa");
      const ref = alugar ? `O aluguel anunciado é de ${reais(anunciado)} por mês.` : `O imóvel está anunciado por ${reais(anunciado)}.`;
      return {
        passo: "faixa",
        dados,
        resposta: [duvida, `Só confirmando: sua faixa é de ${reais(longe)}? ${ref}`].filter(Boolean).join(" "),
        resposta_falha: null,
        fim: null,
        resumo: null,
      };
    }
  }
  // Resposta à confirmação: \"isso\" mantém a faixa; outro valor já substituiu acima. Segue o roteiro.
  if (confirmandoFaixa) dados.faixa_conferida = true;

  // Imóvel parecido: (c) o cliente pede outras opções; (b) o imóvel pedido não serve.
  // Cada conferência de (b) acontece no máximo uma vez por conversa.
  if (busca && !respParecido && (dados.parecidos?.length ?? 0) < MAX_PARECIDOS) {
    const conferido = dados.parecido_conferido ?? [];
    const conferir = (k: string) => {
      dados.parecido_conferido = [...new Set([...(dados.parecido_conferido ?? []), k])];
    };
    const doXml = ctx.imovel_fonte === "xml" || !!dados.imovel_xml_codigo;
    const comDuvida = (t: string) => [duvida, t].filter(Boolean).join(" ");
    if (pedeOutrasOpcoes(texto) && !NAO_QUER_MAIS.test(n)) return ofertar(duvida, { mais_barato: MAIS_BARATO.test(n) });
    // Quer alugar e o pedido é só de venda: diz isso e procura uma locação parecida no XML (sem achar, passa).
    const pedidoSoVenda = ficha?.negocio ? ficha.negocio === "venda" : ctx.transacao === "venda" || doXml;
    if (dados.finalidade === "alugar" && finalidadeAntes !== "alugar" && pedidoSoVenda && !conferido.includes("locacao")) {
      conferir("locacao");
      return ofertar(comDuvida("Esse imóvel está anunciado para venda."), { negocio: "locacao", preco_min: null, preco_max: null });
    }
    // Fora do bairro que o cliente quer.
    const b = bairroDesejado(texto);
    if (b && ficha?.bairro && !norm(ficha.bairro).includes(b) && !conferido.includes("bairro")) {
      conferir("bairro");
      return ofertar(comDuvida(`Esse imóvel fica no bairro ${ficha.bairro}.`), { bairro: b });
    }
    // Faixa de valor recém-informada abaixo do preço anunciado do pedido (o banco compara; o número não é dito).
    const fx = dados.faixa && dados.faixa !== faixaAntes ? valorFaixa(dados.faixa) : null;
    if (fx?.max && doXml && !conferido.includes("faixa")) {
      conferir("faixa");
      const res = await busca({ excluir: dados.parecidos ?? [], negocio: negocio(), preco_min: fx.min ?? null, preco_max: fx.max, codigo_ref: dados.imovel_xml_codigo ?? null }).catch(() => null);
      if (res?.referencia.preco && res.referencia.preco > fx.max)
        return ofertar(comDuvida("Esse imóvel está anunciado acima da faixa que você comentou."), {}, res);
    }
    // O anúncio pedido saiu do XML (não está mais no catálogo atual).
    const cod = ctx.anuncio_codigo || dados.anuncio_informado;
    if ((passoAtual === "interesse" || passoAtual === "codigo") && cod && ctx.imovel_fonte !== "xml" && !dados.imovel_xml_codigo && !conferido.includes("saiu")) {
      conferir("saiu");
      const res = await busca({ excluir: dados.parecidos ?? [], negocio: negocio(), codigo_ref: dados.anuncio_informado ?? null }).catch(() => null);
      if (res?.referencia.saiu)
        return ofertar(comDuvida("Esse anúncio não está mais no nosso catálogo atual; o corretor confirma a situação dele."), {}, res);
    }
  }

  // Visita: escolha entre as 2 opções oferecidas.
  if (passoAtual === "visita") {
    const opcoes = dados.visita_opcoes ?? opcoesVisita(agora);
    // \"Não\" para o parecido oferecido durante a visita: volta às 2 opções (não encerra a conversa).
    if (respParecido)
      return { passo: "visita", dados, resposta: `${abertura ?? "Tudo bem!"} Sobre a visita: ${opcoes[0]} ou ${opcoes[1]} fica bom para você?`, resposta_falha: null, fim: null, resumo: null };
    const escolha = escolhaVisita(texto, opcoes);
    const rep = dados.repeticoes!.visita ?? 0;
    const livre = !escolha && !ehDuvida && OUTRO_DIA.test(n) ? curto(texto, 60) : null;
    if (escolha || livre || (rep >= 1 && !ehDuvida && !PREFERE_CORRETOR.test(n))) {
      dados.visita = escolha ?? livre ?? curto(texto, 60);
      dados.visita_ate = prazoConfirmacao(agora);
      return passar(
        dados,
        "visita",
        `Pré-agendamento anotado: ${dados.visita}.`,
        `Encaminhei para ${CORRETOR}, que confirma com você ${dados.visita_ate}. A visita só fica marcada depois dessa confirmação, combinado?`,
        "Registrei aqui e estou confirmando o envio ao corretor; assim que ele confirmar o horário, te aviso por aqui. A visita só fica marcada depois dessa confirmação.",
        resumoQualificacao(dados, ctx),
      );
    }
    if (PREFERE_CORRETOR.test(n) || (SEM_INTERESSE.test(n) && !ehDuvida))
      return passar(dados, "qualificado", `${duvida ? `${duvida} ` : ""}Sem problema!`, `Encaminhei suas informações para ${CORRETOR}, que vai falar com você por aqui.`, FALHA_PADRAO, resumoQualificacao(dados, ctx));
    if (rep < 1) {
      dados.repeticoes!.visita = rep + 1;
      const q = ehDuvida
        ? `Sobre a visita: ${opcoes[0]} ou ${opcoes[1]} fica bom para você?`
        : "Sem problema! Qual dia e período ficam melhores para você?";
      return { passo: "visita", dados, resposta: [duvida, q].filter(Boolean).join(" "), resposta_falha: null, fim: null, resumo: null };
    }
    return passar(dados, "qualificado", duvida, `Encaminhei suas informações para ${CORRETOR}, que vai combinar a visita com você por aqui.`, FALHA_PADRAO, resumoQualificacao(dados, ctx));
  }

  // Cliente pediu visita (ou terminou a qualificação): oferece 2 opções.
  const ofereceVisita = (intro: string): RespostaIa => {
    const opcoes = opcoesVisita(agora);
    dados.visita_opcoes = opcoes;
    const alvo = frase ? ` ${frase}` : " o imóvel";
    return {
      passo: "visita",
      dados,
      resposta: [intro, `Posso pré-agendar uma visita para você conhecer${alvo}: ${opcoes[0]} ou ${opcoes[1]}? É um pré-agendamento: o corretor confirma o horário com você.`]
        .filter(Boolean)
        .join(" "),
      resposta_falha: null,
      fim: null,
      resumo: null,
    };
  };
  if (QUER_VISITA.test(n) || (passoAtual === "proximo_passo" && /visit/.test(n))) return ofereceVisita(duvida);

  // 1ª resposta sem imóvel identificado e sem código do portal: pede o código UMA vez, com exemplo.
  const semImovel = !ficha && !ctx.tem_captacao && !dados.imovel_capture_id && !ctx.anuncio_codigo;
  if (passoAtual === "interesse" && semImovel && !dados.codigo_pedido) {
    dados.codigo_pedido = true;
    dados.interesse = true;
    return {
      passo: "codigo",
      dados,
      resposta: [duvida || "Que bom!", "Para eu te passar as informações certas, qual é o código do anúncio? Ele aparece na descrição do anúncio, por exemplo: AP1234."]
        .filter(Boolean)
        .join(" "),
      resposta_falha: null,
      fim: null,
      resumo: null,
    };
  }

  let intro = duvida;
  if (passoAtual === "interesse" || passoAtual === "codigo") {
    dados.interesse = true;
    // 1ª resposta: o que a ficha tem sobre o imóvel + a resposta da dúvida (se houve).
    const r = passoAtual === "codigo" && !ficha ? "Obrigada! Vou pedir ao corretor para confirmar qual é o imóvel." : resumoFicha(ficha);
    intro = [abertura ?? (duvida ? "" : "Que bom!"), respParecido ? "" : r, duvida].filter(Boolean).join(" ");
  } else if (abertura) intro = [abertura, intro].filter(Boolean).join(" ");

  // Depois da dúvida, a próxima pergunta (uma por turno). Repete a do passo atual no máximo uma vez,
  // quando o cliente respondeu com outra dúvida.
  const atualSemResposta =
    // Também depois de responder a uma oferta de parecido: a pergunta do passo ficou sem resposta.
    (passoAtual === "finalidade" || passoAtual === "faixa" || passoAtual === "pagamento") && (ehDuvida || respParecido) &&
    !((passoAtual === "finalidade" && dados.finalidade) || (passoAtual === "faixa" && dados.faixa) || (passoAtual === "pagamento" && dados.pagamento?.length));
  if (atualSemResposta && (dados.repeticoes![passoAtual] ?? 0) < 1) {
    dados.repeticoes![passoAtual] = (dados.repeticoes![passoAtual] ?? 0) + 1;
    return { passo: passoAtual, dados, resposta: [intro, PERGUNTA[passoAtual as Pergunta]].filter(Boolean).join(" "), resposta_falha: null, fim: null, resumo: null };
  }
  const q = proximaPergunta(dados, ctx);
  if (q) {
    dados.perguntas!.push(q);
    return { passo: q, dados, resposta: [intro, PERGUNTA[q]].filter(Boolean).join(" "), resposta_falha: null, fim: null, resumo: null };
  }
  // (a) Qualificação feita: ANTES da visita, pergunta se quer ver uma opção parecida (uma vez, só se existir).
  if (busca && !dados.visita_opcoes && !dados.parecido_perguntado && !(dados.parecidos?.length)) {
    dados.parecido_perguntado = true;
    const res = await busca({
      excluir: [],
      negocio: negocio(),
      preco_min: valorFaixa(dados.faixa ?? "")?.min ?? null,
      preco_max: valorFaixa(dados.faixa ?? "")?.max ?? null,
      codigo_ref: dados.imovel_xml_codigo ?? dados.anuncio_informado ?? null,
    }).catch(() => null);
    if (res?.itens.length) {
      dados.parecido_pergunta = true;
      return { passo: passoAtual, dados, resposta: [intro ? `${intro} Obrigada!` : "Obrigada!", PERGUNTA_PARECIDO].join(" "), resposta_falha: null, fim: null, resumo: null };
    }
  }
  // Qualificação feita: oferece a visita (uma vez); se já ofereceu, passa ao corretor.
  if (!dados.visita_opcoes) return ofereceVisita(abertura ? intro : intro ? `${intro} Obrigada!` : "Obrigada!");
  return passar(dados, "qualificado", intro, `Encaminhei suas informações para ${CORRETOR}, que vai falar com você por aqui.`, FALHA_PADRAO, resumoQualificacao(dados, ctx));
}

/**
 * Áudio, foto ou arquivo pelo WhatsApp (card t_6f688b4b): a IA não ouve nem lê anexos. Na 1ª vez pede
 * para escrever; na 2ª, passa ao corretor (que pode ouvir o áudio no WhatsApp).
 */
export function respostaMidia(ctx: ContextoIa): RespostaIa {
  const dados: DadosQualificacao = { ...ctx.dados, midias: (ctx.dados.midias ?? 0) + 1 };
  if ((ctx.dados.midias ?? 0) >= 1)
    return passar(
      dados,
      "pediu_pessoa",
      "",
      `Encaminhei sua mensagem para ${CORRETOR}, que vai falar com você por aqui.`,
      FALHA_PADRAO,
      `Cliente mandou áudio ou arquivo pelo WhatsApp (a IA não lê anexos). Dados até aqui: ${resumoQualificacao(ctx.dados, ctx)}`,
    );
  const passo = ctx.passo === "fim" ? "visita" : ctx.passo;
  const q =
    passo === "finalidade" || passo === "faixa" || passo === "pagamento"
      ? PERGUNTA[passo]
      : passo === "codigo"
        ? "Qual é o código do anúncio? Por exemplo: AP1234."
        : "Pode me escrever sua dúvida?";
  return {
    passo,
    dados,
    resposta: `Desculpe, por aqui eu só consigo ler mensagens escritas. ${q}`,
    resposta_falha: null,
    fim: null,
    resumo: null,
  };
}

// --- Tela ---------------------------------------------------------------------------------------

export type ConversaIa = {
  id: string;
  lead_id: string;
  canal: "teste" | "ziontalk";
  estado: "ativa" | "passada" | "optout" | "parada";
  passo: Passo;
  motivo_fim: string | null;
  resumo: string | null;
  created_at: string;
};

export type MensagemIa = {
  id: string;
  autor: "ia" | "cliente" | "sistema";
  texto: string;
  status: "nao_enviada" | "pendente" | "enviando" | "enviada" | "falhou" | "simulada" | "recebida";
  created_at: string;
};

export const ESTADO_CONVERSA_LABEL: Record<ConversaIa["estado"], string> = {
  ativa: "IA atendendo",
  passada: "Passada ao corretor",
  optout: "Cliente pediu SAIR",
  parada: "IA parada",
};

export const STATUS_MSG_LABEL: Record<MensagemIa["status"], string> = {
  nao_enviada: "não enviada (modo teste)",
  pendente: "aguardando envio",
  enviando: "enviando",
  enviada: "enviada",
  falhou: "falhou",
  simulada: "cliente simulado",
  recebida: "recebida",
};

export type IaConfig = {
  ia_ativa: boolean;
  ia_nome: string;
  ia_boas_vindas: string | null;
  ia_canal: "teste" | "ziontalk";
  /** Texto da 1ª mensagem (vazio = padrão). Marcadores: {nome} {assistente} {imobiliaria} {imovel}. */
  ia_primeira_msg?: string | null;
  /** Reengajamento em 2 toques (~24 h e ~72 h). Desligado por padrão. */
  ia_reengajar?: boolean;
};

/** Texto padrão da 1ª mensagem (igual a lead_ia_primeira_msg no banco). */
export const PRIMEIRA_MSG_PADRAO =
  "Oi, {nome}! Aqui é a {assistente}, da {imobiliaria}. Vi seu interesse {imovel}. {link}Quer saber mais detalhes ou já prefere agendar uma visita?";

export function validarIaConfig(c: Pick<IaConfig, "ia_nome" | "ia_boas_vindas" | "ia_primeira_msg">): string | null {
  const n = c.ia_nome.trim();
  if (n.length < 1 || n.length > 40) return "Nome da IA entre 1 e 40 caracteres.";
  if ((c.ia_boas_vindas ?? "").length > 400) return "Texto de boas-vindas até 400 caracteres.";
  if (temLink(c.ia_boas_vindas)) return "Não coloque link no texto de boas-vindas (a 1ª mensagem vai sem link).";
  const p = (c.ia_primeira_msg ?? "").trim();
  if (p.length > 400) return "1ª mensagem até 400 caracteres.";
  if (temLink(p)) return "Não coloque link na 1ª mensagem.";
  if (p && !/\?\s*$/.test(p)) return "A 1ª mensagem deve terminar com uma pergunta (ex.: \"...ou já prefere agendar uma visita?\").";
  return null;
}

/**
 * A tela da IA tem alteração que ainda não foi gravada? (t_71832765: o nome trocado ficava só na tela
 * quando a pessoa clicava em "Salvar prazos" no rodapé em vez de "Salvar IA".) Compara só o que o
 * administrador edita, do mesmo jeito que o banco grava (nome sem espaços nas pontas, texto vazio = padrão).
 */
export function iaConfigMudou(
  salvo: Pick<IaConfig, "ia_ativa" | "ia_nome" | "ia_primeira_msg" | "ia_reengajar">,
  atual: Pick<IaConfig, "ia_ativa" | "ia_nome" | "ia_primeira_msg" | "ia_reengajar">,
): boolean {
  const txt = (s: string | null | undefined) => (s ?? "").trim();
  return (
    salvo.ia_ativa !== atual.ia_ativa ||
    txt(salvo.ia_nome) !== txt(atual.ia_nome) ||
    txt(salvo.ia_primeira_msg) !== txt(atual.ia_primeira_msg) ||
    (salvo.ia_reengajar === true) !== (atual.ia_reengajar === true)
  );
}

/** Prévia da 1ª mensagem (mesma regra de lead_ia_primeira_msg no banco). imovel = \"no apartamento do bairro X\". */
export function previaPrimeiraMensagem(
  c: Pick<IaConfig, "ia_nome" | "ia_primeira_msg">,
  imobiliaria: string,
  cliente: string,
  imovel: string | null,
  link: string | null = null,
): string {
  let t = c.ia_primeira_msg?.trim() || PRIMEIRA_MSG_PADRAO;
  const anuncio = link && /^https:\/\//.test(link) && link.length <= 300 ? `Anúncio: ${link} ` : "";
  const nome = /^lead( grupo zap)?$/i.test(cliente.trim()) ? "" : cliente.trim().split(" ")[0];
  if (!nome) t = t.replace(/,?\s*\{nome\}/g, "");
  return t
    .split("{nome}").join(nome)
    .split("{assistente}").join(c.ia_nome.trim())
    .split("{imobiliaria}").join(imobiliaria || "imobiliária")
    .split("{imovel}").join(imovel || "no imóvel que você viu")
    .split("{link}").join(anuncio)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}
