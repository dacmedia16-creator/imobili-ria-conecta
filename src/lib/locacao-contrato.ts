// Locação — dados do contrato preenchidos na etapa Documentação (t_127811ca; pedido de Denis 10/11/2026).
// Regras puras (sem banco). O banco (migration 20261112120000) repete a lista de campos, a validação e a trava
// de envio à Conferência; os testes conferem que as duas listas são iguais.
//
// Campos tirados dos marcadores do contrato-modelo residencial com fiador: qualificação completa do locatário,
// proprietário e cônjuge, fiador e cônjuge (com matrícula e cartório do imóvel dele), moradores, inscrição
// municipal e códigos de energia/água/gás, prazo, início e dia de vencimento.

export type SecaoContrato =
  | "locatario"
  | "proprietario"
  | "proprietario_conj"
  | "fiador"
  | "fiador_conj"
  | "fiador_imovel"
  | "imovel"
  | "prazo"
  | "moradores";

export type TipoCampo = "texto" | "data" | "numero" | "estado_civil" | "longo";

export type CampoContrato = {
  k: string;
  label: string;
  secao: SecaoContrato;
  tipo: TipoCampo;
};

const PESSOA: { k: string; label: string; tipo: TipoCampo }[] = [
  { k: "nome", label: "Nome completo", tipo: "texto" },
  { k: "cpf", label: "CPF", tipo: "texto" },
  { k: "rg", label: "RG", tipo: "texto" },
  { k: "nascimento", label: "Data de nascimento", tipo: "data" },
  { k: "nacionalidade", label: "Nacionalidade", tipo: "texto" },
  { k: "estado_civil", label: "Estado civil", tipo: "estado_civil" },
  { k: "regime", label: "Regime de bens (se casado)", tipo: "texto" },
  { k: "profissao", label: "Profissão", tipo: "texto" },
  { k: "endereco", label: "Endereço atual", tipo: "texto" },
  { k: "email", label: "E-mail", tipo: "texto" },
  { k: "telefone", label: "Telefone", tipo: "texto" },
];

const CONJUGE: { k: string; label: string; tipo: TipoCampo }[] = [
  { k: "nome", label: "Nome completo", tipo: "texto" },
  { k: "cpf", label: "CPF", tipo: "texto" },
  { k: "rg", label: "RG", tipo: "texto" },
  { k: "nascimento", label: "Data de nascimento", tipo: "data" },
  { k: "nacionalidade", label: "Nacionalidade", tipo: "texto" },
  { k: "profissao", label: "Profissão", tipo: "texto" },
];

const pessoa = (pre: string, secao: SecaoContrato, lista = PESSOA): CampoContrato[] =>
  lista.map((c) => ({ k: `${pre}_${c.k}`, label: c.label, secao, tipo: c.tipo }));

export const CAMPOS_CONTRATO: CampoContrato[] = [
  ...pessoa("loc", "locatario"),
  ...pessoa("prop", "proprietario"),
  ...pessoa("prop_conj", "proprietario_conj", CONJUGE),
  ...pessoa("fia", "fiador"),
  ...pessoa("fia_conj", "fiador_conj", CONJUGE),
  {
    k: "fia_matricula",
    label: "Matrícula do imóvel do fiador",
    secao: "fiador_imovel",
    tipo: "texto",
  },
  { k: "fia_cartorio", label: "Cartório de registro", secao: "fiador_imovel", tipo: "texto" },
  { k: "imv_inscricao", label: "Inscrição municipal (IPTU)", secao: "imovel", tipo: "texto" },
  { k: "imv_energia", label: "Código de energia (instalação)", secao: "imovel", tipo: "texto" },
  { k: "imv_agua", label: "Código de água", secao: "imovel", tipo: "texto" },
  { k: "imv_gas", label: "Código de gás", secao: "imovel", tipo: "texto" },
  { k: "imv_vagas", label: "Vagas de garagem", secao: "imovel", tipo: "texto" },
  { k: "prazo_meses", label: "Prazo (meses)", secao: "prazo", tipo: "numero" },
  { k: "inicio", label: "Início do contrato", secao: "prazo", tipo: "data" },
  { k: "dia_vencimento", label: "Dia de vencimento (1 a 28)", secao: "prazo", tipo: "numero" },
  {
    k: "moradores",
    label: "Moradores (nome e CPF, um por linha)",
    secao: "moradores",
    tipo: "longo",
  },
];

export const CHAVES_CONTRATO = CAMPOS_CONTRATO.map((c) => c.k);

/** Valor gravado quando o imóvel não tem o item (pedido de Denis 10/11): é valor preenchido, o contrato escreve
 * "não possui" e a IA não sobrescreve (ela só preenche campo vazio). Gás é opcional; vagas é obrigatório. */
export const NAO_POSSUI = "não possui";
export const CAMPOS_NAO_POSSUI = new Set(["imv_gas", "imv_vagas"]);
export const naoPossui = (v: string | undefined) => (v ?? "").trim().toLowerCase() === NAO_POSSUI;
const CHAVES = new Set(CHAVES_CONTRATO);

export const SECOES: { key: SecaoContrato; titulo: string; soFiador?: boolean }[] = [
  { key: "locatario", titulo: "Locatário" },
  { key: "proprietario", titulo: "Proprietário (locador)" },
  { key: "proprietario_conj", titulo: "Cônjuge do proprietário (se casado ou em união estável)" },
  { key: "fiador", titulo: "Fiador", soFiador: true },
  {
    key: "fiador_conj",
    titulo: "Cônjuge do fiador (se casado ou em união estável)",
    soFiador: true,
  },
  { key: "fiador_imovel", titulo: "Imóvel do fiador", soFiador: true },
  { key: "imovel", titulo: "Imóvel locado" },
  { key: "prazo", titulo: "Prazo e vencimento" },
  { key: "moradores", titulo: "Moradores" },
];

export const ESTADOS_CIVIS = [
  "solteiro(a)",
  "casado(a)",
  "união estável",
  "divorciado(a)",
  "separado(a)",
  "viúvo(a)",
];

/** Campos que vêm da pré-análise quando o corretor ainda não digitou nada no contrato. */
export const DA_PRE_ANALISE: Record<string, "nome" | "cpf" | "nascimento" | "email" | "telefone"> =
  {
    loc_nome: "nome",
    loc_cpf: "cpf",
    loc_nascimento: "nascimento",
    loc_email: "email",
    loc_telefone: "telefone",
  };

/** Os campos obrigatórios só valem para locação residencial com fiador (caução e seguro-fiança seguem como estão). */
export function exigeDadosContrato(tipo: string, garantia: string): boolean {
  return tipo === "residencial" && garantia === "fiador";
}

/** Casado ou união estável (pede cônjuge). Mesma regra de public.locacao_casado. */
export function casado(estadoCivil: string | null | undefined): boolean {
  return /(casad|uni[aã]o)/.test((estadoCivil ?? "").toLowerCase());
}

const digitos = (v: string | undefined) => (v ?? "").replace(/\D/g, "");
const vazio = (v: string | undefined) => (v ?? "").trim() === "";

/** O que falta para enviar à Conferência. Espelho de public.locacao_contrato_faltando (mesma ordem e texto). */
export function faltasContrato(
  tipo: string,
  garantia: string,
  v: Record<string, string | undefined>,
): string[] {
  if (!exigeDadosContrato(tipo, garantia)) return [];
  const f: string[] = [];
  const quem: [string, string][] = [
    ["loc", "do locatário"],
    ["prop", "do proprietário"],
    ["fia", "do fiador"],
  ];
  const itens: [string, string][] = [
    ["nome", "nome"],
    ["cpf", "CPF"],
    ["rg", "RG"],
    ["nacionalidade", "nacionalidade"],
    ["estado_civil", "estado civil"],
    ["profissao", "profissão"],
    ["endereco", "endereço"],
  ];
  for (const [pre, rot] of quem) {
    for (const [k, nome] of itens) {
      const val = v[`${pre}_${k}`];
      if (k === "cpf" ? digitos(val).length !== 11 : vazio(val)) f.push(`${nome} ${rot}`);
    }
    if (pre !== "loc" && casado(v[`${pre}_estado_civil`])) {
      if (vazio(v[`${pre}_conj_nome`])) f.push(`nome do cônjuge ${rot}`);
      if (digitos(v[`${pre}_conj_cpf`]).length !== 11) f.push(`CPF do cônjuge ${rot}`);
    }
  }
  const soltos: [string, string][] = [
    ["fia_matricula", "matrícula do imóvel do fiador"],
    ["fia_cartorio", "cartório do imóvel do fiador"],
    ["imv_inscricao", "inscrição municipal do imóvel"],
    ["imv_energia", "código de energia"],
    ["imv_agua", "código de água"],
    ["imv_vagas", 'vagas de garagem (ou "não possui")'],
    ["prazo_meses", "prazo (meses)"],
    ["inicio", "início do contrato"],
    ["dia_vencimento", "dia de vencimento"],
  ];
  for (const [k, nome] of soltos) if (vazio(v[k])) f.push(nome);
  return f;
}

/** Mesma validação de public.locacao_contrato_valor_ok (o banco recusa o que não passar). */
export function valorOk(k: string, t: string): boolean {
  if (t === "") return true;
  if (t.length > (k === "moradores" ? 2000 : 300)) return false;
  if (k === "inicio" || k.endsWith("nascimento")) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
    const d = new Date(`${t}T12:00:00Z`);
    return (
      !Number.isNaN(d.getTime()) &&
      d.toISOString().slice(0, 10) === t &&
      t >= "1900-01-01" &&
      t <= "2100-12-31"
    );
  }
  if (k === "prazo_meses") return /^\d{1,3}$/.test(t) && +t >= 1 && +t <= 240;
  if (k === "dia_vencimento") return /^\d{1,2}$/.test(t) && +t >= 1 && +t <= 28;
  return true;
}

export type OrigemCampo =
  { o: "ia"; item: string } | { o: "manual" } | { o: "pre" } | { o: "vazio" };

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Valores (já com a pré-análise por baixo) e origem de cada campo, lidos de forma fechada. */
export function lerContrato(
  valoresRaw: unknown,
  origemRaw: unknown,
): { valores: Record<string, string>; origem: Record<string, OrigemCampo> } {
  const valores: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(valoresRaw)))
    if (CHAVES.has(k) && typeof v === "string" && v.trim()) valores[k] = v;
  const o = obj(origemRaw);
  const origem: Record<string, OrigemCampo> = {};
  for (const k of CHAVES_CONTRATO) {
    const x = obj(o[k]);
    if (!valores[k]) origem[k] = { o: "vazio" };
    else if (x.o === "ia") origem[k] = { o: "ia", item: typeof x.item === "string" ? x.item : "" };
    else if (x.o === "manual") origem[k] = { o: "manual" };
    else if (k in DA_PRE_ANALISE) origem[k] = { o: "pre" };
    else origem[k] = { o: "manual" };
  }
  return { valores, origem };
}

/** Só as chaves que o corretor mudou de fato (o resto continua com a origem que tinha). */
export function alteracoes(
  atuais: Record<string, string>,
  editados: Record<string, string>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(editados)) {
    if (!CHAVES.has(k)) continue;
    const novo = v.trim();
    if (novo !== (atuais[k] ?? "").trim()) out[k] = novo === "" ? null : novo;
  }
  return out;
}
