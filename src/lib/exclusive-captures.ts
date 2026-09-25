import { PDFDocument, StandardFonts } from "pdf-lib";

export type Template = "campolim" | "barao-de-tatui";
export type CaptureStatus = "rascunho" | "devolvida" | "enviada" | "em_assinatura" | "aprovada";
export type DocumentKind =
  "rg" | "cpf" | "cnh" | "residencia" | "iptu" | "matricula" | "gerado" | "assinado";
export type OwnerField =
  | "nome_completo"
  | "rg"
  | "cpf"
  | "endereco_completo"
  | "nacionalidade"
  | "estado_civil"
  | "email"
  | "telefone_1"
  | "telefone_2";
export type PropertyField =
  | "tipo_imovel"
  | "endereco"
  | "complemento"
  | "bairro"
  | "municipio"
  | "estado"
  | "classificacao_fiscal_iptu"
  | "numero_matricula"
  | "cartorio_registro"
  | "valor_imovel"
  | "observacoes";
export type TermsField =
  | "prazo_dias_numero"
  | "prazo_dias_extenso"
  | "prazo_dias_uteis_numero"
  | "prazo_dias_uteis_extenso"
  | "comissao_percentual_numero"
  | "comissao_percentual_extenso"
  | "foro_comarca"
  | "foro_estado";
export type WitnessField = "nome" | "rg" | "cpf";
export type Owner = Record<OwnerField, string>;
export type Property = Record<PropertyField, string>;
export type Terms = Record<TermsField, string>;
export type Witness = Record<WitnessField, string>;
export type CaptureForm = {
  proprietario_1: Owner;
  proprietario_2?: Owner;
  imovel: Property;
  condicoes: Terms;
  testemunha_1: Witness;
  testemunha_2: Witness;
};
export type Capture = {
  id: string;
  captor_id: string;
  template: Template;
  status: CaptureStatus;
  form_data: CaptureForm;
  broker_name: string;
  broker_cpf: string;
  broker_creci: string;
  created_on_sp: string;
  created_at: string;
};
export type CaptureDocument = {
  id: string;
  capture_id: string;
  kind: DocumentKind;
  owner_index: number;
  storage_path: string;
  file_name: string;
};
export type CaptureEvent = {
  id: number;
  actor_id: string;
  action: string;
  detail: string | null;
  created_at: string;
};

export const TEMPLATES: Record<Template, string> = {
  campolim: "RE/MAX Única Escolha I — Campolim",
  "barao-de-tatui": "RE/MAX Única Escolha II — Barão de Tatuí",
};
export const OWNER_FIELDS: { key: OwnerField; label: string; required?: boolean }[] = [
  { key: "nome_completo", label: "Nome completo", required: true },
  { key: "rg", label: "RG", required: true },
  { key: "cpf", label: "CPF", required: true },
  { key: "endereco_completo", label: "Endereço completo", required: true },
  { key: "nacionalidade", label: "Nacionalidade", required: true },
  { key: "estado_civil", label: "Estado civil", required: true },
  { key: "email", label: "E-mail", required: true },
  { key: "telefone_1", label: "Telefone", required: true },
  { key: "telefone_2", label: "Telefone adicional" },
];
export const PROPERTY_FIELDS: { key: PropertyField; label: string; required?: boolean }[] = [
  { key: "tipo_imovel", label: "Tipo de imóvel", required: true },
  { key: "endereco", label: "Endereço do imóvel", required: true },
  { key: "complemento", label: "Complemento" },
  { key: "bairro", label: "Bairro", required: true },
  { key: "municipio", label: "Município", required: true },
  { key: "estado", label: "Estado", required: true },
  { key: "classificacao_fiscal_iptu", label: "Inscrição / classificação IPTU", required: true },
  { key: "numero_matricula", label: "Número da matrícula", required: true },
  { key: "cartorio_registro", label: "Cartório de registro", required: true },
  { key: "valor_imovel", label: "Valor do imóvel", required: true },
  { key: "observacoes", label: "Observações" },
];
export const TERMS_FIELDS: { key: TermsField; label: string }[] = [
  { key: "prazo_dias_numero", label: "Prazo em dias (número)" },
  { key: "prazo_dias_extenso", label: "Prazo em dias (por extenso)" },
  { key: "prazo_dias_uteis_numero", label: "Dias úteis (número)" },
  { key: "prazo_dias_uteis_extenso", label: "Dias úteis (por extenso)" },
  { key: "comissao_percentual_numero", label: "Comissão % (número)" },
  { key: "comissao_percentual_extenso", label: "Comissão % (por extenso)" },
  { key: "foro_comarca", label: "Foro — comarca" },
  { key: "foro_estado", label: "Foro — estado" },
];
export const emptyOwner = (): Owner =>
  Object.fromEntries(OWNER_FIELDS.map(({ key }) => [key, ""])) as Owner;
export const emptyProperty = (): Property =>
  Object.fromEntries(PROPERTY_FIELDS.map(({ key }) => [key, ""])) as Property;
export const emptyWitness = (): Witness => ({ nome: "", rg: "", cpf: "" });
export const defaultTerms = (): Terms => ({
  prazo_dias_numero: "180",
  prazo_dias_extenso: "cento e oitenta",
  prazo_dias_uteis_numero: "60",
  prazo_dias_uteis_extenso: "sessenta",
  comissao_percentual_numero: "6",
  comissao_percentual_extenso: "seis",
  foro_comarca: "Sorocaba",
  foro_estado: "São Paulo",
});
export function emptyForm(): CaptureForm {
  return {
    proprietario_1: emptyOwner(),
    imovel: emptyProperty(),
    condicoes: defaultTerms(),
    testemunha_1: emptyWitness(),
    testemunha_2: emptyWitness(),
  };
}
export function normalizeForm(value: Partial<CaptureForm> | null | undefined): CaptureForm {
  return {
    proprietario_1: { ...emptyOwner(), ...value?.proprietario_1 },
    ...(value?.proprietario_2
      ? { proprietario_2: { ...emptyOwner(), ...value.proprietario_2 } }
      : {}),
    imovel: { ...emptyProperty(), ...value?.imovel },
    condicoes: { ...defaultTerms(), ...value?.condicoes },
    testemunha_1: { ...emptyWitness(), ...value?.testemunha_1 },
    testemunha_2: { ...emptyWitness(), ...value?.testemunha_2 },
  };
}
export function missingRequirements(
  form: CaptureForm,
  docs: CaptureDocument[],
  cpf: string,
  creci: string,
): string[] {
  const missing: string[] = [];
  if (!cpf.trim()) missing.push("CPF do captador");
  if (!creci.trim()) missing.push("CRECI do captador");
  for (const [index, owner] of [form.proprietario_1, form.proprietario_2].entries()) {
    if (!owner) continue;
    for (const { key, label, required } of OWNER_FIELDS) {
      if (required && !owner[key]?.trim()) missing.push(`Proprietário ${index + 1}: ${label}`);
    }
    const types = new Set(docs.filter((d) => d.owner_index === index + 1).map((d) => d.kind));
    if (!(types.has("cnh") || (types.has("rg") && types.has("cpf"))))
      missing.push(`Proprietário ${index + 1}: RG e CPF ou CNH`);
  }
  for (const { key, label, required } of PROPERTY_FIELDS) {
    if (required && !form.imovel[key]?.trim()) missing.push(label);
  }
  for (const { key, label } of TERMS_FIELDS) {
    if (!form.condicoes[key]?.trim()) missing.push(label);
  }
  if (!docs.some((d) => d.kind === "gerado")) missing.push("Contrato gerado e conferido");
  return missing;
}

// Mapeamento AcroForm conferido visualmente nos dois modelos originais (mesmos nomes).
const ownerFields: Record<OwnerField, [string, string]> = {
  nome_completo: ["07fggfAd", "g"],
  rg: ["07ggAGfw0990v", "gfg"],
  cpf: ["sff", "fe"],
  endereco_completo: ["07ggfAfw0", "ebv"],
  nacionalidade: ["vv0", "kmgkf"],
  estado_civil: ["07grgfAf10gf", "ekkf"],
  email: ["07ggAf0", "svsf"],
  telefone_1: ["egf0", "vfv"],
  telefone_2: ["07grgA0", "grrg"],
};
const propertyFields: Record<PropertyField, string> = {
  tipo_imovel: "kf",
  endereco: "gm",
  complemento: ",v",
  bairro: "kmkg",
  municipio: "gkm fk",
  estado: "kmg",
  classificacao_fiscal_iptu: "vkmefk",
  numero_matricula: "kvoef",
  cartorio_registro: "ekfm",
  valor_imovel: "kvmekf",
  observacoes: "mke",
};
const termsFields: Record<TermsField, string> = {
  prazo_dias_numero: "fge",
  prazo_dias_extenso: "regegr",
  prazo_dias_uteis_numero: "uma remuneração correspondente a",
  prazo_dias_uteis_extenso: "undefined_4",
  comissao_percentual_numero: "de",
  comissao_percentual_extenso: "undefined_6",
  foro_comarca: "B",
  foro_estado: "vdf",
};
const witnessFields: Record<WitnessField, [string, string]> = {
  nome: ["NamGFe", "NamDe"],
  rg: ["ID", "IDFG"],
  cpf: ["Individual TaxpaGFByer Registry", "Individual Taxpayer Registry"],
};

/** Recebe os bytes do modelo ORIGINAL, nunca dados de exemplo do protótipo. */
export async function fillExclusiveTemplate(
  bytes: Uint8Array,
  capture: Capture,
  flatten = true,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fields = new Map(form.getFields().map((field) => [field.getName(), field]));
  const set = (name: string, value: string) => {
    if (!fields.has(name)) throw new Error(`Campo não encontrado no modelo: ${name}`);
    const field = form.getTextField(name);
    field.setText(value || "");
    field.updateAppearances(font);
  };
  const data = normalizeForm(capture.form_data);
  for (const [key, names] of Object.entries(ownerFields) as [OwnerField, [string, string]][]) {
    set(names[0], data.proprietario_1[key]);
    set(names[1], data.proprietario_2?.[key] ?? "");
  }
  for (const [key, name] of Object.entries(propertyFields) as [PropertyField, string][])
    set(name, data.imovel[key]);
  for (const [key, name] of Object.entries(termsFields) as [TermsField, string][])
    set(name, data.condicoes[key]);
  for (const [key, names] of Object.entries(witnessFields) as [WitnessField, [string, string]][]) {
    set(names[0], data.testemunha_1[key]);
    set(names[1], data.testemunha_2[key]);
  }
  const [year, month, day] = capture.created_on_sp.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Data civil de criação inválida");
  const monthName = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  set("NaEme", data.imovel.municipio);
  set("NamBe", String(day));
  set("NamEe", monthName);
  set("Name", String(year).slice(-2));
  set("NaGme", capture.broker_name);
  set("kgmf", capture.broker_creci);
  set("NameGF", capture.broker_cpf);
  if (flatten) form.flatten({ updateFieldAppearances: false });
  return pdf.save();
}

export function applySuggestedFields(
  form: CaptureForm,
  scope: "proprietario_1" | "proprietario_2" | "imovel",
  suggestions: Record<string, unknown>,
): CaptureForm {
  const target = scope === "imovel" ? { ...form.imovel } : { ...(form[scope] ?? emptyOwner()) };
  for (const [key, value] of Object.entries(suggestions)) {
    if (
      Object.hasOwn(target, key) &&
      !(target as Record<string, string>)[key]?.trim() &&
      typeof value === "string"
    ) {
      (target as Record<string, string>)[key] = value.trim();
    }
  }
  return { ...form, [scope]: target };
}
