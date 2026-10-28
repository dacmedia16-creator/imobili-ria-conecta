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
  // Tom humano (t_5b493bc9).
  /** A Nicole já convidou para a visita ao menos uma vez. */
  convite_visita?: boolean;
  /** Pergunta de fecho do último turno, esperando resposta (vale só no turno seguinte). */
  convite_aberto?: "visita" | "detalhe" | "opcoes";
  /** Os detalhes da ficha já foram mandados (não repete a ficha). */
  ficha_enviada?: boolean;
  /** Cliente pediu outras opções e a Nicole precisou perguntar a faixa antes (sem preço de referência). */
  quer_opcoes?: boolean;
  /** Já disse "essas são as opções que tenho nessa faixa" (no pedido seguinte, passa ao corretor). */
  parecidos_fim?: boolean;
  /** Busca nova no meio da conversa (outro tipo, outra pessoa), sem perder o interesse no imóvel do lead. */
  busca2?: Busca2;
  /** Cliente pediu um dia/horário fora das opções oferecidas; a Nicole anotou (t_2aecef49). */
  visita_livre?: boolean;
  /** Outras buscas do cliente na mesma conversa (ex.: apartamento para o filho), resumo para o corretor (t_7b59589c). */
  outras_buscas?: string[];
  /** Característica pedida pelo cliente ("3 suítes"), vale para os próximos pedidos de opção (t_a9f1b447). */
  filtro_pedido?: FiltroCaracteristica;
  /** Quantas vezes \"Quer saber mais algum detalhe?\" já foi perguntado (não repete, t_a9f1b447). */
  detalhe_perguntado?: number;
  /** Códigos oferecidos pela busca por característica (nunca repete, t_a9f1b447). */
  ofertados_carac?: string[];
  /** O cliente já disse \"não\" a uma pergunta de fecho e a Nicole ofereceu seguir (não pergunta de novo). */
  nao_seguiu?: boolean;
  /** Filtro um passo abaixo, sugerido quando não havia nada (\"prefere que eu procure com 2 suítes?\"). */
  carac_relaxar?: FiltroCaracteristica;
  /** Cliente disse só o dia da visita (\"pode ser sábado?\"): a Nicole perguntou manhã ou tarde (t_82c89141 item 4). */
  visita_dia_pendente?: string;
  /** t_37cf21e3 item 4: frase com dois sentidos (\"não quero casa mesmo\"); a Nicole perguntou se é esse tipo. */
  confirmar_tipo?: string;
  /** t_37cf21e3 item 6: último parecido mostrado (fica depois do \"gostei\", para as fotos irem do imóvel certo). */
  ultimo_parecido?: ImovelParecido;
};

/** Característica pedida pelo cliente (t_a9f1b447): vira filtro no XML da própria imobiliária. */
export type FiltroCaracteristica = {
  suites?: number;
  quartos?: number;
  vagas?: number;
  /** Área mínima em m². */
  area?: number;
  tipo?: string;
  bairro?: string;
  finalidade?: "comprar" | "alugar";
};
export type FiltroCaracteristicaBusca = FiltroCaracteristica & {
  negocio: NegocioParecido;
  preco_min?: number | null;
  preco_max?: number | null;
  cidade?: string | null;
  excluir: string[];
  limite?: number;
};
/** itens = dentro da faixa; proximo = o mais perto fora da faixa (quando não há nenhum dentro). */
export type ResultadoCaracteristica = { itens: ImovelParecido[]; proximo: ImovelParecido | null };

/** Segunda busca (t_5b493bc9 item 11): ex. "vcs trabalham com apartamento? é para o meu filho". */
export type Busca2 = {
  ativa?: boolean;
  /** Tipo normalizado (apartamento, casa, terreno, cobertura, studio, imóvel comercial); "" = tanto faz. */
  tipo?: string;
  /** Para quem (filho, filha, mãe...). */
  para?: string;
  finalidade?: "comprar" | "alugar" | "";
  regiao?: string;
  faixa?: string;
  /** t_37cf21e3: suítes e quartos pedidos para ESTA busca (nunca vão para o imóvel do cliente). */
  suites?: number;
  quartos?: number;
  /** Pergunta esperando resposta. */
  etapa?: EtapaBusca;
  perguntas?: EtapaBusca[];
  /** Códigos oferecidos nesta busca (até 3, nunca repete). */
  ofertados?: string[];
  /** Código em que o cliente se interessou. */
  interesse?: string;
  /** Imóvel da busca mostrado no último turno, esperando a reação do cliente. */
  atual?: ImovelParecido;
  repetiu?: boolean;
};
export type EtapaBusca = "tipo" | "finalidade" | "regiao" | "quartos" | "faixa";

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
  /** Outros anúncios do MESMO cliente, de avisos do portal juntados a este lead (t_82c89141 item 7). Só XML. */
  outros_anuncios?: Array<{ codigo: string; ficha: FichaIa | null }> | null;
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
  /** Busca por característica feita ANTES do modelo (t_a9f1b447): o modelo recebe estes imóveis.
   * t_37cf21e3: perfil \"segunda\" = a busca é da 2ª busca (ex.: o filho), não do imóvel do cliente;
   * fora_regiao = bairro pedido em que não há nada (o imóvel mostrado fica em outro bairro). */
  busca?: { pedido: string; itens: ImovelParecido[]; fora_faixa: boolean; perfil?: "segunda"; fora_regiao?: string };
  /** t_37cf21e3: resposta que sai sempre com o texto do roteiro (fotos, confirmação de frase ambígua, \"Gostaria\"). */
  fixo?: boolean;
  /** t_37cf21e3: o cliente pediu mais opções neste turno (o modelo tem de mostrar uma, se houver). */
  intencao?: "opcoes";
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
/** Filtro da busca nova (t_5b493bc9). tipo null = qualquer tipo. */
export type FiltroBusca = {
  tipo: string | null;
  negocio: NegocioParecido;
  preco_min?: number | null;
  preco_max?: number | null;
  /** Bairro ou cidade dito pelo cliente. */
  regiao?: string | null;
  /** Cidade do imóvel do lead (quando a região não é uma cidade). */
  cidade?: string | null;
  excluir: string[];
  limite?: number;
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
  /** Busca nova no XML da própria imobiliária por tipo/negócio/região/faixa (servidor: lead_ia_imoveis_busca,
   * t_5b493bc9). Sem esta função, a busca nova termina passando ao corretor. */
  buscarImoveis?: (filtro: FiltroBusca) => Promise<ResultadoParecidos | null>;
  /** Busca por característica (suítes, quartos, vagas, área, tipo, bairro) no XML da própria imobiliária
   * (servidor: lead_ia_imoveis_caracteristica, t_a9f1b447). Sem ela, o pedido vira \"vou verificar\". */
  buscarCaracteristica?: (filtro: FiltroCaracteristicaBusca) => Promise<ResultadoCaracteristica | null>;
  /** t_37cf21e3: mensagens do cliente que chegaram juntas, antes desta e ainda sem resposta (\"sobre a casa q eu to
   * vendo para mim\" + \"vc tem mais opções?\"). Só para saber de qual busca o cliente está falando. */
  falasAntes?: string[];
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

/** Resposta fixa sobre disponibilidade (t_76243950): a IA nunca garante que o imóvel está disponível. */
export const CONFIRMO_DISPONIBILIDADE = "o corretor confirma a disponibilidade com você na visita ou no contato";
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
// t_5b493bc9 (teste real de Denis, 27/10): pergunta objetiva = só aquele dado, 1 ou 2 frases curtas, e
// 1 pergunta natural para avançar. Não repete a ficha, não fala de proposta sem o cliente puxar, e o que
// não está no XML vira "vou confirmar e já te falo" (o corretor recebe como pendência no resumo).

export const TEMAS = [
  "preco",
  "negociacao",
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
  preco: /(valor|preco|aluguel|quanto (custa|e|fica|esta|sai|ta)\b)/,
  negociacao: /(desconto|negoci|proposta|aceita oferta|faz por|abaix\w* (o )?(valor|preco)|baixa\w* (o )?(valor|preco)|valor final|menor valor)/,
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
/** "valor do condomínio", "quanto é o IPTU": é a taxa, não o preço do imóvel (t_5b493bc9). */
const TAXA_RE = /\b(valor|preco|quanto( (e|fica|custa|esta|sai|ta|da))?)( (do|da|de|o|a))? (?=(condominio|condo\b|iptu|taxa))/g;

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
  const n = norm(texto).replace(TAXA_RE, "");
  return TEMAS.filter((t) => TEMA_RE[t].test(n));
}

/** Rótulo da pendência no resumo do corretor. */
const ROTULO: Record<Tema, string> = {
  preco: "valor",
  negociacao: "proposta/negociação",
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
/** Sem o dado na ficha: a Nicole NÃO promete retorno (ninguém da IA volta a falar disso); o corretor confirma
 * na visita ou no contato e o tema vai como pendência no resumo dele (t_82c89141 item 3). */
export const CORRETOR_CONFIRMA = "com você na visita ou no contato";
/** "O corretor confirma <isto> com você na visita ou no contato." */
const CONFIRMAR: Record<Tema, string> = {
  preco: "o valor",
  negociacao: "a negociação",
  disponibilidade: "a disponibilidade",
  condominio: "o valor do condomínio",
  iptu: "o valor do IPTU",
  permuta: "se o proprietário aceita permuta",
  financiamento: "se aceita financiamento",
  andar: "o andar e a posição",
  quartos: "os quartos",
  banheiros: "os banheiros",
  vagas: "as vagas de garagem",
  area: "a metragem",
  localizacao: "a localização",
};

const plural = (n: string, um: string, varios: string) => `${n} ${n === "1" ? um : varios}`;
const FEMININO = new Set(["casa", "cobertura", "chácara", "sala", "loja", "kitnet"]);
const fem = (tipo?: string | null) => !!tipo && FEMININO.has(tipo);
/** "a casa" / "o apartamento" / "essa casa" / "esse apartamento" (concordância pelo tipo do XML). */
export function oImovel(tipo?: string | null, demonstrativo = false): string {
  const t = tipo || "imóvel";
  return demonstrativo ? `${fem(t) ? "essa" : "esse"} ${t}` : `${fem(t) ? "a" : "o"} ${t}`;
}
/** Valor num padrão só: "R$ 420,00" -> "R$ 420" (centavos só quando existem), como o preço "R$ 1.199.000". */
export const reaisTxt = (s: string) => s.replace(/(R\$\s?\d[\d.]*),00(?!\d)/g, "$1");
const ehCondominio = (b: string) => /^(condominio|residencial|cond\b)/.test(norm(b));
/** "no Condominio Ibiti Reserva" / "no bairro Campolim". */
const noBairro = (b: string) => (ehCondominio(b) ? `no ${b}` : `no bairro ${b}`);

type Parte = { fisico: string } | { frase: string };

/** Resposta de UM tema só com o que está na ficha. null = a ficha não tem o dado. */
function respostaTema(t: Tema, f: FichaIa | null | undefined, suj: string): Parte | null {
  if (!f) return null;
  const S = maiuscula(suj);
  switch (t) {
    case "quartos":
      if (!f.quartos) return null;
      return { fisico: `${plural(f.quartos, "quarto", "quartos")}${f.suites && f.suites !== "0" ? `, sendo ${plural(f.suites, "suíte", "suítes")}` : ""}` };
    case "banheiros":
      return f.banheiros ? { fisico: plural(f.banheiros, "banheiro", "banheiros") } : null;
    case "vagas":
      if (!f.vagas) return null;
      return f.vagas === "0" ? { frase: `${S} não tem vaga de garagem.` } : { fisico: `${plural(f.vagas, "vaga", "vagas")} de garagem` };
    case "area": {
      const a = f.area_util_m2 ? `${f.area_util_m2} m²` : f.area_construida_m2 ? `${f.area_construida_m2} m² construídos` : null;
      if (a) return { fisico: f.area_terreno_m2 ? `${a}, num terreno de ${f.area_terreno_m2} m²` : a };
      return f.area_terreno_m2 ? { fisico: `${f.area_terreno_m2} m² de terreno` } : null;
    }
    case "localizacao":
      return f.bairro
        ? { frase: `Fica ${noBairro(f.bairro)}${f.cidade ? `, em ${f.cidade}` : ""}. O endereço certinho eu te passo quando confirmar a visita.` }
        : null;
    case "condominio":
      return f.condominio ? { frase: `O condomínio é de ${reaisTxt(f.condominio)}${/mes|ano/.test(norm(f.condominio)) ? "" : " por mês"}.` } : null;
    case "iptu":
      return f.iptu ? { frase: `O IPTU é de ${reaisTxt(f.iptu)}.` } : null;
    case "permuta":
      return typeof f.aceita_permuta === "boolean"
        ? { frase: f.aceita_permuta ? "O proprietário aceita avaliar permuta." : "O proprietário não aceita permuta." }
        : null;
    case "financiamento":
      return typeof f.aceita_financiamento === "boolean" ? { frase: f.aceita_financiamento ? "Aceita financiamento, sim." : "Não aceita financiamento." } : null;
    case "andar":
      return f.andar ? { frase: `Fica no ${f.andar}.` } : null;
    case "disponibilidade":
      return null; // nunca garante (o XML pode estar até 1 h atrasado): "vou confirmar a disponibilidade"
    case "negociacao":
      return null; // tratado no roteiro (passa ao corretor só quando o CLIENTE puxa o assunto)
    case "preco": {
      const v = valorAnunciado(f, undefined, suj);
      return v ? { frase: v } : null;
    }
  }
}

/** "A casa está anunciada por R$ 430.000." / "O aluguel é de R$ 2.500 por mês." null = XML sem valor. */
export function valorAnunciado(f: FichaIa | null | undefined, finalidade?: string, sujeito?: string): string | null {
  if (!f) return null;
  const s = maiuscula(sujeito ?? oImovel(f.tipo));
  const venda = f.negocio !== "locacao" && f.preco ? `${s} está anunciad${fem(f.tipo) ? "a" : "o"} por ${reaisTxt(f.preco)}.` : null;
  const alug = f.aluguel ? `O aluguel é de ${reaisTxt(f.aluguel)} por mês.` : null;
  if (finalidade === "alugar") return alug ?? venda;
  if (finalidade === "comprar") return venda ?? alug;
  return venda && alug ? `${venda} ${alug}` : (venda ?? alug);
}

/** Responde SÓ o que foi perguntado (o que a ficha tem) e diz que confirma o resto. */
export function responderDuvidas(
  temas: Tema[],
  ficha: FichaIa | null | undefined,
  dados: DadosQualificacao,
  sujeito?: string,
): string {
  if (!temas.length) return "";
  const suj = sujeito ?? oImovel(ficha?.tipo);
  const fisico: string[] = [];
  const frases: string[] = [];
  const naoSei: Tema[] = [];
  for (const t of temas) {
    if (t === "negociacao") continue;
    const r = respostaTema(t, ficha, suj);
    if (!r) naoSei.push(t);
    else if ("fisico" in r) fisico.push(r.fisico);
    else frases.push(r.frase);
  }
  const partes: string[] = [];
  if (fisico.length) partes.push(`${maiuscula(suj)} tem ${juntar(fisico)}.`);
  partes.push(...frases);
  if (naoSei.length) partes.push(`O corretor confirma ${juntar(naoSei.map((t) => CONFIRMAR[t]))} ${CORRETOR_CONFIRMA}.`);
  dados.pendentes = [...new Set([...(dados.pendentes ?? []), ...naoSei.map((t) => ROTULO[t])])].slice(0, 12);
  return partes.join(" ");
}

/** Detalhes do imóvel, mandados UMA vez quando o cliente pede (a 1ª mensagem já disse tipo, bairro e valor). */
export function detalhesFicha(f: FichaIa | null | undefined): string {
  if (!f) return "";
  const suj = oImovel(f.tipo);
  const fisico = (["quartos", "vagas", "area"] as Tema[])
    .map((t) => respostaTema(t, f, suj))
    .filter((r): r is { fisico: string } => !!r && "fisico" in r)
    .map((r) => r.fisico);
  const partes = fisico.length ? [`${maiuscula(suj)} tem ${juntar(fisico)}.`] : [];
  const cond = f.condominio ? `${reaisTxt(f.condominio)} por mês` : null;
  const iptu = f.iptu ? reaisTxt(f.iptu) : null;
  if (cond && iptu) partes.push(`O condomínio é de ${cond} e o IPTU, ${iptu}.`);
  else if (cond) partes.push(`O condomínio é de ${cond}.`);
  else if (iptu) partes.push(`O IPTU é de ${iptu}.`);
  return partes.join(" ");
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

// t_2aecef49: cliente pede um dia/horário que não está nas 2 opções ("sábado de manhã pode ser?").
// A Nicole aceita e anota, sem repetir as opções; o corretor confirma pelo resumo.
const DIA_PEDIDO_RE = /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|fim de semana|final de semana|semana que vem|dia \d{1,2}|\d{1,2}\/\d{1,2})\b/;
const MARCAR_RE = /(pode ser|da pra|da para|consigo|posso (ir|passar|visitar)|seria possivel|tem como|visit|agendar|marcar|ir ver|conhecer)/;
/** "sábado de manhã", "fim de semana", "sexta às 18h" (texto do próprio cliente, normalizado e com acento). */
export function diaPedido(texto: string): string | null {
  const n = norm(texto);
  const d = DIA_PEDIDO_RE.exec(n)?.[1];
  if (!d) return null;
  const i = DIAS_N.indexOf(d);
  const dia = i >= 0 ? DIAS[i] : d === "final de semana" ? "fim de semana" : d;
  const periodo = /\bmanha\b/.test(n) ? "de manhã" : /\btarde\b/.test(n) ? "à tarde" : /\bnoite\b/.test(n) ? "à noite" : "";
  const h = /\b(\d{1,2})(?:h|:(\d{2}))\b/.exec(n);
  const hora = h && Number(h[1]) <= 23 ? `às ${h[1]}h${h[2] && h[2] !== "00" ? h[2] : ""}` : "";
  return [dia, periodo, hora].filter(Boolean).join(" ");
}
/** Pedido de dia fora das opções? `contextoVisita` = já se falou em visita nesta conversa. */
export function pedidoDiaFora(texto: string, opcoes: string[], contextoVisita: boolean): string | null {
  const n = norm(texto);
  if (!DIA_PEDIDO_RE.test(n) || !(contextoVisita || MARCAR_RE.test(n))) return null;
  if (escolhaVisita(texto, opcoes)) return null;
  return diaPedido(texto);
}

// --- Resumo e passagem -------------------------------------------------------------------------------

/** Resumo para o sino do corretor (sem telefone/e-mail; o banco ainda mascara). */
export function resumoQualificacao(d: DadosQualificacao, ctx?: Pick<ContextoIa, "anuncio_codigo" | "imovel_frase">): string {
  const b = d.busca2;
  const partes = [
    ctx?.imovel_frase ? `Imóvel: ${ctx.imovel_frase}` : null,
    ctx?.anuncio_codigo ? `anúncio ${ctx.anuncio_codigo}` : d.anuncio_informado ? `código informado pelo cliente: ${d.anuncio_informado}` : null,
    d.finalidade ? `Quer ${d.finalidade}` : null,
    d.faixa ? `faixa: ${d.faixa}` : null,
    d.pagamento?.length ? `pagamento: ${d.pagamento.join(", ")}` : null,
    d.prazo ? `prazo: ${d.prazo}` : null,
    d.regiao ? `região: ${d.regiao}` : null,
    d.visita
      ? `PRÉ-AGENDAMENTO: ${d.visita}${d.visita_livre ? ", dia pedido pelo cliente, fora das opções oferecidas" : ""} (confirmar com o cliente ${d.visita_ate ?? ""})`.replace(/ \)$/, ")")
      : null,
    d.pendentes?.length ? `confirmar com o cliente: ${d.pendentes.join(", ")}` : null,
    d.alternativa ? `quer detalhes de ${d.alternativa}` : null,
    d.parecido_interesse ? `INTERESSE NO IMÓVEL PARECIDO código ${d.parecido_interesse} (oferecido pela IA a partir do XML; confirmar disponibilidade)` : null,
    d.parecidos?.length ? `parecidos oferecidos pela IA: ${d.parecidos.join(", ")}` : null,
    b && (b.tipo !== undefined || b.ofertados?.length)
      ? `SEGUNDA BUSCA${b.para ? ` (para ${b.para})` : ""}: ${[
          b.tipo || "imóvel",
          b.finalidade ? `para ${b.finalidade}` : null,
          b.regiao ? `região ${b.regiao}` : null,
          b.suites !== undefined ? `${b.suites} suítes` : null,
          b.quartos !== undefined ? `${b.quartos} quartos` : null,
          b.faixa ? `faixa ${b.faixa}` : null,
          b.ofertados?.length ? `oferecidos: ${b.ofertados.join(", ")}` : null,
          b.interesse ? `INTERESSE no código ${b.interesse}` : null,
        ]
          .filter(Boolean)
          .join(", ")}`
      : null,
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

/** Texto se o banco NÃO conseguiu gravar a passagem: não afirma que alguém foi avisado, mas avisa que um
 * corretor continua (t_82c89141 item 6a) e não promete retorno da própria Nicole. */
export const FALHA_PADRAO = "Anotei tudo aqui. Um corretor da nossa equipe vai continuar seu atendimento por aqui.";
/** A única menção a outra pessoa: na hora de passar, uma vez, com naturalidade (t_5b493bc9 item 8). */
const CHAMAR = `Já pedi para ${"{corretor}"} continuar seu atendimento por aqui`;

// --- Período da visita (t_82c89141 item 4) ------------------------------------------------------------
/** "de manhã" / "à tarde" / "à noite" dito pelo cliente (texto normalizado). null = não disse. */
export function periodoDe(n: string): string | null {
  if (/\bmanha\b|\bcedo\b|\bmanhazinha\b/.test(n) && !/\btarde\b/.test(n)) return "de manhã";
  if (/\btarde(zinha)?\b|depois do almoco/.test(n) && !/\bmanha\b/.test(n)) return "à tarde";
  if (/\bnoite\b/.test(n)) return "à noite";
  const h = /\b(\d{1,2})(?:h|:\d{2})\b/.exec(n);
  if (h && Number(h[1]) <= 23) return Number(h[1]) < 12 ? "de manhã" : Number(h[1]) < 18 ? "à tarde" : "à noite";
  return null;
}
/** O dia anotado já diz o período ou o horário? */
export const temPeriodo = (visita: string) => /(manhã|manha|tarde|noite|às \d|\d{1,2}h)/i.test(visita);
/** Pergunta o período antes de passar ao corretor (o cliente só disse o dia). Não promete o dia. */
export const PERGUNTA_PERIODO = (dia: string) => `Anotado, ${dia}! Fica melhor de manhã ou à tarde?`;
function perguntaPeriodo(dados: DadosQualificacao, dia: string, passo: Passo): RespostaIa {
  dados.visita_dia_pendente = dia;
  dados.convite_visita = true;
  return { passo, dados, resposta: PERGUNTA_PERIODO(dia), resposta_falha: null, fim: null, resumo: null };
}
/** Dia E período escolhidos: anota e passa ao corretor, avisando o cliente que ele continua (item 6a). */
function passarVisita(dados: DadosQualificacao, ctx: Pick<ContextoIa, "anuncio_codigo" | "imovel_frase">, agora: Date, visita: string): RespostaIa {
  dados.visita = visita;
  dados.visita_ate = prazoConfirmacao(agora);
  dados.visita_livre = true;
  return passar(
    dados,
    "visita",
    `${maiuscula(visita)} anotado!`,
    `${CHAMAR} para confirmar o horário certinho.`,
    "Um corretor da nossa equipe vai continuar seu atendimento por aqui para confirmar o horário.",
    resumoQualificacao(dados, ctx),
  );
}

// --- Imóvel parecido do XML (t_232e13cb, regra tirada das conversas da Laís) ------------------------------
// Quando: (b) o pedido não serve (venda x locação, acima da faixa, fora do bairro desejado, saiu do XML);
// (c) o cliente pede outras opções (vem antes do roteiro). Parecido = mesma imobiliária, mesmo negócio, tipo e
// cidade, preferência pelo mesmo condomínio/bairro, preço na faixa do cliente ou ±15% (o banco decide:
// lead_ia_imoveis_parecidos). 1 por vez, até 3 por conversa, nunca repete. Texto só com dados do XML.
// t_5b493bc9: tom de atendente (sem código, sem parênteses técnicos); "gostei" leva à visita com a própria Nicole.


export const MAX_PARECIDOS = 3;
/** Por chamada ao banco (as funções do banco devolvem no máximo 3). */
const LIMITE_BUSCA = 3;

/** Cliente pede outras opções ("tem outras?", "algo parecido", "mais barato"), tolerando erro de digitação
 * e espaço no meio da palavra ("tem mais opçõe s?"). */
export function pedeOutrasOpcoes(texto: string): boolean {
  const n = norm(texto);
  if (/(pagament|horario|\bdia\b|\bdata\b|visita)/.test(n)) return false;
  const j = n.replace(/[^a-z]/g, "");
  return (
    /(maisop[cs]|outr[ao]s?op[cs]|maisimove|outr[ao]s?imove|outr[ao]s?casa|outr[ao]s?apart|outr[ao]s?apto|outr[ao]s?sugest|maissugest|outr[ao]s?alternativ|outr[ao]s?unidade|maisalgum[a]?op|maisalgumimove|(algo|algum|alguma|outro|outra|imovel|opcao|casa|apartamento)(parecid|similar|semelhant)|maisbarat|maisemconta|alternativa)/.test(j) ||
    // t_37cf21e3: \"oq mais vc tem nesta região?\"
    /\b(o ?q(ue)?|que) mais (vc |voce |voces |vcs )?(tem|tens|teria)\b/.test(n) ||
    /^(e)?(tem|teria|tens|vocetem|vctem|temmais|temoutr[ao]s?|tenmais)(outr[ao]s?|mais|opcoes)?$/.test(j)
  );
}
// --- Conversa de teste de Denis, d8907e38 (t_37cf21e3) ------------------------------------------------
/** Fotos ou vídeo: a Nicole manda de novo o link do anúncio (nunca promete mandar fotos avulsas). */
export function pediuFotos(texto: string): boolean {
  const n = norm(texto);
  return /\b(fotos?|videos?|imagens?|fotinhas?)\b/.test(n) && !/\b(nao (quero|precisa)|ja vi)\b/.test(n);
}
/** "Gostaria" ou "quero" sozinho em resposta a "quer saber mais detalhes ou já prefere agendar?": não é elogio. */
export const SO_GOSTARIA = /^(eu )?(gostaria|gostaria sim|gostaria muito|quero|quero sim)[\s.!]*$/;
/** O cliente disse que gostou (só então cabe "Que bom que gostou!"). */
export const DISSE_QUE_GOSTOU = /(\bgost(ei|ou|o)\b|adorei|amei|curti|legal|lind[oa]|bonit|show|perfeit|otim[oa]|top\b|maravilh|me interess)/;
const PLURAL_TIPO: Record<string, string> = { casa: "casas", apartamento: "apartamentos", terreno: "terrenos", cobertura: "coberturas", studio: "studios" };
/** "não quero casa mesmo" (sem vírgula) pode ser "não, quero casa mesmo" ou "não quero casa": confirma. */
const TIPO_RE = "(casas?|apartamentos?|apto|aptos|ap|aps|terrenos?|sobrados?|coberturas?)";
const AMBIGUO_RE = new RegExp(`^(nao|n) (quero|prefiro) (uma |um |a |o )?${TIPO_RE} (mesmo|msm|mesma)[\\s.!]*$`);
/** Tipo dito com certeza: "não, quero casa", "disse que quero casa", "quero casa sim", "casa mesmo". */
const QUERO_TIPO_RE = new RegExp(
  `^((nao|n), (quero|prefiro)|(eu )?(disse|falei) (q|que) (eu )?(quero|prefiro)|(quero|prefiro)|e) (uma |um |a |o )?${TIPO_RE}( (mesmo|msm|sim))?[\\s.!]*$|^${TIPO_RE} (mesmo|msm|sim)[\\s.!]*$`,
);
export function fraseAmbiguaTipo(texto: string): string | null {
  const m = AMBIGUO_RE.exec(norm(texto));
  return m ? tipoDe(m[4]) : null;
}
export function querTipo(texto: string): string | null {
  const n = norm(texto);
  return QUERO_TIPO_RE.test(n) ? tipoDe(n) : null;
}
/** O cliente voltou a falar da busca DELE (\"sobre a casa q eu to vendo para mim\"). */
const PARA_MIM = /\b(para|pra|pro) mim\b|\b(q|que) eu (to|tou|estou|t[oô]) (vendo|procurando|olhando|buscando)\b|\b(a )?minha (casa|busca|procura)\b|\bmeu (imovel|apartamento|ap)\b|\bpra eu\b/;
/** O cliente fala da 2ª busca (do filho etc.). */
const PARA_ELE = /\b(para|pra|pro|do|da) (o |a )?(meu |minha )?(filho|filha|mae|pai|irmao|irma|esposa|marido|namorad[oa]|sogr[oa]|amig[oa]|neto|neta)\b|\b(para|pra) (ele|ela)\b|\bdele\b|\bdela\b/;
/** "nesta região", "nesse bairro", "aqui perto": a região é a do imóvel do cliente. */
const NESTA_REGIAO = /\b(nesta|nessa|neste|nesse|mesma|mesmo|naquela|naquele|por essa|por esta) (regiao|bairro|area|redondeza)|\b(ali|aqui) perto\b|\bperto (dali|daqui|dessa|desse|dela|dele)\b/;
/** Bairro/região pedido pelo cliente na fala (para dizer com clareza quando não houver nada lá). */
export function regiaoPedida(texto: string, bairroDoImovel?: string | null): string | null {
  const n = norm(texto);
  if (NESTA_REGIAO.test(n) && bairroDoImovel) return bairroDoImovel;
  return bairroDesejado(texto);
}
/** O bairro do imóvel é o bairro pedido? (\"campolim\" = \"Parque Campolim\"). */
export function mesmoBairro(bairro: string | undefined, regiao: string | null | undefined): boolean {
  if (!bairro || !regiao) return false;
  const a = norm(bairro);
  const b = norm(regiao);
  return a.includes(b) || b.includes(a);
}
/** Imóvel de que se fala agora: o da 2ª busca (se ativa), o parecido mostrado ou o que o cliente gostou.
 * null = o imóvel do anúncio do lead. */
export function imovelEmFoco(d: DadosQualificacao): ImovelParecido | null {
  if (d.busca2?.ativa && d.busca2.atual) return d.busca2.atual;
  if (d.parecido_atual) return d.parecido_atual;
  if (d.ultimo_parecido && d.parecido_interesse === d.ultimo_parecido.codigo) return d.ultimo_parecido;
  return null;
}
/** Quartos parecidos com o imóvel do cliente (±1). Pedido do cliente (\"3 suítes\") manda; sem dado, não arrisca. */
export function quartosParecidos(i: Pick<ImovelParecido, "quartos">, ficha: Pick<FichaIa, "quartos"> | null | undefined, pedido?: FiltroCaracteristica): boolean {
  if (pedido?.quartos !== undefined || pedido?.suites !== undefined) return true;
  const ref = ficha?.quartos && /^\d+$/.test(ficha.quartos) ? Number(ficha.quartos) : null;
  if (ref === null || ref === 0) return true;
  const q = i.quartos && /^\d+$/.test(i.quartos) ? Number(i.quartos) : null;
  return q !== null && Math.abs(q - ref) <= 1;
}
/** \"No Campolim não tenho casa nessa faixa agora. A mais perto do que você procura fica no bairro X...\" */
export function textoForaRegiao(p: ImovelParecido, regiao: string, tipoCliente?: string | null, oQue?: string): string {
  const tipo = p.tipo || tipoCliente || "imóvel";
  const procura = oQue ?? `${PLURAL_TIPO[tipoCliente || tipo] ?? "opções"} nessa faixa`;
  const lugar = regiao.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const c = oQue ? caractComSuites(p) : caractCurta(p);
  const v = valorCurto(p);
  const onde = p.bairro ? ` fica ${noBairro(p.bairro)}` : " fica em outro bairro";
  const link = p.url ? ` Dá uma olhada: ${p.url}` : "";
  return `No ${lugar} não tenho ${procura} agora. ${fem(tipo) ? "Uma" : "Um"} ${tipo} parecid${fem(tipo) ? "a" : "o"}${onde}${c ? `, com ${c}` : ""}${v ? `, ${v}` : ""}.${link} Te serve, mesmo sendo em outro bairro?`
    .replace(/\s+/g, " ")
    .trim();
}
/** "até R$ 1.200.000" (para o resumo do corretor e para o modelo). */
export function descreverFaixa(texto: string | undefined, compra = true): string | undefined {
  const v = texto ? valorFaixa(texto, compra) : null;
  if (!v) return texto?.trim() || undefined;
  if (v.min != null && v.max != null) return `de ${reais(v.min)} a ${reais(v.max)}`;
  return v.max != null ? `até ${reais(v.max)}` : `a partir de ${reais(v.min!)}`;
}

/** "nesta mesma faixa", "nesse valor", "parecido com esse": faixa = preço do imóvel do lead (±15%). */
const MESMA_FAIXA = /(mesm[ao]s? (faixa|valor|preco|padrao)|(nessa|nesta|neste|nesse|desse|dessa) (mesma )?(faixa|valor|preco)|parecid[ao] com (esse|essa|este|esta)|valor parecido|preco parecido)/;
const NAO_QUER_MAIS = /nao (quero|precisa|preciso|vou querer)( ver)? (outr|mais)/;
/** Diante de um parecido já mostrado, qualquer "outra/mais uma/próxima" pede o próximo. */
const MAIS_UM = /\b(outr[ao]s?|mais uma|mais um|proxim[ao]|seguinte)\b/;
const GOSTOU = /(gostei|me interess|tenho interesse|interessei|quero (esse|essa|este|esta|saber mais|mais detalhes|detalhes|ver (esse|essa|este|esta))|pode (passar|pedir|mandar|ser)|esse (mesmo|ai)|essa (mesma|ai)|manda (mais|os detalhes)|perfeito|gostaria|legal|bonit|show)/;
const NAO_GOSTOU = /^(nao|n|nao obrigad\w*|nao gostei|nao curti|nao me interess\w*|nao (e|eh) (bem )?isso|nenhum|nenhuma)\b/;
/** "Sim" para a oferta/pergunta (sem cumprimentos, que no SIM geral contam como interesse). */
const SIM_P = /^(sim|s|claro|quero|ok|pode|com certeza|quero sim|pode ser|gostaria|isso|opa|manda|mostra|bora|vamos)\b/;
const MAIS_BARATO = /(mais (barat|em conta|acessivel)|menor (valor|preco)|mais em conta)/;
const AGRADECEU = /(obrigad|valeu|agradec|brigad)/;
const DETALHES = /(detalh|mais informac|mais info|saber mais|me (fala|conta|passa|manda) mais|caracteristic|fotos?\b|como (e|ela e|ele e) (a|o)?)/;

/**
 * Faixa de valor dita pelo cliente, em reais: "até 500 mil" -> {max}; "entre 400 e 600 mil" -> {min,max};
 * "a partir de 1 milhão" -> {min}; "uns 500 mil" -> ±15%. null = não deu para entender (não chuta).
 */
export function valorFaixa(texto: string, milSemUnidade = false): { min?: number; max?: number } | null {
  const n0 = norm(texto).replace(/r\$\s*/g, "");
  // t_37cf21e3: na COMPRA, \"até 1200\" (sem unidade, 100 a 9999) é R$ 1.200.000 (quem compra imóvel fala em mil).
  const n = milSemUnidade
    ? n0.replace(/\b(ate|no maximo|maximo de|teto de|uns|umas)\s+(\d{3,4})(?![\d.,]|\s*(mil|milhao|milhoes|mi\b|k\b|reais|m2|m²|metros|suites?|quartos?|vagas?))/g, "$1 $2 mil")
    : n0;
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

/** "3 quartos e 167 m²" (sem "área útil": conversa, não ficha). */
function caractCurta(p: ImovelParecido): string {
  const m2 = p.area_util_m2 ?? (p.tipo === "terreno" ? p.area_terreno_m2 : undefined);
  return juntar([p.quartos && p.quartos !== "0" ? plural(p.quartos, "quarto", "quartos") : null, m2 ? `${m2} m²` : null].filter(Boolean) as string[]);
}
const valorCurto = (p: ImovelParecido) => (p.aluguel ? `com aluguel de ${reaisTxt(p.aluguel)} por mês` : p.preco ? `por ${reaisTxt(p.preco)}` : "");

/**
 * Oferta de um parecido, como atendente: "Tenho sim! Tem outra casa no mesmo condomínio, com 3 quartos e
 * 167 m², por R$ 1.220.000. Dá uma olhada: <link> Gostou? Se quiser, marco uma visita para você ver as duas."
 * Só dados do XML. Nunca fala de disponibilidade, permuta, financiamento ou andar.
 */
export function textoParecido(p: ImovelParecido, jaMostrados: number, op: { pedido?: boolean; comPedido?: boolean } = {}): string {
  const tipo = p.tipo || "imóvel";
  const f = fem(tipo);
  const abre = op.pedido === false ? "" : jaMostrados <= 1 ? "Tenho sim!" : "";
  const onde =
    p.mesmo_condominio || (p.mesmo_bairro && p.bairro && ehCondominio(p.bairro))
      ? " no mesmo condomínio"
      : p.mesmo_bairro
        ? " no mesmo bairro"
        : p.bairro
          ? ` ${noBairro(p.bairro)}`
          : "";
  const c = caractCurta(p);
  const v = valorCurto(p);
  // 1º: "Tem outra casa no mesmo condomínio, ..."; depois: "Tenho mais uma no mesmo condomínio, ..."
  const desc =
    jaMostrados <= 1
      ? `Tem ${f ? "outra" : "outro"} ${tipo}${onde}${c ? `, com ${c}` : ""}${v ? `, ${v}` : ""}.`
      : `Tenho mais ${f ? "uma" : "um"}${onde || ` ${tipo}`}${c ? `, com ${c}` : ""}${v ? `, ${v}` : ""}.`;
  const link = p.url ? ` Dá uma olhada: ${p.url}` : "";
  const ambos = op.comPedido && jaMostrados <= 1 ? ` para você ver ${f ? "as duas" : "os dois"}` : "";
  return `${abre} ${desc}${link} Gostou? Se quiser, marco uma visita${ambos}.`.replace(/\s+/g, " ").trim();
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
    _limite: Math.min(Math.max(Math.trunc(f.limite ?? 1), 1), LIMITE_BUSCA),
    _mais_barato: f.mais_barato === true,
    _codigo: f.codigo_ref ? f.codigo_ref.trim().slice(0, 60) || null : null,
  };
}

/** Argumentos da RPC lead_ia_imoveis_busca (busca nova, t_5b493bc9). */
export function argsBusca(conversaId: string, f: FiltroBusca) {
  const valor = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e11 ? Math.round(v) : null);
  const txt = (s: string | null | undefined, n = 60) => (s && s.trim() ? s.trim().slice(0, n) : null);
  return {
    _conversa: conversaId,
    _tipo: TIPOS_BUSCA.includes(f.tipo ?? "") ? f.tipo : null,
    _negocio: f.negocio === "locacao" ? "locacao" : "venda",
    _preco_min: valor(f.preco_min),
    _preco_max: valor(f.preco_max),
    _regiao: txt(f.regiao),
    _cidade: txt(f.cidade),
    _excluir: (f.excluir ?? []).filter((c) => typeof c === "string" && c.trim()).slice(0, 20).map((c) => c.trim().slice(0, 60)),
    _limite: Math.min(Math.max(Math.trunc(f.limite ?? 1), 1), LIMITE_BUSCA),
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
    .slice(0, LIMITE_BUSCA)
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

// --- Busca nova no meio da conversa (t_5b493bc9 item 11) ------------------------------------------------
// "eu queria ver um imóvel para o meu filho também, vocês trabalham com apartamento?": responde primeiro
// ("Trabalhamos sim!"), faz 1 pergunta curta por vez (o que faltar: tipo, comprar/alugar, região, até quanto;
// no máximo 3), procura no XML da própria imobiliária e oferece 1 por vez com valor e link. Sem achar, passa
// para a equipe procurar. Tudo vai para o resumo do corretor, sem perder o interesse no imóvel do lead.

/** Tipos que o banco entende (iguais a lead_ia_tipo). */
export const TIPOS_BUSCA = ["apartamento", "casa", "terreno", "cobertura", "studio", "imóvel comercial"];

export function tipoDe(n: string): string | null {
  if (/\bcobertura/.test(n)) return "cobertura";
  if (/\b(studio|estudio|kitnet|kitinete|quitinete)\b/.test(n)) return "studio";
  if (/\b(apartamento|apartamentos|apto|aptos|ap|aps|ape|apes|apartamentinho)\b/.test(n)) return "apartamento";
  if (/\b(sala comercial|loja|galpao|barracao|ponto comercial|imovel comercial|escritorio)\b/.test(n)) return "imóvel comercial";
  if (/\b(casa|casas|sobrado|sobrados|chacara|chacaras)\b/.test(n)) return "casa";
  if (/\b(terreno|terrenos|lote|lotes)\b/.test(n)) return "terreno";
  return null;
}
const PARA_QUEM = /\bpara (o |a )?(meu|minha|um|uma)? ?(filho|filha|mae|pai|irmao|irma|esposa|marido|namorad[oa]|sogr[oa]|amig[oa]|tio|tia|primo|prima|cunhad[oa]|parente|neto|neta|cliente)\b|\b(pro|pra) (meu|minha) (filho|filha|mae|pai|irmao|irma|esposa|marido|namorad[oa]|sogr[oa]|amig[oa]|tio|tia|primo|prima|cunhad[oa]|neto|neta)\b/;
const QUER_BUSCA = /(trabalh\w* com|\btem\b|\btens\b|teria|\bvcs\b|voces|procur|busc|queria|quero|gostaria|interess|preciso|vende(m)?|aluga(m)?|mexe(m)? com)/;
const ELA = new Set(["filha", "mae", "irma", "esposa", "namorada", "sogra", "amiga", "tia", "prima", "cunhada", "neta"]);

/** "meu filho está procurando", "minha filha quer" (t_a9f1b447, teste ao vivo 27/10, conversa 37db8fc6). */
const DE_QUEM = /\b(meu|minha) (filho|filha|mae|pai|irmao|irma|esposa|marido|namorad[oa]|sogr[oa]|amig[oa]|neto|neta)\b.{0,25}\b(procur|busc|quer|precis|esta atras)/;
/** Começo de uma busca nova? (outro tipo de imóvel, ou para outra pessoa). */
function novaBusca(n: string, tipoLead: string | undefined): Busca2 | null {
  const t = tipoDe(n);
  const para = PARA_QUEM.exec(n);
  const dele = DE_QUEM.exec(n);
  const outraPessoa = (!!para && /(tambem|\btb\b|\btbm\b|outr[ao]|mais um|mais uma)/.test(n)) || !!dele;
  const outroTipo = !!t && !!tipoLead && t !== tipoLead && QUER_BUSCA.test(n);
  if (!outroTipo && !(outraPessoa && QUER_BUSCA.test(n))) return null;
  const quem = para ? para[3] ?? para[6] : dele?.[2];
  return { ativa: true, tipo: t ?? "", para: quem ? `${ELA.has(quem) ? "a" : "o"} ${quem === "mae" ? "mãe" : quem === "irmao" ? "irmão" : quem === "irma" ? "irmã" : quem}` : undefined, perguntas: [], ofertados: [] };
}

/** "Ele/ela/você" para as perguntas da busca. */
const quemBusca = (b: Busca2) => {
  const w = b.para?.split(" ")[1];
  if (!w) return { suj: "você", obj: "você" };
  return ELA.has(norm(w)) ? { suj: "ela", obj: "ela" } : { suj: "ele", obj: "ele" };
};

function perguntaBusca(e: EtapaBusca, b: Busca2, cidade?: string | null): string {
  const q = quemBusca(b);
  switch (e) {
    case "tipo":
      return `Que tipo de imóvel ${q.suj} procura: casa ou apartamento?`;
    case "finalidade":
      return "Seria para comprar ou para alugar?";
    case "regiao":
      return `E em qual bairro ou região${cidade ? ` de ${cidade}` : ""} ${q.suj === "você" ? "você prefere" : `${q.suj} prefere`}?`;
    case "quartos":
      return `E quantos quartos ${q.suj === "você" ? "você precisa" : `${q.suj} precisa`}?`;
    case "faixa":
      return b.finalidade === "alugar" ? "E até quanto de aluguel por mês?" : `E até quanto ${q.suj === "você" ? "você pensa" : `${q.suj} pensa`} em investir?`;
  }
}

/** Próxima pergunta da busca nova (uma por vez, cada uma uma vez, no máximo 3). null = já dá para procurar. */
function proximaBusca(b: Busca2): EtapaBusca | null {
  const feitas = b.perguntas ?? [];
  if (feitas.length >= 3) return null;
  if (b.tipo === undefined || (b.tipo === "" && !feitas.includes("tipo"))) return "tipo";
  if (!b.finalidade && b.finalidade !== "" && !feitas.includes("finalidade")) return "finalidade";
  if (b.regiao === undefined && !feitas.includes("regiao")) return "regiao";
  if (b.faixa === undefined && !feitas.includes("faixa")) return "faixa";
  if (b.quartos === undefined && b.suites === undefined && !feitas.includes("quartos") && b.tipo !== "terreno") return "quartos";
  return null;
}

/** Lê do texto tudo o que serve para a busca nova (o cliente pode responder várias coisas de uma vez). */
function preencherBusca(b: Busca2, texto: string, etapa: EtapaBusca | undefined): boolean {
  const n = norm(texto);
  let leu = false;
  const t = tipoDe(n);
  if (t && !b.tipo) {
    b.tipo = t;
    leu = true;
  }
  const fin = finalidadeDe(n);
  if (fin && !b.finalidade) {
    b.finalidade = fin;
    leu = true;
  }
  // t_37cf21e3: \"3 suites ate 1200\" = 3 suítes e até R$ 1.200.000, só para ESTA busca.
  const compra = (b.finalidade || fin) !== "alugar";
  // Com unidade (\"até 400 mil\") guarda como o cliente disse; número solto na compra (\"até 1200\") vira reais.
  const fx = valorFaixa(texto) ? curto(texto, 60) : valorFaixa(texto, compra) ? descreverFaixa(texto, compra) ?? null : null;
  if (fx && b.faixa === undefined) {
    b.faixa = fx;
    leu = true;
  }
  const cr = pedidoCaracteristica(texto);
  if (cr?.suites !== undefined && b.suites === undefined) {
    b.suites = cr.suites;
    leu = true;
  }
  if (cr?.quartos !== undefined && b.quartos === undefined) {
    b.quartos = cr.quartos;
    leu = true;
  }
  if (etapa === "quartos" && b.quartos === undefined && b.suites === undefined) {
    const q = /^\D*(\d{1,2})\D*$/.exec(n);
    if (q && Number(q[1]) >= 1 && Number(q[1]) <= 10) b.quartos = Number(q[1]);
  }
  const reg = /\b(?:no|na|em|pelo|pela|perto d[oa])\s+(?:bairro\s+|regiao\s+(?:d[oa]\s+)?|condominio\s+)?([a-z][a-z ]{2,30}?)(?=\s*(?:[,.!?;]|$|\se\s|\sate\s|\spara\s|\spra\s|\scom\s))/.exec(n);
  if (reg && b.regiao === undefined && !/^(comprar|alugar|torno|faixa|valor)/.test(reg[1])) {
    b.regiao = reg[1].trim().slice(0, 40);
    leu = true;
  }
  // Resposta à pergunta feita, quando nada acima a reconheceu: "tanto faz" = sem filtro; senão guarda como veio.
  const tantoFaz = /(tanto faz|qualquer|nao (sei|importa|tem preferencia)|indiferente|sem preferencia|tanto  faz)/.test(n);
  if (etapa === "tipo" && !b.tipo) b.tipo = tantoFaz ? "" : (t ?? "");
  if (etapa === "finalidade" && !b.finalidade) b.finalidade = fin ?? "";
  if (etapa === "regiao" && b.regiao === undefined) b.regiao = tantoFaz ? "" : curto(texto, 40);
  if (etapa === "faixa" && b.faixa === undefined) b.faixa = tantoFaz ? "" : curto(texto, 60);
  return leu || !!etapa;
}

/** Texto da oferta da busca nova: só dados do XML. */
export function textoBusca(p: ImovelParecido, jaMostrados: number, comSuites = false): string {
  const tipo = p.tipo || "imóvel";
  const f = fem(tipo);
  const onde = p.bairro ? ` ${noBairro(p.bairro)}${p.cidade ? `, em ${p.cidade}` : ""}` : "";
  const c = comSuites ? caractComSuites(p) : caractCurta(p);
  const v = valorCurto(p);
  const abre = jaMostrados <= 1 ? `Achei ${f ? "uma" : "um"} ${tipo}` : `Tenho também ${f ? "uma" : "um"} ${tipo}`;
  const link = p.url ? ` Dá uma olhada: ${p.url}` : "";
  const fecho = jaMostrados < MAX_PARECIDOS ? "O que acha? Se quiser, te mando outra opção." : "O que acha?";
  return `${abre}${onde}${c ? `, com ${c}` : ""}${v ? `, ${v}` : ""}.${link} ${fecho}`.replace(/\s+/g, " ").trim();
}

// --- Busca por característica (t_a9f1b447, teste ao vivo de Denis 27/10: "Tem alguma opção de 3 suítes?") ----
// Suítes, quartos, vagas e área (com tipo, bairro e finalidade quando ditos junto) viram filtro no XML da própria
// imobiliária ANTES do modelo. Sem nada na faixa: diz com honestidade e mostra o mais próximo, com preço e link.

const NUM_PALAVRA: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };
const CARAC_RE =
  /\b(\d{1,2}|uma|um|duas|dois|tres|quatro|cinco|seis)\s*(?:ou mais\s*)?(suites?|quartos?|d[oa]m?r?m?[a-z]*torios?|dorms?|vagas?)\b/g;
/** Quer opções (e não só saber do imóvel do anúncio). */
const QUER_OPCAO = /(opc|outr[ao]|algum|alguma|queria|quero|procur|busc|preciso|precisa|gostaria|teria|tens\b|vcs tem|voces tem|com \d|mais (suites|quartos|vagas))/;

/** \"Tem alguma opção de 3 suítes?\" -> {suites: 3}. null = não é pedido de característica com número. */
export function pedidoCaracteristica(texto: string): FiltroCaracteristica | null {
  const n = norm(texto);
  const f: FiltroCaracteristica = {};
  for (const m of n.matchAll(CARAC_RE)) {
    const v = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_PALAVRA[m[1]];
    if (!v || v > 10) continue;
    if (/^suite/.test(m[2])) f.suites = v;
    else if (/^(quarto|d[oa])/.test(m[2])) f.quartos = v;
    else f.vagas = v;
  }
  const a = /\b(\d{2,4})\s*(m2|m²|metros)/.exec(n);
  if (a && Number(a[1]) >= 20) f.area = Number(a[1]);
  if (f.suites === undefined && f.quartos === undefined && f.vagas === undefined && f.area === undefined) return null;
  const t = tipoDe(n);
  if (t) f.tipo = t;
  const fin = finalidadeDe(n);
  if (fin) f.finalidade = fin;
  const b = /\b(?:no|na|em)\s+(?:bairro|regiao|condominio)\s+([a-z0-9][a-z0-9 ]{2,38}?)(?=\s*(?:[,.!?;]|$|\se\s|\scom\s))/.exec(n);
  if (b) f.bairro = b[1].trim().slice(0, 40);
  return f;
}

/** O imóvel tem o que foi pedido? (sem dado no XML = não atende). */
export function atendeCaracteristica(
  p: { suites?: string; quartos?: string; vagas?: string; area_util_m2?: string; tipo?: string },
  f: FiltroCaracteristica | undefined,
): boolean {
  if (!f) return true;
  const n = (s?: string) => (s && /^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : -1);
  if (f.suites !== undefined && n(p.suites) < f.suites) return false;
  if (f.quartos !== undefined && n(p.quartos) < f.quartos) return false;
  if (f.vagas !== undefined && n(p.vagas) < f.vagas) return false;
  if (f.area !== undefined && n(p.area_util_m2) < f.area) return false;
  if (f.tipo && p.tipo && p.tipo !== f.tipo) return false;
  return true;
}

/** \"3 suítes\", \"4 quartos e 2 vagas\", \"pelo menos 150 m²\" (só o pedido, sem o tipo). */
export function textoCaracteristica(f: FiltroCaracteristica): string {
  const p: string[] = [];
  if (f.suites !== undefined) p.push(plural(String(f.suites), "suíte", "suítes"));
  if (f.quartos !== undefined) p.push(plural(String(f.quartos), "quarto", "quartos"));
  if (f.vagas !== undefined) p.push(plural(String(f.vagas), "vaga", "vagas"));
  if (f.area !== undefined) p.push(`pelo menos ${f.area} m²`);
  return juntar(p);
}

/** Um passo abaixo do pedido (\"3 suítes\" -> \"2 suítes\"), para oferecer quando não há nada. */
function relaxar(f: FiltroCaracteristica): FiltroCaracteristica | null {
  if (f.suites !== undefined && f.suites > 1) return { ...f, suites: f.suites - 1 };
  if (f.quartos !== undefined && f.quartos > 1) return { ...f, quartos: f.quartos - 1 };
  if (f.vagas !== undefined && f.vagas > 1) return { ...f, vagas: f.vagas - 1 };
  return null;
}

/** \"3 quartos, 3 suítes e 184 m²\". */
function caractComSuites(p: ImovelParecido): string {
  const m2 = p.area_util_m2 ?? (p.tipo === "terreno" ? p.area_terreno_m2 : undefined);
  return juntar(
    [
      p.quartos && p.quartos !== "0" ? plural(p.quartos, "quarto", "quartos") : null,
      p.suites && p.suites !== "0" ? plural(p.suites, "suíte", "suítes") : null,
      p.vagas && p.vagas !== "0" ? plural(p.vagas, "vaga", "vagas") : null,
      m2 ? `${m2} m²` : null,
    ].filter(Boolean) as string[],
  );
}
function umImovel(p: ImovelParecido): string {
  const tipo = p.tipo || "imóvel";
  const onde = p.bairro ? ` ${noBairro(p.bairro)}` : "";
  return `${fem(tipo) ? "uma" : "um"} ${tipo}${onde}`;
}

/** Oferta de um imóvel que atende a característica pedida (dentro da faixa). */
export function textoCaracOferta(p: ImovelParecido, f: FiltroCaracteristica, jaMostrados: number): string {
  const c = caractComSuites(p);
  const v = valorCurto(p);
  const abre = jaMostrados <= 1 ? `Tenho sim! Com ${textoCaracteristica(f)} tem` : "Tenho também";
  const link = p.url ? ` Dá uma olhada: ${p.url}` : "";
  return `${abre} ${umImovel(p)}${c ? `, com ${c}` : ""}${v ? `, ${v}` : ""}.${link} Gostou?`.replace(/\s+/g, " ").trim();
}
/** Nada na faixa: diz com honestidade e mostra o mais próximo (preço e link); sugere um passo abaixo. */
export function textoCaracForaFaixa(
  p: ImovelParecido | null,
  f: FiltroCaracteristica,
  menos: FiltroCaracteristica | null,
  temFaixa: boolean,
  jaMostrados = 0,
): string {
  const pedido = textoCaracteristica(f);
  const alt = menos ? `prefere que eu procure com ${textoCaracteristica(menos)}` : null;
  if (!p) {
    return junta(
      jaMostrados ? `Com ${pedido}${temFaixa ? " nessa faixa" : ""} não achei mais nenhuma agora.` : `Com ${pedido}${temFaixa ? " nessa faixa" : ""} não tenho nenhuma opção agora.`,
      alt ? `Quer que eu procure com ${textoCaracteristica(menos!)}?` : "Quer que eu procure outras opções parecidas?",
    );
  }
  const v = p.preco ? `por ${reaisTxt(p.preco)}` : p.aluguel ? `com aluguel de ${reaisTxt(p.aluguel)} por mês` : "";
  const link = p.url ? `: ${p.url}` : ".";
  const c = caractComSuites(p);
  if (jaMostrados) return junta(`Outra com ${pedido} é ${umImovel(p)}${c ? `, com ${c}` : ""}${v ? `, ${v}` : ""}${link}`, alt ? `Gostou, ou ${alt}?` : "Gostou?");
  const abre = temFaixa ? `Com ${pedido}, nessa faixa não tenho.` : `Com ${pedido} tenho poucas opções.`;
  const desc = `A mais em conta é ${umImovel(p)}${c ? `, com ${c}` : ""}${v ? `, ${v}` : ""}${link}`;
  return junta(abre, desc, alt ? `Quer dar uma olhada, ou ${alt}?` : "Quer dar uma olhada?");
}

/** Argumentos da RPC lead_ia_imoveis_caracteristica (t_a9f1b447). */
export function argsCaracteristica(conversaId: string, f: FiltroCaracteristicaBusca) {
  const valor = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e11 ? Math.round(v) : null);
  const cont = (v: number | undefined) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null);
  const txt = (s: string | null | undefined) => (s && s.trim() ? s.trim().slice(0, 60) : null);
  return {
    _conversa: conversaId,
    _negocio: f.negocio === "locacao" ? "locacao" : "venda",
    _suites: cont(f.suites),
    _quartos: cont(f.quartos),
    _vagas: cont(f.vagas),
    _area: typeof f.area === "number" && f.area >= 1 && f.area <= 100000 ? Math.round(f.area) : null,
    _tipo: TIPOS_BUSCA.includes(f.tipo ?? "") ? f.tipo : null,
    _bairro: txt(f.bairro),
    _preco_min: valor(f.preco_min),
    _preco_max: valor(f.preco_max),
    _cidade: txt(f.cidade),
    _excluir: (f.excluir ?? []).filter((c) => typeof c === "string" && c.trim()).slice(0, 20).map((c) => c.trim().slice(0, 60)),
    _limite: Math.min(Math.max(Math.trunc(f.limite ?? 3), 1), LIMITE_BUSCA),
  };
}
/** Resposta da RPC: só chaves conhecidas (mesma limpeza dos parecidos). */
export function normalizarCaracteristica(data: unknown): ResultadoCaracteristica | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { itens?: unknown; proximo?: unknown };
  const itens = normalizarParecidos({ itens: d.itens })?.itens ?? [];
  const prox = d.proximo && typeof d.proximo === "object" ? normalizarParecidos({ itens: [d.proximo] })?.itens[0] ?? null : null;
  return { itens, proximo: prox };
}

/** O cliente disse que quer visitar? (as datas só aparecem depois disso, t_a9f1b447 item 7). */
export function querVisitar(ctx: Pick<ContextoIa, "passo" | "dados">, texto: string): boolean {
  const n = norm(texto);
  const d = ctx.dados ?? {};
  if (ctx.passo === "visita" || (d.visita_opcoes?.length && !d.visita)) return true;
  if (QUER_VISITA.test(n) && !/^(nao|n)\b/.test(n)) return true;
  return d.convite_aberto === "visita" && SIM_P.test(n) && !NAO_GOSTOU.test(n);
}

/** Junta o pedido novo ao anterior (\"Não tem outra casa?\" depois de \"3 suítes\" = casa com 3 suítes). */
export function juntarFiltro(antes: FiltroCaracteristica | undefined, novo: Partial<FiltroCaracteristica>): FiltroCaracteristica {
  const r: FiltroCaracteristica = { ...(antes ?? {}) };
  for (const [k, v] of Object.entries(novo)) if (v !== undefined && v !== null && v !== "") (r as Record<string, unknown>)[k] = v;
  return r;
}

// --- Roteiro --------------------------------------------------------------------------------------------
// t_5b493bc9 (teste real de Denis, 27/10): "a ideia é que a pessoa pense que está falando com uma pessoa real".
// - O pedido do cliente vem antes do roteiro: pergunta, "tem mais opções?", busca nova, visita.
// - Pergunta objetiva: só o dado + 1 pergunta natural para avançar (visita, ou "mais algum detalhe?").
// - Faixa de valor só quando o cliente quer outras opções e não há preço de referência. A forma de pagamento
//   não é perguntada pelo roteiro de regras (é anotada se o cliente disser).
// - A Nicole conduz sozinha; outra pessoa só aparece na passagem, uma vez ("Já pedi para {corretor} te chamar").
// Estas regras são também o PLANO B do modelo que escreve as respostas (caminho 2 de Denis).

export const PERGUNTA: Record<Pergunta, string> = {
  finalidade: "Você procura para comprar ou para alugar?",
  faixa: "Até quanto você pensa em investir?",
  // t_59ab47d4: sem "permuta" nas opções sugeridas. Não é perguntada pelo roteiro novo (t_5b493bc9).
  pagamento: "E você pensa em pagar à vista ou com financiamento?",
};
export const PERGUNTA_PARECIDO = "Quer que eu te mostre outras opções parecidas?";
export const CONVITE_VISITA = "Quer agendar uma visita para conhecer?";
export const MAIS_DETALHE = "Quer saber mais algum detalhe?";

/** Próxima pergunta de qualificação: só a finalidade, quando nem o portal nem o XML dizem. null = nenhuma. */
export function proximaPergunta(
  dados: DadosQualificacao,
  ctx: Pick<ContextoIa, "transacao">,
  ficha?: FichaIa | null,
): Pergunta | null {
  const feitas = dados.perguntas ?? [];
  const doXml = ficha?.negocio === "venda" ? "comprar" : ficha?.negocio === "locacao" ? "alugar" : undefined;
  const finalidade = dados.finalidade ?? (ctx.transacao === "venda" ? "comprar" : ctx.transacao === "aluguel" ? "alugar" : doXml);
  if (!finalidade && !feitas.includes("finalidade")) return "finalidade";
  return null;
}

function extrairCodigo(texto: string): string | null {
  const m = texto.toUpperCase().match(/\b(?=[A-Z0-9-]*\d)[A-Z]{0,5}-?[0-9][A-Z0-9-]{2,30}\b/);
  return m ? m[0].slice(0, 40) : null;
}

const junta = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).join(" ");

/**
 * Próxima resposta da IA para a mensagem do cliente. Ordem de prioridade:
 * sensível -> pediu pessoa -> robô? -> não é lead -> recusa -> pedido do cliente (busca nova, outras opções,
 * dúvida, visita) -> convite do turno anterior -> conversa (detalhes, 1 pergunta natural).
 * (Opt-out já foi tratado no banco antes de chegar aqui.)
 */
export async function proximaResposta(
  ctx: ContextoIa,
  texto: string,
  extrator?: Extrator,
  op: OpcoesRoteiro = {},
): Promise<RespostaIa> {
  const agora = op.agora ?? new Date();
  const b0 = ctx.dados.busca2;
  const dados: DadosQualificacao = {
    ...ctx.dados,
    repeticoes: { ...(ctx.dados.repeticoes ?? {}) },
    perguntas: [...(ctx.dados.perguntas ?? [])],
    ...(b0 ? { busca2: { ...b0, perguntas: [...(b0.perguntas ?? [])], ofertados: [...(b0.ofertados ?? [])] } } : {}),
  };
  const n = norm(texto);
  const parcial = () => resumoQualificacao(dados, ctx);
  // A pergunta de fecho do turno anterior vale só para esta resposta.
  const convite = dados.convite_aberto;
  dados.convite_aberto = undefined;

  if (ehSensivel(texto))
    return passar(
      dados,
      "sensivel",
      "Entendi.",
      `${CHAMAR} para cuidar disso com você.`,
      FALHA_PADRAO,
      `Assunto sensível: \"${curto(texto, 160)}\". Atender com prioridade. Dados até aqui: ${parcial()}`,
    );
  // \"Sim\" para a oferta de passar ao corretor feita depois de \"é robô?\": passa (t_25fe1197).
  const ofereceuCorretor = dados.ofereceu_corretor;
  dados.ofereceu_corretor = undefined;
  if (pediuPessoa(texto) || (ofereceuCorretor && SIM_P.test(n) && !detectarTemas(texto).length))
    return passar(dados, "pediu_pessoa", "Claro!", `${CHAMAR}.`, FALHA_PADRAO, `Cliente pediu para falar com uma pessoa. Dados até aqui: ${parcial()}`);
  // \"É robô?\": não se apresenta como robô, mas não mente se perguntarem direto (limite decidido com Denis).
  if (perguntouSeRobo(texto)) {
    dados.ofereceu_corretor = true;
    const quem = `Sou a ${(ctx.ia_nome || "Nicole").trim()}, assistente${ctx.org_nome ? ` da ${ctx.org_nome}` : ""}, e respondo por aqui com ajuda de um sistema.`;
    return {
      passo: ctx.passo === "fim" ? "visita" : ctx.passo,
      dados,
      resposta: `${quem} Se preferir falar com um corretor, te passo agora. Quer?`,
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
      "Entendi!",
      `Já pedi para ${CORRETOR} te responder por aqui.`,
      FALHA_PADRAO,
      `${quem}, não é comprador nem locatário: \"${curto(texto, 160)}\". Atender sem o roteiro de qualificação.`,
    );
  }
  const parecidoPendente = !!(dados.parecido_atual || dados.parecido_pergunta || dados.busca2?.ativa);
  // "não, tudo bem. quantos quartos?" e "não" à oferta do corretor (depois de "é robô?") não são recusa.
  const recusaSimples = ctx.passo === "interesse" && !dados.interesse && !parecidoPendente && !ofereceuCorretor && SEM_INTERESSE.test(n) && !SIM.test(n) && !ehPergunta(texto);
  if (RECUSA.test(n) || recusaSimples)
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
  let achouCodigo = false;
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
        achouCodigo = true;
      }
    }
  }

  const passoAtual: Passo = ctx.passo === "fim" ? "visita" : ctx.passo;
  const busca = op.buscarParecidos;
  const negocio = (): NegocioParecido =>
    dados.finalidade === "alugar" || (!dados.finalidade && (ctx.transacao === "aluguel" || ficha?.negocio === "locacao")) ? "locacao" : "venda";
  const continuar = (resposta: string, passo: Passo = passoAtual === "codigo" ? "interesse" : passoAtual): RespostaIa => ({
    passo,
    dados,
    resposta,
    resposta_falha: null,
    fim: null,
    resumo: null,
  });
  const sujeito = oImovel(ficha?.tipo);

  /** Convida para a visita com 2 opções (a própria Nicole conduz; o corretor só confirma o horário). */
  const ofereceVisita = (intro: string, alvo?: string): RespostaIa => {
    const opcoes = opcoesVisita(agora);
    dados.visita_opcoes = opcoes;
    dados.convite_visita = true;
    const para = alvo ?? (ficha?.tipo ? `conhecer ${sujeito}` : frase ? `conhecer ${frase}` : "conhecer o imóvel");
    return continuar(
      junta(intro, `Para ${para}, tenho ${opcoes[0]} ou ${opcoes[1]}. Qual fica melhor para você? Te confirmo o horário certinho.`),
      "visita",
    );
  };
  /** 1 pergunta natural para avançar: visita (uma vez) ou mais algum detalhe. */
  const fecho = (intro: string): RespostaIa => {
    if (dados.visita_opcoes && !dados.visita)
      return continuar(junta(intro, `Sobre a visita: ${dados.visita_opcoes[0]} ou ${dados.visita_opcoes[1]} fica bom para você?`), "visita");
    if (!dados.convite_visita) {
      dados.convite_visita = true;
      dados.convite_aberto = "visita";
      return continuar(junta(intro, CONVITE_VISITA), "interesse");
    }
    // t_a9f1b447: \"Quer saber mais algum detalhe?\" nunca sozinha nem repetida; a reserva reconhece o pedido.
    const vez = dados.detalhe_perguntado ?? 0;
    dados.detalhe_perguntado = vez + 1;
    if (intro && vez === 0) {
      dados.convite_aberto = "detalhe";
      return continuar(junta(intro, MAIS_DETALHE), "interesse");
    }
    dados.convite_aberto = "opcoes";
    const f = dados.filtro_pedido;
    const outras = f ? `outras opções com ${textoCaracteristica(f)}` : "outras opções parecidas";
    return continuar(junta(intro || "Entendi!", `Quer que eu te mostre ${outras} ou prefere marcar uma visita?`), "interesse");
  };
  /** \"Não\" a uma pergunta de fecho: segue a conversa (não passa ao corretor, t_a9f1b447 item 5). */
  const naoSegue = (): RespostaIa => {
    if (dados.nao_seguiu) return continuar("Combinado! Qualquer dúvida, é só me chamar por aqui.", "interesse");
    dados.nao_seguiu = true;
    dados.convite_aberto = "opcoes";
    const f = dados.filtro_pedido;
    const outras = f ? `outras com ${textoCaracteristica(f)}` : "outras opções parecidas";
    return continuar(`Tranquilo! Quer que eu procure ${outras} ou prefere marcar uma visita?`, "interesse");
  };
  /** Passa ao corretor (a única menção a outra pessoa). */
  const passarAo = (intro: string, depois: string, falha = FALHA_PADRAO) =>
    passar(dados, "qualificado", intro, `${CHAMAR}${depois ? ` ${depois}` : ""}.`, falha, resumoQualificacao(dados, ctx));

  // --- Imóvel parecido do XML (t_232e13cb). Sem op.buscarParecidos: não oferece. ---
  /** Oferece o próximo parecido (1 por vez, até 3, nunca repete) ou diz com franqueza que não há. */
  // t_0c590c55 item 1: \"extraUm\" = o cliente corrigiu o tipo (\"disse q quero casa\") depois das 3 opções; ganha
  // mais 1 opção desse tipo (com link) ou, sem nenhuma, a última que viu de novo com o link.
  const ofertar = async (intro: string, extra: Partial<FiltroParecido> = {}, pre?: ResultadoParecidos | null, pedido = true, extraUm = false): Promise<RespostaIa> => {
    const ja = dados.parecidos ?? [];
    const limite = MAX_PARECIDOS + (extraUm ? 1 : 0);
    const ultimo = dados.ultimo_parecido;
    dados.parecido_atual = undefined;
    dados.parecido_pergunta = undefined;
    const fimOpcoes = (t: string) => {
      dados.parecidos_fim = true;
      return continuar(junta(intro, t, "Gostou de alguma? Se quiser, marco uma visita."));
    };
    const deNovo = () =>
      ultimo?.url
        ? continuar(junta(intro, `A última ${ultimo.tipo || "opção"} que te mostrei${ultimo.bairro ? ` fica ${noBairro(ultimo.bairro)}` : ""}${valorCurto(ultimo) ? `, ${valorCurto(ultimo)}` : ""}: ${ultimo.url} Quer ver essa ou prefere agendar a visita?`))
        : null;
    if (ja.length >= limite) {
      if (extraUm) return deNovo() ?? fimOpcoes("Essas são as opções que tenho agora nesse perfil.");
      if (!dados.parecidos_fim) return fimOpcoes("Essas são as opções que tenho agora nesse perfil.");
      return passarAo(junta(intro, "Vou procurar mais opções para você."), "com outras opções");
    }
    const fx = valorFaixa(dados.faixa ?? "", negocio() === "venda");
    const filtro: FiltroParecido = {
      excluir: ja,
      negocio: negocio(),
      preco_min: fx?.min ?? null,
      preco_max: fx?.max ?? null,
      codigo_ref: dados.imovel_xml_codigo ?? dados.anuncio_informado ?? null,
      ...extra,
    };
    const res = pre !== undefined ? pre : await busca!(filtro).catch(() => null);
    // Nunca oferece de novo um imóvel que não atende o que o cliente pediu (\"3 suítes\", t_a9f1b447) nem um com
    // quartos muito diferentes do imóvel do cliente (t_37cf21e3 item 1: casa de 3 quartos -> 2 a 4 quartos).
    const serve = (i: ImovelParecido) => !ja.includes(i.codigo) && atendeCaracteristica(i, dados.filtro_pedido) && quartosParecidos(i, ficha, dados.filtro_pedido);
    let p = res?.itens.find(serve);
    // t_37cf21e3 item 2: nada no bairro pedido -> diz isso com clareza e só então mostra outro bairro, avisando.
    let foraRegiao: string | undefined;
    if (!p && extra.bairro && pre === undefined) {
      const res2 = await busca!({ ...filtro, bairro: null }).catch(() => null);
      p = res2?.itens.find(serve);
      if (p) foraRegiao = extra.bairro;
    }
    if (!p) {
      if (extraUm) {
        const r0 = deNovo();
        if (r0) return r0;
      }
      if (res && ja.length && !dados.parecidos_fim) return fimOpcoes("Por enquanto essas são as opções parecidas que tenho por aqui.");
      const franco = !res
        ? "Vou separar outras opções para você."
        : (extra.negocio ?? negocio()) === "locacao"
          ? "Agora não tenho uma opção de locação parecida por aqui, mas vou procurar para você."
          : "Agora não tenho outra opção parecida com essa por aqui, mas vou procurar para você.";
      return passarAo(junta(intro, franco), "com outras opções");
    }
    dados.parecidos = [...ja, p.codigo].slice(0, limite);
    dados.parecido_atual = p;
    dados.ultimo_parecido = p;
    dados.interesse = true;
    dados.convite_visita = true;
    // O modelo recebe esta casa como candidata (a busca normal para depois de 3 opções).
    if (extraUm && !extra.bairro)
      return {
        ...continuar(junta(intro, textoParecido(p, dados.parecidos.length, { pedido, comPedido: false }))),
        intencao: "opcoes",
        busca: { pedido: `outras opções do tipo ${p.tipo || "pedido"}`, itens: [p], fora_faixa: false },
      };
    const r: RespostaIa = {
      ...continuar(
        junta(intro, foraRegiao ? textoForaRegiao(p, foraRegiao, ficha?.tipo) : textoParecido(p, dados.parecidos.length, { pedido, comPedido: !!ficha?.tipo && p.tipo === ficha.tipo })),
      ),
      ...(pedido ? { intencao: "opcoes" as const } : {}),
    };
    // O modelo recebe o mesmo imóvel e o aviso de região (só quando o cliente pediu um bairro).
    return extra.bairro ? { ...r, busca: { pedido: `opções no bairro ${extra.bairro}`, itens: [p], fora_faixa: false, ...(foraRegiao ? { fora_regiao: foraRegiao } : {}) } } : r;
  };

  // --- Busca nova no meio da conversa (item 11): outra pessoa, outro tipo. Não perde o imóvel do lead. ---
  const b2 = dados.busca2;
  const quemB = (b: Busca2) => (b.para ? b.para.replace(/^o /, "o seu ").replace(/^a /, "a sua ") : null);
  const perguntarOuBuscar = async (b: Busca2, intro: string, primeira = false, pediu = false): Promise<RespostaIa> => {
    const e = proximaBusca(b);
    if (e) {
      b.perguntas = [...(b.perguntas ?? []), e];
      b.etapa = e;
      const q = perguntaBusca(e, b, ficha?.cidade);
      const para = primeira && quemB(b) ? `Para ${quemB(b)}, ${q[0].toLowerCase()}${q.slice(1)}` : q;
      // t_37cf21e3: a pergunta da 2ª busca sai com o texto do roteiro, para a resposta do cliente cair no campo certo.
      return continuar(junta(intro, para));
    }
    b.etapa = undefined;
    const ja = b.ofertados ?? [];
    const tipoB = b.tipo || "imóvel";
    const art = `${fem(tipoB) ? "uma" : "um"} ${tipoB}`;
    const paraQuem = quemB(b) ? `para ${quemB(b)!.replace(/^o seu /, "o seu ").replace(/^a sua /, "a sua ")}` : "para você";
    if (ja.length >= MAX_PARECIDOS) {
      b.ativa = false;
      return passarAo(junta(intro, `Vou procurar mais opções ${paraQuem}.`), "com outras opções");
    }
    // t_37cf21e3: o perfil DESTA busca (tipo, região, suítes/quartos e faixa), nunca o do imóvel do cliente.
    const negocioB: NegocioParecido = b.finalidade === "alugar" ? "locacao" : "venda";
    const fx = valorFaixa(b.faixa ?? "", negocioB === "venda");
    const comCarac = (b.suites !== undefined || b.quartos !== undefined) && !!op.buscarCaracteristica;
    const procurar = async (regiao: string | null): Promise<ImovelParecido[] | null> => {
      if (comCarac) {
        const r = await op.buscarCaracteristica!({
          suites: b.suites, quartos: b.quartos, tipo: b.tipo || undefined, bairro: regiao ?? undefined, negocio: negocioB,
          preco_min: fx?.min ?? null, preco_max: fx?.max ?? null, cidade: ficha?.cidade ?? null, excluir: ja, limite: 3,
        }).catch(() => null);
        return r ? r.itens : null;
      }
      if (!op.buscarImoveis) return null;
      const r = await op.buscarImoveis({
        tipo: b.tipo || null, negocio: negocioB, preco_min: fx?.min ?? null, preco_max: fx?.max ?? null,
        regiao, cidade: ficha?.cidade ?? null, excluir: ja, limite: 1,
      }).catch(() => null);
      return r ? r.itens : null;
    };
    const regiao = b.regiao || null;
    let itens = await procurar(regiao);
    let p = itens?.find((i) => !ja.includes(i.codigo));
    // Nada na região pedida: diz isso com clareza e só então mostra outro bairro, avisando (item 2).
    let foraRegiao: string | undefined;
    if (!p && regiao) {
      itens = await procurar(null);
      p = itens?.find((i) => !ja.includes(i.codigo) && !mesmoBairro(i.bairro, regiao));
      if (p) foraRegiao = regiao;
    }
    const pedidoB = [b.tipo || "imóvel", b.suites !== undefined ? `com ${plural(String(b.suites), "suíte", "suítes")}` : b.quartos !== undefined ? `com ${plural(String(b.quartos), "quarto", "quartos")}` : null, regiao ? `no ${regiao}` : null, b.faixa || null]
      .filter(Boolean)
      .join(" ");
    if (!p) {
      b.ativa = false;
      const t = ja.length ? `Não achei mais nenhum nesse perfil agora, mas vou procurar ${paraQuem}.` : `Agora não achei ${art} nesse perfil por aqui, mas vou procurar ${paraQuem}.`;
      return passarAo(junta(intro, t), "com as opções");
    }
    b.ofertados = [...ja, p.codigo].slice(0, MAX_PARECIDOS);
    b.atual = p;
    if (pediu) b.ativa = true;
    const oQue = `${PLURAL_TIPO[b.tipo || ""] ?? "imóveis"}${b.suites !== undefined ? ` com ${plural(String(b.suites), "suíte", "suítes")}` : ""}${b.faixa ? ` ${b.faixa}` : ""}`;
    const texto2 = foraRegiao ? textoForaRegiao(p, foraRegiao, b.tipo, oQue) : textoBusca(p, b.ofertados.length, b.suites !== undefined);
    return {
      ...continuar(junta(intro, texto2)),
      busca: { pedido: pedidoB, itens: [p], fora_faixa: false, perfil: "segunda", ...(foraRegiao ? { fora_regiao: foraRegiao } : {}) },
      ...(pediu ? { intencao: "opcoes" as const } : {}),
    };
  };
  // t_37cf21e3 item 3: de qual busca o cliente fala agora? (as mensagens que chegaram juntas contam:
  // \"sobre a casa q eu to vendo para mim\" + \"vc tem mais opções?\"). O perfil de cada busca fica guardado.
  const falasJuntas = norm([...(op.falasAntes ?? []), texto].join(" "));
  if (b2?.ativa && PARA_MIM.test(falasJuntas) && !PARA_ELE.test(n)) {
    b2.ativa = false;
    b2.etapa = undefined;
  } else if (b2 && !b2.ativa && b2.tipo !== undefined && PARA_ELE.test(n) && !PARA_MIM.test(n) && (MAIS_UM.test(n) || pedeOutrasOpcoes(texto) || detectarTemas(texto).length)) {
    b2.ativa = true;
  }

  // t_37cf21e3 item 4: frase com dois sentidos (\"não quero casa mesmo\"): confirma em 1 pergunta curta.
  const tipoPendente = dados.confirmar_tipo;
  dados.confirmar_tipo = undefined;
  const ambiguo = b2?.etapa ? null : fraseAmbiguaTipo(texto);
  if (ambiguo) {
    dados.confirmar_tipo = ambiguo;
    return { ...continuar(`Só para eu entender certo: você quer ver ${PLURAL_TIPO[ambiguo] ?? ambiguo}, certo?`), fixo: true };
  }
  // Tipo confirmado (\"disse q quero casa\", \"sim\" à confirmação): mostra as outras opções desse tipo, se houver.
  const tipoDito = b2?.etapa ? null : (querTipo(texto) ?? (tipoPendente && SIM_P.test(n) && !NAO_GOSTOU.test(n) ? tipoPendente : null));
  if (tipoDito && busca && ficha?.tipo === tipoDito) {
    if (b2?.ativa) b2.ativa = false;
    if (dados.filtro_pedido?.tipo && dados.filtro_pedido.tipo !== tipoDito) dados.filtro_pedido = { ...dados.filtro_pedido, tipo: tipoDito };
    // t_0c590c55 item 1: mostra uma casa (com link), mesmo depois das 3 opções; a intenção vem do ofertar.
    return ofertar(`Combinado, ${PLURAL_TIPO[tipoDito] ?? tipoDito} então!`, {}, undefined, false, true);
  }
  if (tipoDito && b2 && b2.tipo === tipoDito && b2.tipo !== ficha?.tipo) {
    b2.ativa = true;
    return perguntarOuBuscar(b2, "Combinado!");
  }
  if (tipoPendente && NAO_GOSTOU.test(n) && !tipoDito) return continuar("Entendi! Que tipo de imóvel você prefere, então?");

  // t_37cf21e3 item 6: fotos ou vídeo = o link do anúncio do imóvel de que estão falando (nunca promete fotos).
  if (pediuFotos(texto) && !detectarTemas(texto).length) {
    const foco = imovelEmFoco(dados);
    const link = foco ? foco.url : ficha?.link;
    const fecha = dados.visita_opcoes && !dados.visita ? `Sobre a visita: ${dados.visita_opcoes[0]} ou ${dados.visita_opcoes[1]} fica bom para você?` : CONVITE_VISITA;
    // Com link, o modelo escreve (sabe de qual imóvel se fala) e a trava \"fotos\" exige o link; sem link, texto fixo.
    if (link) return continuar(`As fotos estão todas no anúncio: ${link} ${fecha}`);
    dados.pendentes = [...new Set([...(dados.pendentes ?? []), "enviar as fotos do imóvel"])].slice(0, 12);
    return { ...continuar(`As fotos o corretor te envia por aqui. ${fecha}`), fixo: true };
  }

  if (b2?.ativa) {
    if (b2.etapa && /(visitar|agendar|marcar)/.test(n) && QUER_VISITA.test(n)) {
      b2.etapa = undefined;
      b2.ativa = false; // o que já disse da busca fica anotado para o corretor
    } else if (b2.etapa) {
      // Resposta à pergunta da busca (o cliente pode responder várias coisas de uma vez).
      const etapa = b2.etapa;
      b2.etapa = undefined;
      preencherBusca(b2, texto, etapa);
      const ok = ["Perfeito!", "Certo!", "Ótimo!"][((b2.perguntas?.length ?? 1) - 1) % 3];
      return perguntarOuBuscar(b2, AGRADECEU.test(n) ? "Imagina!" : ok);
    }
    const p = b2.atual;
    if (p) {
      const temasB = detectarTemas(texto);
      if (NAO_QUER_MAIS.test(n) || (NAO_GOSTOU.test(n) && !MAIS_UM.test(n) && !pedeOutrasOpcoes(texto))) {
        b2.ativa = false;
        b2.atual = undefined;
        return fecho("Tudo bem!");
      }
      if (MAIS_UM.test(n) || pedeOutrasOpcoes(texto)) return perguntarOuBuscar(b2, "", false, true);
      if (QUER_VISITA.test(n) || GOSTOU.test(n) || SIM_P.test(n)) {
        b2.interesse = p.codigo;
        b2.ativa = false;
        b2.atual = undefined;
        return passarAo(DISSE_QUE_GOSTOU.test(n) ? "Que bom que gostou!" : "Combinado!", `para combinar a visita ${fem(p.tipo) ? "dessa" : "desse"} ${p.tipo || "imóvel"}`);
      }
      if (temasB.length) return continuar(`${responderDuvidas(temasB, fichaDoParecido(p), {}, oImovel(p.tipo, true))} O que acha?`);
      b2.ativa = false; // mudou de assunto: volta ao imóvel do lead
      b2.atual = undefined;
    } else if (MAIS_UM.test(n) || pedeOutrasOpcoes(texto)) {
      return perguntarOuBuscar(b2, "", false, true); // voltou a pedir opções para a outra pessoa
    }
  } else {
    const nb = novaBusca(n, ficha?.tipo);
    if (nb) {
      dados.busca2 = nb;
      preencherBusca(nb, texto, undefined);
      const abre = /(trabalh|mexe(m)? com)/.test(n) ? "Trabalhamos sim!" : "Claro, te ajudo com isso!";
      return perguntarOuBuscar(nb, abre, true);
    }
  }

  // t_82c89141 item 4: a Nicole perguntou \"manhã ou tarde?\" no turno anterior; agora fecha e passa ao corretor.
  const diaPendente = dados.visita_dia_pendente;
  dados.visita_dia_pendente = undefined;
  if (diaPendente && !detectarTemas(texto).length && !pedeOutrasOpcoes(texto)) {
    const p = periodoDe(n);
    const outroDia = diaPedido(texto);
    const dia = outroDia && !/^(de manha|a tarde|a noite)/.test(norm(outroDia)) ? outroDia : diaPendente;
    if (p || /(tanto faz|qualquer|indiferente|tanto  faz|nao sei|voces escolhem|pode escolher)/.test(n)) {
      return passarVisita(dados, ctx, agora, p ? `${dia.replace(/ (de manhã|à tarde|à noite)$/, "")} ${p}` : `${dia}, período a combinar`);
    }
  }

  // Dia/horário fora das opções (\"sábado de manhã pode ser?\"): aceita e anota; sem período, pergunta manhã ou
  // tarde ANTES de passar (t_82c89141 item 4); com período, passa avisando que o corretor continua (item 6a).
  if (!detectarTemas(texto).length) {
    const ctxVisita = passoAtual === "visita" || !!dados.convite_visita || !!dados.visita_opcoes || !!diaPendente;
    const pedido = pedidoDiaFora(texto, dados.visita_opcoes ?? opcoesVisita(agora), ctxVisita);
    if (pedido) {
      if (!temPeriodo(pedido)) return perguntaPeriodo(dados, pedido, passoAtual === "codigo" ? "interesse" : passoAtual);
      return passarVisita(dados, ctx, agora, pedido);
    }
  }

  // --- Busca por característica ANTES do resto (t_a9f1b447): \"Tem alguma opção de 3 suítes?\" ---------
  const buscaCarac = op.buscarCaracteristica;
  if (buscaCarac) {
    const pedidoNovo = pedidoCaracteristica(texto);
    const ehPedidoNovo = !!pedidoNovo && (QUER_OPCAO.test(n) || pedeOutrasOpcoes(texto) || !atendeCaracteristica(ficha ?? {}, pedidoNovo));
    // Pedido anterior ainda vale: \"Não tem outra casa?\", \"?\" logo depois, ou \"sim\" para \"procuro com 2 suítes?\".
    const insistiu = !!dados.filtro_pedido && (pedeOutrasOpcoes(texto) || MAIS_UM.test(n) || /^\?+$/.test(texto.trim()));
    const aceitouMenos =
      !!dados.carac_relaxar && convite === "opcoes" && !NAO_GOSTOU.test(n) &&
      (pedidoNovo ? textoCaracteristica(pedidoNovo) === textoCaracteristica(dados.carac_relaxar) : SIM_P.test(n) || /\b(pode|procura)/.test(n));
    if (ehPedidoNovo || insistiu || aceitouMenos) {
      const tipoNovo = tipoDe(n);
      // Tipo só quando o cliente diz (\"outra casa\"): \"3 suítes\" sozinho vale para qualquer tipo (exemplo de Denis).
      const f: FiltroCaracteristica = aceitouMenos
        ? dados.carac_relaxar!
        : ehPedidoNovo
          ? juntarFiltro(pedidoNovo!.tipo ? {} : { tipo: dados.filtro_pedido?.tipo }, pedidoNovo!)
          : juntarFiltro(dados.filtro_pedido, tipoNovo ? { tipo: tipoNovo } : {});
      if (ehPedidoNovo && !aceitouMenos) dados.ofertados_carac = [];
      dados.filtro_pedido = f;
      dados.carac_relaxar = undefined;
      dados.parecido_atual = undefined;
      dados.parecido_pergunta = undefined;
      dados.interesse = true;
      if (f.finalidade && !dados.finalidade) dados.finalidade = f.finalidade;
      const fxv = valorFaixa(dados.faixa ?? "");
      const ref = negocio() === "locacao" ? ficha?.aluguel_valor : ficha?.preco_valor;
      const pmin = fxv?.min ?? (fxv?.max ? null : ref ? Math.round(ref * 0.85) : null);
      const pmax = fxv?.max ?? (ref ? Math.round(ref * 1.15) : null);
      const ja = [...(dados.ofertados_carac ?? []), ...(dados.parecidos ?? [])];
      const filtroB = { ...f, negocio: negocio(), preco_min: pmin, preco_max: pmax, cidade: ficha?.cidade ?? null, excluir: ja, limite: 3 };
      // Sem tipo dito pelo cliente: primeiro o mesmo tipo do imóvel dele na faixa; se não houver, qualquer tipo.
      const doTipo = !f.tipo && ficha?.tipo ? await buscaCarac({ ...filtroB, tipo: ficha.tipo }).catch(() => null) : null;
      const res = doTipo?.itens.length ? doTipo : await buscaCarac(filtroB).catch(() => null);
      const pedidoTxt = textoCaracteristica(f);
      if (!res) {
        dados.pendentes = [...new Set([...(dados.pendentes ?? []), `quer imóvel com ${pedidoTxt}`])].slice(0, 12);
        dados.convite_aberto = "opcoes";
        return continuar(`Vou procurar opções com ${pedidoTxt} e já te mando por aqui. Enquanto isso, quer marcar uma visita nessa?`);
      }
      const itens = res.itens
        .filter((i) => !ja.includes(i.codigo) && atendeCaracteristica(i, f))
        .sort((a, b) => Number(b.tipo === ficha?.tipo) - Number(a.tipo === ficha?.tipo));
      const p = itens[0];
      if (p) {
        dados.ofertados_carac = [...(dados.ofertados_carac ?? []), p.codigo].slice(0, 6);
        dados.parecidos = [...new Set([...(dados.parecidos ?? []), p.codigo])].slice(0, MAX_PARECIDOS);
        dados.parecido_atual = p;
        dados.convite_visita = true;
        return { ...continuar(textoCaracOferta(p, f, dados.ofertados_carac.length)), busca: { pedido: pedidoTxt, itens, fora_faixa: false } };
      }
      const jaCarac = (dados.ofertados_carac ?? []).length;
      const prox = res.proximo && !ja.includes(res.proximo.codigo) && atendeCaracteristica(res.proximo, f) ? res.proximo : null;
      const menos = relaxar(f);
      dados.carac_relaxar = menos ?? undefined;
      dados.convite_aberto = "opcoes";
      if (prox) {
        dados.ofertados_carac = [...(dados.ofertados_carac ?? []), prox.codigo].slice(0, 6);
        dados.parecido_atual = prox;
      }
      // \"Essa casa tem 3 suítes?\": diz primeiro o que o imóvel do anúncio tem (só o que o XML trouxe).
      const sobreEsse = ehPedidoNovo && /\b(essa|esse|esta|este|ela|ele)\b/.test(n) && ficha && !atendeCaracteristica(ficha, pedidoNovo!)
        ? responderDuvidas(["quartos"], ficha, dados, oImovel(ficha.tipo, true))
        : "";
      return {
        ...continuar(junta(sobreEsse, textoCaracForaFaixa(prox, f, menos, pmax != null, jaCarac))),
        busca: { pedido: pedidoTxt, itens: prox ? [prox] : [], fora_faixa: true },
      };
    }
  }

  // Reação ao parecido mostrado no turno anterior.
  let respParecido = false;
  let abertura: string | null = null;
  const temas = detectarTemas(texto);
  if (busca && dados.parecido_atual) {
    const p = dados.parecido_atual;
    if (NAO_QUER_MAIS.test(n) || (NAO_GOSTOU.test(n) && !MAIS_UM.test(n) && !pedeOutrasOpcoes(texto))) {
      dados.parecido_atual = undefined;
      if (dados.filtro_pedido && /^(nao|n)[\s.!]*$/.test(n)) return naoSegue();
      respParecido = true;
      abertura = "Tudo bem!";
    } else if (MAIS_UM.test(n) || pedeOutrasOpcoes(texto) || MESMA_FAIXA.test(n)) {
      const rq = regiaoPedida(texto, ficha?.bairro);
      return ofertar("", { mais_barato: MAIS_BARATO.test(n), ...(rq ? { bairro: rq } : {}) });
    } else if (QUER_VISITA.test(n) || GOSTOU.test(n) || SIM_P.test(n)) {
      dados.parecido_interesse = p.codigo;
      dados.parecido_atual = undefined;
      // t_37cf21e3 item 5: \"Gostaria\" sozinho não é elogio.
      const abre = SO_GOSTARIA.test(n) ? "Ótimo!" : "Que bom que gostou!";
      if (QUER_VISITA.test(n)) return ofereceVisita(abre, `conhecer ${oImovel(p.tipo, true)}`);
      // t_a9f1b447 item 7: primeiro o convite simples; as datas só depois que o cliente quiser visitar.
      dados.convite_visita = true;
      dados.convite_aberto = "visita";
      return continuar(`${abre} Quer agendar uma visita para conhecer ${oImovel(p.tipo, true)}?`);
    } else if (temas.length) {
      return continuar(`${responderDuvidas(temas, fichaDoParecido(p), {}, oImovel(p.tipo, true))} ${CONVITE_VISITA.replace("conhecer", "conhecer pessoalmente")}`);
    } else {
      dados.parecido_atual = undefined; // mudou de assunto: segue a conversa normal
    }
  } else if (busca && dados.parecido_pergunta) {
    dados.parecido_pergunta = undefined;
    if ((SIM_P.test(n) || pedeOutrasOpcoes(texto) || MAIS_UM.test(n)) && !NAO_QUER_MAIS.test(n) && !NAO_GOSTOU.test(n))
      return ofertar("", { mais_barato: MAIS_BARATO.test(n) });
    respParecido = true;
    abertura = "Tudo bem!";
  }

  // Alternativa do reengajamento (toque 2): \"sim\" = o corretor manda os detalhes.
  if (dados.alternativa && SIM.test(n) && !temas.length)
    return passarAo("Combinado!", `para te passar os detalhes de ${dados.alternativa}`);

  // Resposta à 1ª mensagem (\"Quer saber mais detalhes...?\"): \"valores\" já é a dúvida de preço.
  const primeira = (passoAtual === "interesse" || passoAtual === "codigo") && !dados.interesse;
  if (primeira && !temas.length && /(valor|preco|condic)/.test(n) && !MESMA_FAIXA.test(n)) temas.push("preco");
  const ehDuvida = temas.length > 0 || /\?\s*$/.test(texto.trim());

  // Informação dita pelo cliente (respondendo a uma pergunta ou de forma espontânea): anota sem perguntar de novo.
  const finalidadeAntes = dados.finalidade;
  const fin = finalidadeDe(n);
  if (fin && !dados.finalidade) dados.finalidade = fin;
  const pag = pagamentoDe(n);
  // \"Aceita financiamento?\" é dúvida, não forma de pagamento; \"vou financiar\" é forma de pagamento.
  if (pag && !dados.pagamento?.length && (passoAtual === "pagamento" || !ehPergunta(texto))) dados.pagamento = pag;
  // Na pergunta da faixa, um número solto (\"120000 aceita financiamento?\") também é a faixa (t_59ab47d4).
  const faixaAntes = dados.faixa;
  const fx = faixaDe(texto, n, passoAtual === "faixa");
  const confirmandoFaixa = passoAtual === "faixa" && !!ctx.dados.faixa_pendente;
  dados.faixa_pendente = undefined;
  if (fx && (!dados.faixa || (confirmandoFaixa && valorFaixa(fx)))) dados.faixa = fx;
  // \"nesta mesma faixa\" / \"nesse valor\": a faixa é o preço do imóvel do lead (o banco usa ±15%).
  if (!dados.faixa && passoAtual === "faixa" && MESMA_FAIXA.test(n)) dados.faixa = "mesma faixa do imóvel anunciado";
  const soFinalidade = passoAtual === "faixa" && !!fin && fin !== finalidadeAntes && !fx;
  if ((passoAtual === "finalidade" || passoAtual === "faixa" || passoAtual === "pagamento") && !ehDuvida && !respParecido && !soFinalidade && !pedeOutrasOpcoes(texto)) {
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
      // Não entendeu: anota como veio e segue (nunca repete a pergunta).
      if (passoAtual === "finalidade" && !dados.finalidade) dados.finalidade = curto(texto, 20);
      if (passoAtual === "pagamento" && !dados.pagamento?.length) dados.pagamento = [curto(texto, 30)];
    }
  }
  // "Perfeito!" só quando o cliente passou uma informação que foi entendida ("hmm" não conta).
  const deuInformacao = (!!fin && fin !== finalidadeAntes) || (!!fx && fx !== faixaAntes) || (!!pag && !ctx.dados.pagamento?.length) || (dados.faixa !== faixaAntes && MESMA_FAIXA.test(n));
  // Roteiro antigo (conversa aberta antes do ajuste).
  if ((passoAtual === "prazo" || passoAtual === "regiao") && !ehDuvida && n.length >= 2) dados[passoAtual] = curto(texto);
  if (passoAtual === "proximo_passo") {
    const ex = extrairPorRegras("proximo_passo", texto);
    if (ex?.proximo_passo === "contato") return passarAo("Perfeito!", "");
  }

  // A dúvida do cliente vem primeiro: só o que foi perguntado.
  let duvida = responderDuvidas(temas, ficha, dados, sujeito);
  // Só \"?\" (o cliente cobrando resposta): não é pergunta nova (t_a9f1b447).
  const cobrou = /^[?!.\s]+$/.test(texto.trim());
  if (cobrou) duvida = "Oi, estou aqui!";
  else if (ehDuvida && !temas.length && !pedeOutrasOpcoes(texto) && !QUER_VISITA.test(n) && !DETALHES.test(n)) {
    // Pergunta que as regras não reconhecem: não ignora (item 11).
    duvida = `Isso o corretor confirma ${CORRETOR_CONFIRMA}.`;
    dados.pendentes = [...new Set([...(dados.pendentes ?? []), `pergunta: \"${curto(texto, 60)}\"`])].slice(0, 12);
  }

  // Permuta: a Nicole nunca diz se aceita. Registra e passa (t_59ab47d4); fala em outra pessoa só aqui.
  if (falaPermuta(n) && !respParecido) {
    dados.pagamento = [...new Set([...(dados.pagamento ?? []), "permuta"])];
    const outras = responderDuvidas(temas.filter((t) => t !== "permuta"), ficha, dados, sujeito);
    return passar(
      dados,
      "qualificado",
      junta(outras, "Anotei! Se o proprietário aceita permuta, o corretor confirma com você."),
      `${CHAMAR} para conversar sobre isso.`,
      FALHA_PADRAO,
      `Cliente falou em PERMUTA: \"${curto(texto, 160)}\". ${resumoQualificacao(dados, ctx)}`,
    );
  }
  // Proposta, desconto, negociação: só quando o CLIENTE puxa o assunto.
  if (temas.includes("negociacao") && !respParecido) {
    const outras = responderDuvidas(temas.filter((t) => t !== "negociacao"), ficha, dados, sujeito);
    return passar(
      dados,
      "qualificado",
      junta(outras, "Sobre proposta e valores,"),
      `já pedi para ${CORRETOR} continuar seu atendimento por aqui.`,
      FALHA_PADRAO,
      `Cliente quer falar de PROPOSTA/NEGOCIAÇÃO: \"${curto(texto, 160)}\". ${resumoQualificacao(dados, ctx)}`,
    );
  }

  // Faixa muito longe do valor anunciado no XML (mais que o dobro ou menos da metade): confirma uma vez.
  if (dados.faixa && dados.faixa !== faixaAntes && !dados.faixa_conferida && !respParecido && !MESMA_FAIXA.test(n)) {
    const alugar = negocio() === "locacao";
    const anunciado = alugar ? ficha?.aluguel_valor : ficha?.preco_valor;
    const longe = faixaLonge(dados.faixa, anunciado);
    if (longe != null && anunciado) {
      dados.faixa_conferida = true;
      dados.faixa_pendente = true;
      if (!dados.perguntas!.includes("faixa")) dados.perguntas!.push("faixa");
      const ref = alugar ? `O aluguel é de ${reais(anunciado)} por mês.` : `${maiuscula(sujeito)} está anunciad${fem(ficha?.tipo) ? "a" : "o"} por ${reais(anunciado)}.`;
      return continuar(junta(duvida, `Só confirmando: sua faixa é de ${reais(longe)}? ${ref}`), "faixa");
    }
  }
  if (confirmandoFaixa) dados.faixa_conferida = true;

  // Imóvel parecido: (c) o cliente pede outras opções (antes do roteiro); (b) o imóvel pedido não serve.
  if (busca && !respParecido) {
    const doXml = ctx.imovel_fonte === "xml" || !!dados.imovel_xml_codigo;
    // "nesse valor", "parecido com esse" também pedem opções (a faixa é o preço do imóvel do lead).
    // Depois de "essas são as opções que tenho", um "outra?" também é novo pedido (aí passa à equipe).
    const outraDepoisDoFim = !!dados.parecidos_fim && MAIS_UM.test(n);
    if ((pedeOutrasOpcoes(texto) || outraDepoisDoFim || (MESMA_FAIXA.test(n) && !ehPergunta(texto))) && !NAO_QUER_MAIS.test(n)) {
      const temRef = doXml || !!ficha?.preco_valor || !!ficha?.aluguel_valor;
      if (!temRef && !dados.faixa) {
        // Sem preço de referência: precisa da faixa antes (única hora em que ela é perguntada).
        dados.quer_opcoes = true;
        if (!dados.perguntas!.includes("faixa")) dados.perguntas!.push("faixa");
        return continuar(junta(duvida, `Claro! ${PERGUNTA.faixa}`), "faixa");
      }
      const rq = regiaoPedida(texto, ficha?.bairro);
      return ofertar(duvida, { mais_barato: MAIS_BARATO.test(n), ...(rq ? { bairro: rq } : {}) });
    }
    if (dados.quer_opcoes && passoAtual === "faixa") {
      dados.quer_opcoes = undefined;
      return ofertar(junta(duvida, deuInformacao ? "Perfeito!" : ""));
    }
    const conferido = dados.parecido_conferido ?? [];
    const conferir = (k: string) => {
      dados.parecido_conferido = [...new Set([...(dados.parecido_conferido ?? []), k])];
    };
    const comDuvida = (t: string) => junta(duvida, t);
    const esse = maiuscula(oImovel(ficha?.tipo, true));
    const a = fem(ficha?.tipo) ? "a" : "o";
    if ((dados.parecidos?.length ?? 0) < MAX_PARECIDOS) {
      // Quer alugar e o pedido é só de venda: diz isso e procura uma locação parecida no XML (sem achar, passa).
      const pedidoSoVenda = ficha?.negocio ? ficha.negocio === "venda" : ctx.transacao === "venda" || doXml;
      if (dados.finalidade === "alugar" && finalidadeAntes !== "alugar" && pedidoSoVenda && !conferido.includes("locacao")) {
        conferir("locacao");
        return ofertar(comDuvida(`${esse} está anunciad${a} só para venda.`), { negocio: "locacao", preco_min: null, preco_max: null }, undefined, false);
      }
      // Fora do bairro que o cliente quer.
      const bq = bairroDesejado(texto);
      if (bq && ficha?.bairro && !norm(ficha.bairro).includes(bq) && !conferido.includes("bairro")) {
        conferir("bairro");
        return ofertar(comDuvida(`${esse} fica ${noBairro(ficha.bairro)}.`), { bairro: bq }, undefined, false);
      }
      // Faixa de valor recém-informada abaixo do preço anunciado do pedido (o banco compara).
      const fxv = dados.faixa && dados.faixa !== faixaAntes ? valorFaixa(dados.faixa) : null;
      if (fxv?.max && doXml && !conferido.includes("faixa")) {
        conferir("faixa");
        const res = await busca({ excluir: dados.parecidos ?? [], negocio: negocio(), preco_min: fxv.min ?? null, preco_max: fxv.max, codigo_ref: dados.imovel_xml_codigo ?? null }).catch(() => null);
        if (res?.referencia.preco && res.referencia.preco > fxv.max)
          return ofertar(comDuvida(`${esse} está anunciad${a} acima da faixa que você comentou.`), {}, res, false);
      }
      // O anúncio pedido saiu do XML (não está mais no catálogo atual).
      const cod = ctx.anuncio_codigo || dados.anuncio_informado;
      if ((passoAtual === "interesse" || passoAtual === "codigo") && cod && ctx.imovel_fonte !== "xml" && !dados.imovel_xml_codigo && !conferido.includes("saiu")) {
        conferir("saiu");
        const res = await busca({ excluir: dados.parecidos ?? [], negocio: negocio(), codigo_ref: dados.anuncio_informado ?? null }).catch(() => null);
        if (res?.referencia.saiu)
          return ofertar(comDuvida(`Esse anúncio saiu do nosso catálogo, o corretor confirma a situação dele ${CORRETOR_CONFIRMA}.`), {}, res, false);
      }
    }
  }

  // Visita: escolha entre as 2 opções oferecidas.
  if (passoAtual === "visita") {
    const opcoes = dados.visita_opcoes ?? opcoesVisita(agora);
    // \"Não\" para o parecido oferecido durante a visita: volta às 2 opções (não encerra a conversa).
    if (respParecido) return continuar(`${abertura ?? "Tudo bem!"} Sobre a visita: ${opcoes[0]} ou ${opcoes[1]} fica bom para você?`, "visita");
    const escolha = escolhaVisita(texto, opcoes);
    const rep = dados.repeticoes!.visita ?? 0;
    const livre = !escolha && !ehDuvida && OUTRO_DIA.test(n) ? curto(texto, 60) : null;
    if (escolha || livre || (rep >= 1 && !ehDuvida && !PREFERE_CORRETOR.test(n))) {
      dados.visita = escolha ?? livre ?? curto(texto, 60);
      dados.visita_ate = prazoConfirmacao(agora);
      return passar(
        dados,
        "visita",
        `Combinado, ${dados.visita}!`,
        `${CHAMAR} para confirmar o horário certinho ${dados.visita_ate}.`,
        "Anotei aqui. Um corretor da nossa equipe vai continuar seu atendimento por aqui para confirmar o horário.",
        resumoQualificacao(dados, ctx),
      );
    }
    if (PREFERE_CORRETOR.test(n) || (SEM_INTERESSE.test(n) && !ehDuvida)) return passarAo(junta(duvida, "Sem problema!"), "");
    if (rep < 1) {
      dados.repeticoes!.visita = rep + 1;
      const q = ehDuvida ? `Sobre a visita: ${opcoes[0]} ou ${opcoes[1]} fica bom para você?` : "Sem problema! Qual dia e período ficam melhores para você?";
      return continuar(junta(duvida, q), "visita");
    }
    return passarAo(duvida, "para combinar a visita");
  }

  // Cliente pediu visita: oferece 2 opções (depois de responder o que ele perguntou).
  if (QUER_VISITA.test(n) || (passoAtual === "proximo_passo" && /visit/.test(n))) return ofereceVisita(junta(duvida, duvida ? "" : "Claro!"));

  // 1ª resposta sem imóvel identificado e sem código do portal: pede o código UMA vez, com exemplo.
  const semImovel = !ficha && !ctx.tem_captacao && !dados.imovel_capture_id && !ctx.anuncio_codigo;
  if (passoAtual === "interesse" && semImovel && !dados.codigo_pedido) {
    dados.codigo_pedido = true;
    dados.interesse = true;
    return continuar(
      junta(duvida || "Que bom!", "Para eu te passar as informações certas, qual é o código do anúncio? Ele aparece na descrição do anúncio, por exemplo: AP1234."),
      "codigo",
    );
  }
  if (passoAtual === "codigo" && !ficha) {
    // Código não achado (ou o cliente não sabe): quem confirma o imóvel recebe o atendimento.
    dados.interesse = true;
    return passarAo(junta(duvida, dados.anuncio_informado ? "Obrigada! Vou confirmar qual é o imóvel." : "Tudo bem!"), "para te passar os detalhes");
  }

  // Convite do turno anterior (\"Quer agendar uma visita?\" / \"Quer saber mais algum detalhe?\").
  if (!ehDuvida && !respParecido && convite) {
    const sim = SIM_P.test(n) && !NAO_GOSTOU.test(n);
    const nao = NAO_GOSTOU.test(n) || SEM_INTERESSE.test(n);
    if (convite === "visita" && sim) return ofereceVisita("Ótimo!");
    if (convite === "visita" && nao) {
      if (busca && !(dados.parecidos?.length) && !dados.parecido_perguntado) {
        dados.parecido_perguntado = true;
        // Regra t_232e13cb: sem nenhum parecido no XML, nem pergunta.
        const pre = await busca({ excluir: [], negocio: negocio(), codigo_ref: dados.imovel_xml_codigo ?? dados.anuncio_informado ?? null }).catch(() => null);
        if (pre?.itens.length) {
          dados.parecido_pergunta = true;
          return continuar(`Sem problema! ${PERGUNTA_PARECIDO}`, "interesse");
        }
      }
      dados.convite_aberto = "detalhe";
      return continuar(`Sem problema! ${MAIS_DETALHE}`, "interesse");
    }
    // t_a9f1b447: \"Não\" ao \"quer saber mais algum detalhe?\" não é motivo para passar ao corretor.
    if ((convite === "detalhe" || convite === "opcoes") && nao) return naoSegue();
    if (convite === "opcoes" && QUER_VISITA.test(n)) return ofereceVisita("Ótimo!");
    if (convite === "opcoes" && sim && busca) return ofertar("");
    if (convite === "detalhe" && sim) {
      if (!dados.ficha_enviada && detalhesFicha(ficha)) {
        dados.ficha_enviada = true;
        return fecho(junta("Claro!", detalhesFicha(ficha)));
      }
      dados.convite_aberto = "detalhe";
      return continuar("Claro! O que você gostaria de saber?", "interesse");
    }
  }

  // t_37cf21e3 item 5: \"Gostaria\" sozinho em resposta à 1ª mensagem não é elogio: pergunta o que ele quer saber.
  if (primeira && SO_GOSTARIA.test(n) && !respParecido) {
    dados.interesse = true;
    dados.convite_visita = true;
    dados.convite_aberto = "detalhe";
    return { ...continuar(`Claro! O que você gostaria de saber sobre ${sujeito}, ou já prefere agendar uma visita?`, "interesse"), fixo: true };
  }

  // Conversa: detalhes do imóvel (uma vez, quando o cliente pede), depois 1 pergunta natural.
  let intro = duvida;
  if (primeira) dados.interesse = true;
  const pediuDetalhes = (primeira && !temas.length) || (DETALHES.test(n) && !temas.length) || achouCodigo;
  if (pediuDetalhes && !dados.ficha_enviada && !respParecido) {
    const det = detalhesFicha(ficha);
    if (det) dados.ficha_enviada = true;
    // Código informado pelo cliente: diz qual imóvel achou (a 1ª mensagem não falou dele).
    const qual = achouCodigo && ficha?.tipo ? junta(`É ${fem(ficha.tipo) ? "uma" : "um"} ${ficha.tipo}${ficha.bairro ? ` ${noBairro(ficha.bairro)}` : ""}.`, valorAnunciado(ficha)) : "";
    const abre = achouCodigo ? "Achei!" : AGRADECEU.test(n) ? "Imagina!" : SIM.test(n) || DETALHES.test(n) ? "Claro!" : "";
    intro = junta(abre, qual, det, intro);
  } else if (!intro) {
    intro = abertura ?? (AGRADECEU.test(n) ? "Imagina!" : deuInformacao ? "Perfeito!" : "");
  } else if (abertura) intro = junta(abertura, intro);

  // Só a finalidade, quando nada diz se é compra ou aluguel (uma vez).
  const q = proximaPergunta(dados, ctx, ficha);
  if (q && !ehDuvida) {
    dados.perguntas!.push(q);
    return continuar(junta(intro, PERGUNTA[q]), q);
  }
  return fecho(intro);
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
      `${CHAMAR}.`,
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
