// Locação — modelos de contrato por garantia (t_d08cfeee, Pacote 4; textos-base enviados por Denis em 16/11).
// Regras puras (sem banco). O banco (migration 20261201120000) repete a lista de campos [ ], os blocos [[ ]], a
// validação do editor e qual modelo serve para qual garantia; os testes conferem que as listas são iguais.
//
// Um modelo é uma lista de parágrafos. Cada parágrafo pode ter:
//  * trava: texto exigido pela seguradora/Loft — entra palavra por palavra (sem troca de gênero nem renumeração);
//  * dest: só entra no contrato residencial ou só no comercial (troca do bloco de destinação);
//  * cond: só entra quando a montagem pede (hoje: isenção da multa após o 12º mês);
//  * adaptado: texto comercial derivado do residencial pelo sistema (conferir com o jurídico).
import padrao from "./locacao-modelos-padrao.json";

export type ParagrafoModelo = {
  id: string;
  t: string;
  trava?: boolean;
  dest?: "residencial" | "comercial";
  cond?: "isencao_multa";
  adaptado?: boolean;
};
export type ChaveModelo =
  | "fiador"
  | "caucao_dinheiro"
  | "caucao_imovel"
  | "seguro_porto"
  | "seguro_pottencial"
  | "seguro_tokio"
  | "seguro_almada"
  | "loft";
export type ModeloContrato = {
  chave: ChaveModelo;
  titulo: string;
  /** Tipo do contrato de onde veio o texto-base (o modelo serve aos dois: troca o bloco de destinação). */
  tipo: "residencial" | "comercial";
  garantia: string;
  seguradora?: string | null;
  subtitulo: string;
  paragrafos: ParagrafoModelo[];
  /** 0 = padrão do sistema; N = versão N da imobiliária. */
  versao: number;
  padrao?: boolean;
  nota?: string | null;
  criadoEm?: string | null;
  autor?: string | null;
};

export const CHAVES_MODELO: ChaveModelo[] = [
  "fiador",
  "caucao_dinheiro",
  "caucao_imovel",
  "seguro_porto",
  "seguro_pottencial",
  "seguro_tokio",
  "seguro_almada",
  "loft",
];

/** Qual modelo serve para qual garantia da locação. Espelho de public.locacao_modelo_garantia_ok. */
export const MODELOS_DA_GARANTIA: Record<string, ChaveModelo[]> = {
  fiador: ["fiador"],
  caucao: ["caucao_dinheiro", "caucao_imovel"],
  outras: ["caucao_imovel"],
  seguro_fianca: ["seguro_porto", "seguro_pottencial", "seguro_tokio", "seguro_almada"],
  loft: ["loft"],
};
export const modelosDaGarantia = (garantia: string): ChaveModelo[] =>
  MODELOS_DA_GARANTIA[garantia] ?? [];

export const SEGURADORAS: Record<string, string> = {
  porto: "Porto Seguro Cia. de Seguros Gerais",
  pottencial: "Pottencial Seguradora S.A.",
  tokio: "Tokio Marine Seguradora S.A.",
  almada: "Almada Garantias Contratuais",
};

/** Campos [ ] que o editor aceita. Espelho de public.locacao_modelo_campos (mesma ordem). */
export const CAMPOS_MODELO: { k: string; label: string }[] = [
  { k: "NUMERO_CONTRATO", label: "Número do contrato" },
  { k: "NOME_LOCADOR", label: "Nome do locador" },
  { k: "NOME_LOCATARIO", label: "Nome do locatário" },
  { k: "NOME_FIADOR", label: "Nome do fiador" },
  { k: "IMOVEL_ENDERECO", label: "Endereço do imóvel locado" },
  { k: "VALOR_ALUGUEL", label: "Aluguel (R$)" },
  { k: "VALOR_ALUGUEL_EXTENSO", label: "Aluguel por extenso" },
  { k: "DIA_VENCIMENTO", label: "Dia de vencimento" },
  { k: "PRAZO_MESES", label: "Prazo (meses)" },
  { k: "DATA_INICIO", label: "Data de início" },
  { k: "DATA_TERMINO", label: "Data de término" },
  { k: "CIDADE", label: "Cidade da imobiliária" },
  { k: "ADMINISTRADORA_QUALIFICACAO", label: "Imobiliária (nome, CNPJ e CRECI)" },
  { k: "FIADOR_IMOVEL_ENDERECO", label: "Endereço do imóvel do fiador" },
  { k: "FIADOR_MATRICULA", label: "Matrícula do imóvel do fiador" },
  { k: "FIADOR_CARTORIO", label: "Cartório do imóvel do fiador" },
  { k: "CAUCAO_VALOR", label: "Caução: valor (R$)" },
  { k: "CAUCAO_VALOR_EXTENSO", label: "Caução: valor por extenso" },
  { k: "CAUCAO_MESES", label: "Caução: nº de aluguéis" },
  { k: "CAUCAO_FORMA", label: "Caução: forma de depósito" },
  { k: "CAUCAO_FAVORECIDO", label: "Caução: quem guarda (favorecido)" },
  { k: "CAUCIONANTE_QUALIFICACAO", label: "Caucionante (qualificação completa)" },
  { k: "CAUCAO_IMOVEL_DESCRICAO", label: "Imóvel caucionado: descrição" },
  { k: "CAUCAO_IMOVEL_CARTORIO", label: "Imóvel caucionado: cartório" },
  { k: "CAUCAO_IMOVEL_MATRICULA", label: "Imóvel caucionado: matrícula" },
  { k: "SEGURADORA", label: "Seguradora" },
  { k: "APOLICE_NUMERO", label: "Nº da apólice" },
  {
    k: "APOLICE_REFERENCIA",
    label: 'Apólice ("nº X, conforme anexo" ou "a ser anexada")',
  },
  { k: "LOFT_REFERENCIA", label: "Loft: referência da garantia (anexo)" },
];
export const NOMES_CAMPOS_MODELO = CAMPOS_MODELO.map((c) => c.k);

/** Blocos [[ ]] que o sistema preenche (qualificação das partes, objeto, prazo, assinaturas). */
export const BLOCOS_MODELO: { k: string; label: string }[] = [
  { k: "LOCADOR", label: "Qualificação do(s) locador(es)" },
  { k: "LOCATARIO", label: "Qualificação do(s) locatário(s)" },
  { k: "FIADOR", label: "Qualificação do(s) fiador(es)" },
  { k: "OBJETO", label: "Objeto da locação (endereço, inscrição, energia, água, gás)" },
  { k: "PRAZO", label: "Prazo, início e término" },
  { k: "ADICIONAIS", label: "Moradores" },
  { k: "ASSINATURAS", label: "Local, data e assinaturas" },
];
export const NOMES_BLOCOS_MODELO = BLOCOS_MODELO.map((b) => b.k);

/** Blocos que precisam existir em todo modelo (o fiador também exige [[FIADOR]]). */
export function blocosObrigatorios(chave: string): string[] {
  return [
    "LOCADOR",
    "LOCATARIO",
    "OBJETO",
    "PRAZO",
    "ASSINATURAS",
    ...(chave === "fiador" ? ["FIADOR"] : []),
  ];
}

const RE_BLOCO = /^\[\[([A-Z_]+)\]\]$/;
const RE_CAMPO = /\[([A-Z_]+)\]/g;

/** Problemas que impedem salvar uma versão (mesmas regras de public.locacao_modelo_validar). */
export function validarModelo(chave: string, ps: ParagrafoModelo[]): string[] {
  const erros: string[] = [];
  if (ps.length < 5 || ps.length > 400) erros.push("Lista de cláusulas vazia ou grande demais.");
  const ids = new Set<string>();
  const blocos = new Set<string>();
  ps.forEach((p, i) => {
    const t = p.t.trim();
    const onde = `Cláusula ${i + 1}`;
    if (!/^[a-z0-9_-]{1,24}$/.test(p.id) || ids.has(p.id))
      erros.push(`${onde}: identificação inválida.`);
    ids.add(p.id);
    if (!t) erros.push(`${onde}: texto vazio.`);
    if (t.length > 8000) erros.push(`${onde}: texto longo demais (máx. 8.000 caracteres).`);
    const b = RE_BLOCO.exec(t);
    if (b) {
      if (!NOMES_BLOCOS_MODELO.includes(b[1]))
        erros.push(`${onde}: bloco automático desconhecido [[${b[1]}]].`);
      else if (blocos.has(b[1])) erros.push(`${onde}: bloco automático repetido [[${b[1]}]].`);
      blocos.add(b[1]);
    } else if (t.includes("[[")) {
      erros.push(`${onde}: bloco automático [[...]] tem de ficar sozinho no parágrafo.`);
    } else {
      for (const x of camposDesconhecidos(t)) erros.push(`${onde}: campo que não existe [${x}].`);
    }
  });
  for (const b of blocosObrigatorios(chave))
    if (!blocos.has(b))
      erros.push(`Falta o bloco automático [[${b}]] (dados que o sistema preenche).`);
  return erros;
}

export function camposDesconhecidos(t: string): string[] {
  return [...t.matchAll(RE_CAMPO)].map((m) => m[1]).filter((x) => !NOMES_CAMPOS_MODELO.includes(x));
}

/** Parágrafos travados (texto exigido pela seguradora/Loft) mudaram? Então o salvamento pede confirmação. */
export function travadosMudaram(antes: ParagrafoModelo[], depois: ParagrafoModelo[]): boolean {
  const so = (ps: ParagrafoModelo[]) =>
    JSON.stringify(ps.filter((p) => p.trava).map((p) => ({ id: p.id, t: p.t.trim() })));
  return so(antes) !== so(depois);
}

/** Lista limpa (como o banco grava): só as chaves conhecidas, texto aparado. */
export function limparParagrafos(ps: ParagrafoModelo[]): ParagrafoModelo[] {
  return ps.map((p) => ({
    id: p.id,
    t: p.t.trim(),
    ...(p.trava ? { trava: true } : {}),
    ...(p.dest ? { dest: p.dest } : {}),
    ...(p.cond ? { cond: p.cond } : {}),
    ...(p.adaptado ? { adaptado: true } : {}),
  }));
}

/** Identificação nova para uma cláusula incluída no editor. */
export function novoIdParagrafo(ps: ParagrafoModelo[]): string {
  const usados = new Set(ps.map((p) => p.id));
  let n = ps.length + 1;
  while (usados.has(`n${n}`)) n++;
  return `n${n}`;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function lerParagrafos(raw: unknown): ParagrafoModelo[] {
  return (Array.isArray(raw) ? raw : [])
    .map((x) => {
      const o = obj(x);
      const dest: ParagrafoModelo["dest"] =
        o.dest === "residencial" || o.dest === "comercial" ? o.dest : undefined;
      return {
        id: typeof o.id === "string" ? o.id : "",
        t: typeof o.t === "string" ? o.t : "",
        ...(o.trava === true ? { trava: true } : {}),
        ...(dest ? { dest } : {}),
        ...(o.cond === "isencao_multa" ? { cond: "isencao_multa" as const } : {}),
        ...(o.adaptado === true ? { adaptado: true } : {}),
      };
    })
    .filter((p) => p.id && p.t);
}

export function lerModelo(raw: unknown): ModeloContrato | null {
  const o = obj(raw);
  const chave = o.chave as ChaveModelo;
  if (!CHAVES_MODELO.includes(chave)) return null;
  return {
    chave,
    titulo: typeof o.titulo === "string" ? o.titulo : chave,
    tipo: o.tipo === "comercial" ? "comercial" : "residencial",
    garantia: typeof o.garantia === "string" ? o.garantia : "",
    seguradora: typeof o.seguradora === "string" ? o.seguradora : null,
    subtitulo: typeof o.subtitulo === "string" ? o.subtitulo : "",
    paragrafos: lerParagrafos(o.paragrafos),
    versao: typeof o.versao === "number" ? o.versao : 0,
    padrao: o.padrao === true,
    nota: typeof o.nota === "string" ? o.nota : null,
    criadoEm: typeof o.criado_em === "string" ? o.criado_em : null,
    autor: typeof o.autor === "string" ? o.autor : null,
  };
}

/** Padrão do sistema (mesmo texto que a migration grava com organization_id NULL). */
export function modeloPadrao(chave: ChaveModelo): ModeloContrato {
  const m = (padrao as { modelos: Record<string, unknown>[] }).modelos.find(
    (x) => x.chave === chave,
  );
  const lido = lerModelo({ ...m, versao: 0, padrao: true });
  if (!lido) throw new Error(`Modelo padrão inexistente: ${chave}`);
  return lido;
}
