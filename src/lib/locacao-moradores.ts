// Ficha de moradores da locação (t_40cff7e4, migration 20261216120000). Regras puras, espelho do banco:
// - maior de 18 (data civil de hoje em São Paulo) → item obrigatório "Cópia do RG — <nome>" no checklist do locatário;
// - o contrato continua recebendo "Nome — CPF xxx", um por linha (mesmo texto de antes, gerado da ficha);
// - e-mail e telefone obrigatórios para maiores de 18 (a administradora do condomínio cadastra), opcionais para menores.
import { cpfValido } from "@/lib/locacao";

export type Morador = {
  id: string;
  nome: string;
  cpf: string;
  nascimento: string;
  email: string;
  telefone: string;
};

export const MAX_MORADORES = 20;

export const AVISO_LGPD_MORADORES =
  "Os dados dos moradores (nome, CPF, nascimento, e-mail, telefone e cópia do RG) serão repassados à administradora do condomínio para cadastro. O contrato recebe só nome e CPF.";

export const moradorVazio = (id: string): Morador => ({
  id,
  nome: "",
  cpf: "",
  nascimento: "",
  email: "",
  telefone: "",
});

/** 18 anos completos em `hoje` (AAAA-MM-DD). Espelho de locacao_morador_adulto (data civil, sem fuso). */
export function moradorAdulto(nascimento: string, hoje: string): boolean {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(nascimento) || !re.test(hoje)) return false;
  const [a, m, d] = hoje.split("-").map(Number);
  // `date - interval '18 years'` no Postgres: 29/02 vira 28/02 em ano não bissexto.
  const ano = a - 18;
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const dia = m === 2 && d === 29 && !bissexto ? 28 : d;
  const limite = `${ano}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  return nascimento <= limite;
}

/** Nome do item no checklist. Espelho de locacao_morador_item. */
export const itemRgMorador = (nome: string) => `Cópia do RG — ${nome.trim()}`;
export const ehItemRgMorador = (item: string) => item.startsWith("Cópia do RG — ");

/** CPF sempre com máscara 000.000.000-00 (sem 11 dígitos, devolve como veio). Espelho de locacao_cpf_mascara. */
export function mascaraCpf(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length === 11
    ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    : v.trim();
}

/** Texto que vai para o contrato (campo "moradores"). Espelho de locacao_moradores_texto. */
export function textoMoradores(pessoas: Morador[]): string {
  return pessoas.map((p) => `${p.nome.trim()} — CPF ${mascaraCpf(p.cpf)}`).join("\n");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digitos = (v: string) => v.replace(/\D/g, "");

/** Problemas de um morador (vazio = ok). Mesmas regras de locacao_moradores_salvar. */
export function errosMorador(p: Morador, hoje: string): string[] {
  const e: string[] = [];
  const nome = p.nome.trim();
  if (nome.length < 3 || nome.length > 120) e.push("nome completo");
  if (!cpfValido(p.cpf.trim())) e.push("CPF válido");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(p.nascimento) ||
    p.nascimento < "1900-01-01" ||
    p.nascimento > hoje
  )
    e.push("data de nascimento");
  const adulto = moradorAdulto(p.nascimento, hoje);
  const email = p.email.trim();
  if ((adulto || email) && (email.length > 200 || !EMAIL.test(email))) e.push("e-mail");
  const tel = digitos(p.telefone);
  if ((adulto || p.telefone.trim()) && (tel.length < 10 || tel.length > 13))
    e.push("telefone com DDD");
  return e;
}

/** Problemas da lista inteira (repetidos e limite). */
export function errosLista(pessoas: Morador[]): string[] {
  const e: string[] = [];
  if (pessoas.length > MAX_MORADORES) e.push(`no máximo ${MAX_MORADORES} moradores`);
  const nomes = new Set(pessoas.map((p) => p.nome.trim().toLowerCase()));
  const cpfs = new Set(pessoas.map((p) => digitos(p.cpf)));
  if (nomes.size !== pessoas.length || cpfs.size !== pessoas.length)
    e.push("morador repetido (mesmo nome ou CPF)");
  return e;
}

export function lerMoradoresRpc(raw: unknown): {
  ficha: boolean;
  obrigatoria: boolean;
  pessoas: Morador[];
  /** Data usada para contar os 18 anos (hoje na Documentação; congelada depois). Vazio = hoje. */
  referencia: string;
  congelada: boolean;
  downloads: { em: string; por: string | null }[];
} {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const pessoas = (Array.isArray(o.pessoas) ? o.pessoas : []).map((x) => {
    const p = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return {
      id: s(p.id),
      nome: s(p.nome),
      cpf: s(p.cpf),
      nascimento: s(p.nascimento),
      email: s(p.email),
      telefone: s(p.telefone),
    };
  });
  const downloads = (Array.isArray(o.downloads) ? o.downloads : []).map((x) => {
    const d = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return { em: s(d.em), por: typeof d.por === "string" ? d.por : null };
  });
  const ref = s(o.referencia);
  return {
    ficha: o.ficha === true,
    obrigatoria: o.obrigatoria === true,
    pessoas,
    referencia: /^\d{4}-\d{2}-\d{2}$/.test(ref) ? ref : "",
    congelada: o.congelada === true,
    downloads,
  };
}
