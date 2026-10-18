// Regras da Clicksign na VENDA (signatários padrão + partes extras), sem Deno: usadas pela edge
// function clicksign-sale, pela tela (pré-validação) e pelos testes. Mensagens nunca levam e-mail.
import {
  MAX_IMOBILIARIA_SIGNERS,
  normEmail,
  normName,
  validEmail,
  validSignerName,
  WITNESS_COUNT,
  type PersonInput,
} from "./clicksign.ts";

export const MAX_EXTRAS = 10;

/** Qualificações (lista oficial da Clicksign) com o nome mostrado na tela. */
export const SALE_ROLE_LABEL: Record<string, string> = {
  seller: "Vendedor(a)",
  buyer: "Comprador(a)",
  real_estate_broker: "Corretor(a) de imóveis",
  intermediary: "Intermediário(a)",
  witness: "Testemunha",
  lawyer: "Advogado(a)",
  consenting: "Anuente",
  consenting_intervenor: "Interveniente anuente",
  intervening: "Interveniente",
  party: "Parte",
  attorney: "Procurador(a)",
};

/** Papéis permitidos para parte extra. Advogado = lawyer; cônjuge = consenting (Anuente). */
export const EXTRA_ROLES = [
  "lawyer",
  "consenting",
  "consenting_intervenor",
  "intervening",
  "party",
  "attorney",
  "real_estate_broker",
  "intermediary",
  "buyer",
  "seller",
] as const;

export type SalePapel =
  | "vendedor"
  | "comprador"
  | "corretor"
  | "imobiliaria"
  | "testemunha"
  | "extra_sistema"
  | "extra_externo";

export const ROLE_BY_SALE_PAPEL: Record<
  "vendedor" | "comprador" | "corretor" | "imobiliaria" | "testemunha",
  string
> = {
  vendedor: "seller",
  comprador: "buyer",
  corretor: "real_estate_broker",
  imobiliaria: "intermediary",
  testemunha: "witness",
};

/** Papéis que dá para corrigir (nome/e-mail) com o envelope rodando. Corretor, imobiliária e
 * parte puxada do sistema vêm de cadastro: corrige-se lá. */
export const SALE_EDITABLE_PAPEIS: ReadonlySet<string> = new Set([
  "vendedor",
  "comprador",
  "testemunha",
  "extra_externo",
]);

export type SaleParty = {
  papel: string;
  nome?: string | null;
  email?: string | null;
  tipo_pessoa?: string | null;
};
export type SaleExtra = {
  origem: "sistema" | "externo";
  nome?: string | null;
  email?: string | null;
  role: string;
  cpf?: string | null;
};
export type SaleSigner = {
  papel: SalePapel;
  label: string;
  nome: string;
  email: string;
  role: string;
  parte?: string;
  /** CPF formatado (000.000.000-00), só para pessoa de fora que informou. */
  documentation?: string;
};
export type MissingEmail = { parte: string; label: string; nome: string };

const PARTE_RE = /^(vendedor|comprador)_(\d+)$/;

export function saleParteLabel(parte: string): string {
  const m = PARTE_RE.exec(parte);
  if (!m) return parte;
  return `${m[1] === "vendedor" ? "Vendedor" : "Comprador"} ${m[2]}`;
}

/** Vendedores primeiro, depois compradores, cada lado pela numeração. Ignora outros papéis. */
export function sortPartes<T extends { papel: string }>(list: T[]): T[] {
  const key = (p: string): [number, number] => {
    const m = PARTE_RE.exec(p);
    return m ? [m[1] === "vendedor" ? 0 : 1, Number(m[2])] : [9, 0];
  };
  return list
    .filter((p) => PARTE_RE.test(p.papel))
    .sort((a, b) => {
      const ka = key(a.papel);
      const kb = key(b.papel);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
}

/** Partes da venda sem e-mail válido (vendas antigas): bloqueiam o envio, sem preencher nada. */
export function missingPartyEmails(parties: SaleParty[]): MissingEmail[] {
  return sortPartes(parties)
    .filter((p) => !validEmail(p.email))
    .map((p) => ({ parte: p.papel, label: saleParteLabel(p.papel), nome: normName(p.nome) }));
}

export const missingEmailMessage = (m: MissingEmail) =>
  `Preencha o e-mail de ${m.label}${m.nome ? ` (${m.nome})` : ""} na aba Partes`;

/** CPF opcional da pessoa de fora: aceita com ou sem pontuação; devolve formatado ou null. */
export function formatCpf(v: string | null | undefined): string | null | "invalid" {
  const d = (v ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return "invalid";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export type BuildSaleInput = {
  parties: SaleParty[];
  corretores: PersonInput[];
  imobiliaria: PersonInput[];
  testemunhas: PersonInput[];
  extras: SaleExtra[];
};

/**
 * Monta e valida os signatários da venda: todas as partes (vendedores e compradores), o(s)
 * corretor(es) da venda, quem assina pela imobiliária, 2 testemunhas e as partes extras.
 * Todos assinam ao mesmo tempo (sem ordem).
 */
export function buildSaleSigners(input: BuildSaleInput): {
  signers: SaleSigner[];
  errors: string[];
  missingEmail: MissingEmail[];
} {
  const errors: string[] = [];
  const signers: SaleSigner[] = [];
  const push = (
    papel: SalePapel,
    label: string,
    p: PersonInput,
    role: string,
    extra: Partial<SaleSigner> = {},
  ) => {
    const nome = normName(p.nome);
    const email = normEmail(p.email);
    if (!validSignerName(nome)) errors.push(`${label}: informe nome e sobrenome`);
    if (!validEmail(email)) errors.push(`${label}: e-mail ausente ou inválido`);
    signers.push({ papel, label, nome, email, role, ...extra });
  };

  const partes = sortPartes(input.parties);
  if (!partes.some((p) => p.papel.startsWith("vendedor_")))
    errors.push("Cadastre ao menos 1 vendedor na aba Partes");
  if (!partes.some((p) => p.papel.startsWith("comprador_")))
    errors.push("Cadastre ao menos 1 comprador na aba Partes");
  const missingEmail = missingPartyEmails(partes);
  const missing = new Set(missingEmail.map((m) => m.parte));
  for (const p of partes) {
    const label = saleParteLabel(p.papel);
    if (missing.has(p.papel)) {
      errors.push(missingEmailMessage(missingEmail.find((m) => m.parte === p.papel)!));
      if (!validSignerName(p.nome)) errors.push(`${label}: informe nome e sobrenome`);
      continue;
    }
    const lado = p.papel.startsWith("vendedor_") ? "vendedor" : "comprador";
    push(lado, label, p, ROLE_BY_SALE_PAPEL[lado], { parte: p.papel });
  }

  if (input.corretores.length < 1) errors.push("A venda está sem corretor com cadastro");
  input.corretores.forEach((c, i) =>
    push(
      "corretor",
      input.corretores.length > 1 ? `Corretor ${i + 1}` : "Corretor",
      c,
      ROLE_BY_SALE_PAPEL.corretor,
    ),
  );
  if (input.imobiliaria.length < 1)
    errors.push("Escolha ao menos 1 pessoa para assinar pela imobiliária");
  if (input.imobiliaria.length > MAX_IMOBILIARIA_SIGNERS)
    errors.push("Signatários da imobiliária demais");
  input.imobiliaria
    .slice(0, MAX_IMOBILIARIA_SIGNERS)
    .forEach((p, i) =>
      push("imobiliaria", `Imobiliária ${i + 1}`, p, ROLE_BY_SALE_PAPEL.imobiliaria),
    );
  if (input.testemunhas.length !== WITNESS_COUNT)
    errors.push(`Informe exatamente ${WITNESS_COUNT} testemunhas`);
  input.testemunhas
    .slice(0, WITNESS_COUNT)
    .forEach((p, i) => push("testemunha", `Testemunha ${i + 1}`, p, ROLE_BY_SALE_PAPEL.testemunha));

  if (input.extras.length > MAX_EXTRAS) errors.push(`No máximo ${MAX_EXTRAS} partes extras`);
  input.extras.slice(0, MAX_EXTRAS).forEach((x, i) => {
    const base = `Parte extra ${i + 1}`;
    if (!(EXTRA_ROLES as readonly string[]).includes(x.role)) {
      errors.push(`${base}: papel inválido`);
      return;
    }
    const label = `${base} (${SALE_ROLE_LABEL[x.role]})`;
    const extra: Partial<SaleSigner> = {};
    if (x.origem === "externo") {
      const cpf = formatCpf(x.cpf);
      if (cpf === "invalid") errors.push(`${label}: CPF inválido (ou deixe em branco)`);
      else if (cpf) extra.documentation = cpf;
    }
    push(x.origem === "sistema" ? "extra_sistema" : "extra_externo", label, x, x.role, extra);
  });

  const seen = new Map<string, string>();
  for (const s of signers) {
    if (!s.email) continue;
    const prev = seen.get(s.email);
    if (prev) errors.push(`A mesma pessoa não pode assinar duas vezes (${prev} e ${s.label})`);
    else seen.set(s.email, s.label);
  }
  return { signers, errors: [...new Set(errors)], missingEmail };
}
