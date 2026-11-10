// Leitura dos documentos da locação por IA (t_127811ca). Regras puras: que tipo de documento é cada item do
// checklist, o que pedir à IA, como limpar a resposta e para quais campos do contrato cada dado vai.
// A chamada à IA (mesma do módulo de Vendas: Gemini, GEMINI_API_KEY, gemini-flash-latest) fica em
// locacao-ia.functions.ts. O banco só aceita chaves da lista do contrato e só preenche campo vazio.
import { CHAVES_CONTRATO, valorOk } from "@/lib/locacao-contrato";

export type TipoDocLocacao =
  "identidade" | "certidao" | "renda" | "endereco" | "matricula" | "contas" | "outro";

export type GrupoDoc =
  "locatario" | "fiador" | "proprietario" | "caucao" | "seguro_fianca" | "outro";

const semAcento = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Tipo do documento a partir do nome do item do checklist (a lista é editável por imobiliária). */
export function tipoDoItem(item: string): TipoDocLocacao {
  const t = semAcento(item);
  if (/certidao|casamento/.test(t)) return "certidao";
  if (/matricula/.test(t)) return "matricula";
  if (/\b(rg|cnh|cpf|identidade)\b/.test(t)) return "identidade";
  if (/renda|holerite|contracheque|pro.?labore/.test(t)) return "renda";
  if (/residencia|endereco/.test(t)) return "endereco";
  if (/iptu|consumo|energia|agua|\bgas\b|cpfl|saae|luz/.test(t)) return "contas";
  return "outro";
}

/** Só estes tipos são lidos pela IA; os outros ficam "sem leitura automática" (o corretor digita). */
export function itemLidoPorIa(item: string): boolean {
  return tipoDoItem(item) !== "outro";
}

const PREFIXO: Partial<Record<GrupoDoc, "loc" | "fia" | "prop">> = {
  locatario: "loc",
  fiador: "fia",
  proprietario: "prop",
};

const QUEM: Partial<Record<GrupoDoc, string>> = {
  locatario: "LOCATÁRIO (inquilino)",
  fiador: "FIADOR",
  proprietario: "PROPRIETÁRIO (locador)",
};

export const SISTEMA_IA =
  "Você extrai dados estruturados de documentos brasileiros (RG, CNH, CPF, certidões, comprovantes, matrícula de imóvel, IPTU e contas de consumo). Responda APENAS com JSON válido, sem markdown, sem comentários. Nunca invente: campo ausente = null.";

export function promptDoDocumento(tipo: TipoDocLocacao, grupo: GrupoDoc, item: string): string {
  const dono = QUEM[grupo];
  const base = `Documento da locação: "${item}".${dono ? ` Ele pertence ao ${dono}.` : ""}\nExtraia os campos abaixo. Se um campo não estiver no documento, use null. Datas no formato AAAA-MM-DD.`;
  const campos: Record<Exclude<TipoDocLocacao, "outro">, string> = {
    identidade: `{
  "nome": string|null,
  "cpf": string|null,
  "rg": string|null,
  "data_nascimento": string|null,
  "nacionalidade": string|null,
  "estado_civil": string|null,
  "profissao": string|null
}
"rg" é o número do RG (ou do registro geral que aparece na CNH). "nacionalidade" só se estiver escrita (ex.: "brasileira").`,
    certidao: `{
  "tipo_certidao": "casamento"|"nascimento"|"outra"|null,
  "regime_casamento": string|null,
  "averbacao_divorcio": boolean|null,
  "pessoas_certidao": [{"nome": string|null, "cpf": string|null, "data_nascimento": string|null, "nacionalidade": string|null, "profissao": string|null}]
}
Em "pessoas_certidao" liste só as pessoas principais (os dois cônjuges, ou o registrado), nunca pais, testemunhas ou oficial. Copie os dados de cada pessoa sem misturar com a outra.`,
    renda: `{
  "nome": string|null,
  "cpf": string|null,
  "profissao": string|null
}
"profissao" é o cargo ou a função declarada no comprovante.`,
    endereco: `{
  "endereco": string|null
}
"endereco" é o endereço completo (rua, número, complemento, bairro, cidade/UF e CEP) como aparece no comprovante.`,
    matricula: `{
  "numero_matricula": string|null,
  "cartorio": string|null,
  "inscricao_municipal": string|null,
  "proprietarios": [{"nome": string|null, "cpf": string|null}]
}
"cartorio" é o nome do Cartório/Oficial de Registro de Imóveis (ex.: "1º Oficial de Registro de Imóveis de Sorocaba/SP"). "proprietarios" são os donos ATUAIS (último registro de aquisição).`,
    contas: `{
  "inscricao_municipal": string|null,
  "codigo_energia": string|null,
  "codigo_agua": string|null,
  "codigo_gas": string|null
}
"inscricao_municipal" é a inscrição cadastral do IPTU. "codigo_energia" é o número da instalação/unidade consumidora da conta de luz. "codigo_agua" é o código/matrícula do imóvel na conta de água. "codigo_gas" só se for conta de gás.`,
  };
  return tipo === "outro" ? base : `${base}\n\n${campos[tipo]}`;
}

// ----------------------------------------------------------------------------------------------------------------
// Limpeza da resposta (nunca confiar no formato devolvido pela IA).
const txt = (v: unknown, max = 300): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  if (!t || /^(null|n\/a|nao consta|não consta|-)$/i.test(t)) return null;
  return t.slice(0, max);
};

export function cpfLimpo(v: unknown): string | null {
  const d = (txt(v) ?? "").replace(/\D/g, "");
  if (d.length !== 11) return null;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function dataLimpa(v: unknown): string | null {
  const t = txt(v);
  if (!t) return null;
  let iso: string | null = null;
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (br) iso = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  else if (/^\d{4}-\d{2}-\d{2}/.test(t)) iso = t.slice(0, 10);
  return iso && valorOk("inicio", iso) ? iso : null;
}

export function estadoCivilLimpo(v: unknown): string | null {
  const t = semAcento(txt(v) ?? "");
  if (!t) return null;
  if (/uniao|convivente/.test(t)) return "união estável";
  if (/divorc/.test(t)) return "divorciado(a)";
  if (/separad/.test(t)) return "separado(a)";
  if (/viuv/.test(t)) return "viúvo(a)";
  if (/casad/.test(t)) return "casado(a)";
  if (/solteir/.test(t)) return "solteiro(a)";
  return null;
}

const nomeNorm = (v: unknown) =>
  semAcento(txt(v) ?? "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Mesma pessoa: CPF igual, ou nome igual (sem acento e maiúsculas). */
export function mesmaPessoa(
  a: { nome?: unknown; cpf?: unknown },
  b: { nome?: unknown; cpf?: unknown },
): boolean {
  const ca = cpfLimpo(a.cpf);
  const cb = cpfLimpo(b.cpf);
  if (ca && cb) return ca === cb;
  const na = nomeNorm(a.nome);
  return !!na && na.length >= 5 && na === nomeNorm(b.nome);
}

type Sug = Record<string, string>;
const CHAVES = new Set(CHAVES_CONTRATO);

function por(out: Sug, k: string, v: string | null) {
  if (v && CHAVES.has(k) && valorOk(k, v) && !out[k]) out[k] = v;
}

/**
 * Converte a resposta da IA em sugestões para os campos do contrato. O banco ainda confere a lista de campos e a
 * validação, e só grava em campo vazio. `atuais` = valores já preenchidos (para casar a certidão com a pessoa).
 */
export function sugestoesDoDocumento(
  tipo: TipoDocLocacao,
  grupo: GrupoDoc,
  raw: Record<string, unknown>,
  atuais: Record<string, string> = {},
): Sug {
  const out: Sug = {};
  const pre = PREFIXO[grupo];
  if (tipo === "identidade" && pre) {
    por(out, `${pre}_nome`, txt(raw.nome));
    por(out, `${pre}_cpf`, cpfLimpo(raw.cpf));
    por(out, `${pre}_rg`, txt(raw.rg, 30));
    por(out, `${pre}_nascimento`, dataLimpa(raw.data_nascimento));
    por(out, `${pre}_nacionalidade`, txt(raw.nacionalidade, 60));
    por(out, `${pre}_estado_civil`, estadoCivilLimpo(raw.estado_civil));
    por(out, `${pre}_profissao`, txt(raw.profissao, 100));
  } else if (tipo === "renda" && pre) {
    por(out, `${pre}_profissao`, txt(raw.profissao, 100));
  } else if (tipo === "endereco" && pre) {
    por(out, `${pre}_endereco`, txt(raw.endereco));
  } else if (tipo === "certidao" && pre) {
    const tipoCert = semAcento(txt(raw.tipo_certidao) ?? "");
    const pessoas = (Array.isArray(raw.pessoas_certidao) ? raw.pessoas_certidao : [])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .slice(0, 4);
    if (tipoCert.startsWith("casamento")) {
      if (raw.averbacao_divorcio === true) por(out, `${pre}_estado_civil`, "divorciado(a)");
      else {
        por(out, `${pre}_estado_civil`, "casado(a)");
        por(out, `${pre}_regime`, txt(raw.regime_casamento, 100));
      }
      const titular = { nome: atuais[`${pre}_nome`], cpf: atuais[`${pre}_cpf`] };
      const achadas = pessoas.filter((p) => mesmaPessoa(p, titular));
      // Só separa titular e cônjuge quando a certidão tem 2 pessoas e uma delas é, sem dúvida, o titular.
      if (achadas.length === 1 && pessoas.length === 2) {
        const eu = achadas[0];
        const outro = pessoas.find((p) => p !== eu) ?? {};
        por(out, `${pre}_nacionalidade`, txt(eu.nacionalidade, 60));
        por(out, `${pre}_profissao`, txt(eu.profissao, 100));
        por(out, `${pre}_nascimento`, dataLimpa(eu.data_nascimento));
        if (pre !== "loc" && raw.averbacao_divorcio !== true) {
          por(out, `${pre}_conj_nome`, txt(outro.nome));
          por(out, `${pre}_conj_cpf`, cpfLimpo(outro.cpf));
          por(out, `${pre}_conj_nascimento`, dataLimpa(outro.data_nascimento));
          por(out, `${pre}_conj_nacionalidade`, txt(outro.nacionalidade, 60));
          por(out, `${pre}_conj_profissao`, txt(outro.profissao, 100));
        }
      }
    }
  } else if (tipo === "matricula") {
    if (grupo === "fiador") {
      por(out, "fia_matricula", txt(raw.numero_matricula, 40));
      por(out, "fia_cartorio", txt(raw.cartorio, 200));
    } else if (grupo === "proprietario") {
      por(out, "imv_inscricao", txt(raw.inscricao_municipal, 60));
      const donos = (Array.isArray(raw.proprietarios) ? raw.proprietarios : []).filter(
        (p): p is Record<string, unknown> => !!p && typeof p === "object",
      );
      if (donos.length >= 1) {
        por(out, "prop_nome", txt(donos[0].nome));
        por(out, "prop_cpf", cpfLimpo(donos[0].cpf));
      }
    }
  } else if (tipo === "contas" && (grupo === "proprietario" || grupo === "outro")) {
    por(out, "imv_inscricao", txt(raw.inscricao_municipal, 60));
    por(out, "imv_energia", txt(raw.codigo_energia, 60));
    por(out, "imv_agua", txt(raw.codigo_agua, 60));
    por(out, "imv_gas", txt(raw.codigo_gas, 60));
  }
  return out;
}

/** Códigos de erro gravados (nunca o texto da IA nem dado do documento). */
export type ErroLeitura =
  "IA_SEM_CREDITO" | "IA_COTA_EXCEDIDA" | "TEMPO" | "NAO_CONFIGURADA" | "FALHA" | "SEM_LEITURA";

export const ERRO_LEITURA_TEXTO: Record<ErroLeitura, string> = {
  IA_SEM_CREDITO: "IA sem crédito no momento — digite os dados",
  IA_COTA_EXCEDIDA: "IA no limite de uso — tente mais tarde ou digite",
  TEMPO: "a leitura demorou — tente de novo ou digite",
  NAO_CONFIGURADA: "leitura por IA não configurada — digite os dados",
  FALHA: "não foi possível ler — tente de novo ou digite",
  SEM_LEITURA: "documento sem leitura automática",
};
