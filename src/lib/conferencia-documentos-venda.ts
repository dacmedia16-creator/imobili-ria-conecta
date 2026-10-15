/**
 * Conferência da venda contra o que a IA leu dos documentos (t_ca148813, etapa 2).
 *
 * Tudo aqui é AVISO (amarelo): nada trava o envio e nada sobrescreve o que o corretor digitou.
 * Funções puras para poderem ser testadas e simuladas com as leituras reais.
 */
import { areaM2DoTexto } from "./ficha-imovel";

/** Leitura gravada (document_extractions) com o documento de origem. */
export type ExtracaoDocumento = {
  tipo: string;
  parte: string;
  deleted_at?: string | null;
  raw: Record<string, unknown> | null | undefined;
};

/** Documento excluído (arquivado) não vale mais: o corretor trocou justamente porque estava errado. */
export function extracoesAtivas<T extends { deleted_at?: string | null }>(lista: T[]): T[] {
  return lista.filter((e) => !e.deleted_at);
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
export const somenteDigitos = (v: unknown): string => texto(v).replace(/\D/g, "");

// ---------------------------------------------------------------- matrícula

export type AvisoMatricula = { venda: string; documento: string };

/** Nº da matrícula da venda diferente do nº lido da matrícula (compara só os dígitos). */
export function avisoMatriculaDivergente(
  matriculaVenda: string | null | undefined,
  extracoes: ExtracaoDocumento[],
): AvisoMatricula | null {
  const venda = somenteDigitos(matriculaVenda);
  if (!venda) return null;
  const lidas = extracoesAtivas(extracoes)
    .filter((e) => e.tipo === "matricula" && e.raw)
    .map((e) => texto(e.raw?.matricula ?? e.raw?.numero_matricula))
    .filter((m) => somenteDigitos(m));
  if (!lidas.length) return null;
  // Basta uma matrícula enviada bater (ex.: apartamento + garagem em documentos separados).
  if (lidas.some((m) => somenteDigitos(m) === venda)) return null;
  return { venda: texto(matriculaVenda), documento: lidas[0] };
}

// ---------------------------------------------------------------- descrição

/** Descrição da matrícula a partir deste tamanho é considerada "completa" para comparar. */
export const DESCRICAO_MIN_MATRICULA = 200;
/** A descrição da venda é "bem menor" quando tem menos que esta fração da lida da matrícula. */
export const DESCRICAO_FRACAO_MIN = 0.5;

export type AvisoDescricao = { venda: number; matricula: number };

export function avisoDescricaoCurta(
  descricaoVenda: string | null | undefined,
  extracoes: ExtracaoDocumento[],
): AvisoDescricao | null {
  const lida = Math.max(
    0,
    ...extracoesAtivas(extracoes)
      .filter((e) => e.tipo === "matricula" && e.raw)
      .map((e) => texto(e.raw?.observacoes_imovel).length),
  );
  if (lida < DESCRICAO_MIN_MATRICULA) return null;
  const venda = texto(descricaoVenda).length;
  if (venda >= lida * DESCRICAO_FRACAO_MIN) return null;
  return { venda, matricula: lida };
}

// ---------------------------------------------------------------- área

/** Diferença tolerada entre a área digitada e a da matrícula (arredondamento do corretor). */
export const AREA_TOLERANCIA = 0.02;

/** Área digitada diverge da sugestão vinda dos documentos (> 2% e > 1 m²). */
export function areaDivergente(
  digitada: number | string | null | undefined,
  sugestao: number | null | undefined,
): boolean {
  const a = areaM2DoTexto(digitada);
  if (a == null || sugestao == null || sugestao <= 0) return false;
  const dif = Math.abs(a - sugestao);
  return dif > 1 && dif / Math.max(a, sugestao) > AREA_TOLERANCIA;
}

// ---------------------------------------------------------------- partes

export type ParteFicha = {
  nome?: string | null;
  cpf_cnpj?: string | null;
  conjuge_nome?: string | null;
  conjuge_cpf?: string | null;
};

export type AvisoParte = {
  /** Parte em que o documento foi enviado (comprador_2...). */
  parte: string;
  nomeDocumento: string;
  /** Mensagem pronta para o corretor. */
  mensagem: string;
};

const IDENTIDADE = new Set(["rg", "cpf", "cnh"]);

export function rotuloPapel(papel: string): string {
  const m = papel.match(/^(comprador|vendedor)_(\d+)$/);
  return m ? `${m[1]} ${m[2]}` : papel;
}

export function normalizarNome(v: unknown): string {
  return texto(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PARTICULAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);
/** Mesmo nome: primeiro e último nome iguais (tolera nome do meio abreviado ou omitido). */
export function mesmoNome(a: unknown, b: unknown): boolean {
  const pa = normalizarNome(a)
    .split(" ")
    .filter((p) => p && !PARTICULAS.has(p));
  const pb = normalizarNome(b)
    .split(" ")
    .filter((p) => p && !PARTICULAS.has(p));
  if (!pa.length || !pb.length) return false;
  return pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1];
}

/** CPF com 11 dígitos (documento de pessoa física); CNPJ é tratado à parte. */
const cpfValido = (v: unknown) => {
  const d = somenteDigitos(v);
  return d.length === 11 ? d : "";
};

type Pessoa = { nome: string; cpf: string };
function pessoaDoDocumento(raw: Record<string, unknown>): Pessoa {
  return {
    nome: texto(raw.nome ?? raw.nome_completo),
    cpf: cpfValido(raw.cpf ?? raw.cpf_cnpj),
  };
}

function bate(p: Pessoa, nome: unknown, cpf: unknown): boolean {
  const c = cpfValido(cpf);
  // CPF lido pela IA às vezes vem com 1-2 dígitos trocados (simulação de 30 dias: 7 de 12 vendas
  // avisadas eram a mesma pessoa). Nome completo idêntico = mesma pessoa, mesmo com CPF diferente.
  if (p.cpf && c)
    return p.cpf === c || (!!p.nome && normalizarNome(p.nome) === normalizarNome(nome));
  return !!p.nome && mesmoNome(p.nome, nome);
}

export type DadosCertidao = { profissao: string | null; nacionalidade: string | null };

/**
 * Profissão/nacionalidade de uma certidão (casamento traz as duas pessoas) para a parte certa:
 * só devolve dados da pessoa cujo CPF (ou primeiro + último nome) bate com a parte. Se nenhuma ou
 * mais de uma pessoa bater, não devolve nada — nunca atribui dado de uma pessoa à outra.
 */
export function dadosDaCertidaoParaParte(
  pessoasCertidao: unknown,
  parte: { nome?: unknown; cpf_cnpj?: unknown },
): DadosCertidao | null {
  if (!Array.isArray(pessoasCertidao)) return null;
  const temParte = cpfValido(parte.cpf_cnpj) || normalizarNome(parte.nome);
  if (!temParte) return null;
  const achadas = pessoasCertidao.filter((p): p is Record<string, unknown> => {
    if (!p || typeof p !== "object") return false;
    const r = p as Record<string, unknown>;
    return bate(pessoaDoDocumento(r), parte.nome, parte.cpf_cnpj);
  });
  if (achadas.length !== 1) return null;
  const profissao = texto(achadas[0].profissao) || null;
  const nacionalidade = texto(achadas[0].nacionalidade) || null;
  return profissao || nacionalidade ? { profissao, nacionalidade } : null;
}

/**
 * Documento de identidade (RG/CPF/CNH) cujo nome/CPF não bate com a parte em que foi enviado,
 * e o mesmo CPF em duas partes. Sugere onde a pessoa está (outra parte ou cônjuge de alguém).
 */
export function avisosPartes(
  extracoes: ExtracaoDocumento[],
  partes: Record<string, ParteFicha | null | undefined>,
): AvisoParte[] {
  const avisos: AvisoParte[] = [];
  const vistos = new Set<string>();
  for (const e of extracoesAtivas(extracoes)) {
    if (!IDENTIDADE.has(e.tipo) || !e.raw || !/^(comprador|vendedor)_\d+$/.test(e.parte)) continue;
    const pessoa = pessoaDoDocumento(e.raw);
    if (!pessoa.nome && !pessoa.cpf) continue;
    const chave = `${e.parte}|${pessoa.cpf || normalizarNome(pessoa.nome)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const atual = partes[e.parte];
    const temDados = !!(atual && (cpfValido(atual.cpf_cnpj) || normalizarNome(atual.nome)));
    // Parte vazia: o documento ainda vai preencher, não há o que comparar.
    if (!temDados || bate(pessoa, atual?.nome, atual?.cpf_cnpj)) continue;

    const nomeDoc = pessoa.nome || `CPF ${pessoa.cpf}`;
    let ondeEsta: string | null = null;
    for (const [papel, p] of Object.entries(partes)) {
      if (!p || papel === e.parte) continue;
      if (bate(pessoa, p.nome, p.cpf_cnpj)) {
        ondeEsta = `que está como ${rotuloPapel(papel)}`;
        break;
      }
      if (bate(pessoa, p.conjuge_nome, p.conjuge_cpf)) {
        ondeEsta = `que está como cônjuge do ${rotuloPapel(papel)}`;
        break;
      }
    }
    if (!ondeEsta && atual && bate(pessoa, atual.conjuge_nome, atual.conjuge_cpf))
      ondeEsta = `que está como cônjuge do ${rotuloPapel(e.parte)}`;
    avisos.push({
      parte: e.parte,
      nomeDocumento: nomeDoc,
      mensagem:
        `O documento enviado em ${rotuloPapel(e.parte)} parece ser de ${nomeDoc}` +
        (ondeEsta ? `, ${ondeEsta}` : "") +
        `, mas a parte está preenchida como ${texto(atual?.nome) || "outra pessoa"}. Confira.`,
    });
  }

  // Mesmo CPF em duas partes.
  const porCpf = new Map<string, string[]>();
  for (const [papel, p] of Object.entries(partes)) {
    const c = cpfValido(p?.cpf_cnpj);
    if (c) porCpf.set(c, [...(porCpf.get(c) ?? []), papel]);
  }
  for (const papeis of porCpf.values()) {
    if (papeis.length < 2) continue;
    const nomes = papeis.map(rotuloPapel).sort().join(" e ");
    avisos.push({
      parte: papeis.sort()[0],
      nomeDocumento: "",
      mensagem: `O mesmo CPF aparece em ${nomes}. Confira se a pessoa foi cadastrada duas vezes.`,
    });
  }
  return avisos;
}
