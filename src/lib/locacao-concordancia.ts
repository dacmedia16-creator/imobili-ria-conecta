/** Concordância de gênero e número dos papéis do contrato de locação (PF). PJ não flexiona por sexo. */

export type Sexo = "masculino" | "feminino";
export type PapelContrato = "locador" | "locatario" | "fiador";

export type PartePessoa = {
  pj?: boolean;
  sexo?: string;
};

export type FormaPapel = {
  termo: string;
  plural: boolean;
  feminino: boolean;
  soPj: boolean;
};

const SEXO_OK = new Set<Sexo>(["masculino", "feminino"]);

export function sexoOk(v: string | undefined): v is Sexo {
  return v === "masculino" || v === "feminino";
}

export function linhasPessoas(texto: string | undefined): string[] {
  return (texto ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseSexos(texto: string | undefined): string[] {
  return (texto ?? "").split(/\r?\n/).map((s) => s.trim());
}

const PARES: [string, string][] = [
  ["brasileiro", "brasileira"],
  ["português", "portuguesa"],
  ["solteiro", "solteira"],
  ["casado", "casada"],
  ["divorciado", "divorciada"],
  ["separado", "separada"],
  ["viúvo", "viúva"],
  ["viuvo", "viuva"],
  ["portador", "portadora"],
  ["inscrito", "inscrita"],
  ["domiciliado", "domiciliada"],
  ["denominado", "denominada"],
  ["nascido", "nascida"],
  ["residente e domiciliado", "residente e domiciliada"],
];

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preservarCaixa(origem: string, alvo: string): string {
  if (!origem) return alvo;
  if (origem === origem.toUpperCase() && /[A-ZÁÉÍÓÚÃÕÊÔÀÜ]/.test(origem)) return alvo.toUpperCase();
  if (origem[0] === origem[0].toUpperCase() && origem[0] !== origem[0].toLowerCase())
    return alvo.charAt(0).toUpperCase() + alvo.slice(1);
  return alvo;
}

/** Flexiona nacionalidade, estado civil e qualificações com forma dupla (o/a, (a), /). */
export function flexionarQualificacao(texto: string, feminino: boolean): string {
  let t = texto;
  for (const [m, f] of PARES) {
    const alvo = feminino ? f : m;
    const re = new RegExp(
      `\\b${esc(m)}\\s*\\(\\s*a\\s*\\)|\\b${esc(m)}\\s*/\\s*${esc(f)}|\\b${esc(m)}\\s*/\\s*a\\b|\\b${esc(f)}\\b|\\b${esc(m)}\\b`,
      "gi",
    );
    t = t.replace(re, (x) => preservarCaixa(x, alvo));
  }
  return t;
}

const TERMOS: Record<PapelContrato, { m: [string, string]; f: [string, string] }> = {
  locador: { m: ["LOCADOR", "LOCADORES"], f: ["LOCADORA", "LOCADORAS"] },
  locatario: { m: ["LOCATÁRIO", "LOCATÁRIOS"], f: ["LOCATÁRIA", "LOCATÁRIAS"] },
  fiador: { m: ["FIADOR", "FIADORES"], f: ["FIADORA", "FIADORAS"] },
};

export function formaDoLado(pessoas: PartePessoa[]): FormaPapel {
  const pf = pessoas.filter((p) => !p.pj);
  const pj = pessoas.filter((p) => p.pj);
  const n = pf.length + pj.length;
  const plural = n > 1;
  const soPj = n > 0 && pf.length === 0;
  const feminino = pj.length === 0 && pf.length > 0 && pf.every((p) => p.sexo === "feminino");
  return { termo: "", plural, feminino, soPj };
}

export function termoPapel(papel: PapelContrato, pessoas: PartePessoa[]): string {
  const f = formaDoLado(pessoas);
  const par = f.feminino ? TERMOS[papel].f : TERMOS[papel].m;
  return f.plural ? par[1] : par[0];
}

const ARTIGOS: Record<string, { m1: string; f1: string; mN: string; fN: string }> = {
  o: { m1: "o", f1: "a", mN: "os", fN: "as" },
  a: { m1: "o", f1: "a", mN: "os", fN: "as" },
  os: { m1: "o", f1: "a", mN: "os", fN: "as" },
  as: { m1: "o", f1: "a", mN: "os", fN: "as" },
  do: { m1: "do", f1: "da", mN: "dos", fN: "das" },
  da: { m1: "do", f1: "da", mN: "dos", fN: "das" },
  dos: { m1: "do", f1: "da", mN: "dos", fN: "das" },
  das: { m1: "do", f1: "da", mN: "dos", fN: "das" },
  ao: { m1: "ao", f1: "à", mN: "aos", fN: "às" },
  à: { m1: "ao", f1: "à", mN: "aos", fN: "às" },
  aos: { m1: "ao", f1: "à", mN: "aos", fN: "às" },
  às: { m1: "ao", f1: "à", mN: "aos", fN: "às" },
  pelo: { m1: "pelo", f1: "pela", mN: "pelos", fN: "pelas" },
  pela: { m1: "pelo", f1: "pela", mN: "pelos", fN: "pelas" },
  pelos: { m1: "pelo", f1: "pela", mN: "pelos", fN: "pelas" },
  pelas: { m1: "pelo", f1: "pela", mN: "pelos", fN: "pelas" },
  no: { m1: "no", f1: "na", mN: "nos", fN: "nas" },
  na: { m1: "no", f1: "na", mN: "nos", fN: "nas" },
  nos: { m1: "no", f1: "na", mN: "nos", fN: "nas" },
  nas: { m1: "no", f1: "na", mN: "nos", fN: "nas" },
};

function artigoAlvo(artigo: string, feminino: boolean, plural: boolean): string {
  const key = artigo.toLowerCase();
  const mapa = ARTIGOS[key];
  if (!mapa) return artigo;
  const alvo = feminino ? (plural ? mapa.fN : mapa.f1) : plural ? mapa.mN : mapa.m1;
  if (artigo === artigo.toUpperCase()) {
    if (alvo === "à") return "À";
    if (alvo === "às") return "ÀS";
    return alvo.toUpperCase();
  }
  if (artigo[0] === artigo[0].toUpperCase() && artigo[0] !== artigo[0].toLowerCase()) {
    if (alvo === "à") return "À";
    if (alvo === "às") return "Às";
    return alvo.charAt(0).toUpperCase() + alvo.slice(1);
  }
  return alvo;
}

const DUPLO: Record<PapelContrato, [RegExp, string][]> = {
  locador: [
    [/O\(s\)\s+LOCADOR(?:ES)?\(s\)/g, "O LOCADOR"],
    [/LOCADOR(?:ES)?\s*\/\s*LOCADORAS?/g, "LOCADOR"],
    [/LOCADOR\s*\(\s*A\s*\)/g, "LOCADOR"],
  ],
  locatario: [
    [/O\(s\)\s+LOCAT[ÁA]RIO(?:S)?\(s\)/g, "O LOCATÁRIO"],
    [/LOCAT[ÁA]RIO(?:S)?\s*\/\s*LOCAT[ÁA]RIAS?/g, "LOCATÁRIO"],
    [/LOCAT[ÁA]RIO\s*\(\s*[ASs]\s*\)/g, "LOCATÁRIO"],
    [/LOCATARIO(?![A-Za-zÀ-ÿ])/g, "LOCATÁRIO"],
    [/LOCATARIOS(?![A-Za-zÀ-ÿ])/g, "LOCATÁRIOS"],
  ],
  fiador: [
    [/O\(s\)\s+FIADOR(?:ES)?\(s\)/g, "O FIADOR"],
    [/FIADOR(?:ES)?\s*\/\s*FIADORAS?/g, "FIADOR"],
    [/FIADOR\s*\(\s*[AEs]\s*\)/g, "FIADOR"],
  ],
};

const LEMAS: Record<PapelContrato, string[]> = {
  locador: [
    "LOCADORAS",
    "LOCADORES",
    "LOCADORA",
    "LOCADOR",
    "locadoras",
    "locadores",
    "locadora",
    "locador",
  ],
  locatario: [
    "LOCATÁRIAS",
    "LOCATÁRIOS",
    "LOCATÁRIA",
    "LOCATÁRIO",
    "locatárias",
    "locatários",
    "locatária",
    "locatário",
  ],
  fiador: [
    "FIADORAS",
    "FIADORES",
    "FIADORA",
    "FIADOR",
    "fiadoras",
    "fiadores",
    "fiadora",
    "fiador",
  ],
};

const ART_RE =
  "pelos|pelas|pelo|pela|dos|das|do|da|nos|nas|no|na|aos|às|ao|à|os|as|o|a|Pelos|Pelas|Pelo|Pela|Dos|Das|Do|Da|Nos|Nas|No|Na|Aos|Às|Ao|À|Os|As|O|A|PELOS|PELAS|PELO|PELA|DOS|DAS|DO|DA|NOS|NAS|NO|NA|AOS|ÀS|AO|À|OS|AS|O|A";

function casarTermo(matchPapel: string, alvo: string): string {
  const letras = matchPapel.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letras && letras === letras.toUpperCase()) return alvo;
  return alvo.toLowerCase();
}

function substituirPapel(texto: string, papel: PapelContrato, alvo: string): string {
  const feminino = alvo.endsWith("A") || alvo.endsWith("AS");
  const plural = alvo.endsWith("S");
  let t = texto;
  for (const [re, canon] of DUPLO[papel]) t = t.replace(re, canon);
  const lemas = LEMAS[papel].join("|");
  const re = new RegExp(`(?<![A-Za-zÀ-ÿ])(?:(${ART_RE})\\s+)?(${lemas})(?![A-Za-zÀ-ÿ])`, "g");
  return t.replace(re, (_full, artigo: string | undefined, termo: string) => {
    const papelOut = casarTermo(termo, alvo);
    if (!artigo) return papelOut;
    return `${artigoAlvo(artigo, feminino, plural)} ${papelOut}`;
  });
}

type Flexao = { plural: boolean; feminino: boolean };

function flexDe(alvo: string): Flexao {
  const u = alvo.toUpperCase();
  return { plural: u.endsWith("S"), feminino: u.endsWith("A") || u.endsWith("AS") };
}

function escolher(sm: string, sf: string, pm: string, pf: string, flex: Flexao): string {
  return flex.feminino ? (flex.plural ? pf : sf) : flex.plural ? pm : sm;
}

/** 3ª pessoa, só flexão de número. Mais longos primeiro. */
const VERBOS: [string, string][] = [
  ["compromete-se", "comprometem-se"],
  ["obriga-se", "obrigam-se"],
  ["considera-se", "consideram-se"],
  ["responderá", "responderão"],
  ["permitirá", "permitirão"],
  ["identifique", "identifiquem"],
  ["apresente", "apresentem"],
  ["compromete", "comprometem"],
  ["autoriza", "autorizam"],
  ["pretenda", "pretendam"],
  ["recebeu", "receberam"],
  ["encontre", "encontrem"],
  ["declara", "declaram"],
  ["assume", "assumem"],
  ["deverá", "deverão"],
  ["consiga", "consigam"],
  ["realize", "realizem"],
  ["remova", "removam"],
  ["obriga", "obrigam"],
  ["exerça", "exerçam"],
  ["receba", "recebam"],
  ["poderá", "poderão"],
  ["possa", "possam"],
  ["será", "serão"],
  ["terá", "terão"],
];

const VERBO_RE = VERBOS.flatMap(([s, p]) => [s, p])
  .sort((a, b) => b.length - a.length)
  .map(esc)
  .join("|");

function verboAlvo(forma: string, plural: boolean): string {
  const low = forma.toLowerCase();
  for (const [s, p] of VERBOS) {
    if (low === s || low === p) return preservarCaixa(forma, plural ? p : s);
  }
  return forma;
}

function termoRe(alvo: string): string {
  return `${esc(alvo)}|${esc(alvo.toLowerCase())}`;
}

const MARCA_TIPO = "\u0000TIPO_GARANTIA_FIDEJUSSORIA\u0000";
const MARCA_PJ_LOC = "\u0000PJ_LOC\u0000";
const FIM_PALAVRA = "(?![A-Za-zÀ-ÿ])";

function pertoPessoaJuridica(texto: string, indice: number): boolean {
  const fatia = texto.slice(Math.max(0, indice - 280), indice + 80);
  return /pessoa jurídica/i.test(fatia) || fatia.includes(MARCA_PJ_LOC);
}

function flexionarVerboApos(texto: string, alvo: string, flex: Flexao): string {
  const re = new RegExp(
    `(?<![A-Za-zÀ-ÿ])((?:[Oo]s|[Aa]s|[Oo]|[Aa])\\s+)?(${termoRe(alvo)})(\\s*,)?\\s+(não\\s+)?(se\\s+)?(${VERBO_RE})${FIM_PALAVRA}`,
    "g",
  );
  return texto.replace(re, (full, art, _termo, virg, nao, se, verbo, offset: number) => {
    if (pertoPessoaJuridica(texto, offset)) return full;
    return `${art ?? ""}${_termo}${virg ?? ""} ${nao ?? ""}${se ?? ""}${verboAlvo(verbo, flex.plural)}`;
  });
}

function flexionarVerboInvertido(texto: string, alvo: string, flex: Flexao): string {
  const re = new RegExp(
    `(?<![A-Za-zÀ-ÿ])(${VERBO_RE})(\\s+em mora\\s+|\\s+)((?:[Oo]s|[Aa]s|[Oo]|[Aa])\\s+)(${termoRe(alvo)})${FIM_PALAVRA}`,
    "gi",
  );
  return texto.replace(re, (full, verbo, meio, art, termo, offset: number) => {
    if (pertoPessoaJuridica(texto, offset)) return full;
    return `${verboAlvo(verbo, flex.plural)}${meio}${art}${termo}`;
  });
}

function flexionarDeveraCaso(texto: string, alvo: string, flex: Flexao): string {
  if (!new RegExp(`Caso\\s+(?:[oa]|os|as)\\s+(?:${termoRe(alvo)})\\b`, "i").test(texto))
    return texto;
  if (/pessoa jurídica/i.test(texto)) return texto;
  return texto.replace(new RegExp(`(?<![A-Za-zÀ-ÿ])(deverá|deverão)${FIM_PALAVRA}`, "gi"), (v) =>
    verboAlvo(v, flex.plural),
  );
}

const ADJETIVOS: [string, string, string, string][] = [
  ["responsável", "responsável", "responsáveis", "responsáveis"],
  ["desobrigado", "desobrigada", "desobrigados", "desobrigadas"],
  ["notificado", "notificada", "notificados", "notificadas"],
  ["comunicado", "comunicada", "comunicados", "comunicadas"],
  ["obrigado", "obrigada", "obrigados", "obrigadas"],
];

const ADJ_RE = ADJETIVOS.flat()
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort((a, b) => b.length - a.length)
  .map(esc)
  .join("|");

function adjAlvo(forma: string, flex: Flexao): string {
  const low = forma.toLowerCase();
  for (const q of ADJETIVOS) {
    if (q.some((x) => x === low))
      return preservarCaixa(forma, escolher(q[0], q[1], q[2], q[3], flex));
  }
  return forma;
}

function flexionarFicando(texto: string, alvo: string, flex: Flexao): string {
  const re = new RegExp(
    `(ficando\\s+(?:[Oo]s|[Aa]s|[Oo]|[Aa])\\s+(?:${termoRe(alvo)})\\s+)(${ADJ_RE})${FIM_PALAVRA}`,
    "gi",
  );
  return texto.replace(re, (_full, head, adj) => `${head}${adjAlvo(adj, flex)}`);
}

function flexionarAposSera(texto: string, alvo: string, flex: Flexao): string {
  const re = new RegExp(
    `((?:${termoRe(alvo)})\\s+(?:será|serão)\\s+)(${ADJ_RE})${FIM_PALAVRA}`,
    "gi",
  );
  return texto.replace(re, (_full, head, adj) => `${head}${adjAlvo(adj, flex)}`);
}

function flexionarLocador(texto: string, flex: Flexao): string {
  let t = texto;
  t = t.replace(
    /ser\s+(o|a|os|as)\s+legítim[oa]s?\s+proprietári[oa]s?\s+e\/ou\s+possuidor(?:a|es|as)?/gi,
    () =>
      escolher(
        "ser o legítimo proprietário e/ou possuidor",
        "ser a legítima proprietária e/ou possuidora",
        "ser os legítimos proprietários e/ou possuidores",
        "ser as legítimas proprietárias e/ou possuidoras",
        flex,
      ),
  );
  t = t.replace(/como\s+(o|a|os|as)\s+únic[oa]s?\s+beneficiári[oa]s?/gi, () =>
    escolher(
      "como o único beneficiário",
      "como a única beneficiária",
      "como os únicos beneficiários",
      "como as únicas beneficiárias",
      flex,
    ),
  );
  return t;
}

function flexionarLocatario(texto: string, flex: Flexao): string {
  let t = texto;
  t = t.replace(
    /atribuídos a (?:ele|ela|eles|elas)\b/gi,
    () => `atribuídos ${escolher("a ele", "a ela", "a eles", "a elas", flex)}`,
  );
  t = t.replace(/\b(?:ele mesmo|ela mesma|eles mesmos|elas mesmas)\b/gi, () =>
    escolher("ele mesmo", "ela mesma", "eles mesmos", "elas mesmas", flex),
  );
  t = t.replace(
    /\b(?:este|esta|estes|estas)\s+(?:será|serão)\s+(?:comunicado|comunicada|comunicados|comunicadas)\s+para que possa(?:m)?\b/gi,
    () =>
      escolher(
        "este será comunicado para que possa",
        "esta será comunicada para que possa",
        "estes serão comunicados para que possam",
        "estas serão comunicadas para que possam",
        flex,
      ),
  );
  t = t.replace(/Caso não exerça(?:m)? o direito de preferência, deverá(?:ão)? permitir/gi, () =>
    flex.plural
      ? "Caso não exerçam o direito de preferência, deverão permitir"
      : "Caso não exerça o direito de preferência, deverá permitir",
  );
  if (flex.plural) t = t.replace(/\bem que o recebeu\b/gi, "em que o receberam");
  else t = t.replace(/\bem que o receberam\b/gi, "em que o recebeu");
  if (flex.plural) t = t.replace(/\bpara o seu nome\b/gi, "para os seus nomes");
  else t = t.replace(/\bpara os seus nomes\b/gi, "para o seu nome");
  return t;
}

function flexionarPredicado(texto: string, papel: PapelContrato, alvo: string): string {
  const flex = flexDe(alvo);
  let t = texto;
  t = flexionarVerboApos(t, alvo, flex);
  t = flexionarVerboInvertido(t, alvo, flex);
  t = flexionarDeveraCaso(t, alvo, flex);
  t = flexionarFicando(t, alvo, flex);
  t = flexionarAposSera(t, alvo, flex);
  if (
    new RegExp(`(?:os|as|o|a)\\s+(?:${termoRe(alvo)})`, "i").test(t) &&
    !/pessoa jurídica/i.test(t) &&
    !t.includes(MARCA_PJ_LOC)
  ) {
    t = flex.plural
      ? t.replace(/permanecendo responsável(?![A-Za-zÀ-ÿ])/gi, "permanecendo responsáveis")
      : t.replace(/permanecendo responsáveis(?![A-Za-zÀ-ÿ])/gi, "permanecendo responsável");
  }
  if (papel === "locador") t = flexionarLocador(t, flex);
  if (papel === "locatario") t = flexionarLocatario(t, flex);
  return t;
}

/** Troca o termo do papel, o artigo colado e a flexão que concorda com ele. Não reescreve o sentido. */
export function aplicarPapeis(
  texto: string,
  locador: string,
  locatario: string,
  fiador: string,
): string {
  let t = texto.replace(/Contrato de Garantia: FIADOR/g, MARCA_TIPO);
  t = t.replace(/LOCAT[ÁA]RIO(?:S)? pessoa jurídica/gi, MARCA_PJ_LOC);
  t = substituirPapel(t, "locatario", locatario);
  t = flexionarPredicado(t, "locatario", locatario);
  t = substituirPapel(t, "fiador", fiador);
  t = flexionarPredicado(t, "fiador", fiador);
  t = substituirPapel(t, "locador", locador);
  t = flexionarPredicado(t, "locador", locador);
  t = t.split(MARCA_PJ_LOC).join("LOCATÁRIO pessoa jurídica");
  return t.split(MARCA_TIPO).join("Contrato de Garantia: FIADOR");
}

export function pessoasLocador(
  pj: boolean,
  campos: Record<string, string>,
  contrato: Record<string, string>,
): PartePessoa[] {
  const out: PartePessoa[] = [{ pj, sexo: pj ? undefined : campos.prop_sexo }];
  if (!pj && (contrato.prop_conj_nome || campos.d_prop_conj_nome)?.trim())
    out.push({ sexo: campos.prop_conj_sexo });
  const extras = linhasPessoas(campos.locadores_adicionais);
  const sexos = parseSexos(campos.locadores_adicionais_sexo);
  extras.forEach((_, i) => out.push({ sexo: sexos[i] }));
  return out;
}

export function pessoasLocatario(pj: boolean, campos: Record<string, string>): PartePessoa[] {
  const out: PartePessoa[] = [{ pj, sexo: pj ? undefined : campos.loc_sexo }];
  const extras = linhasPessoas(campos.locatarios_adicionais);
  const sexos = parseSexos(campos.locatarios_adicionais_sexo);
  extras.forEach((_, i) => out.push({ sexo: sexos[i] }));
  return out;
}

export function pessoasFiador(
  pj: boolean,
  campos: Record<string, string>,
  contrato: Record<string, string>,
): PartePessoa[] {
  const out: PartePessoa[] = [{ pj, sexo: pj ? undefined : campos.fia_sexo }];
  if (!pj && (contrato.fia_conj_nome || campos.d_fia_conj_nome)?.trim())
    out.push({ sexo: campos.fia_conj_sexo });
  return out;
}

export { SEXO_OK };
