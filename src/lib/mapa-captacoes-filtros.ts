/**
 * Filtros e contato do "Mapa de captações" (Denis, 08/10/2026). Tudo roda sobre as linhas já
 * cortadas pelo banco (mapa_captacoes_v2): aqui só se filtra e formata, nada novo é exposto.
 */
import type { CaptacaoMapaRow } from "@/lib/mapa-captacoes";
import { nomeExibicao } from "@/lib/vendas-por-regiao";

export type FiltrosMapa = {
  busca: string;
  tipo: string;
  precoMin: string;
  precoMax: string;
  captador: string;
  equipe: string;
};
export const FILTROS_VAZIOS: FiltrosMapa = {
  busca: "",
  tipo: "",
  precoMin: "",
  precoMax: "",
  captador: "",
  equipe: "",
};

const fold = (x: string) =>
  x
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** "R$ 850.000,00" / "850000" / "850.000" -> 850000. Vazio ou inválido -> null. */
export function precoNumero(raw: string | null | undefined): number | null {
  const s = (raw ?? "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  const n = s.includes(",")
    ? Number(s.replace(/\./g, "").replace(",", "."))
    : Number(s.replace(/\./g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function precoTexto(raw: string | null | undefined): string {
  const n = precoNumero(raw);
  return n == null
    ? "Preço não informado"
    : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

/** Tipo do imóvel normalizado para o filtro ("APARTAMENTO", "apartamento" -> "Apartamento"). */
export function tipoLabel(t: string | null | undefined): string {
  const v = (t ?? "").replace(/\s+/g, " ").trim();
  return v ? nomeExibicao(v) : "Não informado";
}

/** Só dígitos, com DDI 55 quando vier sem. null quando não parece telefone brasileiro. */
export function whatsappNumero(tel: string | null | undefined): string | null {
  let d = (tel ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d.length >= 12 && d.length <= 13 && d.startsWith("55") ? d : null;
}

export function whatsappLink(tel: string | null | undefined, codigo?: string): string | null {
  const n = whatsappNumero(tel);
  if (!n) return null;
  const msg = codigo ? `Olá! Vi a captação ${codigo} no mapa de captações.` : "";
  return `https://wa.me/${n}${msg ? "?text=" + encodeURIComponent(msg) : ""}`;
}

/** Opções dos selects (sem repetição, em ordem alfabética). */
export function opcoesFiltro(rows: CaptacaoMapaRow[]) {
  const uniq = (xs: string[]) =>
    [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    tipos: uniq(rows.map((r) => tipoLabel(r.tipo_imovel))),
    captadores: uniq(rows.map((r) => r.captador ?? "")),
    equipes: uniq(rows.map((r) => r.equipe ?? "")),
  };
}

export function filtrarCaptacoes(rows: CaptacaoMapaRow[], f: FiltrosMapa): CaptacaoMapaRow[] {
  const palavras = fold(f.busca).split(" ").filter(Boolean);
  const min = precoNumero(f.precoMin);
  const max = precoNumero(f.precoMax);
  return rows.filter((r) => {
    if (palavras.length) {
      const hay = fold([r.bairro, r.cidade, r.endereco, r.codigo].filter(Boolean).join(" "));
      if (!palavras.every((w) => hay.includes(w))) return false;
    }
    if (f.tipo && tipoLabel(r.tipo_imovel) !== f.tipo) return false;
    if (f.captador && (r.captador ?? "") !== f.captador) return false;
    if (f.equipe && (r.equipe ?? "") !== f.equipe) return false;
    if (min != null || max != null) {
      const p = precoNumero(r.valor_imovel);
      if (p == null) return false; // com faixa de preço, sem preço não entra
      if (min != null && p < min) return false;
      if (max != null && p > max) return false;
    }
    return true;
  });
}

export function filtrosAtivos(f: FiltrosMapa): number {
  return Object.values(f).filter((v) => v.trim() !== "").length;
}
