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
  opcoesOpenRouter,
  rotaDe,
  type EscolhaModelo,
  type UsoModelo,
} from "./leads-ia-modelo";
import {
  CORRETOR,
  categoriaNaoLead,
  ehPergunta,
  ehSensivel,
  falaPermuta,
  MAX_PARECIDOS,
  DISSE_QUE_GOSTOU,
  imovelEmFoco,
  norm,
  pediuFotos,
  quartosParecidos,
  valorFaixa,
  opcoesVisita,
  PERGUNTA_PERIODO,
  periodoDe,
  temPeriodo,
  pediuPessoa,
  perguntouSeRobo,
  prazoConfirmacao,
  querVisitar,
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
/** OpenRouter (DeepSeek sem raciocínio: média ~2 s, pior ~5 s no t_48ddeac0): 1ª chamada 8 s, 2ª 6 s e o Gemini
 * de reserva 10 s. Pior caso ≈ 24 s + espera humana (até 6 s), dentro dos ~30 s do Worker (t_3ea838d7). */
export const REDACAO_OR_TIMEOUT_MS = 8_000;
export const REDACAO_GEMINI_RESERVA_MS = 10_000;
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
    // t_82c89141 item 2: valor e período separados; o período só existe se o XML trouxe iptu_periodo.
    ...iptuPartes(f.iptu),
    link: f.link,
  });
}
/** "R$ 167,00 por ano" -> { iptu: "R$ 167", iptu_periodo: "por ano" }; sem período no XML, só o valor. */
export function iptuPartes(s: string | undefined): { iptu?: string; iptu_periodo?: "por mês" | "por ano" } {
  if (!s) return {};
  const p = /por m[eê]s/i.test(s) ? "por mês" : /por ano/i.test(s) ? "por ano" : undefined;
  const v = valorCurto(s.replace(/\s*por (m[eê]s|ano)\s*$/i, "").trim());
  return p ? { iptu: v, iptu_periodo: p } : { iptu: v };
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
  /** Busca por característica feita antes do modelo (t_a9f1b447): o que o cliente pediu e se ficou fora da faixa. */
  busca?: { pedido: string; fora_faixa: boolean } | null;
  /** t_82c89141 item 1: sem candidatos, por quê? "sem_resultado" = a busca rodou e não achou nada;
   * "nao_consultado" = a busca não rodou ou falhou (aí a Nicole NUNCA diz que não tem). */
  estoque?: "sem_resultado" | "nao_consultado" | null;
  /** t_37cf21e3: perfil de cada busca (a do cliente e a 2ª, ex.: do filho) e qual está valendo agora. */
  buscas?: PerfisBusca | null;
  /** t_37cf21e3: bairro pedido em que não há nada; o candidato fica em outro bairro (avisar). */
  fora_regiao?: string | null;
  /** t_37cf21e3: imóvel de que se fala agora, quando não é o do anúncio nem o último oferecido. */
  em_foco?: ImovelParecido | null;
};

/** t_37cf21e3 item 3: o perfil de cada busca, separado (quem procura, tipo, região, quartos e faixa). */
export type PerfisBusca = {
  atual: "cliente" | "segunda";
  cliente: Record<string, string | number>;
  segunda?: Record<string, string | number>;
};
export function perfisBusca(ctx: Pick<ContextoIa, "ficha">, d: DadosQualificacao): PerfisBusca | null {
  const b = d.busca2;
  const f = ctx.ficha;
  const segunda =
    b && b.tipo !== undefined
      ? limpa({
          quem: b.para ? `${b.para} do cliente` : "outra pessoa",
          tipo: b.tipo || undefined,
          finalidade: b.finalidade || undefined,
          regiao: b.regiao || undefined,
          suites: b.suites,
          quartos: b.quartos,
          faixa: b.faixa || undefined,
        })
      : undefined;
  if (!segunda) return null;
  return {
    atual: b?.ativa ? "segunda" : "cliente",
    cliente: limpa({
      quem: "o próprio cliente",
      tipo: f?.tipo,
      bairro: f?.bairro,
      quartos: f?.quartos,
      faixa: d.faixa ?? (f?.preco ? `perto de ${valorCurto(f.preco)}` : undefined),
    }) as Record<string, string | number>,
    segunda: segunda as Record<string, string | number>,
  };
}

export const INSTRUCAO = `Você é {NOME}, da equipe de atendimento da {ORG}, uma imobiliária. Você conversa pelo WhatsApp com um cliente que se interessou por um imóvel. Escreva como uma atendente humana experiente: simpática, direta, frases curtas, tom de conversa (nada de ficha técnica).

REGRAS (todas obrigatórias):
1. Responda PRIMEIRO exatamente o que o cliente perguntou, em 1 ou 2 frases. Não repita dados que você já mandou no histórico.
2. Só 1 pergunta por mensagem, no fim, de quem conduz a venda: visita, "gostou?", "quer ver mais alguma?". Para dar escolha, junte tudo numa pergunta só com "ou" ("Quer ver essa ou prefere que eu procure com 2 suítes?"). Nunca faça 2 perguntas seguidas ("Te serve? Quer visitar?" está errado). Nunca ofereça "pedir para alguém".
3. Use SOMENTE os dados do bloco DADOS, escritos exatamente como lá (valores no mesmo formato). Nunca invente valor, metragem, quartos, vagas, link, código ou bairro. IPTU: diga "por mês" ou "por ano" SÓ se DADOS trouxer "iptu_periodo"; sem ele, diga só o valor. Sem o dado: "o corretor confirma com você na visita ou no contato" e registre o assunto em "registro.pendente". Nunca prometa voltar com a resposta ("já te falo", "te retorno", "te confirmo").
4. Nunca afirme disponibilidade, que aceita financiamento, FGTS ou permuta, andar, desconto, prazo ou qualquer promessa. Nesses casos diga que o corretor confirma com você na visita ou no contato, registre em "registro.pendente" e convide para a visita. Não use as palavras "disponível" nem "disponíveis" (nem para opções de horário ou de imóveis).
5. Não fale em sistema, robô, IA ou assistente. Não diga que é humana. Corretor só na frase "o corretor confirma com você na visita ou no contato"; nunca diga que o corretor vai ligar, mandar ou responder em algum prazo. Quando for passar o atendimento, use "acao":"passar" e NÃO escreva a frase de passagem (ela é colocada depois e avisa que um corretor continua o atendimento).
6. Sem parênteses, sem código do imóvel, sem markdown, sem lista, no máximo 1 emoji. Não comece com "Obrigada" quando o cliente fez uma pergunta. Concorde o gênero com o tipo (casa anunciada, apartamento anunciado).
7. Pedido de mais opções, "outra", "parecido", "mesma faixa", "nesse valor": ofereça UM imóvel de CANDIDATOS (o primeiro que servir), com tipo, 1 ou 2 características, valor e o link exato, e use "acao":"oferecer" com o "codigo" dele. Se o tipo do candidato for diferente do imóvel do cliente (apartamento para quem viu casa, ou o contrário), diga o tipo com todas as letras e pergunte se esse tipo serve. Havendo candidato, NUNCA diga que não tem outra. Sem candidato: só se DADOS trouxer "estoque":"sem_resultado" diga com naturalidade que essas são as opções que você tem nessa faixa agora e pergunte qual mais gostou ou se quer visitar; com "estoque":"nao_consultado", responda curto ("Entendi!") e use "acao":"passar" (nunca diga que não tem e não prometa separar, mandar ou trazer opções: a frase de passagem já avisa quem continua). Para falar de novo de um imóvel que você já mandou, use "acao":"responder" (oferecer é só para imóvel novo de CANDIDATOS). Use "acao":"passar" também se o cliente insistir em mais opções depois disso.
8. Busca nova (outra pessoa, outro tipo de imóvel, outra finalidade): responda que sim, trabalham com isso, e faça 1 pergunta curta por vez para entender (compra ou aluguel, região, quartos, faixa). Registre em "registro.nova_busca" um resumo curto de tudo o que já sabe dessa busca. Com 2 ou 3 respostas, diga que anotou tudo e use "acao":"passar" (sem prometer separar nem mandar opções). Não perca o interesse no imóvel original.
9. Visita: convide de forma simples ("Quer agendar uma visita?"). Dias e horários só quando o bloco DADOS trouxer "visita" (o cliente já disse que quer visitar); sem ele, não cite dia, data nem período. Quando o cliente escolher dia E período (manhã, tarde ou horário), registre em "registro.visita" e use "acao":"passar". Se ele disse só o dia (ex.: "sábado"), NÃO passe: pergunte "Fica melhor de manhã ou à tarde?". Se ele pedir outro dia ou horário, aceite e anote, sem repetir as opções.
10. Forma de pagamento: pergunte só se o cliente já mostrou interesse num imóvel específico, uma vez só, e nunca no meio de um pedido dele.
11. Máximo de 350 caracteres.
12. Pedido por característica (suítes, quartos, vagas, área, tipo, bairro): se DADOS trouxer "busca", os CANDIDATOS são o resultado dessa busca no estoque. Pode repetir o número que o cliente pediu ("com 3 suítes"). Se "busca.fora_faixa" for true, diga com honestidade que nessa faixa não tem, mostre o candidato como o mais em conta (valor e link) e pergunte se quer ver ou se prefere procurar com um pouco menos. Nunca ofereça de novo um imóvel que não tem o que o cliente acabou de pedir. Sem "busca" e sem candidato que atenda: responda curto que anotou o pedido e use "acao":"passar" (sem prometer procurar nem mandar depois).
13. "Não", "não precisa" ou "só isso" em resposta a uma pergunta sua NÃO é pedido para encerrar nem para passar: siga a conversa com 1 pergunta útil (outras opções do que ele pediu ou a visita). Use "acao":"passar" só quando o cliente pedir uma pessoa, escolher o dia e o período da visita ou no caso das regras 7 e 8.
14. Se DADOS trouxer "outros_anuncios", o cliente também viu esses imóveis no portal: pode citar os dois, com os dados de lá.
15. Duas buscas: se DADOS trouxer "buscas", cada uma tem o seu perfil (quem procura, tipo, região, quartos, faixa) e "buscas.atual" diz de qual o cliente está falando agora. Use só o perfil atual: nunca ofereça para a busca do cliente um imóvel do perfil da outra pessoa, nem o contrário. "para mim", "a casa que eu estou vendo" = busca do cliente; "para o meu filho", "para ele" = a outra.
16. Região: se o cliente pediu um bairro e DADOS trouxer "fora_regiao", diga PRIMEIRO, com clareza, que nesse bairro não tem agora, e só então mostre o candidato dizendo que ele fica em outro bairro (diga qual). Nunca mostre imóvel de outro bairro como se fosse do bairro pedido.
17. Fotos ou vídeo: mande de novo o link do anúncio do imóvel de que vocês estão falando ("As fotos estão todas no anúncio: <link>"). Nunca prometa mandar fotos ("te mando as fotos"). Sem link em DADOS, diga só que o corretor te envia as fotos por aqui.
18. Só diga "que bom que gostou" se o cliente disse que gostou. "Gostaria", "quero" ou "sim" sozinhos são resposta à sua pergunta: pergunte o que ele gostaria de saber ou se prefere agendar a visita.

Responda SÓ com JSON neste formato:
{"mensagem":"texto ao cliente","acao":"responder"|"oferecer"|"passar","codigo":null ou "codigo do candidato oferecido","registro":{"finalidade":"comprar"|"alugar","faixa":"como o cliente disse","pagamento":["à vista"|"financiamento"|"FGTS"|"consórcio"],"visita":"dia e período escolhidos","nova_busca":"resumo curto","interesse":"codigo do imóvel em que o cliente se interessou","pendente":"assunto que o corretor precisa confirmar"}}
Inclua em "registro" só o que o cliente disse nesta conversa.

Exemplos de tom (não copie dados):
Cliente: "qual o valor do condomínio?" -> "O condomínio é R$ 500 por mês. Quer marcar uma visita para conhecer?"
Cliente: "tem outras?" -> "Tenho sim! Tem outra casa no mesmo bairro, com 3 quartos e 170 m², por R$ 900.000. Dá uma olhada: https://exemplo/imovel/1 Gostou?"
Cliente: "aceita financiamento?" -> "Sobre financiamento, o corretor confirma com você na visita ou no contato. Quer marcar uma visita para conhecer?"
Cliente: "pode ser sábado?" -> "Anotado, sábado! Fica melhor de manhã ou à tarde?"`;

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
    busca: e.busca ?? undefined,
    buscas: e.buscas ?? undefined,
    fora_regiao: e.fora_regiao ?? undefined,
    imovel_em_foco: e.em_foco ? parecidoModelo(e.em_foco) : undefined,
    estoque: !e.candidatos.length ? (e.estoque ?? undefined) : undefined,
    outros_anuncios: ctx.outros_anuncios?.length
      ? ctx.outros_anuncios.map((o) => fichaModelo(o.ficha)).filter(Boolean)
      : undefined,
    visita: e.visita.length ? e.visita : undefined,
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
    /** t_82c89141 item 3: assunto sem dado que o corretor confirma (vai para o resumo). */
    pendente?: string;
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
    pendente: txt(r.pendente, 60),
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
  | "oferta"
  | "datas"
  // t_82c89141
  | "retorno"
  | "sem_opcao"
  | "iptu"
  | "tipo"
  | "idioma"
  // t_37cf21e3
  | "fotos"
  | "regiao"
  | "perfil"
  | "gostou"
  | "sem_oferta";

/** Travas FIRMES (t_82c89141): barram também no modo observar (2ª tentativa e, se falhar, o roteiro). */
// t_37cf21e3: fotos (promessa sem link), regiao (outro bairro sem avisar) e perfil (oferta do perfil errado)
// também são firmes: no modo observar, a fala errada não chega ao cliente.
export const TRAVAS_FIRMES: ReadonlySet<Bloqueio> = new Set<Bloqueio>([
  "retorno", "sem_opcao", "iptu", "idioma", "fotos", "regiao", "perfil", "sem_oferta", "gostou",
]);

/** Contagens conferidas pela trava "contagem". */
export type Contagem = "quartos" | "suites" | "vagas" | "banheiros";
type PorContagem = Record<Contagem, Set<number>>;
const porContagem = (): PorContagem => ({ quartos: new Set(), suites: new Set(), vagas: new Set(), banheiros: new Set() });

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
  /** De onde vem cada contagem permitida (t_a9f1b447): ficha do lead, imóveis da busca e pedido do cliente. */
  origem?: { ficha: PorContagem; busca: PorContagem; cliente: PorContagem };
  /** t_82c89141: período do IPTU do XML ("mes" | "ano"); null = o XML não diz (só o valor pode ser dito). */
  iptuPeriodo?: "mes" | "ano" | null;
  /** t_82c89141: situação do estoque entregue ao modelo. Sem o campo, a trava "sem_opcao" não roda. */
  estoque?: "com_candidatos" | "sem_resultado" | "nao_consultado";
  /** t_82c89141: tipo do imóvel do cliente (trava "tipo"). */
  tipoRef?: string;
  // t_37cf21e3 (conversa d8907e38). Sem o campo, a trava correspondente não roda.
  /** O cliente pediu fotos/vídeo: a mensagem tem de levar o link do imóvel em foco (se houver). */
  fotos?: { link: string | null };
  /** Bairro pedido pelo cliente: imóvel de outro bairro só com aviso claro. */
  regiao?: string | null;
  /** Há duas buscas: tipo (base) do perfil que vale agora. */
  perfilTipo?: string | null;
  /** O cliente disse que gostou (\"que bom que gostou\" só nesse caso). */
  clienteGostou?: boolean;
  /** O cliente pediu mais opções e há candidatos: a mensagem tem de mostrar um. */
  pediuOpcoes?: boolean;
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
  /** Mensagens do cliente (a atual e as anteriores): o número que ELE pediu ("3 suítes") não é invenção. */
  falasCliente: string[] = [],
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
    origem: { ficha: porContagem(), busca: porContagem(), cliente: porContagem() },
  };
  const add = <T>(s: Set<T>, v: T | null) => {
    if (v !== null) s.add(v);
  };
  const o = p.origem!;
  for (const [i, alvo] of [[ficha ?? {}, o.ficha], ...parecidos.map((x) => [x, o.busca] as const)] as Array<
    [Partial<FichaIa>, PorContagem]
  >) {
    add(alvo.quartos, inteiro(i.quartos));
    add(alvo.suites, inteiro(i.suites));
    add(alvo.vagas, inteiro(i.vagas));
    add(alvo.banheiros, inteiro(i.banheiros));
  }
  // O número do cliente e um a menos ("prefere que eu procure com 2 suítes?", a mesma sugestão do plano B).
  for (const f of falasCliente)
    for (const [u, v] of contagensDoTexto(norm(f))) {
      o.cliente[u].add(v);
      if (v > 1) o.cliente[u].add(v - 1);
    }
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
  const per = iptuPartes(ficha?.iptu).iptu_periodo;
  p.iptuPeriodo = per === "por mês" ? "mes" : per === "por ano" ? "ano" : null;
  if (ficha?.tipo) p.tipoRef = ficha.tipo;
  return p;
}

/** "Não tenho outra", "essas são as opções que tenho" (texto normalizado). */
const RE_SEM_OPCAO =
  /(nao (tenho|temos|ha|achei|encontrei) (outr[ao]s?|mais (nenhum|opc|imove|casa|apart)|nenhum[ao]? outr|opc|nada)|(essas|estas) (sao|foram) as (unicas )?opcoes|sao as (unicas )?opcoes que (eu )?tenho|so tenho (essa|esse|essas|esses)|sem (outras|mais) opcoes)/;
/** Promessa de voltar com a resposta (t_82c89141 item 3): quem confirma é o corretor, na visita ou no contato. */
const RE_RETORNO =
  /(ja te (falo|retorno|confirmo|aviso|digo|respondo)|te (retorno|confirmo|aviso|respondo)\b|vou (confirmar|verificar|checar|conferir|ver isso|consultar)|deixa eu (confirmar|verificar|ver|checar)|preciso (confirmar|verificar)|retorno (com|para|pra) (voce|vc)|volto (a falar|com a resposta|com voce)|(e|depois|ja) te (mando|envio|passo|trago)\b|vou (separar|procurar|buscar|levantar) (mais|outr|opc|algo|o que))/;
/** Resposta fora do português (visto no DeepSeek real: "También tengo... ¿Te gusta?"). */
// t_f7155e0c: ampliada após o "precio" do DeepSeek. Só palavras que NÃO existem em português (testado contra as falas
// de referência e os bairros/condomínios do XML). Fora de propósito: "el", "y", "pero", "una" soltos (nomes e endereços).
export const RE_IDIOMA =
  /[¿¡ñ]|\b(tambien|tengo|tienes?|usted|mira|gusta|gustaria|ademas|alguna|alguno|algun|ninguna?|ningun|aqui tienes|habitacion|habitaciones|dormitorios con|precios?|banos?|cocheras?|garaje|estacionamiento|cocina|cuartos?|barrio|propiedad|propiedades|inmuebles?|ubicad[oa]s?|ubicacion|metros cuadrados|puedo|puedes|puede|quieres|quiere|muy|ahora|manana|hola|gracias|visitar(la|lo)|visitar el|una (casa|cita|visita|opcion|propiedad)|con (un|una|el|la) )\b|\bcon \d/;
/** Unidade do IPTU dita na mensagem (texto normalizado). */
const RE_IPTU_UNIDADE = /iptu[^.?!]{0,40}?(por mes|por ano|mensa(l|is)|anua(l|is)|ao mes|ao ano|\/mes|\/ano|no ano|no mes|cada mes|cada ano)/;
/** A frase com "corretor" para assunto sem dado (t_82c89141 item 3): sai inteira das travas seguintes. */
const RE_CORRETOR_CONFIRMA = /\bo corretor confirma[^.?!]*/g;
/** Usos de "corretor" que o roteiro manda (t_91c8cf89). Só a palavra sai; o resto da frase continua passando pelas
 * travas de promessa, desconto, condição etc. Confirmar/combinar: em qualquer resposta. Continuar o atendimento:
 * só quando a resposta passa mesmo o atendimento (acao "passar"), para não dizer isso sem passar. */
const CORRETOR_SUJ = String.raw`\b(?:o|um|nosso|seu|ao|pelo|do|para o|pro|que o) corretor(?: da (?:nossa )?equipe)? (?:ja )?(?:vai )?`;
const RE_CORRETOR_CONFIRMA_OK = new RegExp(`${CORRETOR_SUJ}(?:confirma|confirme|confirmar|combina|combine|combinar)\\b`, "g");
const RE_CORRETOR_CONTINUA_OK = new RegExp(
  `${CORRETOR_SUJ}(?:continua|continue|continuar|segue|siga|seguir|acompanha|acompanhar|te atende|te atender|atende|atender)\\b`,
  "g",
);
/** Promessa em nome do corretor (ligar, mandar, prazo, garantia): continua barrada. */
const RE_CORRETOR_PROMESSA =
  /\bcorretor[^.?!]{0,80}?\b(te (liga|ligar|ligue|manda|mandar|mande|envia|enviar|envie|retorna|retornar|chama|chamar|procura|procurar)\b|(liga|ligar|manda|mandar|envia|enviar|retorna|retornar) (pra|para) (voce|vc)|ainda hoje|hoje|agora mesmo|em (ate )?\d+ ?(min|minutos|h|horas?)\b|rapidinho|consegue|vai conseguir)/;
/** t_37cf21e3 item 6: promessa de mandar fotos/vídeo (a Nicole não manda arquivos; manda o link do anúncio). */
const RE_FOTOS_PROMESSA =
  /\b((te |lhe )?(mando|envio|passo|encaminho)|vou (te |lhe )?(mandar|enviar|passar|encaminhar)|posso (te )?(mandar|enviar)|ja (te )?(mando|envio))( (mais|as|umas|algumas|outras|o|os))? (fotos?|videos?|imagens?)\b/;
/** Fala de fotos sem link: \"as fotos ... o corretor confirma\" (sem sentido) também não serve. */
const RE_FOTOS = /\b(fotos?|videos?|imagens?)\b/;
/** Aviso de que o bairro pedido não tem e o imóvel é de outro bairro. */
const RE_AVISO_REGIAO = /(nao (tenho|temos|achei|encontrei|ha|tem)|sem (opc|imove))[^.?!]{0,80}|outro bairro|outra regiao|fica (no|na|em) |bairro vizinho|bem perto d/;
/** \"que bom que gostou\" (e variações). */
const RE_GOSTOU = /\bque (bom|otimo|legal|bacana) que (voce |vc )?gost(ou|a)\b/;
/** Pergunta curta de confirmação ("sábado de manhã, certo?", "tudo bem?"): não conta na regra de 1 pergunta. */
const RE_PERG_CONFIRMA =
  /^(certo|ne|tudo (bem|certo)|ok|combinado|beleza|sabe|viu|entendi|e isso|isso|sim|pode ser|perfeito|tranquilo|ta bom|ta)$/;
/** Pergunta retórica de apresentação ("Que tal essa casa...?", "Sabe o que é melhor?"): só conta se for a última. */
const RE_PERG_RETORICA = /^(e )?(que tal|sabe (o que|qual)|adivinha|olha so)\b/;

/**
 * Quantas perguntas a mensagem faz ao cliente (t_91c8cf89). Não contam: confirmação curta, a alternativa da mesma
 * pergunta ("Te serve? Ou prefere...?"), "qual prefere?" logo depois de uma pergunta com "ou", "?" repetido e a
 * pergunta retórica que não é a última. Duas perguntas de verdade ("Gostou? Quer visitar?") continuam contando 2.
 */
export function contarPerguntas(msg: string): number {
  const segs = norm(msg.replace(LINK_RE, " ")).match(/[^?]*\?/g) ?? [];
  const frases = segs.map((s) => (s.split(/[.!;:]/).pop() ?? "").replace(/\?/g, "").trim());
  let n = 0;
  let anterior = "";
  frases.forEach((f, i) => {
    const fim = (f.split(",").pop() ?? "").trim();
    if (!f || RE_PERG_CONFIRMA.test(fim)) return;
    if (anterior && /^ou\b/.test(f)) return;
    if (/\bou\b/.test(anterior) && /^(e )?(qual|quais) (voce )?(prefere|fica melhor|seria melhor|e melhor)/.test(f)) return;
    if (RE_PERG_RETORICA.test(f) && i < frases.length - 1) return;
    n++;
    anterior = f;
  });
  return n;
}
/** O bairro do candidato é o bairro pedido? (\"campolim\" = \"Parque Campolim\"). */
const mesmoBairroTxt = (bairro: string | undefined, regiao: string) => {
  const a = norm(bairro ?? "");
  const r = norm(regiao);
  return !!a && (a.includes(r) || r.includes(a));
};
export const tipoBase = (t: string | undefined) => {
  const x = norm(t ?? "");
  return /apart|studio|kitnet|flat|cobertura/.test(x) ? "apartamento" : /casa|sobrado/.test(x) ? "casa" : /terreno|lote/.test(x) ? "terreno" : x;
};

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
const unidadeContagem = (u: string): Contagem =>
  /^(quarto|d[oa])/.test(u) ? "quartos" : /^suite/.test(u) ? "suites" : /^vaga/.test(u) ? "vagas" : "banheiros";
/** "3 suítes", "duas vagas" -> [["suites", 3], ["vagas", 2]] (texto já normalizado). */
export function contagensDoTexto(n: string): Array<[Contagem, number]> {
  const r: Array<[Contagem, number]> = [];
  for (const m of n.matchAll(
    /\b(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito)\s*(?:ou mais\s*)?(quartos?|d[oa]m?r?m?[a-z]*torios?|dorms?|suites?|vagas?|banheiros?)\b/g,
  )) {
    const v = /^\d+$/.test(m[1]) ? Number(m[1]) : PALAVRA_NUM[m[1]];
    if (v && v <= 20) r.push([unidadeContagem(m[2]), v]);
  }
  return r;
}

const LINK_RE =
  /(https?:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9-]+\.(?:com|net|org|br|io|app|me|ly|site|link|info)(?:\/[^\s]*)?)/gi;
/** Confirmação honesta ("vou confirmar", "te confirmo", "vou verificar") libera falar do assunto sem afirmar. */
const CONFIRMA =
  /(quem_confirma|vou (confirmar|verificar|checar|ver)|deixa eu (confirmar|verificar|ver)|preciso (confirmar|verificar)|te confirmo|confirmo (com|e|pra|para|isso)|vou te confirmar|ja te (falo|retorno|confirmo))/;
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
  const nPerg = contarPerguntas(msg);
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

  const n0 = norm(resto);
  // Sempre em português do Brasil.
  if (RE_IDIOMA.test(msg.toLowerCase()) || RE_IDIOMA.test(n0)) return b("idioma", achou(RE_IDIOMA, n0) ?? achou(RE_IDIOMA, msg.toLowerCase()));
  // t_82c89141 item 3: nunca prometer voltar com a resposta.
  if (RE_RETORNO.test(n0)) return b("retorno", achou(RE_RETORNO, n0));
  // t_37cf21e3 item 6: fotos = o link do anúncio. Nunca \"te mando as fotos\"; pedido de fotos sem o link = barra.
  if (RE_FOTOS_PROMESSA.test(n0)) return b("fotos", achou(RE_FOTOS_PROMESSA, n0));
  if (perm.fotos && perm.fotos.link && !links.some((l) => l.replace(/[.,;:!?]+$/, "") === perm.fotos!.link))
    return b("fotos", RE_FOTOS.test(n0) ? `${achou(RE_FOTOS, n0)} sem o link` : "pediu fotos, sem o link");
  // t_37cf21e3 item 2: imóvel de outro bairro só com aviso claro de que o bairro pedido não tem.
  const ofertados = [...perm.codigos.values()].filter(
    (c) => (s.acao === "oferecer" && c.codigo === s.codigo) || (!!c.url && links.some((l) => l.replace(/[.,;:!?]+$/, "") === c.url)),
  );
  const foraDoBairro = perm.regiao ? ofertados.filter((c) => !mesmoBairroTxt(c.bairro, perm.regiao!)) : [];
  if (foraDoBairro.length && !RE_AVISO_REGIAO.test(n0)) return b("regiao", `${foraDoBairro[0].bairro ?? "?"} | pediu ${perm.regiao}`);
  // t_37cf21e3 item 3: com duas buscas, a oferta tem de ser do perfil que vale agora.
  if (perm.perfilTipo) {
    const errado = ofertados.find((c) => c.tipo && tipoBase(c.tipo) !== perm.perfilTipo);
    if (errado) return b("perfil", `${errado.tipo} | perfil ${perm.perfilTipo}`);
  }
  // t_37cf21e3 item 4: pediu mais opções e há candidato = mostra um (nunca volta só para o imóvel original).
  if (perm.pediuOpcoes && perm.estoque === "com_candidatos" && !ofertados.length) return b("sem_oferta", "pediu opções e não mostrou nenhuma");
  // t_37cf21e3 item 5: \"Que bom que gostou!\" só se o cliente disse que gostou.
  if (perm.clienteGostou === false && RE_GOSTOU.test(n0)) return b("gostou", achou(RE_GOSTOU, n0));
  // Item 1: com candidato (ou sem a busca ter rodado), nunca dizer que não tem outra opção. Com o aviso de
  // região (o bairro pedido não tem, e a mensagem mostra um de outro bairro), dizer que \"não tem lá\" é correto.
  const avisoRegiao = !!perm.regiao && foraDoBairro.length > 0;
  if (perm.estoque && perm.estoque !== "sem_resultado" && RE_SEM_OPCAO.test(n0) && !avisoRegiao)
    return b("sem_opcao", `${achou(RE_SEM_OPCAO, n0)} | ${perm.estoque}`);
  // Item 2: "por mês"/"por ano" do IPTU só a partir do iptu_periodo do XML.
  const iu = RE_IPTU_UNIDADE.exec(n0);
  if (iu) {
    const dita = /(ano|anua)/.test(iu[1]) ? "ano" : "mes";
    if (perm.iptuPeriodo !== undefined && perm.iptuPeriodo !== dita)
      return b("iptu", `${iu[0]} | xml:${perm.iptuPeriodo ?? "sem período"}`);
  }
  // Item 5: oferta de tipo diferente do imóvel do cliente tem de dizer o tipo.
  if (s.acao === "oferecer" && perm.tipoRef && s.codigo) {
    const c = perm.codigos.get(s.codigo);
    const tc = tipoBase(c?.tipo);
    if (c?.tipo && tc && tc !== tipoBase(perm.tipoRef) && !n0.includes(tc)) return b("tipo", `${c.tipo} | cliente viu ${perm.tipoRef}`);
  }
  // A frase "o corretor confirma com você na visita ou no contato" é permitida (item 3).
  const n = n0.replace(RE_CORRETOR_CONFIRMA, " quem_confirma ");
  // Identidade: nunca "IA/robô/sistema/assistente virtual" e nunca dizer que é humana (a pergunta direta tem
  // resposta fixa antes do modelo).
  if (
    RE_IDENTIDADE.test(
      n,
    )
  )
    return b("identidade", achou(RE_IDENTIDADE, n));
  // Corretor: só "confirma com você..." e os usos do roteiro ("o corretor continua seu atendimento"), sem promessa
  // em nome dele (t_91c8cf89). A palavra sai do texto; o resto da frase segue pelas travas abaixo.
  if (RE_CORRETOR_PROMESSA.test(n0)) return b("corretor", achou(RE_CORRETOR_PROMESSA, n0));
  const tira = (m: string) => m.replace("corretor", "responsavel");
  let nc = n.replace(RE_CORRETOR_CONFIRMA_OK, tira);
  if (s.acao === "passar") nc = nc.replace(RE_CORRETOR_CONTINUA_OK, tira);
  if (/(corretor|corretora|consultor)/.test(nc)) return b("corretor", achou(/(corretor|corretora|consultor)\w*/, nc));
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
    } else if (/^(quarto|dormitorio|suite|vaga|banheiro)/.test(unidade)) {
      const u = unidadeContagem(unidade);
      if (!contagemOk(perm, u, v)) return b("contagem", `${m[0]} | ${origemContagem(perm, u)}`);
    } else return b("numero", m[0]);
  }
  for (const m of semDatas.matchAll(
    /\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito) (quartos?|dormitorios?|suites?|vagas?|banheiros?)\b/g,
  )) {
    const v = PALAVRA_NUM[m[1]];
    const u = unidadeContagem(m[2]);
    if (!contagemOk(perm, u, v)) return b("contagem", `${m[0]} | ${origemContagem(perm, u)}`);
  }
  // Datas da visita só depois que o cliente quis visitar (t_a9f1b447 item 7): sem opções, nada de dia/período.
  if (!perm.datas.size && !/(amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|manha|tarde|noite|\bdia\b|horario)/.test(norm(textoCliente))) {
    const re = /\b(amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b[^.?!]{0,30}\b(manha|tarde|noite)\b/;
    if (re.test(semDatas)) return b("datas", achou(re, semDatas));
  }
  return null;
}

/** O número está na ficha, nos imóveis da busca entregues ao modelo ou no que o cliente pediu? */
function contagemOk(perm: Permitidos, u: Contagem, v: number): boolean {
  return perm[u].has(v) || !!perm.origem?.busca[u].has(v) || !!perm.origem?.cliente[u].has(v);
}
/** "ficha:1 busca:2,4 cliente:-": de onde a trava aceitaria o número (só números, sem texto da conversa). */
function origemContagem(perm: Permitidos, u: Contagem): string {
  const l = (s: Set<number> | undefined) => (s && s.size ? [...s].sort((a, b) => a - b).join(",") : "-");
  const o = perm.origem;
  return `ficha:${l(o?.ficha[u] ?? perm[u])} busca:${l(o?.busca[u])} cliente:${l(o?.cliente[u])}`;
}

/** Explicação curta do bloqueio para a 2ª tentativa do modelo (o que estava errado, sem repetir a conversa). */
export function explicarBloqueio(d: DetalheBloqueio): string {
  const t = d.trecho ? ` ("${d.trecho}")` : "";
  const e: Record<Bloqueio, string> = {
    vazio: "a mensagem veio vazia",
    tamanho: "a mensagem passou de 350 caracteres",
    perguntas: "havia mais de 1 pergunta; deixe só 1, no fim (para dar escolha, junte numa pergunta só com \"ou\")",
    parenteses: "não use parênteses",
    formato: "responda só com o JSON pedido, sem markdown, lista ou símbolos",
    link: "use só o link exato de um imóvel de DADOS",
    valor: "o valor não está em DADOS; use o valor exatamente como em DADOS",
    area: "a metragem não está em DADOS",
    contagem: "esse número de quartos/suítes/vagas não está em DADOS nem no que o cliente pediu; use só os números dos imóveis de DADOS",
    numero: "número solto que não está em DADOS",
    disponibilidade: "não afirme disponibilidade nem use a palavra disponível",
    condicao: "não afirme financiamento, FGTS, permuta ou consórcio; diga que o corretor confirma com você na visita ou no contato",
    andar: "não fale de andar",
    desconto: "não fale de desconto nem de negociar o valor",
    promessa: "não faça promessa nem garantia",
    identidade: "não fale de IA, robô, sistema ou assistente",
    corretor: "corretor só em \"o corretor confirma com você na visita ou no contato\", sem prometer ligação, envio ou prazo; para passar o atendimento use acao passar",
    obrigada: "não comece com Obrigada quando o cliente fez uma pergunta",
    oferta: "ofereça só um imóvel de CANDIDATOS ainda não oferecido, com o codigo dele",
    datas: "ainda não ofereça dias nem horários; convide de forma simples para a visita",
    retorno: "não prometa voltar com a resposta; diga que o corretor confirma com você na visita ou no contato",
    sem_opcao: "não diga que não tem outra opção: há CANDIDATOS em DADOS (ofereça um) ou a busca não rodou (pergunte o que o cliente procura, como quartos ou bairro, sem prometer mandar depois)",
    iptu: "o período do IPTU só pode ser dito se DADOS trouxer iptu_periodo; senão diga só o valor",
    tipo: "o imóvel oferecido é de outro tipo; diga o tipo dele com todas as letras e pergunte se esse tipo serve",
    idioma: "responda só em português do Brasil",
    fotos: "não prometa mandar fotos; mande o link do anúncio do imóvel de que vocês estão falando (\"As fotos estão todas no anúncio: <link>\")",
    regiao: "o imóvel fica em outro bairro: diga primeiro que no bairro pedido não tem agora e depois que esse fica em outro bairro (diga qual)",
    perfil: "esse imóvel é do perfil da outra busca; ofereça só um candidato do tipo da busca de que o cliente fala agora (veja buscas.atual)",
    sem_oferta: "o cliente pediu mais opções e há CANDIDATOS: ofereça um deles com acao oferecer, tipo, valor e link",
    gostou: "o cliente não disse que gostou; pergunte o que ele gostaria de saber ou se prefere agendar a visita",
  };
  return `Sua resposta anterior foi recusada: ${e[d.motivo]}${t}. Escreva de novo seguindo todas as regras.`;
}

// --- Chamada ao modelo (Gemini direto ou OpenRouter), só texto ---------------------------------------

type Chamada = {
  ok: boolean;
  texto: string | null;
  erro: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  custo_usd: number | null;
  rota?: string | null;
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
        // DeepSeek: só Relace/DeepInfra/Reka e sem raciocínio (t_3ea838d7); os demais como antes.
        ...opcoesOpenRouter(modelo, { effort: "low", exclude: true }),
        usage: { include: true },
      }),
    });
    if (!res.ok) return falha(`http_${res.status}`);
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { code?: number };
      provider?: string;
    };
    if (j.error) return falha(`erro_${num(j.error.code) ?? "x"}`);
    return {
      ok: true,
      texto: j.choices?.[0]?.message?.content ?? null,
      erro: null,
      tokens_entrada: num(j.usage?.prompt_tokens),
      tokens_saida: num(j.usage?.completion_tokens),
      custo_usd: num(j.usage?.cost),
      rota: rotaDe(j.provider),
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

/** "Não" curto a uma pergunta da Nicole (não é motivo para passar ao corretor, t_a9f1b447 item 5). */
const NAO_CURTO = /^(nao|n|nao obrigad\w*|nao precisa|so isso|tudo bem|ta bom|nao,? obrigad\w*)[\s.!]*$/;

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
    (base.fim === "visita" && !!base.dados.visita_livre) ||
    // t_82c89141 item 4 (regra fixa do sábado/dia sem período): o roteiro pergunta "manhã ou tarde?".
    (!base.fim && !!base.dados.visita_dia_pendente)
  );
}

// t_82c89141 item 6a: a última mensagem sempre avisa que um corretor continua o atendimento (com ou sem o nome).
const PASSAR_OK = `Já pedi para ${CORRETOR}, que vai continuar seu atendimento por aqui.`;
const PASSAR_FALHA = "Um corretor da nossa equipe vai continuar seu atendimento por aqui.";
const VISITA_OK = `Já pedi para ${CORRETOR}, que vai continuar seu atendimento por aqui para confirmar o horário certinho.`;
const VISITA_FALHA = "Um corretor da nossa equipe vai continuar seu atendimento por aqui para confirmar o horário.";

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

  // t_37cf21e3: respostas que o roteiro decidiu com texto fixo (confirmação de frase ambígua, \"Gostaria\",
  // perguntas da 2ª busca, fotos sem link) saem como estão.
  if (base.fixo) return plano();
  // Busca por característica feita antes (plano B, t_a9f1b447): o estado dela vale para o modelo também.
  const busca = base.busca ?? null;
  // t_37cf21e3 item 3: o perfil da 2ª busca (do filho etc.) e a troca de perfil vêm SEMPRE do roteiro; antes
  // eram descartados a cada turno e a fala do filho virava filtro e faixa da busca do pai.
  const baseD = base.dados ?? {};
  const dadosIn: DadosQualificacao = busca
    ? { ...(ctx.dados ?? {}), ...baseD, parecido_atual: ctx.dados?.parecido_atual, parecidos: ctx.dados?.parecidos }
    : {
        ...(ctx.dados ?? {}),
        busca2: baseD.busca2 ?? ctx.dados?.busca2,
        outras_buscas: baseD.outras_buscas ?? ctx.dados?.outras_buscas,
        confirmar_tipo: baseD.confirmar_tipo,
        filtro_pedido: baseD.busca2?.ativa ? ctx.dados?.filtro_pedido : (baseD.filtro_pedido ?? ctx.dados?.filtro_pedido),
        faixa: baseD.faixa ?? ctx.dados?.faixa,
      };
  const perfis = perfisBusca(ctx, dadosIn);
  const emFoco = imovelEmFoco(dadosIn);
  const segundaAtiva = !!dadosIn.busca2?.ativa;
  const ja = ctx.dados?.parecidos ?? [];
  const negocio =
    dadosIn.finalidade === "alugar" || (!dadosIn.finalidade && ctx.transacao === "aluguel")
      ? "locacao"
      : "venda";
  // Candidatos: até 3 parecidos do XML ainda não oferecidos (o banco aplica as regras de parecido).
  const res = busca
    ? { referencia: {}, itens: busca.itens }
    : op.buscarParecidos && ja.length < MAX_PARECIDOS && !segundaAtiva
      ? await op
          .buscarParecidos({
            excluir: ja,
            negocio,
            limite: 3,
            codigo_ref: dadosIn.imovel_xml_codigo ?? dadosIn.anuncio_informado ?? null,
          })
          .catch(() => null)
      : null;
  // t_37cf21e3 item 1: só parecidos de verdade (quartos ±1 do imóvel do cliente, quando não há pedido próprio).
  const candidatos = (res?.itens ?? [])
    .filter((i) => !ja.includes(i.codigo) && (busca ? true : quartosParecidos(i, ctx.ficha, dadosIn.filtro_pedido)))
    .slice(0, 3);
  // t_82c89141 item 1: a Nicole só pode dizer "não tenho outra" se a busca RODOU e voltou vazia.
  const estoque: Permitidos["estoque"] = candidatos.length ? "com_candidatos" : res ? "sem_resultado" : "nao_consultado";
  // Datas só depois que o cliente disse que quer visitar (item 7); antes, o convite é simples.
  const visita = querVisitar(ctx, texto) ? visitaSemParenteses(op.agora ?? new Date()) : [];
  const msgs = montarMensagens({
    ctx: { ...ctx, dados: dadosIn },
    texto,
    historico: op.historico,
    candidatos,
    visita,
    busca: busca ? { pedido: busca.pedido, fora_faixa: busca.fora_faixa } : null,
    estoque: estoque === "com_candidatos" ? null : estoque,
    buscas: perfis,
    fora_regiao: busca?.fora_regiao ?? null,
    em_foco: emFoco,
  });
  const falasCliente = [
    texto,
    ...op.historico.filter((m) => m.autor === "cliente").slice(-4).map((m) => m.texto),
    ...(dadosIn.filtro_pedido ? [textoFiltro(dadosIn.filtro_pedido)] : []),
  ];

  let saida: SaidaModelo | null = null;
  let uso: Omit<UsoModelo, "ok" | "erro" | "tokens_entrada" | "tokens_saida" | "custo_usd"> | null =
    null;
  let chamada: Chamada | null = null;
  const perm = permitidosDe(
    ctx.ficha,
    [...candidatos, ...(dadosIn.parecido_atual ? [dadosIn.parecido_atual] : []), ...(emFoco && emFoco !== dadosIn.parecido_atual ? [emFoco] : [])],
    visita,
    falasCliente,
  );
  perm.estoque = estoque;
  // t_37cf21e3: travas da conversa d8907e38.
  if (pediuFotos(texto)) perm.fotos = { link: (emFoco ? emFoco.url : ctx.ficha?.link) || null };
  if (busca?.fora_regiao) perm.regiao = busca.fora_regiao;
  if (perfis) perm.perfilTipo = tipoBase(perfis.atual === "segunda" ? dadosIn.busca2?.tipo : ctx.ficha?.tipo) || null;
  // Na 2ª busca, a trava "tipo" compara com o tipo pedido para a outra pessoa (não com a casa do cliente).
  if (perfis?.atual === "segunda" && dadosIn.busca2?.tipo) perm.tipoRef = dadosIn.busca2.tipo;
  perm.clienteGostou = DISSE_QUE_GOSTOU.test(norm(texto));
  perm.pediuOpcoes = base.intencao === "opcoes";
  void valorFaixa;
  // No máximo 2 chamadas. Modo bloquear: bloqueio do validador = 2ª tentativa dizendo o que estava errado
  // (t_a9f1b447); só se ela também falhar sai a frase pronta. Modo observar: erro, demora ou JSON ruim = 2ª
  // tentativa (t_3a4bf078); bloqueio só registra. A trava "contagem" corrigida vale nos dois modos.
  let detalhe: DetalheBloqueio | null = null;
  let primeira: { saida: SaidaModelo; detalhe: DetalheBloqueio } | null = null;
  let correcao: string | null = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const tempo = tentativa === 1 ? REDACAO_TIMEOUT_MS : REDACAO_RETRY_TIMEOUT_MS;
    const m = correcao ? { sistema: msgs.sistema, usuario: `${msgs.usuario}\n\nCORREÇÃO: ${correcao}` } : msgs;
    chamada = null;
    uso = null;
    let tentReal = tentativa;
    if (usaOr) {
      // Plano B do OpenRouter (t_3ea838d7): erro, demora ou provedor fora = tenta 1 vez de novo no mesmo
      // modelo; se falhar de novo, vai ao Gemini (não à frase pronta). Cada falha fica no lead_ia_uso.
      const ate = tentativa === 1 ? 2 : 1;
      uso = { provedor: "openrouter", modelo: op.escolha.modelo!, fallback: false };
      for (let k = 1; k <= ate; k++) {
        tentReal = Math.min(2, tentativa + k - 1);
        if (chamada && !chamada.ok)
          op.registrar({ ...uso, ...semTexto(chamada), uso: "redigir", bloqueado: false, bloqueio: null, tentativa: tentReal - 1 });
        chamada = await redigirOpenRouter(
          orKey!,
          op.escolha.modelo!,
          m,
          fetchFn,
          tentReal === 1 ? REDACAO_OR_TIMEOUT_MS : REDACAO_RETRY_TIMEOUT_MS,
        );
        if (chamada.ok) break;
      }
      if (chamada && !chamada.ok && usaGemini) {
        op.registrar({ ...uso, ...semTexto(chamada), uso: "redigir", bloqueado: false, bloqueio: null, tentativa: tentReal });
        chamada = null;
      }
    }
    if (!chamada && usaGemini) {
      chamada = await redigirGemini(gKey!, m, fetchFn, usaOr ? REDACAO_GEMINI_RESERVA_MS : tempo);
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
    // No modo observar a mensagem sai mesmo barrada; "observado" marca que a trava só registrou. As travas
    // FIRMES (t_82c89141: retorno, sem_opcao, iptu) barram nos dois modos.
    const firme = !!detalhe && TRAVAS_FIRMES.has(detalhe.motivo);
    const observado = observar && !!saida && !!detalhe && !firme;
    // Trecho (o número/link/palavras, até 60 caracteres) e origem (só números) do bloqueio, nos dois modos.
    op.registrar({
      ...uso,
      ...semTexto(chamada),
      ok: chamada.ok && !!saida,
      erro: chamada.ok ? (saida ? null : "json") : chamada.erro,
      uso: "redigir",
      bloqueado: !!detalhe,
      bloqueio: detalhe?.motivo ?? null,
      bloqueio_trecho: detalhe?.trecho ?? null,
      tentativa: tentReal,
      ...(observar ? { observado } : {}),
    });
    if (saida && !detalhe) break; // aprovada
    // Modo observar: a trava só registra, a mensagem sai como veio (sem 2ª tentativa por bloqueio).
    if (saida && detalhe && observar && !firme) break;
    if (saida && detalhe) {
      // Bloqueada: tenta 1 vez de novo dizendo o que estava errado.
      if (!primeira) primeira = { saida, detalhe };
      correcao = explicarBloqueio(detalhe);
      continue;
    }
    // Erro/demora/JSON ruim: só o modo observar tenta de novo.
    if (!observar) break;
    // OpenRouter: o plano B (2ª chamada + Gemini) já rodou nesta volta; outra volta estouraria o tempo do Worker.
    // Só uma resposta ruim (JSON) do OpenRouter na 1ª chamada ganha a 2ª volta (que ainda tem o Gemini de reserva).
    if (usaOr && (!chamada.ok || tentReal >= 2 || uso.provedor === "gemini")) break;
  }
  // Observar: se a 2ª falhou (erro), sai a 1ª resposta legível, mesmo barrada (a trava só registra).
  if (observar && !saida && primeira && !TRAVAS_FIRMES.has(primeira.detalhe.motivo)) {
    saida = primeira.saida;
    detalhe = primeira.detalhe;
  }
  if (!chamada || !saida) {
    // Trava firme barrou as 2 tentativas: o roteiro (plano B) responde, também no modo observar.
    const m = detalhe?.motivo ?? primeira?.detalhe.motivo ?? null;
    return observar && !(m && TRAVAS_FIRMES.has(m)) ? semResposta() : plano(m);
  }
  const bloqueio: Bloqueio | null = detalhe?.motivo ?? null;
  if (bloqueio && (!observar || TRAVAS_FIRMES.has(bloqueio))) return plano(bloqueio);
  // t_82c89141 item 4: dia sem período não passa ao corretor; pergunta manhã ou tarde.
  if (saida.acao === "passar" && saida.registro.visita && !temPeriodo(saida.registro.visita) && !periodoDe(norm(texto))) {
    const dia = saida.registro.visita;
    return {
      passo: ctx.passo === "fim" ? "visita" : ctx.passo,
      dados: { ...dadosIn, visita_dia_pendente: dia, convite_visita: true },
      resposta: PERGUNTA_PERIODO(dia),
      resposta_falha: null,
      fim: null,
      resumo: null,
      redigida: true,
      bloqueio,
    };
  }
  // "Não" a uma pergunta da Nicole não é motivo para passar ao corretor (item 5).
  if (saida.acao === "passar" && !saida.registro.visita && !saida.registro.nova_busca && NAO_CURTO.test(norm(texto)))
    saida = { ...saida, acao: "responder" };
  // Observar: limite do banco (2000) e oferta com código fora dos candidatos não vira "oferecido".
  if (observar) saida = { ...saida, mensagem: saida.mensagem.slice(0, 1500) };
  const ofertaValida = saida.acao === "oferecer" && !!saida.codigo && perm.codigos.has(saida.codigo);

  // Aprovada: monta o estado a partir do que a conversa já tinha + o que o cliente disse (registro).
  const dados: DadosQualificacao = {
    ...dadosIn,
    // Busca por característica: o modelo pode ter mostrado outro candidato que não o do plano B.
    ...(busca ? { parecido_atual: base.dados.parecido_atual, parecidos: base.dados.parecidos } : {}),
    repeticoes: { ...(dadosIn.repeticoes ?? {}) },
    perguntas: [...(dadosIn.perguntas ?? [])],
  };
  dados.ofereceu_corretor = undefined;
  dados.interesse = true;
  const r = saida.registro;
  if (r.finalidade && !dados.finalidade) dados.finalidade = r.finalidade;
  if (r.faixa) dados.faixa = r.faixa;
  if (r.pagamento?.length) dados.pagamento = r.pagamento;
  // t_82c89141 item 3: o que ficou sem dado vai como pendência no resumo do corretor.
  if (r.pendente) dados.pendentes = [...new Set([...(dados.pendentes ?? []), r.pendente])].slice(0, 12);
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

/** "3 suítes 2 vagas" a partir do filtro guardado (o cliente já pediu antes; o número dele não é invenção). */
function textoFiltro(f: NonNullable<DadosQualificacao["filtro_pedido"]>): string {
  return [
    f.suites !== undefined ? `${f.suites} suites` : "",
    f.quartos !== undefined ? `${f.quartos} quartos` : "",
    f.vagas !== undefined ? `${f.vagas} vagas` : "",
  ].join(" ");
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
/** t_37cf21e3: falas do cliente que chegaram juntas, antes da atual e depois da última resposta da Nicole. */
export function falasSemResposta(h: FalaHistorico[], atual: string): string[] {
  const fim = [...h];
  if (fim.length && fim[fim.length - 1].autor === "cliente" && fim[fim.length - 1].texto.trim() === atual.trim()) fim.pop();
  const out: string[] = [];
  for (let i = fim.length - 1; i >= 0 && fim[i].autor === "cliente" && out.length < 3; i--) out.unshift(fim[i].texto);
  return out;
}

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
    rota: c.rota ?? null,
  };
}
