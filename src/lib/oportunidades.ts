// Módulo Oportunidades (maquete aprovada por Denis em 14/10/2026, cards t_d8385376 / t_a23144bb).
// Lógica pura, sem imports: é usada pela tela, pelos alertas e pelo script de ingestão da VPS
// (scripts/oportunidades-ingest.ts roda este arquivo direto no Node).

export type OpportunityKind = "procura" | "oferta" | "outros";
export type Finalidade = "Venda" | "Locação";
export type TipoImovel = "Apartamento" | "Casa" | "Terreno" | "Comercial" | "Rural";

/** Post já limpo e estruturado, do jeito que é gravado em opportunity_posts. */
export type OpportunityPost = {
  id: string;
  kind: OpportunityKind;
  tipo: TipoImovel | null;
  finalidade: Finalidade | null;
  bairro: string | null;
  valor_min: number | null;
  valor_max: number | null;
  valor: number | null;
  corretor: string;
  texto: string;
  posted_at: string;
  /** Cadastro do autor, ligado pelo telefone na ingestão (null = não identificado). Só o servidor lê. */
  author_profile_id?: string | null;
};

/** Captação aprovada da equipe, só com o que o encaixe precisa (sem endereço nem proprietário). */
export type CaptureCandidate = {
  id: string;
  captor_id: string;
  captor_nome: string;
  tipo: TipoImovel | null;
  finalidade: Finalidade;
  bairro: string | null;
  municipio: string | null;
  valor: number | null;
};

/** Validade de um cartão no mural (dias). */
export const VALIDADE_DIAS = 7;
/** Margem aceita acima do teto do cliente (10%). */
export const MARGEM_TETO = 0.1;
/** No máximo N alertas por corretor por dia; o resto fica só no mural. */
export const LIMITE_DIARIO_ALERTAS = 3;
/** A captação do ADM não registra venda/locação: por ora todas contam como VENDA (decisão do card). */
export const FINALIDADE_CAPTACAO: Finalidade = "Venda";

// ---------------------------------------------------------------------------------------------
// Limpeza (nunca guardar telefone, e-mail, link, senha ou menção)
// ---------------------------------------------------------------------------------------------

/** Remove do texto tudo que não pode ir para o ADM. Mesmo filtro de senha do leitor do WhatsApp. */
export function sanitizeText(raw: string): string {
  return (
    raw
      .replace(/\b(senhas?|password|passwd|pass|pwd|pin|token)(\s*[:=]\s*)\S+/gi, "")
      .replace(/https?:\/\/\S+|www\.\S+|\b[\w.-]+\.(?:com|net|org)(?:\.br)?\/\S*/gi, "")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "")
      .replace(
        /\[(?:número oculto|e-mail oculto|senha oculta|imagem|vídeo|video|áudio|audio|documento|figurinha)\]/gi,
        "",
      )
      .replace(/\S*oculto\]\S*/gi, "")
      .replace(/@\S+/g, "")
      // telefone: 8+ dígitos com separadores comuns, com ou sem DDI/DDD
      .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\s*\d{4}[\s.-]?\d{4}\b/g, (m) =>
        m.replace(/\D/g, "").length >= 8 ? "" : m,
      )
      .replace(/~[^~\n]*~/g, "") // preço riscado ("~De R$ 2.950.000~")
      .replace(/\*+/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

/** Nome do corretor como aparece no grupo, sem cargo, empresa nem pedaço de telefone. */
export function sanitizeName(raw: string): string {
  const first = (raw ?? "")
    .split(/\n|\||•| - | – /)[0]
    .replace(/[*_~]/g, "")
    .trim();
  if (!first || /\d|••|^contato$/i.test(first)) return "Corretor(a) do grupo";
  return (
    first
      .replace(/^(corretora?|eng\.?)\s+/i, "")
      .replace(/[.\s]+(corretora?|imóveis|imoveis|i)\b.*$/i, "")
      .trim() || "Corretor(a) do grupo"
  );
}

// ---------------------------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------------------------

const sem = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const PROCURA =
  /\b(procur\w*|busc[ao]\w*|demanda|cliente (precisa|quer|busca|procura)|tenho (um |uma )?cliente|preciso de|necessito|interessad[oa]s? em|algu[eé]m (com|tem|teria|possui|posicionad|lembra|sabe)|quem tem|tem algu[eé]m com)\b/i;
const OFERTA =
  /(\b(a|à) venda\b|\bvendo\b|\bvende-se\b|\bpara loca[cç][aã]o\b|\bloca[cç][aã]o\b|\balugo\b|\baluga-se\b|\boportunidade\b|\bdispon[ií]vel\b|\bparceria\b|\bexclusiv[ao]\b)/i;
const CARACTERISTICA =
  /\b(dorm\w*|quartos?|su[ií]tes?|vagas?|m²|m2|banheiros?|lavabo|churrasqueira|condom[ií]nio)\b/i;

const TIPOS: [TipoImovel, RegExp][] = [
  [
    "Comercial",
    /\b(sala comercial|salas comerciais|sala para|galpao|barracao|ponto comercial|loja|predio comercial|casa comercial|imovel comercial|consultorio)\b/,
  ],
  ["Apartamento", /\b(apartamentos?|aptos?|apart|ap|cobertura|studio|kitnet|flat|duplex)\b/],
  ["Casa", /\b(casas?|sobrado|terrea|edicula)\b/],
  ["Terreno", /\b(terrenos?|lotes?)\b/],
  ["Rural", /\b(chacaras?|sitios?|fazenda|rancho)\b/],
];

/** Tipo citado primeiro no texto (empate: comercial antes de casa, para "casa comercial"). */
export function classifyTipo(text: string): TipoImovel | null {
  const t = sem(text);
  let best: [TipoImovel, number] | null = null;
  for (const [tipo, re] of TIPOS) {
    const i = t.search(re);
    if (i >= 0 && (!best || i < best[1])) best = [tipo, i];
  }
  return best?.[0] ?? null;
}

/** Converte "730.000,00", "5,500", "318.000", "1,2" (com a unidade ao lado) para número. */
function toNumber(num: string, unit: string): number | null {
  let s = num.trim();
  const u = sem(unit);
  if (/^(mil|k)$/.test(u)) {
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n * 1000 : null;
  }
  if (/^(mi|milhao|milhoes|mm)$/.test(u)) {
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n * 1_000_000 : null;
  }
  if (/,\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/,\d{3}$/.test(s)) s = s.replace(/[.,]/g, "");
  else s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const VALOR =
  /(r\$\s*|\$\s*)?(\d{1,3}(?:[.,]\d{3})+(?:,\d{2})?|\d+(?:,\d+)?)\s*(mil\b|k\b|mi\b|milh[aã]o\b|milh[oõ]es\b|reais\b)?(?!\d|[.,]\d|\s*(?:m²|m2|mt|metros|m\b|%))/gi;

/** Valores em reais citados no texto (ignora metragem, condomínio e IPTU). */
export function extractValues(text: string): number[] {
  const clean = text
    .replace(/~[^~\n]*~/g, "")
    .replace(/(condom[ií]nio|cond\.?|iptu|taxa)\s*:?\s*(de\s*)?r\$\s*[\d.,]+/gi, "");
  const out: number[] = [];
  for (const m of clean.matchAll(VALOR)) {
    const [, rs, num, unit = ""] = m;
    // número solto (quartos, andar) só conta com separador de milhar: "até 500.000"
    if (!rs && !unit && !/^\d{1,3}(?:\.\d{3})+(?:,\d{2})?$/.test(num)) continue;
    const n = toNumber(num, unit.toLowerCase() === "reais" ? "" : unit);
    if (n && n >= 300 && n <= 200_000_000) out.push(n);
  }
  return out;
}

const MUNICIPIOS = [
  "Sorocaba",
  "Votorantim",
  "Itu",
  "Salto",
  "Araçoiaba da Serra",
  "Iperó",
  "Porto Feliz",
  "Boituva",
  "Piedade",
  "Salto de Pirapora",
  "Mairinque",
  "Alumínio",
  "São Roque",
  "Itapetininga",
  "Tatuí",
  "Santo André",
  "São Paulo",
];

const PREFIXO_BAIRRO =
  "(?:Jardim|Jd\\.?|Vila|Vl\\.?|Parque|Pq\\.?|Residencial|Condom[ií]nio|Cond\\.?|Alto|Bairro|Chácara|Chacara|Recanto|Portal|Village|Villa|Wanel|Horto|Centro|Campolim|Éden|Eden|Zona)";
const BAIRRO_RE = new RegExp(
  `\\b${PREFIXO_BAIRRO}(?:[ \\t]+(?:d[aoe]s?|[A-ZÀ-Ú][\\wÀ-ú']*|\\d+)){0,4}`,
  "g",
);

/** Bairro/região citado (heurística; o texto original continua no cartão). */
export function extractBairro(text: string): string | null {
  const t = text.replace(/\*/g, "");
  if (/\bqualquer (bairro|regi[aã]o)\b/i.test(t)) return "Qualquer região";
  const zona = t.match(/\bzona\s+(norte|sul|leste|oeste)\b/i);
  const achados = [...t.matchAll(BAIRRO_RE)]
    .map((m) => m[0].replace(/\s+(d[aoe]s?)$/i, "").trim())
    .filter((b) => b.split(/\s+/).length >= 2 || /^(Campolim|Centro|Éden|Eden)$/i.test(b))
    .filter((b) => !/^(condom[ií]nio|cond\.?)\s*$/i.test(b));
  if (achados.length)
    return achados[0].replace(
      /^Zona\s+(\w+)/i,
      (_, z) => `Zona ${z[0].toUpperCase()}${z.slice(1).toLowerCase()}`,
    );
  if (zona) return `Zona ${zona[1][0].toUpperCase()}${zona[1].slice(1).toLowerCase()}`;
  const cidade = MUNICIPIOS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(t));
  return cidade ?? null;
}

export type Classified = Omit<OpportunityPost, "id" | "corretor" | "texto" | "posted_at">;

/** Separa procura × oferta × outros e extrai tipo, finalidade, bairro e valores. */
export function classifyPost(text: string): Classified {
  const t = text.trim();
  const tipo = classifyTipo(t);
  const valores = extractValues(t);
  const cabeca = t.slice(0, 140);
  // Anúncio começa dizendo o que é ("CASA À VENDA", "LOCAÇÃO |", "Oportunidade:"); pedido costuma ser pergunta.
  const anuncio =
    OFERTA.test(t.slice(0, 70)) &&
    !/\?/.test(cabeca) &&
    !/\b(demanda|cliente|procuro|busco)\b/i.test(t.slice(0, 70));
  const pergunta =
    /^(alguma?|algu[eé]m|quem|tem algu|to precisando|estou precisando|precisando)\b/i.test(
      t.replace(/^(ol[aá]|oi+|bom dia|boa tarde|boa noite|pessoal|time|parceiros)[!,. ]*/gi, ""),
    ) ||
    (t.length < 200 && /\?\s*$/.test(t));
  const pedeNaFrente = PROCURA.test(cabeca) || /\bprecisando\b/i.test(cabeca);
  let kind: OpportunityKind = "outros";
  if (t.length >= 25 && (pergunta || (pedeNaFrente && !anuncio)))
    kind = tipo || pedeNaFrente ? "procura" : "outros";
  else if (t.length >= 40 && tipo && (OFERTA.test(t) || CARACTERISTICA.test(t) || valores.length))
    kind = "oferta";
  else if (t.length >= 25 && PROCURA.test(t)) kind = "procura";

  const loc = /\b(loca[cç][aã]o|alug\w*|aluguel|locar)\b/i.test(t);
  const venda =
    /\b(venda|vend\w*|compra\w*|financ\w*|[aà] vista|caixa aprov\w*|investi\w*)\b/i.test(t);
  let finalidade: Finalidade | null = loc && !venda ? "Locação" : venda && !loc ? "Venda" : null;
  if (!finalidade && loc && venda)
    finalidade = /\b(pacote|aluguel)\b/i.test(t) ? "Locação" : "Venda";
  const maior = valores.length ? Math.max(...valores) : null;
  if (!finalidade && maior) finalidade = maior <= 20_000 ? "Locação" : "Venda";

  let valor_min: number | null = null;
  let valor_max: number | null = null;
  let valor: number | null = null;
  if (kind === "procura" && valores.length) {
    const faixa = t.match(
      /\bde\s*(?:r\$\s*)?([\d.,]+)\s*(mil|k)?\s*(?:a|at[eé])\s*(?:r\$\s*)?([\d.,]+)\s*(mil|k|mi|milh[aã]o)?/i,
    );
    const unit = faixa ? (faixa[4] ?? faixa[2] ?? "") : "";
    const fMin = faixa ? toNumber(faixa[1], faixa[2] ?? unit) : null;
    const fMax = faixa ? toNumber(faixa[3], unit) : null;
    if (fMin && fMax && fMin >= 300 && fMax >= fMin && valores.includes(fMax)) {
      valor_min = fMin;
      valor_max = fMax;
    } else valor_max = maior;
  } else if (kind === "oferta" && valores.length)
    valor = valores[valores.length > 1 && /\bpara\b/i.test(t) ? valores.length - 1 : 0];

  return {
    kind,
    tipo,
    finalidade,
    bairro: kind === "outros" ? null : extractBairro(t),
    valor_min,
    valor_max,
    valor,
  };
}

/** Mensagens do leitor que não viram cartão (só link/imagem, resposta curta, resumo automático). */
export function isNoise(text: string): boolean {
  return (
    !text || /cronjob response|job_id:/i.test(text) || text.replace(/[^\p{L}]/gu, "").length < 15
  );
}

// ---------------------------------------------------------------------------------------------
// Idade e cor do cartão
// ---------------------------------------------------------------------------------------------

/** Dias corridos (horário de São Paulo) entre a postagem e hoje. */
export function ageDays(postedAt: string, now: Date = new Date()): number {
  const d = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const a = Date.parse(`${d(new Date(postedAt))}T00:00:00Z`);
  const b = Date.parse(`${d(now)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export type AgeTone = "hoje" | "recente" | "meio" | "vencendo";
export function ageTone(age: number): AgeTone {
  if (age <= 0) return "hoje";
  if (age <= 2) return "recente";
  if (age <= 5) return "meio";
  return "vencendo";
}
export function ageLabel(age: number): string {
  if (age <= 0) return "hoje";
  if (age === 1) return "ontem";
  return age >= 6 ? `${age} dias · vence em ${Math.max(0, VALIDADE_DIAS - age)}d` : `${age} dias`;
}
export function isExpired(postedAt: string, now: Date = new Date()): boolean {
  return ageDays(postedAt, now) > VALIDADE_DIAS;
}

// ---------------------------------------------------------------------------------------------
// Encaixe
// ---------------------------------------------------------------------------------------------

const GENERICO =
  /\b(jardim|jd|vila|vl|parque|pq|residencial|condominio|cond|bairro|regiao|de|da|do|das|dos)\b\.?/g;
const normBairro = (s: string) =>
  sem(s)
    .replace(GENERICO, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Procura sem bairro, "qualquer região" ou só a cidade casa com qualquer bairro. */
function isWildcard(bairro: string | null): boolean {
  if (!bairro) return true;
  const n = sem(bairro);
  return n.startsWith("qualquer") || MUNICIPIOS.some((c) => sem(c) === n);
}

/** Bairros "batem" se algum pedaço da procura (separado por / , e ou) contém ou está contido no outro. */
export function bairroCasa(
  procura: string | null,
  oferta: string | null,
  municipio?: string | null,
): boolean {
  if (isWildcard(procura)) {
    if (!procura || sem(procura).startsWith("qualquer")) return Boolean(oferta || municipio);
    const cidade = sem(procura);
    return (
      !municipio || sem(municipio) === cidade || (oferta ? sem(oferta).includes(cidade) : false)
    );
  }
  const alvos = [oferta, municipio].filter(Boolean).map((x) => normBairro(x as string));
  if (!alvos.length) return false;
  return procura!
    .split(/\/|,|\s+e\s+|\s+ou\s+/i)
    .map(normBairro)
    .filter((p) => p.length >= 3)
    .some((p) => alvos.some((a) => a.length >= 3 && (a.includes(p) || p.includes(a))));
}

/** Valor da oferta dentro da faixa da procura, com 10% de folga acima do teto e abaixo do piso. */
export function valorCasa(
  procura: Pick<OpportunityPost, "valor_min" | "valor_max">,
  valor: number | null,
): boolean {
  if (!valor || !procura.valor_max) return false;
  return (
    valor <= procura.valor_max * (1 + MARGEM_TETO) &&
    valor >= (procura.valor_min ?? 0) * (1 - MARGEM_TETO)
  );
}

type Ofertavel = {
  tipo: TipoImovel | null;
  finalidade: Finalidade | null;
  bairro: string | null;
  municipio?: string | null;
  valor: number | null;
};

export function encaixa(procura: OpportunityPost, oferta: Ofertavel): boolean {
  if (procura.kind !== "procura" || !procura.tipo || procura.tipo !== oferta.tipo) return false;
  if (!procura.finalidade || procura.finalidade !== oferta.finalidade) return false;
  if (!bairroCasa(procura.bairro, oferta.bairro, oferta.municipio)) return false;
  return valorCasa(procura, oferta.valor);
}

const mesmoNome = (a: string, b: string) => {
  const x = sem(a).split(/\s+/)[0];
  const y = sem(b).split(/\s+/)[0];
  return x.length >= 3 && x === y && sem(a).split(/\s+/)[1] === sem(b).split(/\s+/)[1];
};

export const pairKey = (postId: string, targetId: string) => `${postId}|${targetId}`;

/** Mesmo autor identificado nos dois lados (não é encaixe). */
const mesmoAutor = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a) && a === b;

/** Procura × oferta do grupo (autores diferentes), sem os pares marcados como "não encaixa". */
export function groupMatches(
  posts: OpportunityPost[],
  hidden: Set<string>,
  now = new Date(),
): Map<string, OpportunityPost[]> {
  const vivos = posts.filter((p) => !isExpired(p.posted_at, now));
  const out = new Map<string, OpportunityPost[]>();
  const add = (k: string, p: OpportunityPost) => out.set(k, [...(out.get(k) ?? []), p]);
  for (const pr of vivos.filter((p) => p.kind === "procura"))
    for (const of of vivos.filter(
      (p) =>
        p.kind === "oferta" &&
        p.corretor !== pr.corretor &&
        !mesmoAutor(p.author_profile_id, pr.author_profile_id),
    )) {
      if (hidden.has(pairKey(pr.id, of.id)) || !encaixa(pr, of)) continue;
      add(pr.id, of);
      add(of.id, pr);
    }
  return out;
}

/** Procura × captação aprovada da equipe. Quem postou a procura não recebe da própria captação. */
export function captureMatches(
  posts: OpportunityPost[],
  captures: CaptureCandidate[],
  hidden: Set<string>,
  now = new Date(),
): { post: OpportunityPost; capture: CaptureCandidate }[] {
  const out: { post: OpportunityPost; capture: CaptureCandidate }[] = [];
  for (const pr of posts)
    if (pr.kind === "procura" && !isExpired(pr.posted_at, now))
      for (const c of captures)
        if (
          !hidden.has(pairKey(pr.id, c.id)) &&
          !mesmoNome(pr.corretor, c.captor_nome) &&
          !mesmoAutor(pr.author_profile_id, c.captor_id) &&
          encaixa(pr, c)
        )
          out.push({ post: pr, capture: c });
  return out;
}

/** Quem está olhando o mural. Staff = gestor, administrador, administrador principal ou staff. */
export type MuralViewer = { userId: string; isStaff: boolean };

/** Captação devolvida ao mural: só o que o selo mostra (sem captor_id). */
export type EncaixeCaptacao = Pick<
  CaptureCandidate,
  "id" | "captor_nome" | "bairro" | "municipio" | "valor"
>;

/** Encaixes que ESTE usuário pode ver, por id de post (serializável: vai do servidor para a tela). */
export type EncaixesVisiveis = {
  grupo: Record<string, string[]>;
  equipe: Record<string, EncaixeCaptacao[]>;
};

/**
 * Filtro de envolvimento (t_6dd4a31b, pedido de Denis):
 * - ⭐ procura × captação: o dono da captação e o autor da procura;
 * - 🤝 procura × oferta: os autores dos dois posts;
 * - staff vê todos. Post sem autor identificado não dá acesso a corretor nenhum.
 * Roda no servidor, que é quem tem as captações de todos e o autor de cada post.
 */
export function encaixesVisiveis(
  posts: OpportunityPost[],
  captures: CaptureCandidate[],
  hidden: Set<string>,
  viewer: MuralViewer,
  now = new Date(),
): EncaixesVisiveis {
  const meu = (p: OpportunityPost) =>
    Boolean(viewer.userId) && p.author_profile_id === viewer.userId;
  const grupo: Record<string, string[]> = {};
  for (const [id, pares] of groupMatches(posts, hidden, now)) {
    const post = posts.find((p) => p.id === id);
    const ids = pares
      .filter((o) => viewer.isStaff || (post && (meu(post) || meu(o))))
      .map((o) => o.id);
    if (ids.length) grupo[id] = ids;
  }
  const equipe: Record<string, EncaixeCaptacao[]> = {};
  for (const { post, capture: c } of captureMatches(posts, captures, hidden, now)) {
    if (!viewer.isStaff && !meu(post) && c.captor_id !== viewer.userId) continue;
    (equipe[post.id] ??= []).push({
      id: c.id,
      captor_nome: c.captor_nome,
      bairro: c.bairro,
      municipio: c.municipio,
      valor: c.valor,
    });
  }
  return { grupo, equipe };
}

/** Converte a captação (form_data) em candidato ao encaixe. */
export function captureCandidate(row: {
  id: string;
  captor_id: string;
  captor_nome: string | null;
  tipo_imovel: string | null;
  bairro: string | null;
  municipio: string | null;
  valor_imovel: string | null;
}): CaptureCandidate {
  const v = extractValues(`R$ ${row.valor_imovel ?? ""}`);
  return {
    id: row.id,
    captor_id: row.captor_id,
    captor_nome: row.captor_nome ?? "Captador",
    tipo: classifyTipo(row.tipo_imovel ?? ""),
    finalidade: FINALIDADE_CAPTACAO,
    bairro: row.bairro?.trim() || null,
    municipio: row.municipio?.trim() || null,
    valor: v[0] ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------------------------

export function brl(v: number): string {
  if (v >= 1e6) return `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (v >= 1e4) return `R$ ${Math.round(v / 1000)} mil`;
  return `R$ ${v.toLocaleString("pt-BR")}`;
}

export function faixaTexto(
  p: Pick<OpportunityPost, "kind" | "valor" | "valor_min" | "valor_max">,
): string {
  if (p.kind === "oferta") return p.valor ? brl(p.valor) : "Sem valor";
  if (p.kind === "procura")
    return p.valor_max
      ? p.valor_min
        ? `${brl(p.valor_min)} a ${brl(p.valor_max)}`
        : `até ${brl(p.valor_max)}`
      : "Sem teto informado";
  return "—";
}

/** Texto do alerta de WhatsApp (procura do grupo × captação da equipe). */
export function alertMessage(post: OpportunityPost, c: CaptureCandidate, appUrl: string): string {
  const acima =
    post.valor_max && c.valor && c.valor > post.valor_max
      ? ` (${Math.round((c.valor / post.valor_max - 1) * 100)}% acima do teto, dentro da margem)`
      : "";
  const faixa = faixaTexto(post);
  return [
    `🔔 Oportunidade: ${post.corretor} tem cliente procurando ${(post.tipo ?? "imóvel").toLowerCase()} para ${(post.finalidade ?? "").toLowerCase()} em ${post.bairro ?? "qualquer região"}${faixa === "Sem teto informado" ? "" : ` ${faixa}`}.`,
    `Sua captação ${c.bairro ? `no ${c.bairro}` : ""}${c.valor ? ` (${brl(c.valor)})` : ""}${acima} parece encaixar.`,
    `Veja: ${appUrl.replace(/\/$/, "")}/oportunidades`,
  ].join("\n");
}

/** Chave estável do post para não duplicar repostagens (mesmo autor + mesmo texto). */
export function sourceKeyInput(corretor: string, texto: string): string {
  return `${sem(corretor)}|${sem(texto).replace(/\s+/g, " ").slice(0, 400)}`;
}
