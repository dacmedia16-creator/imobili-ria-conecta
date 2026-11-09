// Proposta de compra 2/3 (t_da0dac53): leitura do detalhe/lista que vem do banco e regras puras das telas.
// O banco (migration 20261109120000) decide permissão, situação, pendências e aceite; aqui só se lê em lista
// fechada e se monta o que a tela mostra e o que vai para proposta_salvar.
import {
  ESTADOS_CIVIS,
  FORMAS_PAGAMENTO,
  PAPEIS,
  PAPEL_LABEL,
  SITUACOES,
  TERMOS_NUMERO,
  TERMOS_TEXTO,
  VALIDADE_PADRAO_DIAS,
  diasParaVencer,
  lerCadastro,
  lerSinalTipo,
  lerTermos,
  precisaConjuge,
  type Cadastro,
  type EstadoCivil,
  type FormaPagamento,
  type Papel,
  type PropostaPublica,
  type SinalTipo,
  type Situacao,
  type TermoNumero,
  type TermoTexto,
  type Termos,
} from "@/lib/proposta-compra";
import type { TextoInput } from "@/lib/proposta-compra-texto";

export const ESTADO_CIVIL_LABEL: Record<EstadoCivil, string> = {
  solteiro: "Solteiro(a)",
  casado: "Casado(a)",
  uniao_estavel: "União estável",
  divorciado: "Divorciado(a)",
  viuvo: "Viúvo(a)",
  separado: "Separado(a)",
};

/** Texto oficial: "proteção do comprador/certidões" marcada (padrão) ou não. */
export const CERTIDOES_LABEL = {
  vendedor_apresenta: "Proteger o comprador pelas certidões (recomendado)",
  dispensadas: "Sem a cláusula de proteção pelas certidões",
} as const;
export type Certidoes = keyof typeof CERTIDOES_LABEL;

export const TOM_SITUACAO: Record<
  Situacao,
  "slate" | "blue" | "green" | "red" | "violet" | "amber"
> = {
  rascunho: "slate",
  aguardando_assinaturas: "blue",
  aceita: "green",
  recusada: "red",
  contraproposta: "violet",
  vencida: "amber",
};

export type CodigoInfo = {
  criadoEm: string | null;
  enviadoEm: string | null;
  expiraEm: string | null;
  tentativas: number;
  envioErro: string | null;
  ativo: boolean;
};

export type ParteDetalhe = {
  id: string;
  papel: Papel;
  ordem: number;
  tipoPessoa: "fisica" | "juridica";
  nome: string | null;
  cpfCnpj: string | null;
  estadoCivil: EstadoCivil | null;
  telefone: string | null;
  email: string | null;
  origem: string;
  assinadoEm: string | null;
  codigo: CodigoInfo | null;
};

export type EventoProposta = {
  tipo: string;
  versao: number | null;
  detalhe: string | null;
  criadoEm: string;
  autor: string | null;
};

export type Imovel = Partial<
  Record<
    | "tipo"
    | "endereco"
    | "complemento"
    | "bairro"
    | "cidade"
    | "uf"
    | "matricula"
    | "cartorio"
    | "iptu"
    | "codigo"
    | "valor_anunciado",
    string
  >
>;

export type PropostaDetalhe = {
  id: string;
  documento: string;
  captureId: string;
  leadId: string | null;
  origemId: string | null;
  versao: number;
  situacao: Situacao;
  imovel: Imovel;
  valorOferta: number | null;
  formaPagamento: FormaPagamento | null;
  sinalValor: number | null;
  sinalPrazoDias: number | null;
  sinalTipo: SinalTipo;
  financiamentoBanco: string | null;
  financiamentoValor: number | null;
  validadeDias: number;
  validadeAte: string | null;
  prazoContratoDias: number | null;
  certidoes: Certidoes | null;
  observacoes: string | null;
  termos: Termos;
  /** Data do documento e cadastro fixados com o PDF (o que vale no texto assinado). */
  documentoData: string | null;
  cadastro: Cadastro | null;
  /** Cadastro de agora (aviso de dado faltando antes de gerar o PDF). */
  cadastroAtual: Cadastro;
  pdfHash: string | null;
  conteudoHash: string | null;
  enviadaEm: string | null;
  aceitaEm: string | null;
  recusadaEm: string | null;
  recusaMotivo: string | null;
  vendaId: string | null;
  criadoEm: string;
  corretorId: string | null;
  corretorNome: string | null;
  podeOperar: boolean;
  pendenciasEnvio: string[];
  partes: ParteDetalhe[];
  eventos: EventoProposta[];
};

export type PropostaResumo = {
  id: string;
  documento: string;
  criadoEm: string;
  versao: number;
  comprador: string | null;
  valorOferta: number | null;
  corretor: string | null;
  situacao: Situacao;
  validadeAte: string | null;
  origemId: string | null;
  vendaId: string | null;
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const umDe = <T extends string>(lista: readonly T[], v: unknown): T | null =>
  (lista as readonly string[]).includes(v as string) ? (v as T) : null;
const situacao = (v: unknown): Situacao => umDe(SITUACOES, v) ?? "rascunho";

export function lerResumo(raw: unknown): PropostaResumo | null {
  const r = obj(raw);
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    documento: str(r.documento) ?? "",
    criadoEm: str(r.criado_em) ?? "",
    versao: num(r.versao) ?? 1,
    comprador: str(r.comprador),
    valorOferta: num(r.valor_oferta),
    corretor: str(r.corretor),
    situacao: situacao(r.situacao),
    validadeAte: str(r.validade_ate),
    origemId: str(r.origem_id),
    vendaId: str(r.venda_id),
  };
}

export const lerLista = (raw: unknown): PropostaResumo[] =>
  (Array.isArray(raw) ? raw : []).map(lerResumo).filter((x): x is PropostaResumo => x !== null);

function lerParte(raw: unknown): ParteDetalhe | null {
  const x = obj(raw);
  const id = str(x.id);
  const papel = umDe(PAPEIS, x.papel);
  if (!id || !papel) return null;
  const c = x.codigo && typeof x.codigo === "object" ? obj(x.codigo) : null;
  return {
    id,
    papel,
    ordem: num(x.ordem) ?? 1,
    tipoPessoa: x.tipo_pessoa === "juridica" ? "juridica" : "fisica",
    nome: str(x.nome),
    cpfCnpj: str(x.cpf_cnpj),
    estadoCivil: umDe(ESTADOS_CIVIS, x.estado_civil),
    telefone: str(x.telefone),
    email: str(x.email),
    origem: str(x.origem) ?? "manual",
    assinadoEm: str(x.assinado_em),
    codigo: c
      ? {
          criadoEm: str(c.criado_em),
          enviadoEm: str(c.enviado_em),
          expiraEm: str(c.expira_em),
          tentativas: num(c.tentativas) ?? 0,
          envioErro: str(c.envio_erro),
          ativo: c.ativo === true,
        }
      : null,
  };
}

export function lerDetalhe(raw: unknown): PropostaDetalhe {
  const r = obj(raw);
  const id = str(r.id);
  if (!id) throw new Error("Proposta não encontrada.");
  const im = obj(r.imovel);
  const imovel: Imovel = {};
  for (const k of [
    "tipo",
    "endereco",
    "complemento",
    "bairro",
    "cidade",
    "uf",
    "matricula",
    "cartorio",
    "iptu",
    "codigo",
    "valor_anunciado",
  ] as const) {
    const v = str(im[k]);
    if (v) imovel[k] = v;
  }
  const docData = str(r.documento_data);
  return {
    id,
    documento: str(r.documento) ?? "",
    captureId: str(r.capture_id) ?? "",
    leadId: str(r.lead_id),
    origemId: str(r.origem_id),
    versao: num(r.versao) ?? 1,
    situacao: situacao(r.situacao),
    imovel,
    valorOferta: num(r.valor_oferta),
    formaPagamento: umDe(FORMAS_PAGAMENTO, r.forma_pagamento),
    sinalValor: num(r.sinal_valor),
    sinalPrazoDias: num(r.sinal_prazo_dias),
    sinalTipo: lerSinalTipo(r.sinal_tipo),
    financiamentoBanco: str(r.financiamento_banco),
    financiamentoValor: num(r.financiamento_valor),
    validadeDias: num(r.validade_dias) ?? VALIDADE_PADRAO_DIAS,
    validadeAte: str(r.validade_ate),
    prazoContratoDias: num(r.prazo_contrato_dias),
    certidoes:
      r.certidoes === "vendedor_apresenta" || r.certidoes === "dispensadas" ? r.certidoes : null,
    observacoes: str(r.observacoes),
    termos: lerTermos(r.termos),
    documentoData: docData && /^\d{4}-\d{2}-\d{2}$/.test(docData) ? docData : null,
    cadastro: r.cadastro && typeof r.cadastro === "object" ? lerCadastro(r.cadastro) : null,
    cadastroAtual: lerCadastro(r.cadastro_atual),
    pdfHash: str(r.pdf_hash),
    conteudoHash: str(r.conteudo_hash),
    enviadaEm: str(r.enviada_em),
    aceitaEm: str(r.aceita_em),
    recusadaEm: str(r.recusada_em),
    recusaMotivo: str(r.recusa_motivo),
    vendaId: str(r.venda_id),
    criadoEm: str(r.criado_em) ?? "",
    corretorId: str(r.corretor_id),
    corretorNome: str(r.corretor_nome),
    podeOperar: r.pode_operar === true,
    pendenciasEnvio: (Array.isArray(r.pendencias_envio) ? r.pendencias_envio : []).filter(
      (x): x is string => typeof x === "string",
    ),
    partes: (Array.isArray(r.partes) ? r.partes : [])
      .map(lerParte)
      .filter((x): x is ParteDetalhe => x !== null),
    eventos: (Array.isArray(r.eventos) ? r.eventos : []).map((e) => {
      const x = obj(e);
      return {
        tipo: str(x.tipo) ?? "",
        versao: num(x.versao),
        detalhe: str(x.detalhe),
        criadoEm: str(x.criado_em) ?? "",
        autor: str(x.autor),
      };
    }),
  };
}

// --- Formulário ("Nova proposta") ---------------------------------------------------------------------------

export type ParteForm = {
  papel: Exclude<Papel, "corretor">;
  ordem: number;
  tipoPessoa: "fisica" | "juridica";
  nome: string;
  cpfCnpj: string;
  estadoCivil: EstadoCivil | "";
  telefone: string;
  email: string;
  /** Veio da captação ou do lead (a tela mostra o selo "preenchido"). */
  origem: string;
};

export type PropostaForm = {
  valorOferta: string;
  formaPagamento: FormaPagamento | "";
  sinalValor: string;
  sinalPrazoDias: string;
  /** D7 revista: confirmatórias (padrão) ou penitenciais. */
  sinalTipo: SinalTipo;
  financiamentoBanco: string;
  financiamentoValor: string;
  validadeDias: string;
  prazoContratoDias: string;
  certidoes: Certidoes | "";
  observacoes: string;
  /** Campos do texto oficial (textos livres e valores digitados). */
  termos: Partial<Record<TermoTexto | TermoNumero, string>>;
  partes: ParteForm[];
};

/** "R$ 485.000,00", "485000", "485.000" → 485000 (null se vazio/ilegível). */
export function lerValor(raw: string): number | null {
  const s = (raw ?? "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  const n = s.includes(",")
    ? Number(s.replace(/\./g, "").replace(",", "."))
    : /^\d{1,3}(\.\d{3})+$/.test(s)
      ? Number(s.replace(/\./g, ""))
      : Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

const inteiro = (raw: string): number | null => {
  const t = (raw ?? "").trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  return Number(t);
};

const valorTexto = (n: number | null) =>
  n == null
    ? ""
    : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parteForm(p: ParteDetalhe): ParteForm | null {
  if (p.papel === "corretor") return null;
  return {
    papel: p.papel,
    ordem: p.ordem,
    tipoPessoa: p.tipoPessoa,
    nome: p.nome ?? "",
    cpfCnpj: p.cpfCnpj ?? "",
    estadoCivil: p.estadoCivil ?? "",
    telefone: p.telefone ?? "",
    email: p.email ?? "",
    origem: p.origem,
  };
}

/** Formulário a partir do rascunho criado pelo banco (já vem com captação + lead preenchidos). */
export function formDoDetalhe(d: PropostaDetalhe): PropostaForm {
  return {
    valorOferta: valorTexto(d.valorOferta),
    formaPagamento: d.formaPagamento ?? "",
    sinalValor: valorTexto(d.sinalValor),
    sinalPrazoDias: d.sinalPrazoDias == null ? "" : String(d.sinalPrazoDias),
    sinalTipo: d.sinalTipo,
    financiamentoBanco: d.financiamentoBanco ?? "",
    financiamentoValor: valorTexto(d.financiamentoValor),
    validadeDias: String(d.validadeDias || VALIDADE_PADRAO_DIAS),
    prazoContratoDias: d.prazoContratoDias == null ? "" : String(d.prazoContratoDias),
    certidoes: d.certidoes ?? "",
    observacoes: d.observacoes ?? "",
    termos: termosForm(d.termos),
    partes: d.partes.map(parteForm).filter((x): x is ParteForm => x !== null),
  };
}

const TERMOS_VALOR: readonly TermoNumero[] = ["proprios_valor", "fgts_valor", "permuta_valor"];
function termosForm(t: Termos): PropostaForm["termos"] {
  const out: PropostaForm["termos"] = {};
  for (const k of TERMOS_TEXTO) if (t[k]) out[k] = String(t[k]);
  for (const k of TERMOS_NUMERO) {
    const v = t[k];
    if (v != null) out[k] = TERMOS_VALOR.includes(k) ? valorTexto(v) : String(v);
  }
  return out;
}

/** Termos para proposta_salvar: textos aparados, valores em número (o banco limpa e valida de novo). */
export function termosParaSalvar(f: PropostaForm): Record<string, string | number | null> {
  const t = f.termos;
  const out: Record<string, string | number | null> = {};
  const pj = f.partes.find((p) => p.papel === "comprador")?.tipoPessoa === "juridica";
  for (const k of TERMOS_TEXTO) {
    const v = (t[k] ?? "").trim();
    out[k] = v || null;
  }
  // Campos que não valem para o tipo de comprador saem (PF não tem representante; PJ não tem RG/regime).
  const fora: TermoTexto[] = pj
    ? ["comprador_rg", "comprador_nacionalidade", "comprador_profissao", "comprador_regime"]
    : ["comprador_representante", "comprador_representante_cpf", "comprador_cargo"];
  for (const k of fora) out[k] = null;
  const compr = f.partes.find((p) => p.papel === "comprador");
  if (!pj && !precisaConjuge(compr?.estadoCivil)) out.comprador_regime = null;
  if (out.comprador_representante_cpf)
    out.comprador_representante_cpf = String(out.comprador_representante_cpf).replace(/\D/g, "");
  for (const k of TERMOS_VALOR) out[k] = lerValor(t[k] ?? "") || null;
  const fp = inteiro(t.fin_prazo_dias ?? "");
  out.fin_prazo_dias = fp && fp >= 1 && fp <= 365 ? fp : null;
  return out;
}

/**
 * Entrada do texto oficial para o link público (t_b4e7c368): a parte lê a proposta INTEIRA antes do
 * "Li e concordo". O link não recebe CPF/CNPJ, celular, e-mail, RG, endereço do comprador nem conta do
 * vendedor (lista fechada do banco); nesses campos o texto sai em branco ou "—".
 */
export function textoDaPublica(d: PropostaPublica): TextoInput {
  return {
    documento: d.documento,
    versao: d.versao,
    imovel: d.imovel,
    valorOferta: d.valores.oferta,
    formaPagamento: d.valores.formaPagamento,
    sinalValor: d.valores.sinal,
    sinalPrazoDias: d.valores.sinalPrazoDias,
    sinalTipo: d.valores.sinalTipo,
    financiamentoBanco: d.valores.financiamentoBanco,
    financiamentoValor: d.valores.financiamentoValor,
    validadeDias: d.condicoes.validadeDias,
    prazoContratoDias: d.condicoes.prazoContratoDias,
    certidoes: d.condicoes.certidoes,
    observacoes: d.condicoes.observacoes,
    termos: d.termos as Termos,
    cadastro: d.cadastro.nome ? d.cadastro : { ...d.cadastro, nome: d.imobiliaria || undefined },
    documentoData: d.documentoData,
    corretorNome: d.corretor.nome,
    partes: d.partes.map((x) => ({
      papel: x.papel,
      ordem: x.ordem,
      tipoPessoa: x.tipoPessoa,
      nome: x.nome,
      cpfCnpj: null,
      estadoCivil: x.estadoCivil,
      telefone: null,
      email: null,
    })),
  };
}

/** Entrada do texto oficial a partir do detalhe (o que foi gravado; cadastro fixado ou o de agora na prévia). */
export function textoDoDetalhe(d: PropostaDetalhe): TextoInput {
  return {
    documento: d.documento,
    versao: d.versao,
    imovel: d.imovel,
    valorOferta: d.valorOferta,
    formaPagamento: d.formaPagamento,
    sinalValor: d.sinalValor,
    sinalPrazoDias: d.sinalPrazoDias,
    sinalTipo: d.sinalTipo,
    financiamentoBanco: d.financiamentoBanco,
    financiamentoValor: d.financiamentoValor,
    validadeDias: d.validadeDias,
    prazoContratoDias: d.prazoContratoDias,
    certidoes: d.certidoes,
    observacoes: d.observacoes,
    termos: d.termos,
    cadastro: d.cadastro ?? d.cadastroAtual,
    documentoData: d.documentoData,
    corretorNome: d.corretorNome,
    partes: d.partes.map((x) => ({
      papel: x.papel,
      ordem: x.ordem,
      tipoPessoa: x.tipoPessoa,
      nome: x.nome,
      cpfCnpj: x.cpfCnpj,
      estadoCivil: x.estadoCivil,
      telefone: x.telefone,
      email: x.email,
    })),
  };
}

const ORDEM_PAPEL: Record<Papel, number> = {
  comprador: 0,
  comprador_conjuge: 1,
  vendedor: 2,
  vendedor_conjuge: 3,
  corretor: 4,
};
export const ordenarPartes = <T extends { papel: Papel; ordem: number }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => ORDEM_PAPEL[a.papel] - ORDEM_PAPEL[b.papel] || a.ordem - b.ordem);

/**
 * Mantém o cônjuge coerente com o estado civil: casado/união estável (pessoa física) ganha o cônjuge em
 * branco; outro estado civil ou empresa perde o cônjuge. Não apaga o que já foi digitado no cônjuge que fica.
 */
export function ajustarConjuges(partes: readonly ParteForm[]): ParteForm[] {
  const principais = partes.filter((p) => p.papel === "comprador" || p.papel === "vendedor");
  const out: ParteForm[] = [...principais];
  for (const p of principais) {
    const papelC = p.papel === "comprador" ? "comprador_conjuge" : "vendedor_conjuge";
    if (p.tipoPessoa !== "fisica" || !precisaConjuge(p.estadoCivil)) continue;
    const atual = partes.find((x) => x.papel === papelC && x.ordem === p.ordem);
    out.push(
      atual ?? {
        papel: papelC,
        ordem: p.ordem,
        tipoPessoa: "fisica",
        nome: "",
        cpfCnpj: "",
        estadoCivil: p.estadoCivil,
        telefone: "",
        email: "",
        origem: "manual",
      },
    );
  }
  return ordenarPartes(out);
}

/** Corpo de proposta_salvar. Campos vazios vão como null (o banco aplica as regras e as CHECKs). */
export function dadosParaSalvar(f: PropostaForm): Record<string, unknown> {
  const forma = f.formaPagamento || null;
  const temSinal = forma === "sinal_financiamento" || forma === "sinal_parcelas";
  const fin = forma === "sinal_financiamento";
  const validade = inteiro(f.validadeDias);
  return {
    valor_oferta: lerValor(f.valorOferta) || null,
    forma_pagamento: forma,
    sinal_valor: temSinal ? lerValor(f.sinalValor) : null,
    sinal_prazo_dias: temSinal ? inteiro(f.sinalPrazoDias) : null,
    sinal_tipo: f.sinalTipo,
    financiamento_banco: fin ? f.financiamentoBanco.trim() || null : null,
    financiamento_valor: fin ? lerValor(f.financiamentoValor) : null,
    validade_dias: validade && validade >= 1 && validade <= 30 ? validade : VALIDADE_PADRAO_DIAS,
    prazo_contrato_dias: inteiro(f.prazoContratoDias),
    certidoes: f.certidoes || null,
    observacoes: f.observacoes.trim() || null,
    termos: termosParaSalvar(f),
    partes: ajustarConjuges(f.partes).map((p) => ({
      papel: p.papel,
      ordem: p.ordem,
      tipo_pessoa: p.papel.endsWith("_conjuge") ? "fisica" : p.tipoPessoa,
      nome: p.nome.trim() || null,
      cpf_cnpj: p.cpfCnpj.replace(/\D/g, "") || null,
      estado_civil: p.tipoPessoa === "fisica" ? p.estadoCivil || null : null,
      telefone: p.telefone.replace(/\D/g, "") || null,
      email: p.email.trim() || null,
    })),
  };
}

/** Erros que a tela mostra antes de salvar (o banco confere de novo). */
export function errosDoForm(f: PropostaForm): string[] {
  const e: string[] = [];
  const oferta = lerValor(f.valorOferta);
  if (f.valorOferta.trim() && !oferta) e.push("Valor da oferta inválido.");
  const sinal = lerValor(f.sinalValor);
  if (oferta && sinal && sinal > oferta) e.push("O sinal não pode ser maior que a oferta.");
  const fin = lerValor(f.financiamentoValor);
  if (f.formaPagamento === "sinal_financiamento" && oferta && fin && fin > oferta)
    e.push("O valor financiado não pode ser maior que a oferta.");
  const v = inteiro(f.validadeDias);
  if (!v || v < 1 || v > 30) e.push("Validade entre 1 e 30 dias.");
  if (f.prazoContratoDias.trim() && !inteiro(f.prazoContratoDias))
    e.push("Prazo do contrato inválido.");
  for (const p of f.partes) {
    const doc = p.cpfCnpj.replace(/\D/g, "");
    if (doc && doc.length !== 11 && doc.length !== 14)
      e.push(`CPF/CNPJ de ${rotuloParte(p.papel, p.ordem)} deve ter 11 ou 14 dígitos.`);
    const tel = p.telefone.replace(/\D/g, "");
    if (tel && (tel.length < 10 || tel.length > 13))
      e.push(`Celular de ${rotuloParte(p.papel, p.ordem)} inválido.`);
  }
  return e;
}

export function rotuloParte(papel: Papel, ordem: number, total = 2): string {
  const base = PAPEL_LABEL[papel];
  return (papel === "vendedor" || papel === "vendedor_conjuge") && total > 1
    ? `${base} ${ordem}`
    : base;
}

// --- Assinaturas ----------------------------------------------------------------------------------------------

export type SituacaoParte =
  "assinou" | "aguardando" | "codigo_vencido" | "falha_envio" | "nao_enviado" | "sem_celular";

export const SITUACAO_PARTE_LABEL: Record<SituacaoParte, string> = {
  assinou: "Assinou",
  aguardando: "Aguardando assinatura",
  codigo_vencido: "Código vencido — reenviar",
  falha_envio: "Falha no envio — reenviar",
  nao_enviado: "Ainda não enviado",
  sem_celular: "Sem celular",
};

export function situacaoParte(p: ParteDetalhe): SituacaoParte {
  if (p.assinadoEm) return "assinou";
  if (!p.telefone) return "sem_celular";
  if (!p.codigo) return "nao_enviado";
  if (p.codigo.envioErro) return "falha_envio";
  return p.codigo.ativo ? "aguardando" : "codigo_vencido";
}

/** Partes que ainda podem receber código (não assinaram e têm celular). */
export const faltamAssinar = (d: PropostaDetalhe) => d.partes.filter((p) => !p.assinadoEm);

/** O que a tela pode fazer em cada situação (o banco confere de novo). */
export function acoes(d: PropostaDetalhe) {
  const op = d.podeOperar;
  return {
    editar: op && (d.situacao === "rascunho" || d.situacao === "aguardando_assinaturas"),
    gerarPdf: op && d.situacao === "rascunho",
    enviar: op && d.situacao === "rascunho" && d.pendenciasEnvio.length === 0,
    reenviar: op && d.situacao === "aguardando_assinaturas" && faltamAssinar(d).length > 0,
    recusar: op && d.situacao === "aguardando_assinaturas",
    contraproposta:
      op &&
      (d.situacao === "aguardando_assinaturas" ||
        d.situacao === "recusada" ||
        d.situacao === "vencida"),
    criarVenda: op && d.situacao === "aceita" && !d.vendaId,
  };
}

/** "Vence hoje", "Vence em 2 dias", "Venceu em 13/11". */
export function textoValidade(validadeAte: string | null, hoje: string): string | null {
  if (!validadeAte) return null;
  const d = diasParaVencer(validadeAte, hoje);
  const br = `${validadeAte.slice(8, 10)}/${validadeAte.slice(5, 7)}`;
  if (d < 0) return `Venceu em ${br}`;
  if (d === 0) return "Vence hoje";
  return `Vence em ${br} (${d} dia${d > 1 ? "s" : ""})`;
}

export const EVENTO_LABEL: Record<string, string> = {
  criada: "Proposta criada",
  editada: "Rascunho alterado",
  pdf: "PDF gerado",
  enviada: "Enviada para assinatura",
  codigo_gerado: "Código gerado",
  codigo_enviado: "Código enviado",
  codigo_falhou: "Falha no envio do código",
  codigo_errado: "Código digitado errado",
  assinada: "Parte assinou",
  aceita: "Aceita (todas as partes assinaram)",
  nova_versao: "Nova versão (assinaturas anteriores invalidadas)",
  recusada: "Recusada",
  contraproposta: "Virou contraproposta",
  venda_criada: "Venda criada em rascunho",
  lead_proposta: "Lead movido para a etapa Proposta",
  lead_nao_movido: "Lead não foi movido",
};

// --- "O que fazer hoje" ---------------------------------------------------------------------------------------

export type PendenciaProposta = {
  kind: "proposta_vencendo" | "proposta_falta_assinar";
  propostaId: string;
  captureId: string;
  imovel: string | null;
  detalhe: string;
  prazo: string | null;
  dias: number | null;
};

export const ROTULO_PENDENCIA_PROPOSTA: Record<PendenciaProposta["kind"], string> = {
  proposta_vencendo: "Proposta vencendo",
  proposta_falta_assinar: "Falta assinar",
};

export function lerPendencias(raw: unknown): PendenciaProposta[] {
  return (Array.isArray(raw) ? raw : [])
    .map((r) => {
      const x = obj(r);
      const kind =
        x.kind === "proposta_vencendo" || x.kind === "proposta_falta_assinar" ? x.kind : null;
      const propostaId = str(x.proposta_id);
      const captureId = str(x.capture_id);
      if (!kind || !propostaId || !captureId) return null;
      return {
        kind,
        propostaId,
        captureId,
        imovel: str(x.imovel),
        detalhe: str(x.detalhe) ?? "",
        prazo: str(x.prazo),
        dias: num(x.dias),
      };
    })
    .filter((x): x is PendenciaProposta => x !== null)
    .sort((a, b) => (a.dias ?? 99) - (b.dias ?? 99) || (a.kind === "proposta_vencendo" ? -1 : 1));
}

// --- Comprovação das assinaturas (página final do PDF) ----------------------------------------------------------

export type AssinaturaComprovada = {
  papel: Papel;
  ordem: number;
  nome: string | null;
  telefone: string | null;
  assinadoEm: string;
  ip: string | null;
  userAgent: string | null;
  conteudoHash: string;
  pdfHash: string;
};
export type Comprovacao = {
  documento: string;
  versao: number;
  pdfHash: string | null;
  conteudoHash: string | null;
  aceitaEm: string | null;
  assinaturas: AssinaturaComprovada[];
};

export function lerComprovacao(raw: unknown): Comprovacao {
  const r = obj(raw);
  return {
    documento: str(r.documento) ?? "",
    versao: num(r.versao) ?? 1,
    pdfHash: str(r.pdf_hash),
    conteudoHash: str(r.conteudo_hash),
    aceitaEm: str(r.aceita_em),
    assinaturas: (Array.isArray(r.assinaturas) ? r.assinaturas : [])
      .map((a) => {
        const x = obj(a);
        const papel = umDe(PAPEIS, x.papel);
        const em = str(x.assinado_em);
        if (!papel || !em) return null;
        return {
          papel,
          ordem: num(x.ordem) ?? 1,
          nome: str(x.nome),
          telefone: str(x.telefone),
          assinadoEm: em,
          ip: str(x.ip),
          userAgent: str(x.user_agent),
          conteudoHash: str(x.conteudo_hash) ?? "",
          pdfHash: str(x.pdf_hash) ?? "",
        };
      })
      .filter((x): x is AssinaturaComprovada => x !== null),
  };
}

/** (15) 9****-0000: só DDD e os 4 finais. */
export function mascararTelefone(t: string | null): string {
  const d = (t ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length < 10) return "-";
  return `(${d.slice(0, 2)}) ${d.length === 11 ? "9****" : "****"}-${d.slice(-4)}`;
}

/** 189.xx.xx.12 (IPv4) ou os 2 primeiros blocos (IPv6). */
export function mascararIp(ip: string | null): string {
  if (!ip) return "-";
  const v4 = ip.match(/^(\d{1,3})\.\d{1,3}\.\d{1,3}\.(\d{1,3})$/);
  if (v4) return `${v4[1]}.xx.xx.${v4[2]}`;
  const p = ip.split(":").filter(Boolean);
  return p.length >= 2 ? `${p[0]}:${p[1]}:…` : "-";
}

/** "iPhone/Safari", "Android/Chrome", "Windows/Edge"… (só para leitura humana; o texto inteiro fica no banco). */
export function aparelho(ua: string | null): string {
  if (!ua) return "-";
  const so = /iPhone|iPad/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "Outro";
  const nav = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung"
      : /CriOS|Chrome\//.test(ua)
        ? "Chrome"
        : /FxiOS|Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navegador";
  return `${so}/${nav}`;
}

/** Data e hora em São Paulo: "08/11/2026 14:20". */
export function dataHoraSp(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(", ", " ");
}

export const dataBr = (iso: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    : "-";
