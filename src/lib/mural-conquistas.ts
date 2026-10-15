// Regras puras da tela do Mural de Conquistas (card t_f40b6920). Sem rede: testável e reaproveitável.
// Nunca carrega valor, comissão nem cliente — o feed só aceita os campos da lista branca abaixo.

export type FeedPost = {
  id: string;
  venda_em: string;
  captador_nome: string | null;
  vendedor_nome: string | null;
  coordenador_nome: string | null;
  tipo_imovel: string | null;
  bairro: string | null;
  cidade: string | null;
  cheers: number;
  cheered_by_me: boolean;
};

export type Cheerer = { post_id: string; user_id: string; nome: string | null };
export type RankingRow = {
  user_id: string;
  nome: string | null;
  avatar_url: string | null;
  pontos: number;
};
export type BirthdayRow = {
  user_id: string;
  nome: string | null;
  avatar_url: string | null;
  dia: number;
  mes: number;
};

export type Participante = { nome: string; papel: "Captação" | "Venda" | "Coordenação" };

const TZ = "America/Sao_Paulo";

/** Lista branca: qualquer campo extra que vier do banco é descartado antes de chegar à tela. */
export function sanitizeFeed(rows: unknown): FeedPost[] {
  if (!Array.isArray(rows)) return [];
  const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return rows
    .filter(
      (r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof r.id === "string",
    )
    .map((r) => ({
      id: r.id as string,
      venda_em: String(r.venda_em ?? ""),
      captador_nome: txt(r.captador_nome),
      vendedor_nome: txt(r.vendedor_nome),
      coordenador_nome: txt(r.coordenador_nome),
      tipo_imovel: txt(r.tipo_imovel),
      bairro: txt(r.bairro),
      cidade: txt(r.cidade),
      cheers: Math.max(0, Number(r.cheers ?? 0) || 0),
      cheered_by_me: r.cheered_by_me === true,
    }));
}

/** Participantes com papel; a mesma pessoa em captação e venda aparece uma vez só ("Captação e venda"). */
export function participantes(p: FeedPost): { nome: string; papel: string }[] {
  const out: { nome: string; papel: string }[] = [];
  const add = (nome: string | null, papel: Participante["papel"]) => {
    if (!nome) return;
    const ja = out.find((x) => x.nome === nome);
    if (ja) ja.papel = `${ja.papel} e ${papel.toLowerCase()}`;
    else out.push({ nome, papel });
  };
  add(p.captador_nome, "Captação");
  add(p.vendedor_nome, "Venda");
  add(p.coordenador_nome, "Coordenação");
  return out;
}

export function descricaoImovel(p: FeedPost): string {
  const local = [p.bairro, p.cidade].filter(Boolean).join(", ");
  return [p.tipo_imovel, local].filter(Boolean).join(" · ");
}

export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  const a = partes[0][0] ?? "";
  const b = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
  return (a + b).toUpperCase();
}

/** Data da venda em São Paulo, ex.: "15/10/2026". */
export function dataVenda(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** Ano e mês correntes em São Paulo (venda às 23h30 do dia 31 em SP ainda é daquele mês). */
export function mesAtualSP(now: Date = new Date()): { ano: number; mes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const ano = Number(parts.find((x) => x.type === "year")?.value);
  const mes = Number(parts.find((x) => x.type === "month")?.value);
  return { ano, mes };
}

export function diaAtualSP(now: Date = new Date()): { dia: number; mes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return {
    dia: Number(parts.find((x) => x.type === "day")?.value),
    mes: Number(parts.find((x) => x.type === "month")?.value),
  };
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function nomeMes(ano: number, mes: number): string {
  return `${MESES[mes - 1] ?? "?"} de ${ano}`;
}

/** Últimos N meses (o atual primeiro) para o seletor do ranking. */
export function ultimosMeses(n: number, now: Date = new Date()): { ano: number; mes: number }[] {
  const { ano, mes } = mesAtualSP(now);
  const out: { ano: number; mes: number }[] = [];
  for (let i = 0; i < n; i++) {
    const total = ano * 12 + (mes - 1) - i;
    out.push({ ano: Math.floor(total / 12), mes: (total % 12) + 1 });
  }
  return out;
}

export function rotuloPontos(n: number): string {
  return `${n} ${n === 1 ? "venda" : "vendas"}`;
}

/** Ranking com posição; empates dividem a mesma posição (1º, 1º, 3º). */
export function rankingComPosicao(rows: RankingRow[]): (RankingRow & { posicao: number })[] {
  const ordenado = [...rows]
    .map((r) => ({ ...r, pontos: Number(r.pontos) || 0 }))
    .sort((a, b) => b.pontos - a.pontos || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR"));
  let posicao = 0;
  return ordenado.map((r, i) => {
    if (i === 0 || r.pontos !== ordenado[i - 1].pontos) posicao = i + 1;
    return { ...r, posicao };
  });
}

/** Rótulo do aniversário: só dia/mês (nunca ano ou idade). */
export function rotuloAniversario(b: BirthdayRow, hoje: { dia: number; mes: number }): string {
  const dm = `${String(b.dia).padStart(2, "0")}/${String(b.mes).padStart(2, "0")}`;
  return b.dia === hoje.dia && b.mes === hoje.mes ? `hoje · ${dm}` : dm;
}

/**
 * Parabéns otimista: no máximo um por usuário. Se já parabenizou, devolve o mesmo array (no-op).
 * O banco também garante (PK post_id+user_id e ON CONFLICT DO NOTHING).
 */
export function aplicarParabens(posts: FeedPost[], postId: string): FeedPost[] {
  const alvo = posts.find((p) => p.id === postId);
  if (!alvo || alvo.cheered_by_me) return posts;
  return posts.map((p) =>
    p.id === postId ? { ...p, cheered_by_me: true, cheers: p.cheers + 1 } : p,
  );
}

/** Confirma com o total devolvido pelo banco (fonte da verdade). */
export function confirmarParabens(posts: FeedPost[], postId: string, total: number): FeedPost[] {
  return posts.map((p) =>
    p.id === postId ? { ...p, cheered_by_me: true, cheers: Math.max(0, total) } : p,
  );
}

/** Desfaz o otimista quando a RPC falha. */
export function desfazerParabens(
  posts: FeedPost[],
  postId: string,
  antes: FeedPost | undefined,
): FeedPost[] {
  if (!antes) return posts;
  return posts.map((p) => (p.id === postId ? { ...antes } : p));
}

export function agruparQuemParabenizou(rows: Cheerer[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r.nome) continue;
    (out[r.post_id] ??= []).push(r.nome);
  }
  return out;
}

/** Texto curto "Ana, Caio e mais 3" para a lista de quem parabenizou. */
export function resumoQuemParabenizou(nomes: string[], total: number, max = 3): string {
  const primeiros = (n: string) => n.split(/\s+/)[0];
  const mostrados = nomes.slice(0, max).map(primeiros);
  const resto = Math.max(0, total - mostrados.length);
  if (!mostrados.length) return "";
  if (!resto) {
    return mostrados.length === 1
      ? mostrados[0]
      : `${mostrados.slice(0, -1).join(", ")} e ${mostrados[mostrados.length - 1]}`;
  }
  return `${mostrados.join(", ")} e mais ${resto}`;
}
