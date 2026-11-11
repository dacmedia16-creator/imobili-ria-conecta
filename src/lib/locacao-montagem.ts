import clausulas from "./locacao-clausulas.json";
export { gerarPdfContrato, type OpcoesPdfContrato } from "./locacao-contrato-pdf";

export type Montagem = {
  campos: Record<string, string>;
  contrato: Record<string, string>;
  administradora: { nome: string; cnpj: string; creci: string; cidade: string; uf: string };
};
export type LocacaoBase = {
  codigo: string;
  endereco: string;
  aluguel: number;
  taxaAdm: number;
  tipo: string;
  garantia: string;
  ficha: { imovelId: string; locatarioEndereco?: string; proprietario?: { nome: string } };
};

export const CAMPOS_DOCUMENTO = {
  prop_nome: 0,
  prop_cpf: 0,
  prop_rg: 0,
  prop_nacionalidade: 0,
  prop_estado_civil: 0,
  prop_profissao: 0,
  prop_endereco: 0,
  prop_conj_nome: 0,
  prop_conj_cpf: 0,
  loc_nome: 2,
  loc_cpf: 2,
  loc_rg: 2,
  loc_nacionalidade: 2,
  loc_estado_civil: 2,
  loc_profissao: 2,
  loc_endereco: 2,
  inicio: 3,
  prazo_meses: 3,
  dia_vencimento: 3,
  moradores: 3,
  imv_vagas: 0,
  imv_inscricao: 0,
  imv_energia: 0,
  imv_agua: 0,
  imv_gas: 0,
  fia_nome: 5,
  fia_cpf: 5,
  fia_rg: 5,
  fia_nacionalidade: 5,
  fia_estado_civil: 5,
  fia_profissao: 5,
  fia_endereco: 5,
  fia_conj_nome: 5,
  fia_conj_cpf: 5,
  fia_matricula: 5,
  fia_cartorio: 5,
} as const;

export const PASSOS = [
  "Imóvel",
  "Situação",
  "Locatário",
  "Detalhes",
  "Mais",
  "Garantia",
  "Repasse",
] as const;
export const CAMPOS: Record<
  string,
  { label: string; passo: number; padrao?: string; opcoes?: string[] }
> = {
  fia_imovel_endereco: { label: "Endereço do imóvel de propriedade do fiador", passo: 5 },
  numero: { label: "Número do contrato", passo: 0 },
  imovel_endereco: { label: "Endereço do imóvel", passo: 0 },
  aluguel: { label: "Aluguel mensal (R$; decimal com ponto)", passo: 3 },
  destinacao_fiscal: { label: "Destinação fiscal", passo: 0 },
  situacao: { label: "Situação", passo: 1, padrao: "pendente", opcoes: ["pendente", "ativo"] },
  checklist_modelo: { label: "Modelo do checklist", passo: 1 },
  locadores_adicionais: {
    label: "Outros locadores (qualificação completa, um por linha)",
    passo: 0,
  },
  locatarios_adicionais: {
    label: "Outros locatários (qualificação completa, um por linha)",
    passo: 2,
  },
  nota_fiscal: { label: "Nota fiscal", passo: 2, opcoes: ["nao", "sim"] },
  irrf: { label: "IR retido", passo: 2, opcoes: ["nao", "sim"] },
  deduzir_taxa_irrf: {
    label: "Deduzir taxa de administração no IRRF",
    passo: 2,
    opcoes: ["nao", "sim"],
  },
  dimob: { label: "Gerar DIMOB", passo: 2, opcoes: ["nao", "sim"] },
  fim: { label: "Término (AAAA-MM-DD)", passo: 3 },
  ocupacao: { label: "Ocupação", passo: 3 },
  reajuste: {
    label: "Reajuste (modelo: anual IPCA; campos extras a confirmar)",
    passo: 3,
    padrao: "Anual — IPCA",
  },
  conta_bancaria: { label: "Conta bancária para recebimento", passo: 4 },
  cobranca: {
    label: "Forma de cobrança",
    passo: 4,
    padrao: "mes_vencido",
    opcoes: ["mes_vencido", "mes_vincendo"],
  },
  entrega: { label: "Forma de entrega", passo: 4 },
  isencao_multa_meses: { label: "Isenção da multa rescisória (meses)", passo: 4 },
  mes_fechado: { label: "Período com mês fechado", passo: 4, opcoes: ["nao", "sim"] },
  juros: { label: "Juros próprios do contrato", passo: 4, padrao: "1% ao mês" },
  multa: { label: "Multa própria do contrato", passo: 4, padrao: "10%" },
  desconto: { label: "Desconto", passo: 4 },
  tarifa_bancaria: { label: "Tarifa bancária do locatário", passo: 4 },
  gerente_comercial: { label: "Gerente comercial", passo: 4 },
  clausulas_adicionais: { label: "Cláusulas adicionais (conferir antes da emissão)", passo: 4 },
  observacao: { label: "Observação interna", passo: 4 },
  repasse_tipo: {
    label: "Tipo de repasse",
    passo: 6,
    padrao: "manual",
    opcoes: ["manual", "split"],
  },
  repasse_taxa: { label: "Taxa de administração mensal (%)", passo: 6 },
  repasse_fixo: { label: "Ou valor fixo (R$)", passo: 6 },
  repasse_dias_uteis: { label: "Dias úteis após o pagamento", passo: 6, padrao: "4" },
  repasse_garantido: { label: "Repasse garantido", passo: 6, opcoes: ["nao", "sim"] },
  tarifa_doc_ted: { label: "Tarifa DOC/TED", passo: 6 },
  local: { label: "Local de emissão", passo: 4 },
  data: { label: "Data de emissão (AAAA-MM-DD)", passo: 4 },
  assinaturas: { label: "Bloco adicional de assinaturas", passo: 4 },
};

export function camposIniciais(base: LocacaoBase, m: Montagem): Record<string, string> {
  const c = Object.fromEntries(Object.entries(CAMPOS).map(([k, v]) => [k, v.padrao ?? ""]));
  const d = Object.fromEntries(
    Object.keys(CAMPOS_DOCUMENTO).map((key) => [`d_${key}`, m.contrato[key] ?? ""]),
  );
  return {
    ...c,
    ...d,
    numero: base.codigo,
    imovel_endereco: base.endereco,
    aluguel: base.aluguel ? base.aluguel.toFixed(2) : "",
    d_prop_nome: m.contrato.prop_nome || base.ficha.proprietario?.nome || "",
    d_loc_endereco: m.contrato.loc_endereco || base.ficha.locatarioEndereco || "",
    repasse_taxa: String(base.taxaAdm),
    local: `${m.administradora.cidade ?? ""}/${m.administradora.uf ?? ""}`,
    ...m.campos,
  };
}
export function dadosContrato(m: Montagem, c: Record<string, string>): Record<string, string> {
  return {
    ...m.contrato,
    ...Object.fromEntries(
      Object.keys(CAMPOS_DOCUMENTO).map((key) => [key, c[`d_${key}`] ?? m.contrato[key] ?? ""]),
    ),
  };
}
const docLabel = (rotulo: string, valor: string) => {
  const v = (valor || "").trim();
  if (!v) return rotulo;
  return v.toLowerCase().startsWith(rotulo.toLowerCase()) ? v : `${rotulo} ${v}`;
};
const nome = (v: Record<string, string>, prefixo: string) =>
  `${v[`${prefixo}_nome`] || ""}, ${v[`${prefixo}_nacionalidade`] || ""}, ${v[`${prefixo}_estado_civil`] || ""}, ${v[`${prefixo}_profissao`] || ""}, ${docLabel("RG", v[`${prefixo}_rg`] || "")}, ${docLabel("CPF", v[`${prefixo}_cpf`] || "")}, residente em ${v[`${prefixo}_endereco`] || ""}`;
const conj = (v: Record<string, string>, p: string) =>
  v[`${p}_conj_nome`]
    ? `, e cônjuge ${v[`${p}_conj_nome`]}, ${docLabel("CPF", v[`${p}_conj_cpf`] || "")}`
    : "";
const dataLonga = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: "UTC",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(d);
};
export function fimPrazo(inicio: string, meses: number): string {
  const d = new Date(`${inicio}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || !Number.isInteger(meses) || meses < 1 || meses > 240) return "";
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  d.setUTCDate(
    Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ = [
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const DEZENAS = [
  "",
  "",
  "vinte",
  "trinta",
  "quarenta",
  "cinquenta",
  "sessenta",
  "setenta",
  "oitenta",
  "noventa",
];
const CENTENAS = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];
function trio(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100),
    r = n % 100,
    d = Math.floor(r / 10),
    u = r % 10;
  return [
    CENTENAS[c],
    r < 10
      ? UNIDADES[r]
      : r < 20
        ? DEZ[r - 10]
        : [DEZENAS[d], UNIDADES[u]].filter(Boolean).join(" e "),
  ]
    .filter(Boolean)
    .join(" e ");
}
export function reaisExtenso(valor: number): string {
  if (!Number.isFinite(valor) || valor < 0 || valor > 999999999)
    throw new Error("Valor fora do intervalo");
  const cents = Math.round(valor * 100),
    int = Math.floor(cents / 100),
    fra = cents % 100;
  const milhoes = Math.floor(int / 1000000),
    milhares = Math.floor(int / 1000) % 1000,
    resto = int % 1000;
  const partes = [
    milhoes ? `${trio(milhoes)} ${milhoes === 1 ? "milhão" : "milhões"}` : "",
    milhares ? `${milhares === 1 ? "mil" : `${trio(milhares)} mil`}` : "",
    resto ? trio(resto) : "",
  ].filter(Boolean);
  const r = `${partes.join(" e ") || "zero"} ${int === 1 ? "real" : "reais"}`;
  return fra ? `${r} e ${trio(fra)} ${fra === 1 ? "centavo" : "centavos"}` : r;
}

export function faltasMontagem(
  base: LocacaoBase,
  m: Montagem,
  c: Record<string, string>,
): string[] {
  const v = dadosContrato(m, c);
  const faltas = [
    ["número", c.numero],
    ["locador", v.prop_nome],
    ["locatário", v.loc_nome],
    ["fiador", v.fia_nome],
    ...(["prop", "loc", "fia"] as const).flatMap((p) =>
      ["cpf", "rg", "nacionalidade", "estado_civil", "profissao", "endereco"].map((key) => [
        `${key} ${p}`,
        v[`${p}_${key}`],
      ]),
    ),
    ["matrícula do fiador", v.fia_matricula],
    ["cartório do fiador", v.fia_cartorio],
    ["endereço do imóvel do fiador", c.fia_imovel_endereco],
    ["endereço do imóvel", c.imovel_endereco],
    ["vagas", v.imv_vagas],
    ["inscrição municipal", v.imv_inscricao],
    ["energia", v.imv_energia],
    ["água", v.imv_agua],
    ["gás ou cobrado no condomínio", v.imv_gas],
    ["prazo", v.prazo_meses],
    ["início", v.inicio],
    ["vencimento", v.dia_vencimento],
    ["data de emissão", c.data],
    ["local", c.local],
    ["administradora", m.administradora.nome],
    ["CNPJ da administradora", m.administradora.cnpj],
  ]
    .filter(([, val]) => !String(val ?? "").trim())
    .map(([label]) => label);
  for (const p of ["prop", "fia"]) {
    if (/casad/i.test(v[`${p}_estado_civil`] || "")) {
      if (!v[`${p}_conj_nome`]?.trim() || !v[`${p}_conj_cpf`]?.trim()) faltas.push(`cônjuge ${p}`);
    }
  }
  const aluguel = Number(c.aluguel);
  if (!Number.isFinite(aluguel) || aluguel <= 0 || aluguel >= 10000000)
    faltas.push("aluguel válido");
  if (!/^([1-9]|1[0-9]|2[0-8])$/.test(v.dia_vencimento || ""))
    faltas.push("dia de vencimento inválido");
  if (!/^[1-9][0-9]{0,2}$/.test(v.prazo_meses || "") || Number(v.prazo_meses) > 240)
    faltas.push("prazo inválido");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.inicio || "") || !fimPrazo(v.inicio, Number(v.prazo_meses)))
    faltas.push("início inválido");
  if (c.fim && c.fim !== fimPrazo(v.inicio, Number(v.prazo_meses)))
    faltas.push("término divergente do prazo");
  if (
    c.juros !== "1% ao mês" ||
    c.multa !== "10%" ||
    c.reajuste !== "Anual — IPCA" ||
    c.cobranca !== "mes_vencido" ||
    c.isencao_multa_meses
  )
    faltas.push("condições diferentes do modelo residencial (revisão jurídica necessária)");
  return faltas;
}

export function textoContrato(base: LocacaoBase, m: Montagem, c: Record<string, string>): string[] {
  const faltas = faltasMontagem(base, m, c);
  if (base.tipo !== "residencial" || base.garantia !== "fiador" || faltas.length)
    throw new Error(`Contrato incompleto: ${faltas.join(", ")}`);
  const v = dadosContrato(m, c);
  const dia = v.dia_vencimento;
  const aluguel = Number(c.aluguel);
  const replace = (s: string) =>
    s
      .replace("{{fia_imovel_endereco}}", c.fia_imovel_endereco)
      .replace("{{fia_matricula}}", v.fia_matricula)
      .replace("{{fia_cartorio}}", v.fia_cartorio);
  return [
    "CONTRATO DE LOCAÇÃO - RESIDENCIAL",
    "Contrato de Garantia: FIADOR",
    `Nº ${c.numero}`,
    "QUADRO RESUMO:",
    "Administradora; Imóvel; Destinação da Locação; Prazo da Locação; Valor e Vencimento do Aluguel; Reajuste e Encargos Locatícios; Contas de Consumo; Transferência de Titularidade; Garantia Locatícia; Vistoria Inicial; Conservação do Imóvel; Benfeitorias; Vistoria Final; Rescisão e Multa; Disposições Gerais.",
    `LOCADOR (A): ${nome(v, "prop")}${conj(v, "prop")}${c.locadores_adicionais ? `; ${c.locadores_adicionais}` : ""}.`,
    `LOCATÁRIO (A): ${nome(v, "loc")}${c.locatarios_adicionais ? `; ${c.locatarios_adicionais}` : ""}.`,
    `ADMINISTRADORA: ${m.administradora.nome} - ${docLabel("CNPJ", m.administradora.cnpj)}${m.administradora.creci ? ` - ${docLabel("CRECI", m.administradora.creci)}` : ""}.`,
    `GARANTIA LOCATÍCIA - FIADOR: ${nome(v, "fia")}${conj(v, "fia")}.`,
    ...clausulas.slice(0, 8).map(replace),
    `OBJETO DA LOCAÇÃO: ${c.imovel_endereco} — Vagas:\u00a0${(v.imv_vagas || "").replace(/ /g, "\u00a0")}.`,
    `Inscrição Cadastral Municipal: ${v.imv_inscricao}`,
    `Código de fornecimento de energia: ${v.imv_energia}`,
    `Código de Fornecimento de água: ${v.imv_agua}`,
    `Gás: ${v.imv_gas}`,
    ...clausulas.slice(8, 10),
    `PRAZO DA LOCAÇÃO: ${v.prazo_meses} meses.`,
    `Início: ${dataLonga(v.inicio)}            Término: ${dataLonga(c.fim || fimPrazo(v.inicio, Number(v.prazo_meses)))}`,
    `Cláusula 1º - O aluguel mensal ajustado é de R$ ${aluguel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (${reaisExtenso(aluguel)}), devendo ser pago pelo LOCATÁRIO até o dia ${dia} de cada mês, conforme as condições estabelecidas neste instrumento.`,
    `Cláusula 2º - O primeiro aluguel vencerá 30 (trinta) dias após a efetiva entrega das chaves ao LOCATÁRIO. Os aluguéis subsequentes vencerão todo dia ${dia} de cada mês, observando-se, quando necessário, o cálculo proporcional dos períodos de ocupação, a fim de evitar cobrança em duplicidade.`,
    ...(v.moradores ? [`CLÁUSULAS ADICIONAIS: MORADORES: ${v.moradores}`] : []),
    ...clausulas.slice(10).map(replace),
    ...(c.clausulas_adicionais
      ? [`CLÁUSULAS ADICIONAIS A CONFERIR: ${c.clausulas_adicionais}`]
      : []),
    `${c.local}, ${dataLonga(c.data)}.`,
    "LOCADOR:",
    v.prop_nome,
    v.prop_cpf,
    ...(v.prop_conj_nome ? [v.prop_conj_nome, v.prop_conj_cpf] : []),
    ...(c.locadores_adicionais ? [c.locadores_adicionais] : []),
    "LOCATÁRIO:",
    v.loc_nome,
    v.loc_cpf,
    ...(c.locatarios_adicionais ? [c.locatarios_adicionais] : []),
    "FIADOR:",
    v.fia_nome,
    v.fia_cpf,
    ...(v.fia_conj_nome ? [v.fia_conj_nome, v.fia_conj_cpf] : []),
    "ADMINISTRADORA:",
    m.administradora.nome,
    docLabel("CNPJ", m.administradora.cnpj),
    ...(c.assinaturas ? [c.assinaturas] : []),
  ];
}
