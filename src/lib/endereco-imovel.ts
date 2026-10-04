/**
 * Endereço estruturado do imóvel (CEP, rua, número, bairro, cidade, UF).
 *
 * O campo livre `imovel_endereco` continua sendo o texto completo (o que a IA lê do documento e o
 * que aparece em notificações). Os campos separados servem para relatório por bairro/cidade.
 * Regra: quando houver CEP válido, rua/bairro/cidade/UF do CEP (ViaCEP) prevalecem sobre o texto
 * do documento — matrícula costuma trazer loteamento ou nome antigo de bairro.
 */

export type EnderecoEstruturado = {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
};

export const ENDERECO_VAZIO: EnderecoEstruturado = {
  cep: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  cidade: null,
  uf: null,
};

/** Só dígitos; devolve os 8 dígitos do CEP ou null. */
export function normalizarCep(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = String(v).replace(/\D/g, "");
  return d.length === 8 ? d : null;
}

export function formatarCep(v: string | null | undefined): string {
  const d = normalizarCep(v);
  return d ? `${d.slice(0, 5)}-${d.slice(5)}` : (v ?? "");
}

const UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "),
);

const PALAVRAS_BAIRRO =
  /^(jardim|jd\.?|vila|vl\.?|parque|pq\.?|bairro|ch[aá]cara|ch[aá]caras|residencial|condom[ií]nio|recanto|conjunto|n[uú]cleo|loteamento|centro|alto|altos|portal|distrito|s[ií]tio|cidade)\b/i;

const limpar = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();

/**
 * Separa um endereço em texto livre (como a IA devolve dos documentos) em partes.
 * Heurística conservadora: o que não reconhece fica null para o corretor completar.
 */
export function separarEnderecoTexto(texto: string | null | undefined): EnderecoEstruturado {
  const out: EnderecoEstruturado = { ...ENDERECO_VAZIO };
  if (!texto) return out;
  let t = ` ${texto.replace(/\s+/g, " ").trim()} `;

  const cep = t.match(/\b(?:CEP[:\s]*)?(\d{2})\.?(\d{3})-?(\d{3})\b/i);
  if (cep) {
    out.cep = `${cep[1]}${cep[2]}${cep[3]}`;
    t = t.replace(cep[0], " ");
  }
  t = t.replace(/\bCEP[:\s]*/gi, " ").replace(/[\s,.;:\-–]+$/, " ");

  // Cidade/UF no fim: "Sorocaba - SP", "Sorocaba/SP", "Sorocaba, SP", "Sorocaba SP".
  const cidadeUf = t.match(
    /[,\-–]\s*([A-Za-zÀ-ÿ' ]{3,40}?)\s*(?:[-/,–]\s*|\s)([A-Za-z]{2})\.?\s*$/,
  );
  if (cidadeUf && UFS.has(cidadeUf[2].toUpperCase())) {
    out.cidade = limpar(cidadeUf[1]);
    out.uf = cidadeUf[2].toUpperCase();
    t = t.slice(0, cidadeUf.index) + " ";
  }

  if (!out.cidade) {
    const semSep = t.match(
      /\s(Sorocaba|Votorantim|Ara[çc]oiaba da Serra|Itu|Salto|Piedade|Boituva|Porto Feliz|Iper[óo]|Tatu[íi]|Mairinque|Alum[íi]nio|Itapetininga|Cerquilho|Tiet[êe]|Salto de Pirapora|S[ãa]o Paulo)\s*[-/]?\s*(SP)?\.?\s*$/i,
    );
    if (semSep) {
      out.cidade = semSep[1];
      if (semSep[2]) out.uf = "SP";
      t = t.slice(0, semSep.index) + " ";
    }
  }
  const partes = t
    .split(/\s*[,;]\s*|\s+[-–]\s+|(?<=\d)[-–]\s+/)
    .map(limpar)
    .filter(Boolean);
  if (!partes.length) return out;

  // 1ª parte: logradouro (pode trazer o número colado: "Rua X 432").
  let logr = partes.shift() as string;
  const numColado = logr.match(/^(.*?)(?:\s+n[º°o]?\.?\s*|\s+)(\d+[A-Za-z]?)$/i);
  if (numColado && /[A-Za-zÀ-ÿ]{3}/.test(numColado[1])) {
    logr = numColado[1];
    out.numero = numColado[2];
  }
  out.logradouro = limpar(logr) || null;

  const resto: string[] = [];
  for (const p of partes) {
    const num =
      p.match(/^(?:n[º°o]?\.?|n[uú]mero)\s*(\d{1,3}(?:\.\d{3})+|\d+[A-Za-z]?)$/i) ??
      p.match(/^(\d{1,3}(?:\.\d{3})+|\d+[A-Za-z]?)$/);
    if (!out.numero && num) {
      out.numero = num[1].replace(/\.(?=\d{3}\b)/g, "");
      continue;
    }
    const numBairro = p.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
    if (!out.numero && numBairro && PALAVRAS_BAIRRO.test(numBairro[2])) {
      out.numero = numBairro[1];
      const b = numBairro[2].replace(/\s+(quadra|lote)\b.*$/i, "");
      if (!out.bairro) out.bairro = limpar(b);
      continue;
    }
    const bairroRot = p.match(/^bairro(?:\s+d[aeo]s?)?[:\s]+(.+)$/i);
    if (!out.bairro && bairroRot) {
      out.bairro = limpar(bairroRot[1]);
      continue;
    }
    if (!out.bairro && PALAVRAS_BAIRRO.test(p) && !/^condom[ií]nio|^residencial/i.test(p)) {
      out.bairro = p;
      continue;
    }
    resto.push(p);
  }
  // Sem rótulo de bairro: condomínio/residencial costuma ser o bairro quando é o único candidato.
  if (!out.bairro) {
    const cand = resto.findIndex((p) => PALAVRAS_BAIRRO.test(p));
    if (cand >= 0) out.bairro = resto.splice(cand, 1)[0];
  }
  // Sem cidade/UF no fim: última parte sem dígito pode ser a cidade.
  if (!out.cidade && resto.length && !/\d/.test(resto[resto.length - 1]) && out.bairro) {
    const ult = resto[resto.length - 1];
    if (/^[A-Za-zÀ-ÿ' ]{3,40}$/.test(ult) && !PALAVRAS_BAIRRO.test(ult)) {
      out.cidade = ult;
      resto.pop();
    }
  }
  // IPTU de Sorocaba usa "BAIRRO REGIAO SUL/NORTE..." (zona fiscal), que não é bairro.
  if (out.bairro && /^regi[aã]o\b/i.test(out.bairro)) out.bairro = null;
  out.complemento = resto.length ? resto.join(", ") : null;
  return out;
}

/**
 * Junta o que a IA devolveu separado (endereco_cep, endereco_bairro...) com o que dá para tirar
 * do texto completo (endereco_imovel). O valor separado pela IA tem prioridade.
 */
export function enderecoDaExtracao(r: Record<string, unknown>): EnderecoEstruturado {
  const txt = (k: string) => {
    const v = r[k];
    return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
  };
  const doTexto = separarEnderecoTexto(txt("endereco_imovel"));
  const uf = txt("endereco_uf")?.toUpperCase() ?? null;
  const bairroIa = txt("endereco_bairro");
  return {
    cep: normalizarCep(txt("endereco_cep")) ?? doTexto.cep,
    logradouro: txt("endereco_logradouro") ?? doTexto.logradouro,
    numero: txt("endereco_numero") ?? doTexto.numero,
    complemento: txt("endereco_complemento") ?? doTexto.complemento,
    bairro: bairroIa && !/^regi[aã]o\b/i.test(bairroIa) ? bairroIa : doTexto.bairro,
    cidade: txt("endereco_cidade") ?? doTexto.cidade,
    uf: uf && UFS.has(uf) ? uf : doTexto.uf,
  };
}

/** Nome das colunas em `sales` para cada parte do endereço. */
export const COLUNAS_ENDERECO = {
  cep: "imovel_cep",
  logradouro: "imovel_logradouro",
  numero: "imovel_numero",
  complemento: "imovel_complemento",
  bairro: "imovel_bairro",
  cidade: "imovel_cidade",
  uf: "imovel_uf",
} as const satisfies Record<keyof EnderecoEstruturado, string>;

type ViaCepResposta = {
  erro?: boolean | string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

/** Consulta o ViaCEP (público, gratuito). Só o CEP sai da aplicação. Null se inválido/falhar. */
export async function buscarCep(
  cep: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Pick<EnderecoEstruturado, "cep" | "logradouro" | "bairro" | "cidade" | "uf"> | null> {
  const d = normalizarCep(cep);
  if (!d) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetchImpl(`https://viacep.com.br/ws/${d}/json/`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = (await res.json()) as ViaCepResposta;
    if (!j || j.erro) return null;
    return {
      cep: d,
      logradouro: j.logradouro || null,
      bairro: j.bairro || null,
      cidade: j.localidade || null,
      uf: j.uf || null,
    };
  } catch {
    return null;
  }
}

/** CEP manda em rua/bairro/cidade/UF; número e complemento vêm do texto. */
const semAcento = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const PALAVRAS_VIA = new Set(
  "rua r av avenida alameda al travessa tv estrada est rodovia rod praca pca largo via de da do das dos e".split(
    " ",
  ),
);
/** true se as duas ruas compartilham alguma palavra significativa (ignora "Rua", "de"...). */
export function mesmaRua(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const tok = (v: string) =>
    new Set(
      semAcento(v)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !PALAVRAS_VIA.has(w)),
    );
  const ta = tok(a);
  for (const w of tok(b)) if (ta.has(w)) return true;
  return ta.size === 0;
}

export function combinarComCep(
  texto: EnderecoEstruturado,
  viaCep: Awaited<ReturnType<typeof buscarCep>>,
): EnderecoEstruturado {
  if (!viaCep) return texto;
  // CEP de outra rua (erro de digitação ou de outro documento): não confia nele.
  if (!mesmaRua(texto.logradouro, viaCep.logradouro)) return { ...texto, cep: null };
  return {
    ...texto,
    cep: viaCep.cep,
    logradouro: viaCep.logradouro ?? texto.logradouro,
    bairro: viaCep.bairro ?? texto.bairro,
    cidade: viaCep.cidade ?? texto.cidade,
    uf: viaCep.uf ?? texto.uf,
  };
}
