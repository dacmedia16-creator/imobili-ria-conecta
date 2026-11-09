// Proposta de compra com assinatura por link + código no WhatsApp (t_4cff61a6; pedido de Denis em 09/11/2026).
// Regras puras, sem rede. O banco (migration 20261109120000) é a fonte da verdade: situação, partes obrigatórias,
// validade, código e assinatura são decididos lá; aqui ficam rótulos, a mensagem do WhatsApp e a leitura em lista
// fechada das respostas do banco (nada além do permitido chega à tela pública).

export const SITUACOES = [
  "rascunho",
  "aguardando_assinaturas",
  "aceita",
  "recusada",
  "contraproposta",
  "vencida",
] as const;
export type Situacao = (typeof SITUACOES)[number];

export const SITUACAO_LABEL: Record<Situacao, string> = {
  rascunho: "Rascunho",
  aguardando_assinaturas: "Aguardando assinaturas",
  aceita: "Aceita",
  recusada: "Recusada",
  contraproposta: "Contraproposta",
  vencida: "Vencida",
};

export const PAPEIS = [
  "comprador",
  "comprador_conjuge",
  "vendedor",
  "vendedor_conjuge",
  "corretor",
] as const;
export type Papel = (typeof PAPEIS)[number];

export const PAPEL_LABEL: Record<Papel, string> = {
  comprador: "Comprador",
  comprador_conjuge: "Cônjuge do comprador",
  vendedor: "Vendedor",
  vendedor_conjuge: "Cônjuge do vendedor",
  corretor: "Corretor",
};

export const FORMAS_PAGAMENTO = ["a_vista", "sinal_financiamento", "sinal_parcelas"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];
export const FORMA_LABEL: Record<FormaPagamento, string> = {
  a_vista: "À vista",
  sinal_financiamento: "Sinal + financiamento",
  sinal_parcelas: "Sinal + parcelas",
};

export const ESTADOS_CIVIS = [
  "solteiro",
  "casado",
  "uniao_estavel",
  "divorciado",
  "viuvo",
  "separado",
] as const;
export type EstadoCivil = (typeof ESTADOS_CIVIS)[number];

/** D9 (Denis 09/11): validade padrão de 5 dias CORRIDOS, contados da data do documento. */
export const VALIDADE_PADRAO_DIAS = 5;
/** D7 revista (Denis 09/11, t_b4e7c368): como na Campolim, o corretor escolhe; padrão = confirmatórias. */
export const SINAL_TIPOS = ["confirmatorias", "penitenciais"] as const;
export type SinalTipo = (typeof SINAL_TIPOS)[number];
export const SINAL_TIPO_PADRAO: SinalTipo = "confirmatorias";
/** Rótulos da tela iguais aos da Campolim. */
export const SINAL_TIPO_LABEL: Record<SinalTipo, string> = {
  confirmatorias: "Confirmatório (padrão da lei)",
  penitenciais: "Com direito de arrependimento",
};
export const SINAL_TIPO_AJUDA: Record<SinalTipo, string> = {
  confirmatorias: "confirma o negócio e faz parte do preço.",
  penitenciais: "quem desistir perde o sinal (ou devolve em dobro) e nada mais é cobrado.",
};
export const lerSinalTipo = (v: unknown): SinalTipo =>
  v === "penitenciais" ? "penitenciais" : SINAL_TIPO_PADRAO;
/**
 * MARCAÇÃO INTERNA (t_b4e7c368): o texto oficial (Campolim ajustado, aprovado por Denis em 09/11) AINDA DEPENDE da
 * aprovação do advogado. Enquanto for false, a publicação continua bloqueada (além do "sim" de Denis).
 * Só mude para true com a aprovação registrada do advogado.
 */
export const TEXTO_APROVADO_ADVOGADO = false;
export const AVISO_TEXTO_ADVOGADO =
  "Texto oficial (Campolim ajustado) ainda depende da aprovação do advogado. Não publicar.";

export const CODIGO_RE = /^[0-9]{6}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const LIMITE_TENTATIVAS = 5;
export const AVISO_SO_ENVIA = "Este número só envia avisos e não lê respostas.";

/** Casado ou união estável: o cônjuge também assina. */
export function precisaConjuge(ec: string | null | undefined): boolean {
  return ec === "casado" || ec === "uniao_estavel";
}

/** Situação mostrada (cópia da regra do banco proposta_situacao, para testes e telas). */
export function situacaoVisivel(
  situacao: string,
  validadeAte: string | null,
  hoje: string,
): Situacao {
  if (situacao === "aguardando_assinaturas" && validadeAte && validadeAte < hoje) return "vencida";
  return (SITUACOES as readonly string[]).includes(situacao) ? (situacao as Situacao) : "rascunho";
}

/** "2026-11-09" + 5 dias corridos → "2026-11-14" (sem fuso: datas civis). */
export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Dias até vencer (negativo = vencida). */
export function diasParaVencer(validadeAte: string, hoje: string): number {
  return Math.round(
    (Date.parse(`${validadeAte}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000,
  );
}

export function propostaLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/proposta/${token}`;
}

/** wa.me do corretor do negócio (só dígitos, com DDI 55). Telefone inválido = null. */
export function waMe(telefone: string | null | undefined): string | null {
  const d = (telefone ?? "").replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return null;
  return `https://wa.me/${d.startsWith("55") && d.length >= 12 ? d : `55${d}`}`;
}

export type DadosMensagem = {
  imobiliaria: string;
  endereco: string | null;
  link: string;
  codigo: string;
  parteNome: string | null;
  corretorNome: string | null;
  corretorTelefone: string | null;
};

/**
 * Mensagem individual de cada parte: imobiliária, endereço do imóvel, link próprio, código de 6 dígitos,
 * "Dúvidas? Fale com seu corretor" com o wa.me do corretor do negócio e o aviso de que o número só envia.
 * Sem acentos aqui não: quem envia aplica paraWhatsapp (o ZionTalk recusa acento).
 */
export function montarMensagem(d: DadosMensagem): string {
  if (!CODIGO_RE.test(d.codigo)) throw new Error("Código inválido");
  const nome = (d.parteNome ?? "").trim().split(/\s+/)[0];
  const wa = waMe(d.corretorTelefone);
  const linhas = [
    `*${d.imobiliaria.trim()}*`,
    "",
    nome ? `Olá, ${nome}!` : "Olá!",
    "Você recebeu uma proposta de compra para assinar.",
    d.endereco ? `Imóvel: ${d.endereco}` : null,
    "",
    "Leia a proposta inteira e assine pelo link:",
    d.link,
    "",
    `Seu código: *${d.codigo}*`,
    "O código vale por 24 horas. Não compartilhe com ninguém.",
    "",
    wa
      ? `Dúvidas? Fale com seu corretor${d.corretorNome ? ` ${d.corretorNome.trim()}` : ""}: ${wa}`
      : "Dúvidas? Fale com seu corretor.",
    AVISO_SO_ENVIA,
  ];
  return linhas.filter((l): l is string => l !== null).join("\n");
}

// --- Resposta pública (proposta_publica_ler) — lista fechada --------------------------------------------------

export type ParteVisivel = {
  papel: Papel;
  ordem: number;
  nome: string | null;
  assinou: boolean;
  tipoPessoa: "fisica" | "juridica";
  estadoCivil: EstadoCivil | null;
};
export type PropostaPublica = {
  imobiliaria: string;
  documento: string;
  versao: number;
  situacao: Situacao;
  validadeAte: string | null;
  conteudoHash: string;
  voce: {
    papel: Papel;
    ordem: number;
    nome: string | null;
    documentoFinal: string | null;
    assinadoEm: string | null;
  };
  imovel: Record<
    "tipo" | "endereco" | "complemento" | "bairro" | "cidade" | "uf" | "matricula" | "cartorio" | "iptu",
    string | null
  >;
  /** Texto oficial: termos sem dado pessoal/bancário (o banco já tira RG, endereço, CPF do representante e conta). */
  termos: Record<string, string | number>;
  documentoData: string | null;
  cadastro: Record<string, string>;
  valores: {
    oferta: number | null;
    formaPagamento: FormaPagamento | null;
    sinal: number | null;
    sinalPrazoDias: number | null;
    sinalTipo: SinalTipo;
    financiamentoBanco: string | null;
    financiamentoValor: number | null;
  };
  condicoes: {
    validadeDias: number;
    prazoContratoDias: number | null;
    certidoes: "vendedor_apresenta" | "dispensadas" | null;
    observacoes: string | null;
  };
  partes: ParteVisivel[];
  corretor: { nome: string | null; whatsapp: string | null };
};
export type ErroPublico = "indisponivel" | "limite" | "invalido" | "vencida";
export type LeituraPublica =
  { ok: true; dados: PropostaPublica } | { ok: false; erro: ErroPublico };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const papel = (v: unknown): Papel | null =>
  (PAPEIS as readonly string[]).includes(v as string) ? (v as Papel) : null;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// --- Termos do texto oficial (coluna termos; lista fechada, igual a proposta_termos_limpar) ------------------
export const TERMOS_TEXTO = [
  "comprador_rg",
  "comprador_nacionalidade",
  "comprador_profissao",
  "comprador_endereco",
  "comprador_regime",
  "comprador_representante",
  "comprador_representante_cpf",
  "comprador_cargo",
  "vendedor_conta",
  "imovel_descricao",
  "sinal_forma",
  "proprios_quando",
  "permuta_descricao",
  "parcelas",
  "pagamento_obs",
  "itens",
  "posse",
  "local",
  "comissao_quem",
] as const;
export const TERMOS_NUMERO = [
  "proprios_valor",
  "fgts_valor",
  "permuta_valor",
  "fin_prazo_dias",
] as const;
export type TermoTexto = (typeof TERMOS_TEXTO)[number];
export type TermoNumero = (typeof TERMOS_NUMERO)[number];
export type Termos = Partial<Record<TermoTexto, string> & Record<TermoNumero, number>>;
/** O que o link público recebe (o banco tira RG, endereço, CPF do representante e conta do vendedor). */
export const TERMOS_PRIVADOS: readonly TermoTexto[] = [
  "comprador_rg",
  "comprador_endereco",
  "comprador_representante_cpf",
  "vendedor_conta",
];
const TERMOS_PUBLICOS: readonly string[] = [...TERMOS_TEXTO, ...TERMOS_NUMERO].filter(
  (k) => !(TERMOS_PRIVADOS as readonly string[]).includes(k),
);

export function lerTermos(
  raw: unknown,
  permitidos: readonly string[] = [...TERMOS_TEXTO, ...TERMOS_NUMERO],
): Termos {
  const r = obj(raw);
  const out: Record<string, string | number> = {};
  for (const k of permitidos) {
    if ((TERMOS_NUMERO as readonly string[]).includes(k)) {
      const n = num(r[k]);
      if (n != null && n > 0) out[k] = n;
    } else {
      const s = str(r[k]);
      if (s) out[k] = s.trim();
    }
  }
  return out as Termos;
}

export const CADASTRO_CHAVES = [
  "nome",
  "razao_social",
  "cnpj",
  "creci",
  "endereco",
  "cidade",
  "uf",
  "corretor_creci",
] as const;
export type Cadastro = Partial<Record<(typeof CADASTRO_CHAVES)[number], string>>;
export function lerCadastro(raw: unknown): Cadastro {
  const r = obj(raw);
  const out: Cadastro = {};
  for (const k of CADASTRO_CHAVES) {
    const s = str(r[k]);
    if (s) out[k] = s.trim();
  }
  return out;
}

/** Copia SÓ os campos permitidos (mesmo que o banco mande algo a mais). */
export function lerPropostaPublica(raw: unknown): LeituraPublica {
  const r = obj(raw);
  if (r.ok !== true) {
    const e = r.erro;
    return {
      ok: false,
      erro: e === "limite" || e === "invalido" || e === "vencida" ? e : "indisponivel",
    };
  }
  const voce = obj(r.voce);
  const vp = papel(voce.papel);
  const hash = str(r.conteudo_hash);
  if (!vp || !hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, erro: "indisponivel" };
  const im = obj(r.imovel);
  const v = obj(r.valores);
  const c = obj(r.condicoes);
  const cor = obj(r.corretor);
  const forma = (FORMAS_PAGAMENTO as readonly string[]).includes(v.forma_pagamento as string)
    ? (v.forma_pagamento as FormaPagamento)
    : null;
  const cert =
    c.certidoes === "vendedor_apresenta" || c.certidoes === "dispensadas" ? c.certidoes : null;
  const final = str(voce.documento_final);
  return {
    ok: true,
    dados: {
      imobiliaria: str(r.imobiliaria) ?? "",
      documento: str(r.documento) ?? "",
      versao: num(r.versao) ?? 1,
      situacao: (SITUACOES as readonly string[]).includes(r.situacao as string)
        ? (r.situacao as Situacao)
        : "aguardando_assinaturas",
      validadeAte: str(r.validade_ate),
      conteudoHash: hash,
      voce: {
        papel: vp,
        ordem: num(voce.ordem) ?? 1,
        nome: str(voce.nome),
        documentoFinal: final && /^[0-9]{2}$/.test(final) ? final : null,
        assinadoEm: str(voce.assinado_em),
      },
      imovel: {
        tipo: str(im.tipo),
        endereco: str(im.endereco),
        complemento: str(im.complemento),
        bairro: str(im.bairro),
        cidade: str(im.cidade),
        uf: str(im.uf),
        matricula: str(im.matricula),
        cartorio: str(im.cartorio),
        iptu: str(im.iptu),
      },
      termos: lerTermos(r.termos, TERMOS_PUBLICOS),
      documentoData: (() => {
        const d = str(r.documento_data);
        return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
      })(),
      cadastro: lerCadastro(r.cadastro),
      valores: {
        oferta: num(v.oferta),
        formaPagamento: forma,
        sinal: num(v.sinal),
        sinalPrazoDias: num(v.sinal_prazo_dias),
        sinalTipo: lerSinalTipo(v.sinal_tipo),
        financiamentoBanco: str(v.financiamento_banco),
        financiamentoValor: num(v.financiamento_valor),
      },
      condicoes: {
        validadeDias: num(c.validade_dias) ?? VALIDADE_PADRAO_DIAS,
        prazoContratoDias: num(c.prazo_contrato_dias),
        certidoes: cert,
        observacoes: str(c.observacoes),
      },
      partes: (Array.isArray(r.partes) ? r.partes : [])
        .map(obj)
        .filter((x) => papel(x.papel))
        .map((x) => ({
          papel: x.papel as Papel,
          ordem: num(x.ordem) ?? 1,
          nome: str(x.nome),
          assinou: x.assinou === true,
          tipoPessoa: x.tipo_pessoa === "juridica" ? ("juridica" as const) : ("fisica" as const),
          estadoCivil: (ESTADOS_CIVIS as readonly string[]).includes(x.estado_civil as string)
            ? (x.estado_civil as EstadoCivil)
            : null,
        })),
      corretor: { nome: str(cor.nome), whatsapp: waMe(str(cor.telefone)) },
    },
  };
}

// --- Assinatura (proposta_publica_assinar) ----------------------------------------------------------------

export type ResultadoAssinatura =
  | { ok: true; situacao: Situacao; faltam: number }
  | { ok: false; erro: ErroAssinatura; restantes?: number };
export type ErroAssinatura =
  | "codigo_errado"
  | "limite"
  | "codigo_vencido"
  | "sem_codigo"
  | "versao_mudou"
  | "aceite_obrigatorio"
  | "ja_assinado"
  | "vencida"
  | "indisponivel"
  | "invalido";
const ERROS_ASSINATURA: readonly ErroAssinatura[] = [
  "codigo_errado",
  "limite",
  "codigo_vencido",
  "sem_codigo",
  "versao_mudou",
  "aceite_obrigatorio",
  "ja_assinado",
  "vencida",
  "indisponivel",
  "invalido",
];

export function lerResultadoAssinatura(raw: unknown): ResultadoAssinatura {
  const r = obj(raw);
  if (r.ok === true && r.resultado === "assinado") {
    const s = r.situacao as string;
    return {
      ok: true,
      situacao: (SITUACOES as readonly string[]).includes(s)
        ? (s as Situacao)
        : "aguardando_assinaturas",
      faltam: Math.max(0, num(r.faltam) ?? 0),
    };
  }
  const erro = ERROS_ASSINATURA.includes(r.erro as ErroAssinatura)
    ? (r.erro as ErroAssinatura)
    : "indisponivel";
  const restantes = num(r.restantes);
  return erro === "codigo_errado" && restantes !== null
    ? { ok: false, erro, restantes: Math.max(0, Math.min(LIMITE_TENTATIVAS, restantes)) }
    : { ok: false, erro };
}

export const MENSAGEM_ERRO_ASSINATURA: Record<ErroAssinatura, string> = {
  codigo_errado: "Código incorreto. Confira a mensagem no WhatsApp.",
  limite: "Muitas tentativas. Peça ao seu corretor um código novo.",
  codigo_vencido: "Este código venceu. Peça ao seu corretor um código novo.",
  sem_codigo: "Não há código ativo para você. Peça ao seu corretor um código novo.",
  versao_mudou: "A proposta foi alterada. Recarregue a página e leia de novo antes de assinar.",
  aceite_obrigatorio: 'Marque "Li e concordo" para assinar.',
  ja_assinado: "Você já assinou esta proposta.",
  vencida: "Esta proposta venceu. Fale com o seu corretor.",
  indisponivel: "Esta proposta não está mais disponível. Fale com o seu corretor.",
  invalido: "Não foi possível confirmar. Tente de novo.",
};

export function textoErroAssinatura(r: Extract<ResultadoAssinatura, { ok: false }>): string {
  if (r.erro === "codigo_errado" && r.restantes !== undefined)
    return `Código incorreto. Você tem mais ${r.restantes} tentativa(s).`;
  return MENSAGEM_ERRO_ASSINATURA[r.erro];
}
