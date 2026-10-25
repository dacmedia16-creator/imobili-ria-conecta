// IA de atendimento dos leads (papel da Lais) — card t_8046ecb0. Lógica pura, sem rede.
// O banco (migration 20261025180000) decide quem vê, opt-out, deduplicação e a passagem ao corretor.
// Aqui fica o roteiro de qualificação. Todos os textos que vão ao cliente são FIXOS: a IA nunca
// inventa preço, condição, disponibilidade ou dado do imóvel. Um modelo de linguagem, quando ligado,
// só ajuda a ENTENDER a resposta do cliente (extrair finalidade/pagamento...); nunca escreve a resposta.

import { temLink } from "./leads-ia-canal";

export const PASSOS = [
  "interesse",
  "finalidade",
  "prazo",
  "pagamento",
  "faixa",
  "regiao",
  "proximo_passo",
  "fim",
] as const;
export type Passo = (typeof PASSOS)[number];

export type FimConversa = "qualificado" | "pediu_pessoa" | "sensivel" | "sem_interesse";

export type DadosQualificacao = {
  interesse?: boolean;
  finalidade?: "comprar" | "alugar" | string;
  prazo?: string;
  pagamento?: string[];
  faixa?: string;
  regiao?: string;
  proximo_passo?: "visita" | "contato";
  /** Quantas vezes a mesma pergunta já foi repetida (máx. 1 repetição). */
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
};

export type RespostaIa = {
  passo: Passo;
  dados: DadosQualificacao;
  resposta: string;
  fim: FimConversa | null;
  resumo: string | null;
};

/** Ajuda opcional de um modelo de linguagem para entender a resposta. Sem modelo = só regras. */
export type Extrator = (
  passo: Passo,
  texto: string,
) => Promise<Partial<DadosQualificacao> | null | undefined>;

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

/** Pergunta sobre preço/condição/disponibilidade: a IA NÃO responde, só avisa que o corretor confirma. */
export function perguntaComercial(t: string): boolean {
  return /(qual (o |e o )?(valor|preco)|quanto (custa|e|fica|esta)|preco|valor do|condo(minio)?|iptu|aceita (permuta|proposta|financiamento|fgts|carro)|desconto|negocia|(esta|ta|continua) disponivel|ainda (esta|ta) (a venda|disponivel)|metragem|quantos (quartos|m2|metros)|vaga)/.test(
    norm(t),
  );
}

const SEM_INTERESSE =
  /^(nao|n|nao obrigad\w*|sem interesse|nao tenho (mais )?interesse|ja (comprei|aluguei|resolvi|fechei)|nao procuro mais|desisti)\b/;
const SIM = /^(sim|s|tenho|claro|isso|quero|ok|pode|com certeza|tenho sim|sim tenho|ainda tenho|opa|oi|ola|bom dia|boa tarde|boa noite)\b/;

export const PERGUNTA: Record<Exclude<Passo, "interesse" | "fim">, string> = {
  finalidade: "Você procura para comprar ou para alugar?",
  prazo: "E para quando você pensa em se mudar ou fechar negócio? (ex.: agora, em 3 meses, ainda sem pressa)",
  pagamento: "Como pretende pagar: financiamento, à vista ou usando FGTS? Pode ser mais de um.",
  faixa: "Qual faixa de valor você tem em mente?",
  regiao: "E qual região ou bairro você prefere?",
  proximo_passo:
    "Obrigado! Prefere agendar uma visita ou que o corretor entre em contato para conversar?",
};

const PROXIMO: Record<Passo, Passo> = {
  interesse: "finalidade",
  finalidade: "prazo",
  prazo: "pagamento",
  pagamento: "faixa",
  faixa: "regiao",
  regiao: "proximo_passo",
  proximo_passo: "fim",
  fim: "fim",
};

const curto = (t: string, n = 80) => t.replace(/\s+/g, " ").trim().slice(0, n);

/** Entende a resposta de cada passo só por regras. null = não entendeu. */
export function extrairPorRegras(passo: Passo, texto: string): Partial<DadosQualificacao> | null {
  const n = norm(texto);
  switch (passo) {
    case "finalidade": {
      const c = /(compr|adquirir|investir)/.test(n);
      const a = /(alug|locar|locacao|arrend)/.test(n);
      if (c && !a) return { finalidade: "comprar" };
      if (a && !c) return { finalidade: "alugar" };
      return null;
    }
    case "pagamento": {
      const p: string[] = [];
      if (/financ/.test(n)) p.push("financiamento");
      if (/(a vista|avista|dinheiro|recurso proprio)/.test(n)) p.push("à vista");
      if (/fgts/.test(n)) p.push("FGTS");
      if (/consorcio/.test(n)) p.push("consórcio");
      return p.length ? { pagamento: p } : null;
    }
    case "proximo_passo":
      if (/visit/.test(n)) return { proximo_passo: "visita" };
      if (/(contato|liga|whats|mensage|conversar|corretor|tanto faz|pode ser)/.test(n))
        return { proximo_passo: "contato" };
      return null;
    case "prazo":
    case "faixa":
    case "regiao":
      // Respostas livres: guarda o que o cliente disse (curto), sem interpretar valores.
      return n.length >= 2 ? { [passo]: curto(texto) } : null;
    default:
      return null;
  }
}

/** Resumo para o sino do corretor (sem telefone/e-mail). */
export function resumoQualificacao(d: DadosQualificacao): string {
  const partes = [
    d.finalidade ? `Quer ${d.finalidade}` : null,
    d.prazo ? `prazo: ${d.prazo}` : null,
    d.pagamento?.length ? `pagamento: ${d.pagamento.join(", ")}` : null,
    d.faixa ? `faixa: ${d.faixa}` : null,
    d.regiao ? `região: ${d.regiao}` : null,
    d.proximo_passo === "visita"
      ? "prefere agendar visita"
      : d.proximo_passo === "contato"
        ? "prefere contato do corretor"
        : null,
  ].filter(Boolean);
  return partes.length ? `${partes.join("; ")}.` : "Sem dados de qualificação.";
}

function fim(ctx: ContextoIa, dados: DadosQualificacao, motivo: FimConversa, resposta: string, resumo: string): RespostaIa {
  return { passo: "fim", dados, resposta, fim: motivo, resumo: resumo.slice(0, 1000) };
}

/**
 * Próxima resposta da IA para a mensagem do cliente. Ordem de prioridade:
 * sensível -> pediu pessoa -> sem interesse -> pergunta comercial -> roteiro de qualificação.
 * (Opt-out já foi tratado no banco antes de chegar aqui.)
 */
export async function proximaResposta(
  ctx: ContextoIa,
  texto: string,
  extrator?: Extrator,
): Promise<RespostaIa> {
  const dados: DadosQualificacao = { ...ctx.dados, repeticoes: { ...(ctx.dados.repeticoes ?? {}) } };
  const parcial = resumoQualificacao(dados);

  if (ehSensivel(texto))
    return fim(
      ctx,
      dados,
      "sensivel",
      "Entendi. Vou passar agora para uma pessoa da nossa equipe, que vai cuidar disso com você.",
      `Assunto sensível: "${curto(texto, 160)}". Atender com prioridade. Dados até aqui: ${parcial}`,
    );
  if (pediuPessoa(texto))
    return fim(
      ctx,
      dados,
      "pediu_pessoa",
      "Claro! Vou pedir para o corretor responsável falar com você.",
      `Cliente pediu para falar com uma pessoa. Dados até aqui: ${parcial}`,
    );
  if (ctx.passo === "interesse" && SEM_INTERESSE.test(norm(texto)) && !SIM.test(norm(texto)))
    return fim(
      ctx,
      dados,
      "sem_interesse",
      "Tudo bem, obrigado pelo retorno! Se precisar de algo, é só chamar.",
      `Cliente disse que não tem interesse: "${curto(texto, 160)}".`,
    );

  const passo = ctx.passo === "fim" ? "proximo_passo" : ctx.passo;
  const aviso = perguntaComercial(texto)
    ? "Essa informação o corretor confirma para você, para não te passar nada errado. "
    : "";

  if (passo === "interesse") {
    dados.interesse = true;
    return {
      passo: "finalidade",
      dados,
      resposta: `${aviso}Que bom! Para eu adiantar seu atendimento, faço umas perguntas rápidas. ${PERGUNTA.finalidade}`,
      fim: null,
      resumo: null,
    };
  }

  const q = PERGUNTA[passo as keyof typeof PERGUNTA];
  // Pergunta de preço/condição/disponibilidade: não responde, não interpreta; repete a pergunta do passo.
  if (aviso) return { passo, dados, resposta: `${aviso}${q}`, fim: null, resumo: null };

  let extraido = extrairPorRegras(passo, texto);
  if (!extraido && extrator) {
    try {
      extraido = (await extrator(passo, texto)) ?? null;
    } catch {
      extraido = null; // modelo fora do ar: segue só com regras
    }
  }

  if (!extraido) {
    const rep = dados.repeticoes![passo] ?? 0;
    if (rep < 1) {
      dados.repeticoes![passo] = rep + 1;
      return { passo, dados, resposta: `Desculpe, não entendi bem. ${q}`, fim: null, resumo: null };
    }
    // Não entendeu duas vezes: anota a resposta como veio e segue (não trava a conversa).
    extraido = { [passo]: passo === "pagamento" ? [curto(texto)] : curto(texto) } as Partial<DadosQualificacao>;
  }
  Object.assign(dados, sanitizar(passo, extraido));

  const prox = PROXIMO[passo];
  if (prox === "fim") {
    const pref =
      dados.proximo_passo === "visita"
        ? "O corretor vai falar com você para combinar o melhor dia e horário da visita."
        : "O corretor vai entrar em contato com você em breve.";
    return fim(ctx, dados, "qualificado", `Perfeito, obrigado! ${pref}`, resumoQualificacao(dados));
  }
  return { passo: prox, dados, resposta: PERGUNTA[prox as keyof typeof PERGUNTA], fim: null, resumo: null };
}

/**
 * Áudio, foto ou arquivo pelo WhatsApp (card t_6f688b4b): a IA não ouve nem lê anexos. Na 1ª vez pede
 * para escrever; na 2ª, passa ao corretor (que pode ouvir o áudio no WhatsApp).
 */
export function respostaMidia(ctx: ContextoIa): RespostaIa {
  const dados: DadosQualificacao = { ...ctx.dados, midias: (ctx.dados.midias ?? 0) + 1 };
  if ((ctx.dados.midias ?? 0) >= 1)
    return fim(
      ctx,
      dados,
      "pediu_pessoa",
      "Vou pedir para o corretor responsável falar com você por aqui, combinado?",
      `Cliente mandou áudio ou arquivo pelo WhatsApp (a IA não lê anexos). Dados até aqui: ${resumoQualificacao(ctx.dados)}`,
    );
  const passo = ctx.passo === "fim" ? "proximo_passo" : ctx.passo;
  const q = passo === "interesse" ? "Você ainda tem interesse no imóvel?" : PERGUNTA[passo as keyof typeof PERGUNTA];
  return {
    passo,
    dados,
    resposta: `Desculpe, por aqui eu só consigo ler mensagens escritas. Pode me responder em texto? ${q}`,
    fim: null,
    resumo: null,
  };
}

/** Só aceita do extrator (modelo) o campo do passo, em formato seguro. */
function sanitizar(passo: Passo, d: Partial<DadosQualificacao>): Partial<DadosQualificacao> {
  switch (passo) {
    case "finalidade":
      return typeof d.finalidade === "string" ? { finalidade: curto(d.finalidade, 20) } : {};
    case "pagamento":
      return Array.isArray(d.pagamento)
        ? { pagamento: d.pagamento.filter((x) => typeof x === "string").slice(0, 4).map((x) => curto(x, 30)) }
        : {};
    case "proximo_passo":
      return d.proximo_passo === "visita" || d.proximo_passo === "contato" ? { proximo_passo: d.proximo_passo } : {};
    case "prazo":
    case "faixa":
    case "regiao": {
      const v = d[passo];
      return typeof v === "string" ? { [passo]: curto(v) } : {};
    }
    default:
      return {};
  }
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

export type IaConfig = { ia_ativa: boolean; ia_nome: string; ia_boas_vindas: string | null; ia_canal: "teste" | "ziontalk" };

export function validarIaConfig(c: Pick<IaConfig, "ia_nome" | "ia_boas_vindas">): string | null {
  const n = c.ia_nome.trim();
  if (n.length < 1 || n.length > 40) return "Nome da IA entre 1 e 40 caracteres.";
  if ((c.ia_boas_vindas ?? "").length > 400) return "Texto de boas-vindas até 400 caracteres.";
  if (temLink(c.ia_boas_vindas)) return "Não coloque link no texto de boas-vindas (a 1ª mensagem vai sem link).";
  return null;
}

/** Prévia da 1ª mensagem (mesma regra de lead_ia_primeira_msg no banco). */
export function previaPrimeiraMensagem(
  c: Pick<IaConfig, "ia_nome" | "ia_boas_vindas">,
  imobiliaria: string,
  cliente: string,
  imovel: string | null,
): string {
  const base = (c.ia_boas_vindas?.trim() || "Recebi seu contato").replace(/[.!?\s]+$/, "");
  return `Olá, ${cliente.trim().split(" ")[0]}! Aqui é ${c.ia_nome.trim()}, da ${imobiliaria || "imobiliária"}. ${base}${
    imovel ? ` sobre o imóvel ${imovel}` : ""
  }. Você ainda tem interesse? (Se não quiser receber mensagens, responda SAIR.)`;
}
