// Dados de pagamento do parceiro na parceria da locação (t_756c1c63; migration 20261212120000).
// Regras puras usadas pelas telas. O banco repete todas as validações e só deixa ler/gravar o Financeiro da locação e a
// gestão (locacao_parceiro_pag_pode); o corretor recebe {pode:false} sem dado nenhum.
import { cpfValido, lerConfig, type ConfigLocacao } from "@/lib/locacao";

export type ParceriaLado = "captador" | "locatario";
export const PARCERIA_LADO_LABEL: Record<ParceriaLado, string> = {
  captador: "Captador (lado do proprietário)",
  locatario: "Corretor do locatário",
};
export const ladoValido = (v: unknown): ParceriaLado | "" =>
  v === "captador" || v === "locatario" ? v : "";

export type FavorecidoTipo = "imobiliaria" | "corretor";
export const FAVORECIDO_LABEL: Record<FavorecidoTipo, string> = {
  imobiliaria: "Imobiliária (CNPJ)",
  corretor: "Corretor (CPF)",
};

export type PagamentoValores = {
  favorecidoTipo: FavorecidoTipo | "";
  favorecidoNome: string;
  documento: string;
  pix: string;
  banco: string;
  agencia: string;
  conta: string;
  telefone: string;
  email: string;
  emiteNf: "" | "sim" | "nao";
};

export const PAGAMENTO_VAZIO: PagamentoValores = {
  favorecidoTipo: "",
  favorecidoNome: "",
  documento: "",
  pix: "",
  banco: "",
  agencia: "",
  conta: "",
  telefone: "",
  email: "",
  emiteNf: "",
};

/** CNPJ sem pontuação, em maiúsculas. Espelho de locacao_cnpj_limpo(). */
export const cnpjLimpo = (v: string) => v.replace(/[./ -]/g, "").toUpperCase();

/**
 * CNPJ com dígitos verificadores, numérico ou alfanumérico (Receita, 07/2026). Espelho de locacao_cnpj_ok():
 * cada caractere vale (código − 48); os 2 últimos são números.
 */
export function cnpjValido(v: string): boolean {
  if (!/^[0-9A-Za-z./ -]+$/.test(v)) return false;
  const d = cnpjLimpo(v);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos =
      n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, p, i) => a + (d.charCodeAt(i) - 48) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

const o = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const t = (v: unknown): string => (typeof v === "string" ? v : "");

/** CPF ou CNPJ com pontuação, para a tela. */
export function documentoTela(tipo: FavorecidoTipo | "", doc: string): string {
  const d = doc.replace(/\D/g, "");
  if (tipo === "corretor" && d.length === 11)
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  const c = cnpjLimpo(doc);
  if (tipo === "imobiliaria" && c.length === 14)
    return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  return doc;
}

export function lerPagamento(raw: unknown): PagamentoValores | null {
  if (!raw || typeof raw !== "object") return null;
  const x = o(raw);
  const tipo =
    x.favorecido_tipo === "imobiliaria" || x.favorecido_tipo === "corretor"
      ? x.favorecido_tipo
      : "";
  return {
    favorecidoTipo: tipo,
    favorecidoNome: t(x.favorecido_nome),
    documento: documentoTela(tipo, t(x.documento)),
    pix: t(x.pix),
    banco: t(x.banco),
    agencia: t(x.agencia),
    conta: t(x.conta),
    telefone: t(x.telefone),
    email: t(x.email),
    emiteNf: x.emite_nf === true ? "sim" : x.emite_nf === false ? "nao" : "",
  };
}

/** Espelho das regras de locacao_parceiro_pag_salvar (mesma ordem das mensagens). */
export function faltasPagamento(v: PagamentoValores): string[] {
  const f: string[] = [];
  if (!v.favorecidoTipo) f.push("favorecido (imobiliária ou corretor)");
  if (v.favorecidoNome.trim().length < 2) f.push("nome do favorecido");
  if (v.favorecidoTipo === "corretor" && !cpfValido(v.documento.trim())) f.push("CPF válido");
  if (v.favorecidoTipo === "imobiliaria" && !cnpjValido(v.documento.trim())) f.push("CNPJ válido");
  if (!v.pix.trim() && (!v.banco.trim() || !v.agencia.trim() || !v.conta.trim())) {
    f.push("PIX ou banco, agência e conta");
  }
  if (v.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) f.push("e-mail válido");
  if (!v.emiteNf) f.push("emite nota fiscal?");
  return f;
}

export function pagamentoParaBanco(v: PagamentoValores): Record<string, string | boolean | null> {
  const s = (x: string) => (x.trim() === "" ? null : x.trim());
  return {
    favorecido_tipo: v.favorecidoTipo || null,
    favorecido_nome: s(v.favorecidoNome),
    documento: s(v.documento),
    pix: s(v.pix),
    banco: s(v.banco),
    agencia: s(v.agencia),
    conta: s(v.conta),
    telefone: s(v.telefone),
    email: s(v.email),
    emite_nf: v.emiteNf === "sim" ? true : v.emiteNf === "nao" ? false : null,
  };
}

/** Resumo de uma linha do pagamento (para listas). */
export function resumoPagamento(p: PagamentoValores): string {
  const destino = p.pix ? `PIX ${p.pix}` : `${p.banco} · ag. ${p.agencia} · conta ${p.conta}`;
  return `${p.favorecidoNome} (${p.favorecidoTipo === "imobiliaria" ? "CNPJ" : "CPF"} ${p.documento}) · ${destino} · NF: ${p.emiteNf === "sim" ? "sim" : "não"}`;
}

/** Uma linha da lista "Pagamentos a parceiros" do Financeiro (RPC locacao_parceiros_pagar). */
export type ParceiroPagar = {
  id: string;
  codigo: string;
  endereco: string;
  chaveEm: string | null;
  /** Locação encerrada: o Financeiro vê o aviso antes de pagar. */
  encerrada: boolean;
  aluguel: number;
  taxaAdm: number;
  parceria: "remax" | "externa";
  lado: ParceriaLado | "";
  parceiroNome: string;
  corretor: string;
  creci: string;
  valorParceiro: number;
  pagamento: PagamentoValores | null;
};

/** Valor a pagar ao parceiro: metade do aluguel, nunca da taxa de administração nem da comissão interna. */
export function valorParceiro(aluguel: number): number {
  return Math.round(aluguel * 50) / 100;
}

export function lerParceirosPagar(raw: unknown): { config: ConfigLocacao; itens: ParceiroPagar[] } {
  const x = o(raw);
  const config = lerConfig(x.config);
  const itens = (Array.isArray(x.itens) ? x.itens : []).map((r) => {
    const i = o(r);
    const aluguel = Number(i.aluguel) || 0;
    const taxaAdm = Number(i.taxa_adm) || 0;
    const parceria = i.parceria === "remax" ? "remax" : "externa";
    return {
      id: t(i.id),
      codigo: t(i.codigo),
      endereco: t(i.endereco),
      chaveEm: t(i.chave_em) || null,
      encerrada: i.situacao === "encerrada",
      aluguel,
      taxaAdm,
      parceria,
      lado: ladoValido(i.parceria_lado),
      parceiroNome: parceria === "remax" ? t(i.parceria_unidade) : t(i.parceria_imobiliaria),
      corretor: t(i.parceria_corretor),
      creci: t(i.parceria_creci),
      valorParceiro: i.valor_parceiro == null ? valorParceiro(aluguel) : Number(i.valor_parceiro),
      pagamento: lerPagamento(i.pagamento),
    } satisfies ParceiroPagar;
  });
  return { config, itens };
}
