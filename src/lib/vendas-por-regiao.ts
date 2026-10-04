/**
 * "Vendas por região": agrupa as vendas efetivadas por cidade e bairro do imóvel.
 * Só leitura e só apresentação — a base é a mesma camada canônica dos demais relatórios
 * (vendas_comerciais_canonicas), com a data da assinatura do contrato (America/Sao_Paulo).
 */
export type VendaRegiaoRow = {
  sale_id: string;
  data_fechamento: string | null;
  modalidade: string | null;
  status: string | null;
  codigo_interno: string | null;
  imovel_id: string | null;
  corretor_id: string | null;
  valor_negociado: number | string | null;
  imovel_endereco: string | null;
  imovel_bairro: string | null;
  imovel_cidade: string | null;
  imovel_uf: string | null;
  imovel_cep: string | null;
};

export const SEM_CIDADE = "Sem cidade informada";
export const SEM_BAIRRO = "Sem bairro informado";

/** Chave para juntar grafias diferentes do mesmo nome ("SOROCABA", "Sorocaba", "São"/"Sao"). */
export function chaveNome(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e"]);
/** "JARDIM SÃO CARLOS" -> "Jardim São Carlos"; mantém o texto se já vier misto. */
export function nomeExibicao(v: string): string {
  const t = v.replace(/\s+/g, " ").trim();
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export type VendaRegiao = {
  saleId: string;
  data: string | null;
  codigo: string;
  endereco: string;
  bairro: string;
  cidade: string;
  vgv: number;
  modalidade: string | null;
};

export type GrupoBairro = {
  chave: string;
  bairro: string;
  vendas: VendaRegiao[];
  qtd: number;
  vgv: number;
};
export type GrupoCidade = {
  chave: string;
  cidade: string;
  uf: string | null;
  qtd: number;
  vgv: number;
  bairros: GrupoBairro[];
};

export type FiltrosRegiao = { dataDe: string; dataAte: string; busca: string };

export function montarVendas(rows: VendaRegiaoRow[]): VendaRegiao[] {
  return rows.map((r) => ({
    saleId: r.sale_id,
    data: r.data_fechamento,
    codigo: r.codigo_interno || r.imovel_id || "—",
    endereco: (r.imovel_endereco ?? "").trim(),
    bairro: (r.imovel_bairro ?? "").trim(),
    cidade: [(r.imovel_cidade ?? "").trim(), (r.imovel_uf ?? "").trim()].filter(Boolean).join("|"),
    vgv: Number(r.valor_negociado) || 0,
    modalidade: r.modalidade,
  }));
}

export function filtrarVendas(vendas: VendaRegiao[], f: FiltrosRegiao): VendaRegiao[] {
  const q = chaveNome(f.busca);
  return vendas.filter((v) => {
    if (f.dataDe && (!v.data || v.data < f.dataDe)) return false;
    if (f.dataAte && (!v.data || v.data > f.dataAte)) return false;
    if (q) {
      const alvo = chaveNome(
        [v.endereco, v.bairro, v.cidade.replace("|", " "), v.codigo].join(" "),
      );
      if (!alvo.includes(q)) return false;
    }
    return true;
  });
}

/** Grafia mais frequente entre as variações do mesmo nome. */
function maisFrequente(nomes: string[]): string {
  const c = new Map<string, number>();
  for (const n of nomes) c.set(n, (c.get(n) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export function agruparPorRegiao(vendas: VendaRegiao[]): GrupoCidade[] {
  const cidades = new Map<string, { nomes: string[]; ufs: string[]; vendas: VendaRegiao[] }>();
  for (const v of vendas) {
    const [cidade, uf] = v.cidade.split("|");
    const k = chaveNome(cidade) || "~sem";
    const g = cidades.get(k) ?? { nomes: [], ufs: [], vendas: [] };
    if (cidade) g.nomes.push(nomeExibicao(cidade));
    if (uf) g.ufs.push(uf.toUpperCase());
    g.vendas.push(v);
    cidades.set(k, g);
  }
  const out: GrupoCidade[] = [];
  for (const [k, g] of cidades) {
    const bairros = new Map<string, { nomes: string[]; vendas: VendaRegiao[] }>();
    for (const v of g.vendas) {
      const kb = chaveNome(v.bairro) || "~sem";
      const b = bairros.get(kb) ?? { nomes: [], vendas: [] };
      if (v.bairro) b.nomes.push(nomeExibicao(v.bairro));
      b.vendas.push(v);
      bairros.set(kb, b);
    }
    const listaBairros: GrupoBairro[] = [...bairros].map(([kb, b]) => ({
      chave: kb,
      bairro: b.nomes.length ? maisFrequente(b.nomes) : SEM_BAIRRO,
      vendas: [...b.vendas].sort((a, c) => (c.data ?? "").localeCompare(a.data ?? "")),
      qtd: b.vendas.length,
      vgv: b.vendas.reduce((s, v) => s + v.vgv, 0),
    }));
    listaBairros.sort((a, b) => ordenar(a.chave, b.chave, a.qtd, b.qtd, a.vgv, b.vgv));
    out.push({
      chave: k,
      cidade: g.nomes.length ? maisFrequente(g.nomes) : SEM_CIDADE,
      uf: g.ufs.length ? maisFrequente(g.ufs) : null,
      qtd: g.vendas.length,
      vgv: g.vendas.reduce((s, v) => s + v.vgv, 0),
      bairros: listaBairros,
    });
  }
  return out.sort((a, b) => ordenar(a.chave, b.chave, a.qtd, b.qtd, a.vgv, b.vgv));
}

/** Mais vendas primeiro; empate pelo VGV; "sem cidade/bairro" sempre no fim. */
function ordenar(ka: string, kb: string, qa: number, qb: number, va: number, vb: number): number {
  const sa = ka === "~sem" ? 1 : 0;
  const sb = kb === "~sem" ? 1 : 0;
  return sa - sb || qb - qa || vb - va;
}
