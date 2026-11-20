import clausulas from "./locacao-clausulas.json";
import {
  SEGURADORAS,
  lerModelo,
  modelosDaGarantia,
  type ChaveModelo,
  type ModeloContrato,
  type ParagrafoModelo,
} from "./locacao-modelos";
import {
  aplicarPapeis,
  flexionarQualificacao,
  linhasPessoas,
  parseSexos,
  pessoasFiador,
  pessoasLocador,
  pessoasLocatario,
  sexoOk,
  termoPapel,
} from "./locacao-concordancia";
export { gerarPdfContrato, type OpcoesPdfContrato } from "./locacao-contrato-pdf";

export type Montagem = {
  campos: Record<string, string>;
  contrato: Record<string, string>;
  administradora: { nome: string; cnpj: string; creci: string; cidade: string; uf: string };
  /** Modelos vigentes da imobiliária que servem para a garantia da locação (chave → modelo). */
  modelos?: Record<string, unknown>;
  /** Nº da apólice anexada na locação (seguro-fiança), se houver. */
  apolice?: string | null;
};
export type LocacaoBase = {
  codigo: string;
  endereco: string;
  aluguel: number;
  taxaAdm: number;
  tipo: string;
  garantia: string;
  ficha: {
    imovelId: string;
    /** Bloco/apto (t_8f09d406): entra no endereço do imóvel do contrato. */
    complemento?: string;
    /** "Cláusulas adicionais e tratativas" da ficha (t_a0736d87): pré-preenche clausulas_adicionais. */
    observacoes?: string;
    locatarioEndereco?: string;
    proprietario?: { nome: string };
    locatarioPessoa?: "pf" | "pj";
    proprietarioPessoa?: "pf" | "pj";
    fiadorPessoa?: "pf" | "pj";
  };
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
  cau_tipo: 5,
  // Campos por garantia (t_d08cfeee): o corretor preenche nos dados do contrato; a Larissa confere aqui.
  seg_seguradora: 5,
  seg_apolice: 5,
  cau_valor: 5,
  cau_meses: 5,
  cau_forma: 5,
  cau_favorecido: 5,
  cauc_nome: 5,
  cauc_cpf: 5,
  cauc_rg: 5,
  cauc_nacionalidade: 5,
  cauc_estado_civil: 5,
  cauc_profissao: 5,
  cauc_endereco: 5,
  cauc_imovel_descricao: 5,
  cauc_imovel_matricula: 5,
  cauc_imovel_cartorio: 5,
  loft_numero: 5,
} as const;

/** Campos de garantia exibidos na montagem só para o modelo correspondente. */
export const CAMPOS_GARANTIA: Record<string, string[]> = {
  fiador: [
    "fia_nome",
    "fia_cpf",
    "fia_rg",
    "fia_nacionalidade",
    "fia_estado_civil",
    "fia_profissao",
    "fia_endereco",
    "fia_conj_nome",
    "fia_conj_cpf",
    "fia_matricula",
    "fia_cartorio",
  ],
  caucao_dinheiro: ["cau_tipo", "cau_valor", "cau_meses", "cau_forma", "cau_favorecido"],
  caucao_imovel: [
    "cau_tipo",
    "cauc_nome",
    "cauc_cpf",
    "cauc_rg",
    "cauc_nacionalidade",
    "cauc_estado_civil",
    "cauc_profissao",
    "cauc_endereco",
    "cauc_imovel_descricao",
    "cauc_imovel_matricula",
    "cauc_imovel_cartorio",
  ],
  seguro: ["seg_seguradora", "seg_apolice"],
  loft: ["loft_numero"],
};
export const grupoGarantia = (chave: string) => (chave.startsWith("seguro_") ? "seguro" : chave);

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
  locadores_adicionais_sexo: { label: "Sexo dos outros locadores", passo: 0 },
  locatarios_adicionais: {
    label: "Outros locatários (qualificação completa, um por linha)",
    passo: 2,
  },
  locatarios_adicionais_sexo: { label: "Sexo dos outros locatários", passo: 2 },
  prop_sexo: { label: "Sexo do locador", passo: 0, opcoes: ["masculino", "feminino"] },
  prop_conj_sexo: {
    label: "Sexo do cônjuge do locador",
    passo: 0,
    opcoes: ["masculino", "feminino"],
  },
  loc_sexo: { label: "Sexo do locatário", passo: 2, opcoes: ["masculino", "feminino"] },
  fia_sexo: { label: "Sexo do fiador", passo: 5, opcoes: ["masculino", "feminino"] },
  fia_conj_sexo: {
    label: "Sexo do cônjuge do fiador",
    passo: 5,
    opcoes: ["masculino", "feminino"],
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
  const r: Record<string, string> = {
    ...c,
    ...d,
    numero: base.codigo,
    imovel_endereco: base.ficha.complemento?.trim()
      ? `${base.endereco}, ${base.ficha.complemento.trim()}`
      : base.endereco,
    aluguel: base.aluguel ? base.aluguel.toFixed(2) : "",
    d_prop_nome: m.contrato.prop_nome || base.ficha.proprietario?.nome || "",
    d_loc_endereco: m.contrato.loc_endereco || base.ficha.locatarioEndereco || "",
    repasse_taxa: String(base.taxaAdm),
    local: `${m.administradora.cidade ?? ""}/${m.administradora.uf ?? ""}`,
    ...m.campos,
  };
  // t_a0736d87: as cláusulas combinadas na ficha chegam ao setor de contratos só quando o campo está vazio; o que já
  // foi digitado/salvo na montagem nunca é trocado e continua editável.
  const obs = (base.ficha.observacoes ?? "").trim();
  if (obs && !(r.clausulas_adicionais ?? "").trim()) r.clausulas_adicionais = obs;
  return r;
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
const nome = (v: Record<string, string>, prefixo: string, feminino: boolean | null) => {
  const nac = v[`${prefixo}_nacionalidade`] || "";
  const civil = v[`${prefixo}_estado_civil`] || "";
  return `${v[`${prefixo}_nome`] || ""}, ${feminino == null ? nac : flexionarQualificacao(nac, feminino)}, ${feminino == null ? civil : flexionarQualificacao(civil, feminino)}, ${v[`${prefixo}_profissao`] || ""}, ${docLabel("RG", v[`${prefixo}_rg`] || "")}, ${docLabel("CPF", v[`${prefixo}_cpf`] || "")}, residente em ${v[`${prefixo}_endereco`] || ""}`;
};
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

export function chaveModeloLocacao(
  base: LocacaoBase,
  v: Record<string, string>,
): ChaveModelo | null {
  if (base.garantia === "fiador") return "fiador";
  if (base.garantia === "loft") return "loft";
  if (base.garantia === "outras") return v.cau_tipo === "imovel" ? "caucao_imovel" : null;
  if (base.garantia === "caucao") {
    if (v.cau_tipo === "dinheiro") return "caucao_dinheiro";
    if (v.cau_tipo === "imovel") return "caucao_imovel";
  }
  if (base.garantia === "seguro_fianca" && SEGURADORAS[v.seg_seguradora])
    return `seguro_${v.seg_seguradora}` as ChaveModelo;
  return null;
}

export function modeloDaMontagem(
  base: LocacaoBase,
  m: Montagem,
  c: Record<string, string>,
): ModeloContrato | null {
  const chave = chaveModeloLocacao(base, dadosContrato(m, c));
  if (!chave || !modelosDaGarantia(base.garantia).includes(chave)) return null;
  // Não confundir um padrão embarcado com a versão vigente da imobiliária: o banco decide qual vale.
  return lerModelo(m.modelos?.[chave]);
}

export function faltasMontagem(
  base: LocacaoBase,
  m: Montagem,
  c: Record<string, string>,
): string[] {
  const v = dadosContrato(m, c);
  const chave = chaveModeloLocacao(base, v);
  const comFiador = base.garantia === "fiador";
  const faltas = [
    ["número", c.numero],
    ["locador", v.prop_nome],
    ["locatário", v.loc_nome],
    ...(comFiador ? [["fiador", v.fia_nome]] : []),
    ...(["prop", "loc", ...(comFiador ? ["fia"] : [])] as const).flatMap((p) =>
      ["cpf", "rg", "nacionalidade", "estado_civil", "profissao", "endereco"].map((key) => [
        `${key} ${p}`,
        v[`${p}_${key}`],
      ]),
    ),
    ...(comFiador
      ? [
          ["matrícula do fiador", v.fia_matricula],
          ["cartório do fiador", v.fia_cartorio],
          ["endereço do imóvel do fiador", c.fia_imovel_endereco],
        ]
      : []),
    ...(base.garantia === "seguro_fianca" ? [["seguradora", v.seg_seguradora]] : []),
    ...(base.garantia === "caucao" || base.garantia === "outras"
      ? [["tipo de caução", v.cau_tipo]]
      : []),
    ...(chave === "caucao_dinheiro"
      ? [
          ["valor da caução", v.cau_valor],
          ["número de aluguéis da caução", v.cau_meses],
          ["forma de depósito", v.cau_forma],
          ["quem guarda a caução", v.cau_favorecido],
        ]
      : []),
    ...(chave === "caucao_imovel"
      ? [
          ...["nome", "cpf", "rg", "nacionalidade", "estado_civil", "profissao", "endereco"].map(
            (k) => [`${k} do caucionante`, v[`cauc_${k}`]],
          ),
          ["descrição do imóvel caucionado", v.cauc_imovel_descricao],
          ["matrícula do imóvel caucionado", v.cauc_imovel_matricula],
          ["cartório do imóvel caucionado", v.cauc_imovel_cartorio],
        ]
      : []),
    ...(chave === "loft" ? [["número da garantia Loft", v.loft_numero]] : []),
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
  for (const p of comFiador ? ["prop", "fia"] : ["prop"]) {
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
    !m.modelos &&
    (c.juros !== "1% ao mês" ||
      c.multa !== "10%" ||
      c.reajuste !== "Anual — IPCA" ||
      c.cobranca !== "mes_vencido" ||
      c.isencao_multa_meses)
  )
    faltas.push("condições diferentes do modelo residencial (revisão jurídica necessária)");
  if (m.modelos && !chave) faltas.push("escolha o modelo da garantia");
  else if (m.modelos && !modeloDaMontagem(base, m, c))
    faltas.push("modelo não disponível nesta imobiliária");
  if (chave === "caucao_dinheiro") {
    if (Number(v.cau_valor) > Number(c.aluguel) * 3) faltas.push("caução acima de três aluguéis");
    if (Number(v.cau_meses) > 3 || Number(v.cau_meses) < 1)
      faltas.push("número de aluguéis da caução inválido");
  }
  const pjProp = base.ficha.proprietarioPessoa === "pj";
  const pjLoc = base.ficha.locatarioPessoa === "pj";
  const pjFia = base.ficha.fiadorPessoa === "pj";
  if (!pjProp && !sexoOk(c.prop_sexo)) faltas.push("sexo do locador");
  if (!pjLoc && !sexoOk(c.loc_sexo)) faltas.push("sexo do locatário");
  if (comFiador && !pjFia && !sexoOk(c.fia_sexo)) faltas.push("sexo do fiador");
  if (!pjProp && v.prop_conj_nome?.trim() && !sexoOk(c.prop_conj_sexo))
    faltas.push("sexo do cônjuge do locador");
  if (comFiador && !pjFia && v.fia_conj_nome?.trim() && !sexoOk(c.fia_conj_sexo))
    faltas.push("sexo do cônjuge do fiador");
  const extraLoc = linhasPessoas(c.locadores_adicionais);
  const sexoLoc = parseSexos(c.locadores_adicionais_sexo);
  if (extraLoc.some((_, i) => !sexoOk(sexoLoc[i]))) faltas.push("sexo dos locadores adicionais");
  const extraLocat = linhasPessoas(c.locatarios_adicionais);
  const sexoLocat = parseSexos(c.locatarios_adicionais_sexo);
  if (extraLocat.some((_, i) => !sexoOk(sexoLocat[i])))
    faltas.push("sexo dos locatários adicionais");
  return faltas;
}

export function textoContrato(base: LocacaoBase, m: Montagem, c: Record<string, string>): string[] {
  const faltas = faltasMontagem(base, m, c);
  if (m.modelos) {
    if (faltas.length) throw new Error(`Contrato incompleto: ${faltas.join(", ")}`);
    const modelo = modeloDaMontagem(base, m, c);
    if (!modelo) throw new Error("Modelo de contrato não disponível para esta garantia.");
    return montarTextoModelo(base, m, c, modelo);
  }
  if (base.tipo !== "residencial" || base.garantia !== "fiador" || faltas.length)
    throw new Error(`Contrato incompleto: ${faltas.join(", ")}`);
  const v = dadosContrato(m, c);
  const dia = v.dia_vencimento;
  const aluguel = Number(c.aluguel);
  const pjProp = base.ficha.proprietarioPessoa === "pj";
  const pjLoc = base.ficha.locatarioPessoa === "pj";
  const pjFia = base.ficha.fiadorPessoa === "pj";
  const tLocador = termoPapel("locador", pessoasLocador(pjProp, c, v));
  const tLocatario = termoPapel("locatario", pessoasLocatario(pjLoc, c));
  const tFiador = termoPapel("fiador", pessoasFiador(pjFia, c, v));
  const femProp = pjProp ? null : c.prop_sexo === "feminino";
  const femLoc = pjLoc ? null : c.loc_sexo === "feminino";
  const femFia = pjFia ? null : c.fia_sexo === "feminino";
  const replace = (s: string) =>
    aplicarPapeis(
      s
        .replace("{{fia_imovel_endereco}}", c.fia_imovel_endereco)
        .replace("{{fia_matricula}}", v.fia_matricula)
        .replace("{{fia_cartorio}}", v.fia_cartorio),
      tLocador,
      tLocatario,
      tFiador,
    );
  return [
    "CONTRATO DE LOCAÇÃO - RESIDENCIAL",
    "Contrato de Garantia: FIADOR",
    `Nº ${c.numero}`,
    "QUADRO RESUMO:",
    "Administradora; Imóvel; Destinação da Locação; Prazo da Locação; Valor e Vencimento do Aluguel; Reajuste e Encargos Locatícios; Contas de Consumo; Transferência de Titularidade; Garantia Locatícia; Vistoria Inicial; Conservação do Imóvel; Benfeitorias; Vistoria Final; Rescisão e Multa; Disposições Gerais.",
    `${tLocador}: ${nome(v, "prop", femProp)}${conj(v, "prop")}${c.locadores_adicionais ? `; ${c.locadores_adicionais}` : ""}.`,
    `${tLocatario}: ${nome(v, "loc", femLoc)}${c.locatarios_adicionais ? `; ${c.locatarios_adicionais}` : ""}.`,
    `ADMINISTRADORA: ${m.administradora.nome} - ${docLabel("CNPJ", m.administradora.cnpj)}${m.administradora.creci ? ` - ${docLabel("CRECI", m.administradora.creci)}` : ""}.`,
    `GARANTIA LOCATÍCIA - ${tFiador}: ${nome(v, "fia", femFia)}${conj(v, "fia")}.`,
    ...clausulas.slice(0, 8).map(replace),
    `OBJETO DA LOCAÇÃO: ${c.imovel_endereco} — Vagas:\u00a0${(v.imv_vagas || "").replace(/ /g, "\u00a0")}.`,
    `Inscrição Cadastral Municipal: ${v.imv_inscricao}`,
    `Código de fornecimento de energia: ${v.imv_energia}`,
    `Código de Fornecimento de água: ${v.imv_agua}`,
    `Gás: ${v.imv_gas}`,
    ...clausulas.slice(8, 10).map(replace),
    `PRAZO DA LOCAÇÃO: ${v.prazo_meses} meses.`,
    `Início: ${dataLonga(v.inicio)}            Término: ${dataLonga(c.fim || fimPrazo(v.inicio, Number(v.prazo_meses)))}`,
    replace(
      `Cláusula 1º - O aluguel mensal ajustado é de R$ ${aluguel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (${reaisExtenso(aluguel)}), devendo ser pago pelo LOCATÁRIO até o dia ${dia} de cada mês, conforme as condições estabelecidas neste instrumento.`,
    ),
    replace(
      `Cláusula 2º - O primeiro aluguel vencerá 30 (trinta) dias após a efetiva entrega das chaves ao LOCATÁRIO. Os aluguéis subsequentes vencerão todo dia ${dia} de cada mês, observando-se, quando necessário, o cálculo proporcional dos períodos de ocupação, a fim de evitar cobrança em duplicidade.`,
    ),
    ...(v.moradores ? [`CLÁUSULAS ADICIONAIS: MORADORES: ${v.moradores}`] : []),
    ...clausulas.slice(10).map(replace),
    ...(c.clausulas_adicionais
      ? [`CLÁUSULAS ADICIONAIS A CONFERIR: ${c.clausulas_adicionais}`]
      : []),
    `${c.local}, ${dataLonga(c.data)}.`,
    `${tLocador}:`,
    v.prop_nome,
    v.prop_cpf,
    ...(v.prop_conj_nome ? [v.prop_conj_nome, v.prop_conj_cpf] : []),
    ...(c.locadores_adicionais ? [c.locadores_adicionais] : []),
    `${tLocatario}:`,
    v.loc_nome,
    v.loc_cpf,
    ...(c.locatarios_adicionais ? [c.locatarios_adicionais] : []),
    `${tFiador}:`,
    v.fia_nome,
    v.fia_cpf,
    ...(v.fia_conj_nome ? [v.fia_conj_nome, v.fia_conj_cpf] : []),
    "ADMINISTRADORA:",
    m.administradora.nome,
    docLabel("CNPJ", m.administradora.cnpj),
    ...(c.assinaturas ? [c.assinaturas] : []),
  ];
}

/** Renderiza o texto vigente retornado pelo banco; não altera cláusulas marcadas como exigidas. */
export function montarTextoModelo(
  base: LocacaoBase,
  m: Montagem,
  c: Record<string, string>,
  modelo: ModeloContrato,
): string[] {
  if (!modelosDaGarantia(base.garantia).includes(modelo.chave))
    throw new Error("Modelo de garantia diferente da locação.");
  const v = dadosContrato(m, c);
  const aluguel = Number(c.aluguel);
  const valor = (n: number) =>
    n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pfProp = base.ficha.proprietarioPessoa !== "pj";
  const pfLoc = base.ficha.locatarioPessoa !== "pj";
  const pfFia = base.ficha.fiadorPessoa !== "pj";
  const tLocador = termoPapel("locador", pessoasLocador(!pfProp, c, v));
  const tLocatario = termoPapel("locatario", pessoasLocatario(!pfLoc, c));
  const tFiador = termoPapel("fiador", pessoasFiador(!pfFia, c, v));
  const fProp = pfProp ? c.prop_sexo === "feminino" : null;
  const fLoc = pfLoc ? c.loc_sexo === "feminino" : null;
  const fFia = pfFia ? c.fia_sexo === "feminino" : null;
  const apolice = v.seg_apolice || m.apolice || "";
  const campos: Record<string, string> = {
    NUMERO_CONTRATO: c.numero,
    NOME_LOCADOR: v.prop_nome,
    NOME_LOCATARIO: v.loc_nome,
    NOME_FIADOR: v.fia_nome,
    IMOVEL_ENDERECO: c.imovel_endereco,
    VALOR_ALUGUEL: valor(aluguel),
    VALOR_ALUGUEL_EXTENSO: reaisExtenso(aluguel),
    DIA_VENCIMENTO: v.dia_vencimento,
    PRAZO_MESES: v.prazo_meses,
    DATA_INICIO: dataLonga(v.inicio),
    DATA_TERMINO: dataLonga(c.fim || fimPrazo(v.inicio, Number(v.prazo_meses))),
    CIDADE: c.local,
    ADMINISTRADORA_QUALIFICACAO: `${m.administradora.nome} - ${docLabel("CNPJ", m.administradora.cnpj)}${m.administradora.creci ? ` - ${docLabel("CRECI", m.administradora.creci)}` : ""}`,
    FIADOR_IMOVEL_ENDERECO: c.fia_imovel_endereco,
    FIADOR_MATRICULA: v.fia_matricula,
    FIADOR_CARTORIO: v.fia_cartorio,
    CAUCAO_VALOR: valor(Number(v.cau_valor)),
    CAUCAO_VALOR_EXTENSO: reaisExtenso(Number(v.cau_valor || 0)),
    CAUCAO_MESES: v.cau_meses,
    CAUCAO_FORMA: v.cau_forma,
    CAUCAO_FAVORECIDO: v.cau_favorecido,
    CAUCIONANTE_QUALIFICACAO: nome(v, "cauc", null),
    CAUCAO_IMOVEL_DESCRICAO: v.cauc_imovel_descricao,
    CAUCAO_IMOVEL_CARTORIO: v.cauc_imovel_cartorio,
    CAUCAO_IMOVEL_MATRICULA: v.cauc_imovel_matricula,
    SEGURADORA: SEGURADORAS[v.seg_seguradora] || "",
    APOLICE_NUMERO: apolice || "a ser anexada",
    APOLICE_REFERENCIA: apolice ? `nº ${apolice}, conforme anexo` : "a ser anexada",
    LOFT_REFERENCIA: v.loft_numero ? `nº ${v.loft_numero}, conforme anexo` : "a ser anexado",
  };
  const assinaturas = [
    `${c.local}, ${dataLonga(c.data)}.`,
    `${tLocador}:`,
    v.prop_nome,
    v.prop_cpf,
    ...(v.prop_conj_nome ? [v.prop_conj_nome, v.prop_conj_cpf] : []),
    ...(c.locadores_adicionais ? [c.locadores_adicionais] : []),
    `${tLocatario}:`,
    v.loc_nome,
    v.loc_cpf,
    ...(c.locatarios_adicionais ? [c.locatarios_adicionais] : []),
    ...(modelo.chave === "fiador"
      ? [
          `${tFiador}:`,
          v.fia_nome,
          v.fia_cpf,
          ...(v.fia_conj_nome ? [v.fia_conj_nome, v.fia_conj_cpf] : []),
        ]
      : []),
    ...(modelo.chave === "caucao_imovel" ? ["CAUCIONANTE:", v.cauc_nome, v.cauc_cpf] : []),
    "ADMINISTRADORA:",
    m.administradora.nome,
    docLabel("CNPJ", m.administradora.cnpj),
    ...(c.assinaturas ? [c.assinaturas] : []),
  ];
  const blocos: Record<string, string[]> = {
    LOCADOR: [
      `${tLocador}: ${nome(v, "prop", fProp)}${conj(v, "prop")}${c.locadores_adicionais ? `; ${c.locadores_adicionais}` : ""}.`,
    ],
    LOCATARIO: [
      `${tLocatario}: ${nome(v, "loc", fLoc)}${c.locatarios_adicionais ? `; ${c.locatarios_adicionais}` : ""}.`,
    ],
    FIADOR: [`GARANTIA LOCATÍCIA - ${tFiador}: ${nome(v, "fia", fFia)}${conj(v, "fia")}.`],
    OBJETO: [
      `OBJETO DA LOCAÇÃO: ${c.imovel_endereco} — Vagas: ${v.imv_vagas}.`,
      `Inscrição Cadastral Municipal: ${v.imv_inscricao}`,
      `Código de fornecimento de energia: ${v.imv_energia}`,
      `Código de Fornecimento de água: ${v.imv_agua}`,
      `Gás: ${v.imv_gas}`,
    ],
    PRAZO: [
      `PRAZO DA LOCAÇÃO: ${v.prazo_meses} meses.`,
      `Início: ${dataLonga(v.inicio)}            Término: ${campos.DATA_TERMINO}`,
    ],
    ADICIONAIS: v.moradores ? [`CLÁUSULAS ADICIONAIS: MORADORES: ${v.moradores}`] : [],
    ASSINATURAS: assinaturas,
  };
  const visiveis = modelo.paragrafos.filter(
    (p) =>
      (!p.dest || p.dest === base.tipo) &&
      (!p.cond || (p.cond === "isencao_multa" && c.isencao_multa_meses === "12")),
  );
  // O número corrente é calculado sobre os textos visíveis; referências a cláusulas originais
  // seguem a primeira ocorrência correspondente. O texto exigido pela seguradora nunca é reescrito.
  let seq = 0;
  const numeradas = new Map<string, number>();
  const numeroPorId = new Map<string, number>();
  for (const p of visiveis) {
    const achado = /^Cláusula\s+(\d+)º\s*[-–]/i.exec(p.t);
    if (achado && !p.trava) {
      seq++;
      numeroPorId.set(p.id, seq);
      if (!numeradas.has(achado[1])) numeradas.set(achado[1], seq);
    }
  }
  const render = (p: ParagrafoModelo): string[] => {
    const bloco = /^\[\[([A-Z_]+)\]\]$/.exec(p.t.trim());
    if (bloco) {
      if (!blocos[bloco[1]]) throw new Error(`Bloco desconhecido: ${bloco[1]}`);
      return blocos[bloco[1]];
    }
    if (p.trava) return [p.t];
    let t = p.t.replace(/\[([A-Z_]+)\]/g, (_, k: string) => {
      if (!(k in campos)) throw new Error(`Campo desconhecido no modelo: [${k}]`);
      return campos[k];
    });
    t = aplicarPapeis(t, tLocador, tLocatario, tFiador);
    t = t.replace(/CLÁUSULA\s+(\d+)º/gi, (original, n: string) =>
      numeradas.has(n) ? original.replace(n, String(numeradas.get(n))) : original,
    );
    const n = numeroPorId.get(p.id);
    if (n) t = t.replace(/^Cláusula\s+\d+º/i, `Cláusula ${n}º`);
    return [t];
  };
  return [
    `CONTRATO DE LOCAÇÃO - ${base.tipo === "comercial" ? "COMERCIAL" : "RESIDENCIAL"}`,
    `Contrato de Garantia: ${modelo.subtitulo}`,
    `Nº ${c.numero}`,
    ...visiveis.flatMap(render),
    ...(c.clausulas_adicionais
      ? [`CLÁUSULAS ADICIONAIS A CONFERIR: ${c.clausulas_adicionais}`]
      : []),
  ];
}
