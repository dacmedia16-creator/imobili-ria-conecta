import { validCpf } from "./exclusive-captures-ocr";
import type { DocumentKind, OwnerField, PropertyField } from "./exclusive-captures";

/** Documentos da captação que valem a leitura por IA (contratos gerados/assinados não). */
export const AI_READABLE_KINDS = ["rg", "cpf", "cnh", "residencia", "iptu", "matricula"] as const;
export type AiReadableKind = (typeof AI_READABLE_KINDS)[number];
export const isAiReadableKind = (kind: DocumentKind): kind is AiReadableKind =>
  (AI_READABLE_KINDS as readonly string[]).includes(kind);

const KIND_LABEL: Record<AiReadableKind, string> = {
  rg: "RG / carteira de identidade",
  cpf: "CPF",
  cnh: "CNH (carteira de motorista)",
  residencia: "comprovante de residência (conta de consumo, boleto etc.)",
  iptu: "carnê ou certidão de IPTU",
  matricula: "matrícula do imóvel (certidão do Registro de Imóveis)",
};

const OWNER_SCHEMA = `{
  "nome_completo": string|null,
  "rg": string|null,
  "cpf": string|null,
  "nacionalidade": string|null,
  "estado_civil": string|null,
  "endereco_completo": string|null,
  "email": string|null,
  "telefone_1": string|null,
  "telefone_2": string|null
}`;

const PROPERTY_SCHEMA = `{
  "tipo_imovel": string|null,
  "endereco": string|null,
  "complemento": string|null,
  "bairro": string|null,
  "municipio": string|null,
  "estado": string|null,
  "classificacao_fiscal_iptu": string|null,
  "numero_matricula": string|null,
  "cartorio_registro": string|null,
  "valor_imovel": string|null,
  "observacoes": string|null
}`;

/** Prompt por tipo de documento: cada um diz onde está cada dado e o formato esperado. */
export function buildCapturePrompt(kind: AiReadableKind, scope: "owner" | "property"): string {
  const head = `Documento enviado na captação de um imóvel: ${KIND_LABEL[kind]}.
Extraia os campos abaixo. Se o dado não estiver escrito no documento, use null — nunca invente, nunca deduza.
Responda somente JSON puro.`;
  if (scope === "owner") {
    const hints: Record<AiReadableKind, string> = {
      rg: `- "rg": número do registro geral com dígito (ex.: "12.345.678-9"); não confunda com o número do espelho/via.
- "nacionalidade": se constar naturalidade de cidade brasileira ou "brasileiro(a)", use "brasileira".
- "cpf": só se estiver impresso no documento.`,
      cpf: `- "cpf": no formato 000.000.000-00.`,
      cnh: `- "rg": campo "DOC. IDENTIDADE / ÓRG. EMISSOR / UF" — só o número.
- "cpf": no formato 000.000.000-00.
- "nacionalidade": campo "NACIONALIDADE" (ex.: "brasileira").`,
      residencia: `- "endereco_completo": endereço do titular em uma linha: logradouro, número, complemento, bairro, cidade/UF, CEP.
- "nome_completo": o titular da conta.`,
      iptu: `- "nome_completo"/"cpf": o contribuinte/proprietário, se constar.`,
      matricula: `- "nome_completo", "cpf", "rg", "nacionalidade", "estado_civil": do proprietário ATUAL (último registro de aquisição).`,
    };
    return `${head}\n\nOrientações:\n${hints[kind]}\n- "estado_civil": em minúsculas (ex.: "casado(a)", "solteiro(a)"), incluindo o regime de bens se constar.\n\nCampos:\n${OWNER_SCHEMA}`;
  }
  const hints: Record<AiReadableKind, string> = {
    matricula: `- "numero_matricula": número da matrícula.
- "cartorio_registro": nome do cartório (ex.: "1º Oficial de Registro de Imóveis de Sorocaba").
- "classificacao_fiscal_iptu": cadastro/inscrição municipal, se constar.
- "tipo_imovel": casa, apartamento, terreno, sala comercial etc.
- "observacoes": descrição do imóvel resumida (área, cômodos, vaga, unidade/bloco), até 400 caracteres.`,
    iptu: `- "classificacao_fiscal_iptu": inscrição imobiliária / cadastro / classificação fiscal.
- "valor_imovel": NÃO use o valor venal — deixe null.`,
    residencia: `- Preencha apenas o endereço do imóvel.`,
    rg: `- Documento pessoal: devolva só o que for do imóvel (normalmente nada).`,
    cpf: `- Documento pessoal: devolva só o que for do imóvel (normalmente nada).`,
    cnh: `- Documento pessoal: devolva só o que for do imóvel (normalmente nada).`,
  };
  return `${head}\n\nOrientações:\n${hints[kind]}\n- "endereco": logradouro e número, sem bairro/cidade.\n- "estado": nome do estado por extenso (ex.: "São Paulo").\n- "valor_imovel": só se houver valor de venda/negócio explícito.\n\nCampos:\n${PROPERTY_SCHEMA}`;
}

const OWNER_KEYS: OwnerField[] = [
  "nome_completo",
  "rg",
  "cpf",
  "nacionalidade",
  "estado_civil",
  "endereco_completo",
  "email",
  "telefone_1",
  "telefone_2",
];
const PROPERTY_KEYS: PropertyField[] = [
  "tipo_imovel",
  "endereco",
  "complemento",
  "bairro",
  "municipio",
  "estado",
  "classificacao_fiscal_iptu",
  "numero_matricula",
  "cartorio_registro",
  "valor_imovel",
  "observacoes",
];

const UF: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

/**
 * Resposta da IA não é confiável: mantém só chaves conhecidas, strings curtas e CPF válido.
 * O resultado vira sugestão que o corretor confere antes de aplicar.
 */
export function sanitizeCaptureAi(
  raw: Record<string, unknown>,
  scope: "owner" | "property",
): Record<string, string> {
  const keys: string[] = scope === "owner" ? OWNER_KEYS : PROPERTY_KEYS;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = raw[key];
    if (typeof value !== "string" && typeof value !== "number") continue;
    let text = String(value).replace(/\s+/g, " ").trim();
    if (!text || /^(null|n\/a|-+|não consta|nao consta)$/i.test(text)) continue;
    text = text.slice(0, key === "observacoes" ? 400 : 200);
    if (key === "cpf") {
      const digits = text.replace(/\D/g, "");
      if (digits.length !== 11) continue;
      text = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
      if (!validCpf(text)) continue;
    }
    if (key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) continue;
    if ((key === "telefone_1" || key === "telefone_2") && text.replace(/\D/g, "").length < 10)
      continue;
    if (key === "estado" && UF[text.toUpperCase()]) text = UF[text.toUpperCase()];
    out[key] = text;
  }
  return out;
}
