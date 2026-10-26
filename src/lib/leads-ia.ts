// IA de atendimento dos leads (Emanuella) — cards t_8046ecb0 e t_fc4d9b27 (roteiro novo a partir do estudo
// de 1.347 conversas da Lais). Lógica pura, sem rede.
// O banco decide quem vê, opt-out, deduplicação e a passagem ao corretor (migrations 20261025180000 e
// 20261026140000). Aqui fica o roteiro. Todos os textos que vão ao cliente são FIXOS ou montados SÓ com
// dados da ficha da captação: a IA nunca inventa preço, condição, disponibilidade ou dado do imóvel.
// Um modelo de linguagem, quando ligado, só ajuda a ENTENDER a resposta do cliente; nunca escreve a resposta.
//
// Roteiro (t_fc4d9b27):
//  1) 1ª mensagem: uma bolha, sem link, assistente virtual + tipo/bairro + pergunta fechada (banco).
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

/** Ficha do imóvel que o banco entrega (lead_ia_ficha): só o que existe e está preenchido na captação.
 * Os campos marcados como "futuro" ainda NÃO existem na captação; o roteiro já sabe usá-los quando existirem. */
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
  /** futuro */ disponivel?: boolean;
  /** futuro (texto já formatado, ex.: "R$ 650,00") */ condominio?: string;
  /** futuro */ iptu?: string;
  /** futuro */ aceita_permuta?: boolean;
  /** futuro */ aceita_financiamento?: boolean;
  /** futuro (ex.: "5º andar, frente") */ andar?: string;
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
  // Roteiro novo (lead_ia_registrar_cliente, migration 20261026140000). Opcionais: banco antigo não manda.
  org_nome?: string | null;
  /** Do portal (Grupo ZAP): venda/aluguel. Com isso a finalidade não é perguntada. */
  transacao?: "venda" | "aluguel" | null;
  /** Código do anúncio que veio do portal. Com ele, o código nunca é pedido ao cliente. */
  anuncio_codigo?: string | null;
  tem_captacao?: boolean;
  /** "o apartamento do bairro Campolim" */
  imovel_frase?: string | null;
  ficha?: FichaIa | null;
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

export type ImovelEncontrado = { capture_id: string; frase: string | null; ficha: FichaIa | null };

export type OpcoesRoteiro = {
  /** Relógio (testes). */
  agora?: Date;
  /** Procura a captação pelo código que o cliente informou (servidor: lead_ia_imovel_por_codigo). */
  buscarImovel?: (codigo: string) => Promise<ImovelEncontrado | null>;
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

/** Cliente pede uma pessoa (ou desconfia de robô). */
export function pediuPessoa(t: string): boolean {
  return /(falar com (um |uma |o |a )?(corretor|corretora|atendente|humano|pessoa|alguem|gerente|responsavel)|quero (um |uma |falar com )?(pessoa|humano|atendente|corretor)|atendimento humano|me (liga|ligue|ligar)|ligue pra mim|liga pra mim|(e|eh|vc e|voce e) (um )?robo|e uma ia|e bot)/.test(
    norm(t),
  );
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
  pagamento: "E a forma de pagamento seria à vista, financiamento ou permuta?",
};

const NAO_SEI = "não tenho esse dado confirmado, vou confirmar com o corretor";
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
  if (/(permut|troca)/.test(n)) p.push("permuta");
  if (/fgts/.test(n)) p.push("FGTS");
  if (/consorcio/.test(n)) p.push("consórcio");
  return p.length ? p : null;
}
/** Valor dito pelo cliente: guarda como ele disse (curto), nunca interpreta. */
function faixaDe(texto: string, n: string): string | null {
  return /(\d[\d.,]*\s*(mil|milhao|milhoes|mi\b|k\b|reais)|r\$\s*\d|\bate \d|\d{3}\.\d{3})/.test(n) ? curto(texto) : null;
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
  permuta: /(permut|troca|aceita (carro|imovel|terreno|apartamento|casa|moto)|como (parte|entrada))/,
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
      return f.disponivel === true ? "está disponível" : null; // \"indisponível\" nunca é dito pela IA
    case "preco":
      return null; // valor e negociação: sempre o corretor
  }
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
  const semPreco = naoSei.filter((t) => t !== "preco");
  if (naoSei.includes("preco"))
    partes.push("O valor e as condições de negociação quem confirma é o corretor, para não te passar nada desatualizado.");
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
  if (pediuPessoa(texto))
    return passar(
      dados,
      "pediu_pessoa",
      "Claro!",
      `Encaminhei seu contato para ${CORRETOR}, que vai falar com você por aqui.`,
      FALHA_PADRAO,
      `Cliente pediu para falar com uma pessoa. Dados até aqui: ${parcial()}`,
    );
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
  if (RECUSA.test(n) || (ctx.passo === "interesse" && SEM_INTERESSE.test(n) && !SIM.test(n)))
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
        dados.imovel_capture_id = achou.capture_id;
        ficha = achou.ficha;
        frase = achou.frase;
      }
    }
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
  const fin = finalidadeDe(n);
  if (fin && !dados.finalidade) dados.finalidade = fin;
  const pag = pagamentoDe(n);
  // \"Aceita financiamento?\" é dúvida, não forma de pagamento; \"vou financiar\" é forma de pagamento.
  if (pag && !dados.pagamento?.length && (passoAtual === "pagamento" || !ehPergunta(texto))) dados.pagamento = pag;
  const fx = faixaDe(texto, n);
  if (fx && !dados.faixa) dados.faixa = fx;
  if ((passoAtual === "finalidade" || passoAtual === "faixa" || passoAtual === "pagamento") && !ehDuvida) {
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

  // Visita: escolha entre as 2 opções oferecidas.
  if (passoAtual === "visita") {
    const opcoes = dados.visita_opcoes ?? opcoesVisita(agora);
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
    intro = [duvida ? "" : "Que bom!", r, duvida].filter(Boolean).join(" ");
  }

  // Depois da dúvida, a próxima pergunta (uma por turno). Repete a do passo atual no máximo uma vez,
  // quando o cliente respondeu com outra dúvida.
  const atualSemResposta =
    (passoAtual === "finalidade" || passoAtual === "faixa" || passoAtual === "pagamento") && ehDuvida &&
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
  // Qualificação feita: oferece a visita (uma vez); se já ofereceu, passa ao corretor.
  if (!dados.visita_opcoes) return ofereceVisita(intro ? `${intro} Obrigada!` : "Obrigada!");
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
  "Oi, {nome}! Aqui é a {assistente}, assistente virtual da {imobiliaria}. Vi seu interesse {imovel}. Quer saber valores e condições, ou já prefere agendar uma visita?";

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

/** Prévia da 1ª mensagem (mesma regra de lead_ia_primeira_msg no banco). imovel = \"no apartamento do bairro X\". */
export function previaPrimeiraMensagem(
  c: Pick<IaConfig, "ia_nome" | "ia_primeira_msg">,
  imobiliaria: string,
  cliente: string,
  imovel: string | null,
): string {
  let t = c.ia_primeira_msg?.trim() || PRIMEIRA_MSG_PADRAO;
  const nome = /^lead( grupo zap)?$/i.test(cliente.trim()) ? "" : cliente.trim().split(" ")[0];
  if (!nome) t = t.replace(/,?\s*\{nome\}/g, "");
  return t
    .split("{nome}").join(nome)
    .split("{assistente}").join(c.ia_nome.trim())
    .split("{imobiliaria}").join(imobiliaria || "imobiliária")
    .split("{imovel}").join(imovel || "no imóvel que você viu")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}
