/** PDF usado na geração: os 2 modelos antigos da Única Escolha ou o contrato-base RE/MAX. */
export type Template = "campolim" | "barao-de-tatui" | "remax-padrao";
export type LegacyTemplate = Exclude<Template, "remax-padrao">;
/** Unidade cadastrada pela imobiliária (exclusive_units). */
export type ExclusiveUnit = {
  id: string;
  nome: string;
  creci: string;
  razao_social: string;
  endereco: string;
  cidade: string;
  estado: string;
  cnpj: string;
  nome_comercial: string;
  legacy_template: LegacyTemplate | null;
  contrato_antigo: boolean;
  ativo: boolean;
};
export type UnitField = Exclude<
  keyof ExclusiveUnit,
  "id" | "legacy_template" | "contrato_antigo" | "ativo"
>;
export const UNIT_FIELDS: { key: UnitField; label: string; placeholder: string }[] = [
  { key: "nome", label: "Nome da unidade", placeholder: "Ex.: Única Escolha I" },
  { key: "creci", label: "CRECI da unidade", placeholder: "Ex.: 38086-J" },
  {
    key: "razao_social",
    label: "Razão social",
    placeholder: "Ex.: XYZ NEGÓCIOS IMOBILIÁRIOS LTDA",
  },
  { key: "cnpj", label: "CNPJ", placeholder: "00.000.000/0000-00" },
  { key: "endereco", label: "Endereço da sede", placeholder: "Rua, número - complemento - bairro" },
  { key: "cidade", label: "Cidade", placeholder: "Ex.: Sorocaba" },
  { key: "estado", label: "Estado", placeholder: "Ex.: São Paulo" },
  {
    key: "nome_comercial",
    label: "Nome comercial (assinatura e cláusula)",
    placeholder: "Ex.: RE/MAX ÚNICA ESCOLHA",
  },
];
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
  /** Unidade escolhida na criação; nulo nas captações anteriores ao cadastro de unidades. */
  unit_id?: string | null;
  status: CaptureStatus;
  form_data: CaptureForm;
  broker_name: string;
  broker_cpf: string;
  broker_creci: string;
  created_on_sp: string;
  created_at: string;
  archived_at?: string | null;
  signed_on?: string | null;
  geo_lat?: number | null;
  geo_lon?: number | null;
  geo_key?: string | null;
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

/** Rótulo das captações antigas (sem unit_id), anteriores ao cadastro de unidades. */
export const TEMPLATES: Record<Template, string> = {
  campolim: "RE/MAX Única Escolha I — Campolim",
  "barao-de-tatui": "RE/MAX Única Escolha II — Barão de Tatuí",
  "remax-padrao": "Contrato-base RE/MAX",
};
/** Unidade da captação: a gravada nela ou, nas antigas, a unidade ligada ao mesmo PDF antigo. */
export function captureUnit(
  c: Pick<Capture, "unit_id" | "template">,
  units: ExclusiveUnit[],
): ExclusiveUnit | null {
  if (c.unit_id) return units.find((u) => u.id === c.unit_id) ?? null;
  return units.find((u) => u.legacy_template === c.template) ?? null;
}
/** Chave estável da unidade para filtro/ranking (antigas sem unidade cadastrada: o modelo). */
export function captureUnitKey(
  c: Pick<Capture, "unit_id" | "template">,
  units: ExclusiveUnit[],
): string {
  return captureUnit(c, units)?.id ?? c.unit_id ?? `modelo:${c.template}`;
}
export function captureUnitLabel(
  c: Pick<Capture, "unit_id" | "template">,
  units: ExclusiveUnit[],
): string {
  return captureUnit(c, units)?.nome ?? (c.unit_id ? "Unidade" : (TEMPLATES[c.template] ?? ""));
}
/**
 * Qual PDF gerar. Decidido na hora da geração pela unidade: a chave contrato_antigo da unidade
 * permite voltar/sair dos PDFs antigos sem mexer nas captações. Captação antiga sem unidade
 * cadastrada continua no PDF gravado nela.
 */
export function contractSource(
  c: Pick<Capture, "unit_id" | "template">,
  units: ExclusiveUnit[],
): { file: Template; unit: ExclusiveUnit | null } {
  const unit = captureUnit(c, units);
  if (unit?.contrato_antigo && unit.legacy_template)
    return { file: unit.legacy_template, unit: null };
  if (unit) return { file: "remax-padrao", unit };
  if (c.template === "remax-padrao") throw new Error("Unidade da captação não encontrada");
  return { file: c.template, unit: null };
}
/** Próxima ação da captação, independente do fluxo de vendas. */
export function captureNextAction(status: CaptureStatus, manager: boolean): string {
  switch (status) {
    case "rascunho":
      return "Conferir documentos e completar dados";
    case "devolvida":
      return "Corrigir pendências e reenviar ao gestor";
    case "enviada":
      return manager ? "Revisar e encaminhar para assinatura" : "Aguardar revisão do gestor";
    case "em_assinatura":
      return manager ? "Anexar contrato assinado e aprovar" : "Aguardar assinatura externa";
    case "aprovada":
      return "Captação concluída";
  }
}

export function ownerDocumentsComplete(docs: CaptureDocument[], owner: 1 | 2): boolean {
  const types = new Set(docs.filter((d) => d.owner_index === owner).map((d) => d.kind));
  return types.has("cnh") || (types.has("rg") && types.has("cpf"));
}
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
    if (!ownerDocumentsComplete(docs, (index + 1) as 1 | 2))
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

/** Campos AcroForm da unidade no contrato-base (vazios no PDF; vêm de exclusive_units). */
const UNIT_PDF_FIELDS: Record<string, (u: ExclusiveUnit) => string> = {
  Franquia: (u) => u.nome, // nome sob o logo, págs. 1-5
  REMAX: (u) => u.razao_social,
  undefined: (u) => u.nome.toLocaleUpperCase("pt-BR"),
  with: (u) => u.endereco,
  "registered with the CNPJME under number": (u) => u.cidade,
  "registered with the CNPJME undger number": (u) => u.estado,
  undefined_2: (u) => u.cnpj,
  // A assinatura já imprime "RE/MAX" antes do campo.
  REMAX_2: (u) => u.nome_comercial.replace(/^\s*RE\/?MAX\s*/i, ""),
};
/** Texto fixo da unidade removido do contrato-base: reescrito na mesma posição do original
 * (coordenadas pdf-lib, origem embaixo; medidas nos PDFs da Única Escolha). */
const UNIT_CRECI_POS: [page: number, x: number, y: number][] = [
  [0, 97.49, 25.77],
  [1, 95.53, 40.8],
  [2, 466.33, 718.26],
  [3, 96.51, 40.15],
  [4, 96.51, 40.8],
];
export const UNIT_TEXT_LIMITS = { clausulaB: 225, logo: 108 };
/** Tamanho máximo por campo da unidade, igual ao que os PDFs antigos exibiam. */
const UNIT_FIELD_SIZE: Record<string, number> = { Franquia: 15.49, REMAX_2: 8.54 };
/** Pág. 6: faixa branca sob o "RE/MAX" do logo (cobre as bordas da área apagada da imagem). */
const LOGO6 = { x0: 427, x1: 539, y0: 760.4, y1: 784.6, centerX: 482.4, baseline: 766.58 };

/** Recebe os bytes do modelo ORIGINAL, nunca dados de exemplo do protótipo. Com `unit`, o PDF é
 * o contrato-base e os dados da unidade são preenchidos aqui. */
export async function fillExclusiveTemplate(
  bytes: Uint8Array,
  capture: Capture,
  flatten = true,
  contractDate?: string,
  unit?: ExclusiveUnit | null,
): Promise<Uint8Array> {
  // Carregar PDF apenas no clique: importar no SSR quebra o Worker inteiro.
  const { PDFDocument, StandardFonts, TextAlignment, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fields = new Map(form.getFields().map((field) => [field.getName(), field]));
  const set = (name: string, value: string, appearanceFont = font) => {
    if (!fields.has(name)) throw new Error(`Campo não encontrado no modelo: ${name}`);
    const field = form.getTextField(name);
    field.setText(value || "");
    field.updateAppearances(appearanceFont);
  };
  if (unit) {
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const [name, value] of Object.entries(UNIT_PDF_FIELDS)) {
      // Contrato-base tem tamanho fixo (14pt); os PDFs antigos usavam tamanho automático
      // (~11,8pt; 15,5 no logo; 8,5 na assinatura). Reduz até caber na largura do campo.
      const f = name === "Franquia" ? bold : font;
      const text = value(unit).trim();
      if (!fields.has(name)) throw new Error(`Campo não encontrado no modelo: ${name}`);
      const field = form.getTextField(name);
      // Menor widget do campo (o nome sob o logo se repete nas págs. 1-5).
      const widths = field.acroField.getWidgets().map((w) => w.getRectangle().width);
      const width = Math.min(...widths) - 4;
      const cap = UNIT_FIELD_SIZE[name] ?? 11.84;
      const size = Math.min(cap, (cap * width) / Math.max(1, f.widthOfTextAtSize(text, cap)));
      const fixed = Math.floor(size * 100) / 100;
      field.setFontSize(fixed);
      // O DA do widget (21pt no logo, 14pt no quadro) tem prioridade sobre o do campo.
      for (const w of field.acroField.getWidgets()) {
        const da = w.getDefaultAppearance();
        if (da) w.setDefaultAppearance(da.replace(/[\d.]+(\s+Tf)/, `${fixed}$1`));
      }
      // Nome sob o logo: centralizado, como nos PDFs antigos.
      if (name === "Franquia") field.setAlignment(TextAlignment.Center);
      set(name, text, f);
    }
    const pages = pdf.getPages();
    if (pages.length !== 6) throw new Error("Contrato-base inesperado");
    const fit = (text: string, f: typeof font, size: number, max: number) =>
      Math.min(size, (size * max) / Math.max(1, f.widthOfTextAtSize(text, size)));
    const creci = `CRECI ${unit.creci.trim()}`;
    for (const [p, x, y] of UNIT_CRECI_POS)
      pages[p].drawText(creci, { x, y, size: 8, font, color: rgb(0.047, 0.11, 0.224) });
    // Pág. 6: cláusula B. e nome da unidade sob o logo.
    const clause = ` A IMOBILIÁRIA ${unit.nome_comercial.trim().toLocaleUpperCase("pt-BR")}, acima mencionada,`;
    pages[5].drawText(clause, {
      x: 323.65,
      y: 645.12,
      size: fit(clause, font, 8.5, UNIT_TEXT_LIMITS.clausulaB),
      font,
      color: rgb(0.137, 0.122, 0.125),
    });
    pages[5].drawRectangle({
      x: LOGO6.x0,
      y: LOGO6.y0,
      width: LOGO6.x1 - LOGO6.x0,
      height: LOGO6.y1 - LOGO6.y0,
      color: rgb(1, 1, 1),
    });
    const logoName = unit.nome.trim();
    const logoSize = fit(logoName, bold, 15, UNIT_TEXT_LIMITS.logo);
    pages[5].drawText(logoName, {
      x: LOGO6.centerX - bold.widthOfTextAtSize(logoName, logoSize) / 2,
      y: LOGO6.baseline,
      size: logoSize,
      font: bold,
      color: rgb(0.005, 0.112, 0.234),
    });
  }
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
  // Data do contrato: dia em que ele é gerado (SP); sem ela, a data de criação.
  const [year, month, day] = (contractDate ?? capture.created_on_sp).split("-").map(Number);
  if (!year || !month || !day) throw new Error("Data civil do contrato inválida");
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

export type ValidityLevel = "ok" | "atencao" | "urgente" | "vencida";
export type Validity = {
  start: string;
  end: string;
  days: number;
  daysLeft: number;
  level: ValidityLevel;
};
const dayMs = 86400000;
const utcDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
/** Vigência da exclusividade: conta da DATA DE ASSINATURA (cláusula 1.2) pelo prazo em dias.
 * Sem data de assinatura registrada ainda não há vigência. `today` = data civil em SP. */
export function captureValidity(
  c: Pick<Capture, "signed_on" | "form_data">,
  today: string,
): Validity | null {
  const days = Number.parseInt(c.form_data?.condicoes?.prazo_dias_numero ?? "", 10);
  if (!c.signed_on || !/^\d{4}-\d{2}-\d{2}$/.test(c.signed_on) || !(days > 0)) return null;
  const endMs = utcDay(c.signed_on) + days * dayMs;
  const end = new Date(endMs).toISOString().slice(0, 10);
  const daysLeft = Math.round((endMs - utcDay(today)) / dayMs);
  const level: ValidityLevel =
    daysLeft < 0 ? "vencida" : daysLeft <= 7 ? "urgente" : daysLeft <= 30 ? "atencao" : "ok";
  return { start: c.signed_on, end, days, daysLeft, level };
}
export const formatDateBR = (iso: string) => iso.split("-").reverse().join("/");
export function validityText(v: Validity): string {
  if (v.daysLeft < 0) return `Vencida em ${formatDateBR(v.end)}`;
  if (v.daysLeft === 0) return "Vence hoje";
  return `Vence em ${v.daysLeft} dia${v.daysLeft === 1 ? "" : "s"} (${formatDateBR(v.end)})`;
}
export const VALIDITY_STYLE: Record<ValidityLevel, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  atencao: "bg-amber-100 text-amber-900",
  urgente: "bg-red-100 text-red-800",
  vencida: "bg-muted text-muted-foreground line-through",
};
