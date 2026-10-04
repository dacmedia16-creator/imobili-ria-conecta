import {
  captureUnitKey,
  captureUnitLabel,
  captureValidity,
  type Capture,
  type ExclusiveUnit,
  type Validity,
} from "./exclusive-captures";

/** "R$ 870.000,00", "730.000", "195.000,00" -> número em reais (null se vazio/ilegível). */
export function parseBRL(raw: string | undefined | null): number | null {
  const s = (raw ?? "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  const n = s.includes(",")
    ? Number(s.replace(/\./g, "").replace(",", "."))
    : Number(s.replace(/\./g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
export const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const clean = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
/** Bairro com grafia unificada (maiúsculas/minúsculas e espaços). */
export function bairroLabel(c: Capture): string {
  const b = clean(c.form_data.imovel?.bairro);
  if (!b) return "Sem bairro";
  return b.toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());
}

export type Situation = "em_vigor" | "vencendo" | "vencida" | "em_andamento" | "rascunho";
export const SITUATION_LABEL: Record<Situation, string> = {
  em_vigor: "Em vigor",
  vencendo: "Vence em até 30 dias",
  vencida: "Vencida",
  em_andamento: "Em andamento (enviada/assinatura)",
  rascunho: "Rascunho",
};
export const SITUATION_COLOR: Record<Situation, string> = {
  em_vigor: "#059669",
  vencendo: "#d97706",
  vencida: "#6b7280",
  em_andamento: "#2563eb",
  rascunho: "#a3a3a3",
};
export function situation(c: Capture, today: string): { s: Situation; v: Validity | null } {
  const v = captureValidity(c, today);
  if (c.status === "aprovada") {
    if (!v) return { s: "em_vigor", v };
    return { s: v.daysLeft < 0 ? "vencida" : v.daysLeft <= 30 ? "vencendo" : "em_vigor", v };
  }
  if (c.status === "enviada" || c.status === "em_assinatura") return { s: "em_andamento", v };
  return { s: "rascunho", v };
}

export type Filters = {
  periodo: string;
  corretor: string;
  unidade: string;
  bairro: string;
  situacao: string;
  busca: string;
};
export const EMPTY_FILTERS: Filters = {
  periodo: "tudo",
  corretor: "",
  unidade: "",
  bairro: "",
  situacao: "",
  busca: "",
};
const fold = (x: string) =>
  x
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const dayMs = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
/** Uma captação passa nos filtros? (período pela data de criação, em São Paulo). Não olha arquivamento. */
export function matchFilters(
  c: Capture,
  f: Filters,
  today: string,
  units: ExclusiveUnit[] = [],
): boolean {
  const days = f.periodo === "tudo" ? null : Number(f.periodo);
  if (days !== null && utc(today) - utc(c.created_on_sp) > days * dayMs) return false;
  if (f.corretor && (c.broker_name || "—") !== f.corretor) return false;
  if (f.unidade && captureUnitKey(c, units) !== f.unidade) return false;
  if (f.bairro && bairroLabel(c) !== f.bairro) return false;
  if (f.situacao && situation(c, today).s !== f.situacao) return false;
  if (f.busca) {
    const i = c.form_data.imovel;
    const hay = fold([i?.endereco, i?.bairro, i?.tipo_imovel, c.broker_name].join(" "));
    if (
      !fold(f.busca)
        .split(/\s+/)
        .every((w) => hay.includes(w))
    )
      return false;
  }
  return true;
}
/** Captações ativas (não arquivadas) que passam nos filtros. */
export function applyFilters(
  list: Capture[],
  f: Filters,
  today: string,
  units: ExclusiveUnit[] = [],
): Capture[] {
  return list.filter((c) => !c.archived_at && matchFilters(c, f, today, units));
}
export const filtersActive = (f: Filters) =>
  (Object.keys(EMPTY_FILTERS) as (keyof Filters)[]).some((k) => f[k] !== EMPTY_FILTERS[k]);

export type Group = { key: string; total: number; aprovadas: number; valor: number };
export type Dashboard = {
  total: number;
  porSituacao: Record<Situation, number>;
  valorEmVigor: number;
  comissaoPotencial: number;
  semValor: number;
  mediaDiasAteAssinatura: number | null;
  porCorretor: Group[];
  porBairro: Group[];
  porUnidade: Group[];
  proximosVencimentos: { c: Capture; v: Validity }[];
};
/** Indicadores gerenciais das captações ativas (já filtradas e já restritas pelo banco às permitidas). */
export function buildDashboard(
  list: Capture[],
  today: string,
  units: ExclusiveUnit[] = [],
): Dashboard {
  const porSituacao: Record<Situation, number> = {
    em_vigor: 0,
    vencendo: 0,
    vencida: 0,
    em_andamento: 0,
    rascunho: 0,
  };
  let valorEmVigor = 0,
    comissaoPotencial = 0,
    semValor = 0;
  const ate: number[] = [];
  const groups = {
    c: new Map<string, Group>(),
    b: new Map<string, Group>(),
    u: new Map<string, Group>(),
  };
  const venc: { c: Capture; v: Validity }[] = [];
  for (const c of list) {
    const { s, v } = situation(c, today);
    porSituacao[s]++;
    const valor = parseBRL(c.form_data.imovel?.valor_imovel);
    const vigente = s === "em_vigor" || s === "vencendo";
    if (vigente) {
      if (valor === null) semValor++;
      else {
        valorEmVigor += valor;
        const pct = Number(
          (c.form_data.condicoes?.comissao_percentual_numero ?? "").replace(",", "."),
        );
        if (pct > 0) comissaoPotencial += (valor * pct) / 100;
      }
    }
    if (c.status === "aprovada" && c.signed_on)
      ate.push(Math.max(0, (utc(c.signed_on) - utc(c.created_on_sp)) / dayMs));
    if (v && v.daysLeft <= 60 && c.status === "aprovada") venc.push({ c, v });
    const add = (m: Map<string, Group>, key: string) => {
      const g = m.get(key) ?? { key, total: 0, aprovadas: 0, valor: 0 };
      g.total++;
      if (vigente) {
        g.aprovadas++;
        g.valor += valor ?? 0;
      }
      m.set(key, g);
    };
    add(groups.c, c.broker_name || "—");
    add(groups.b, bairroLabel(c));
    add(groups.u, captureUnitLabel(c, units));
  }
  const sort = (m: Map<string, Group>) =>
    [...m.values()].sort(
      (a, b) => b.aprovadas - a.aprovadas || b.total - a.total || a.key.localeCompare(b.key),
    );
  return {
    total: list.length,
    porSituacao,
    valorEmVigor,
    comissaoPotencial,
    semValor,
    mediaDiasAteAssinatura: ate.length
      ? Math.round(ate.reduce((a, b) => a + b, 0) / ate.length)
      : null,
    porCorretor: sort(groups.c),
    porBairro: sort(groups.b),
    porUnidade: sort(groups.u),
    proximosVencimentos: venc.sort((a, b) => a.v.daysLeft - b.v.daysLeft),
  };
}

/** Chave do endereço usada no mapa (sem dados de proprietário). Vazia = sem endereço para localizar. */
export function geoKey(c: Capture): string {
  const i = c.form_data.imovel;
  const parts = [i?.endereco, i?.bairro, i?.municipio, i?.estado].map((p) =>
    clean(p).toLowerCase(),
  );
  if (!parts[0] && !parts[1]) return "";
  return parts.join("|");
}
/** Consultas ao OpenStreetMap, da mais precisa para a aproximada (rua -> rua sem número -> bairro). */
export function geoQueries(c: Capture): string[] {
  const i = c.form_data.imovel;
  const city = clean(i?.municipio) || "Sorocaba";
  const uf = clean(i?.estado) || "SP";
  const rua = clean(i?.endereco).replace(/,\s*$/, "");
  const semNumero = rua.replace(/[,\s]+\d+\s*[a-z]?$/i, "").replace(/,.*$/, "");
  const bairro = clean(i?.bairro);
  const q: string[] = [];
  if (rua) q.push(`${rua}, ${bairro ? bairro + ", " : ""}${city}, ${uf}, Brasil`);
  if (semNumero && semNumero !== rua) q.push(`${semNumero}, ${city}, ${uf}, Brasil`);
  if (bairro) q.push(`${bairro}, ${city}, ${uf}, Brasil`);
  return q;
}
