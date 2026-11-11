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

const MARCA_TIPO = "\u0000TIPO_GARANTIA_FIDEJUSSORIA\u0000";

/** Troca só o termo do papel (e o artigo colado). Não reescreve o resto da cláusula. */
export function aplicarPapeis(
  texto: string,
  locador: string,
  locatario: string,
  fiador: string,
): string {
  let t = texto.replace(/Contrato de Garantia: FIADOR/g, MARCA_TIPO);
  t = substituirPapel(t, "locatario", locatario);
  t = substituirPapel(t, "fiador", fiador);
  t = substituirPapel(t, "locador", locador);
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
