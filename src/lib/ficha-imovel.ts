// Ficha do imóvel (pedido de Denis em 08/10/2026, tópico 6238): os MESMOS campos do Estudo de Mercado
// (repo estudodemercadomax, src/routes/app.novo-estudo.tsx) na venda e na captação, para a integração
// ser direta. O estudo calcula o preço por m² pela ÁREA ÚTIL (no terreno, pela área total).
//
// Módulo sem imports de propósito: é usado pela tela, pelos testes e pelo script de preenchimento das
// vendas antigas (scripts/ficha-imovel-backfill.ts, rodado com `node`).

/** Mesma lista e mesma ordem do Estudo de Mercado. */
export const TIPOS_IMOVEL = [
  "Apartamento",
  "Casa",
  "Terreno",
  "Comercial",
  "Cobertura",
  "Studio",
] as const;
export type TipoImovel = (typeof TIPOS_IMOVEL)[number];

/** Tipos residenciais: exigem quartos, banheiros e vagas para enviar a venda ao gestor. */
export const TIPOS_RESIDENCIAIS: readonly TipoImovel[] = ["Apartamento", "Casa", "Cobertura", "Studio"];
/** Unidade em condomínio vertical: a área útil é a PRIVATIVA da matrícula; a "área do terreno" do IPTU
 * é fração ideal e nunca vale como terreno. */
export const TIPOS_UNIDADE_CONDOMINIO: readonly TipoImovel[] = ["Apartamento", "Cobertura", "Studio"];

export function isTipoImovel(v: unknown): v is TipoImovel {
  return typeof v === "string" && (TIPOS_IMOVEL as readonly string[]).includes(v);
}
export const isResidencial = (t: string | null | undefined) =>
  isTipoImovel(t) && TIPOS_RESIDENCIAIS.includes(t);
export const isUnidadeCondominio = (t: string | null | undefined) =>
  isTipoImovel(t) && TIPOS_UNIDADE_CONDOMINIO.includes(t);

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * Texto livre ("APARTAMENTO", "casa em condomínio", "sala comercial", "lote") → tipo da lista.
 * Ambíguo ("Residencial", "Predial") ou vazio → null (o corretor escolhe).
 */
export function tipoImovelDoTexto(texto: string | null | undefined): TipoImovel | null {
  const t = semAcento(String(texto ?? "")).trim();
  if (!t) return null;
  if (/\bcobertura\b/.test(t)) return "Cobertura";
  if (/\b(studio|estudio|kitnet|kitinete|kitchenette|quitinete|kit)\b/.test(t)) return "Studio";
  if (/\b(apartamento|apto|ap)\b/.test(t)) return "Apartamento";
  if (/\b(sala|loja|escritorio|comercial|galpao|barracao|ponto comercial|consultorio)\b/.test(t))
    return "Comercial";
  if (/\b(casa|sobrado|residencia|chacara|edicula)\b/.test(t)) return "Casa";
  if (/\b(terreno|lote|gleba)\b/.test(t)) return "Terreno";
  return null;
}

/**
 * Converte área escrita de vários jeitos em número (m², 2 casas):
 * "52,23" → 52.23 · "250,00 metros quadrados" → 250 · "198.78400000 m2" → 198.78 ·
 * "16.312,09" → 16312.09 · "1.250 m²" → 1250 · "21,58842064 m2" → 21.59.
 * Zero, negativo, sem número ou absurdo (> 10 milhões) → null.
 */
export function areaM2DoTexto(texto: unknown): number | null {
  if (typeof texto === "number") return Number.isFinite(texto) && texto > 0 && texto < 1e7
    ? Math.round(texto * 100) / 100
    : null;
  if (typeof texto !== "string") return null;
  const m = texto.match(/\d[\d.,]*/);
  if (!m) return null;
  let s = m[0].replace(/[.,]+$/, "");
  const temPonto = s.includes(".");
  const temVirgula = s.includes(",");
  if (temPonto && temVirgula) {
    // O último separador é o decimal; o outro é milhar.
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const mil = dec === "," ? "." : ",";
    s = s.split(mil).join("").replace(dec, ".");
  } else if (temVirgula) {
    const partes = s.split(",");
    // "1,250,000" (milhar em inglês) é raro; com uma vírgula só, é decimal.
    s = partes.length > 2 ? partes.join("") : partes.join(".");
  } else if (temPonto) {
    const partes = s.split(".");
    // Ponto único seguido de exatamente 3 dígitos = milhar ("1.250"); senão decimal ("198.784", com 8).
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) s = partes.join("");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n >= 1e7) return null;
  return Math.round(n * 100) / 100;
}

/** Inteiro pequeno (quartos, suítes, banheiros, vagas): "2", "02", "3 quartos" → número; vazio → null. */
export function inteiroDoTexto(texto: unknown, max = 99): number | null {
  if (typeof texto === "number")
    return Number.isInteger(texto) && texto >= 0 && texto <= max ? texto : null;
  if (typeof texto !== "string") return null;
  const m = texto.trim().match(/^\d{1,4}/);
  if (!m) return null;
  const n = Number(m[0]);
  return n <= max ? n : null;
}

/** Ano de construção plausível (1800 até o ano que vem). */
export function anoConstrucaoDoTexto(texto: unknown, hoje = new Date()): number | null {
  const n = inteiroDoTexto(texto, 9999);
  return n != null && n >= 1800 && n <= hoje.getFullYear() + 1 ? n : null;
}

/** "Área privativa de 54,80 m²" no texto da matrícula (já gravado em observacoes_imovel). */
export function areaPrivativaDaDescricao(texto: unknown): number | null {
  if (typeof texto !== "string" || !texto) return null;
  const t = semAcento(texto);
  const m = t.match(/area\s+(?:real\s+)?privativa(?:\s+(?:total|coberta))?[^0-9]{0,40}(\d[\d.,]*)/);
  return m ? areaM2DoTexto(m[1]) : null;
}

/** Tipo citado na descrição da matrícula (o primeiro da ordem de prioridade). */
export function tipoImovelDaDescricao(texto: unknown): TipoImovel | null {
  if (typeof texto !== "string" || !texto) return null;
  const t = semAcento(texto).replace(/\s+/g, " ");
  const inicio = t.slice(0, 160);
  // Vaga/box de garagem não é tipo do Estudo: o corretor decide.
  if (/designad[ao] por (vaga|box|garagem)|^\W*(uma )?(vaga|box) de garagem|^\W*(uma )?garagem\b/.test(inicio))
    return null;
  // Unidade autônoma primeiro: "apartamento nº 12 ... do condomínio construído no lote 5".
  if (/\bcobertura\b/.test(t) && /\bapartamento\b/.test(t)) return "Cobertura";
  if (/\bapartamento\b/.test(t)) return "Apartamento";
  if (/\b(studio|kitnet|kitinete|kitchenette|quitinete)\b/.test(t)) return "Studio";
  // "sala" sozinha aparece na descrição de casa ("sala, cozinha..."): só vale o comercial explícito
  // ou a unidade autônoma que É uma sala/loja ("unidade autônoma designada por SALA nº 605").
  if (
    /\b(sala comercial|salao comercial|conjunto comercial|galpao|barracao|predio comercial)\b/.test(t) ||
    /designad[ao] por (sala|loja|conjunto)\b/.test(inicio) ||
    /^\W*(uma |a )?(sala|loja)\b/.test(inicio)
  )
    return "Comercial";
  // Condomínio horizontal: "A unidade residencial autônoma nº 29, integrante do Condomínio..." = casa.
  if (/\bunidade residencial autonoma\b|\bunidade autonoma residencial\b/.test(inicio)) return "Casa";
  // Em Sorocaba a matrícula de casa costuma dizer "um prédio residencial" ou só "um prédio".
  if (/\b(casa|sobrado|residencia|predio)\b/.test(t)) return "Casa";
  if (/\b(terreno|lote)\b/.test(t)) return "Terreno";
  return null;
}

/** Leitura (raw_json) já gravada de um documento do imóvel. */
export type ExtracaoImovel = {
  tipo: "matricula" | "iptu" | string;
  raw: Record<string, unknown> | null | undefined;
};

export type SugestaoAreas = {
  tipo_sugerido: TipoImovel | null;
  area_util_m2: number | null;
  /** De onde veio a área útil (texto para o corretor). */
  area_util_fonte: string | null;
  area_construida_m2: number | null;
  area_terreno_m2: number | null;
  /** IPTU e matrícula trazem área construída diferente (> 2%). */
  divergente: boolean;
  matricula_construida_m2: number | null;
  iptu_construida_m2: number | null;
};

const primeiro = (...v: (number | null)[]) => v.find((x) => x != null) ?? null;
/** Limite de área construída plausível para sugerir (acima disso a leitura pegou a gleba). */
export const AREA_CONSTRUIDA_MAX = 5000;

/**
 * Sugestão de áreas a partir das leituras já gravadas (sem reler nada).
 * Regras (t_8be054a9):
 *  - Apartamento/Cobertura/Studio: área útil = área PRIVATIVA da matrícula (campo area_privativa, ou
 *    o texto "área privativa" da descrição). Nunca a "área do terreno" do IPTU (é fração ideal).
 *  - Casa/Comercial: área útil = área construída (matrícula; senão IPTU), só como sugestão. Sala em
 *    condomínio com área privativa usa a privativa.
 *  - Terreno: só área do terreno (matrícula; senão IPTU). Sem área útil.
 *  - Tipo desconhecido: privativa se houver; senão nada (o corretor escolhe o tipo).
 */
export function sugerirAreas(
  extracoes: ExtracaoImovel[],
  tipoInformado?: string | null,
): SugestaoAreas {
  const mats = extracoes.filter((e) => e.tipo === "matricula" && e.raw);
  const iptus = extracoes.filter((e) => e.tipo === "iptu" && e.raw);
  const pegar = (lista: ExtracaoImovel[], f: (r: Record<string, unknown>) => number | null) =>
    primeiro(...lista.map((e) => f(e.raw as Record<string, unknown>)));

  const privativa = pegar(
    mats,
    (r) => areaM2DoTexto(r.area_privativa) ?? areaPrivativaDaDescricao(r.observacoes_imovel),
  );
  // Construída acima de 5.000 m² é leitura errada (gleba/condomínio inteiro): não sugere.
  const plausivel = (n: number | null) => (n != null && n <= AREA_CONSTRUIDA_MAX ? n : null);
  const matConstruida = pegar(mats, (r) => plausivel(areaM2DoTexto(r.area_construida)));
  const matTotal = pegar(mats, (r) => areaM2DoTexto(r.area_total));
  const iptuConstruida = pegar(iptus, (r) => plausivel(areaM2DoTexto(r.area_construida)));
  const iptuTotal = pegar(iptus, (r) => areaM2DoTexto(r.area_total));
  const tipoDescricao =
    mats.map((e) => tipoImovelDaDescricao((e.raw as Record<string, unknown>).observacoes_imovel)).find(
      Boolean,
    ) ?? null;

  // Matrícula de "terreno/lote" com área construída (matrícula ou IPTU) = casa construída no lote.
  const tipoDoc: TipoImovel | null =
    tipoDescricao === "Terreno" && (matConstruida != null || iptuConstruida != null)
      ? "Casa"
      : tipoDescricao;
  const tipo: TipoImovel | null = isTipoImovel(tipoInformado)
    ? tipoInformado
    : (tipoDoc ?? (privativa != null ? "Apartamento" : null));
  const condominio = isUnidadeCondominio(tipo);
  const divergente =
    matConstruida != null &&
    iptuConstruida != null &&
    Math.abs(matConstruida - iptuConstruida) / Math.max(matConstruida, iptuConstruida) > 0.02;

  let util: number | null = null;
  let fonte: string | null = null;
  if (tipo === "Terreno") {
    util = null;
  } else if (privativa != null) {
    util = privativa;
    fonte = "área privativa da matrícula";
  } else if (!condominio && tipo != null) {
    if (matConstruida != null) {
      util = matConstruida;
      fonte = "área construída da matrícula";
    } else if (iptuConstruida != null) {
      util = iptuConstruida;
      fonte = "área construída do IPTU";
    }
  }
  return {
    tipo_sugerido: tipo,
    area_util_m2: util,
    area_util_fonte: fonte,
    area_construida_m2: primeiro(matConstruida, iptuConstruida),
    // Unidade em condomínio: o "terreno" do IPTU/matrícula é fração ideal — não sugere.
    area_terreno_m2: condominio ? null : primeiro(matTotal, iptuTotal),
    divergente,
    matricula_construida_m2: matConstruida,
    iptu_construida_m2: iptuConstruida,
  };
}

/** Campos da ficha na venda (colunas de public.sales). */
export type FichaVenda = {
  tipo_imovel?: string | null;
  area_util_m2?: number | string | null;
  area_construida_m2?: number | string | null;
  area_terreno_m2?: number | string | null;
  ano_construcao?: number | null;
  quartos?: number | null;
  suites?: number | null;
  banheiros?: number | null;
  vagas?: number | null;
  area_origem?: string | null;
  area_confirmada_por?: string | null;
  area_confirmada_em?: string | null;
};

const positivo = (v: unknown) => v != null && v !== "" && Number(v) > 0;
const preenchido = (v: unknown) => v != null && v !== "" && Number.isFinite(Number(v));

/**
 * O que falta na ficha para enviar a venda ao gestor (mesma regra da trava do banco,
 * bloquear_avanco_sem_ficha_imovel). Lista vazia = completa.
 */
export function fichaFaltando(f: FichaVenda | null | undefined): string[] {
  const falta: string[] = [];
  const tipo = f?.tipo_imovel ?? null;
  if (!isTipoImovel(tipo)) {
    falta.push("Tipo do imóvel");
    return falta;
  }
  if (tipo === "Terreno") {
    if (!positivo(f?.area_terreno_m2)) falta.push("Área do terreno");
  } else if (!positivo(f?.area_util_m2)) falta.push("Área útil");
  if (isResidencial(tipo)) {
    if (!preenchido(f?.quartos)) falta.push("Quartos");
    if (!preenchido(f?.banheiros)) falta.push("Banheiros");
    if (!preenchido(f?.vagas)) falta.push("Vagas");
  }
  if (!falta.length && !f?.area_confirmada_em && !f?.area_confirmada_por)
    falta.push(tipo === "Terreno" ? "Confirmar a área do terreno" : "Confirmar a área útil");
  return falta;
}

export const MSG_FICHA_FALTANDO = "Complete a ficha do imóvel";
export function mensagemFichaFaltando(falta: string[]): string {
  return `${MSG_FICHA_FALTANDO} (falta: ${falta.join(", ")}). Sem ela a venda não segue para o gestor.`;
}

/** Preço por m² (só com área útil; terreno usa a área do terreno, como no estudo). */
export function precoM2(
  valor: number | string | null | undefined,
  area: number | string | null | undefined,
): number | null {
  const v = Number(valor);
  const a = Number(area);
  if (!Number.isFinite(v) || !Number.isFinite(a) || v <= 0 || a <= 0) return null;
  return Math.round(v / a);
}

/** "54,8 m²" */
export function formatarArea(a: number | string | null | undefined): string {
  const n = Number(a);
  if (a == null || a === "" || !Number.isFinite(n)) return "";
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`;
}

/** Ficha guardada na captação (form_data.ficha): texto, como o resto do formulário. */
export type FichaCaptacao = {
  area_util_m2: string;
  area_construida_m2: string;
  area_terreno_m2: string;
  ano_construcao: string;
  quartos: string;
  suites: string;
  banheiros: string;
  vagas: string;
};
export const FICHA_CAPTACAO_CAMPOS: { key: keyof FichaCaptacao; label: string; area?: boolean }[] = [
  { key: "area_util_m2", label: "Área útil (m²)", area: true },
  { key: "area_construida_m2", label: "Área construída (m²)", area: true },
  { key: "area_terreno_m2", label: "Área do terreno (m²)", area: true },
  { key: "ano_construcao", label: "Ano de construção" },
  { key: "quartos", label: "Quartos" },
  { key: "suites", label: "Suítes" },
  { key: "banheiros", label: "Banheiros" },
  { key: "vagas", label: "Vagas" },
];
export const fichaCaptacaoVazia = (): FichaCaptacao => ({
  area_util_m2: "",
  area_construida_m2: "",
  area_terreno_m2: "",
  ano_construcao: "",
  quartos: "",
  suites: "",
  banheiros: "",
  vagas: "",
});

/** Campo da ficha que aparece para o tipo (igual ao Estudo: terreno só tem área; apartamento sem terreno). */
export function campoVisivel(campo: string, tipo: string | null | undefined): boolean {
  if (tipo === "Terreno") return campo === "area_terreno_m2";
  if (campo === "area_terreno_m2") return !isUnidadeCondominio(tipo);
  return true;
}
