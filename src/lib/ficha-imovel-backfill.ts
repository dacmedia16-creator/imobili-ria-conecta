// Preenchimento das vendas antigas (t_8be054a9, item 4): usa SÓ as leituras já gravadas
// (document_extractions.raw_json da matrícula e do IPTU), sem reler documento nem chamar a IA.
// Tudo entra como "do documento, não confirmado" (area_origem = 'documento', sem confirmação): o
// corretor confirma depois. Nunca sobrescreve campo já preenchido na venda.
//
// Import relativo com extensão de propósito: o executor (scripts/ficha-imovel-backfill.ts) roda com
// `node` puro, sem o alias "@/".
import { sugerirAreas, type ExtracaoImovel, type TipoImovel } from "./ficha-imovel.ts";

export type VendaBackfill = {
  id: string;
  codigo: string;
  corretor: string | null;
  tipo_imovel: string | null;
  area_util_m2: number | string | null;
  area_construida_m2: number | string | null;
  area_terreno_m2: number | string | null;
  extracoes: ExtracaoImovel[];
};

export type PlanoVenda = {
  id: string;
  codigo: string;
  corretor: string | null;
  set: {
    tipo_imovel?: TipoImovel;
    area_util_m2?: number;
    area_construida_m2?: number;
    area_terreno_m2?: number;
  };
  sem_area: boolean;
  divergente: boolean;
  matricula_construida_m2: number | null;
  iptu_construida_m2: number | null;
};

const vazio = (v: unknown) => v == null || v === "";

export function planejarVenda(v: VendaBackfill): PlanoVenda {
  const s = sugerirAreas(v.extracoes, v.tipo_imovel);
  const set: PlanoVenda["set"] = {};
  if (vazio(v.tipo_imovel) && s.tipo_sugerido) set.tipo_imovel = s.tipo_sugerido;
  if (vazio(v.area_util_m2) && s.area_util_m2 != null) set.area_util_m2 = s.area_util_m2;
  if (vazio(v.area_construida_m2) && s.area_construida_m2 != null && s.tipo_sugerido !== "Terreno")
    set.area_construida_m2 = s.area_construida_m2;
  if (vazio(v.area_terreno_m2) && s.area_terreno_m2 != null) set.area_terreno_m2 = s.area_terreno_m2;
  const tipoFinal = (v.tipo_imovel ?? set.tipo_imovel ?? null) as string | null;
  const temArea =
    tipoFinal === "Terreno"
      ? !vazio(v.area_terreno_m2) || set.area_terreno_m2 != null
      : !vazio(v.area_util_m2) || set.area_util_m2 != null;
  return {
    id: v.id,
    codigo: v.codigo,
    corretor: v.corretor,
    set,
    sem_area: !temArea,
    divergente: s.divergente,
    matricula_construida_m2: s.matricula_construida_m2,
    iptu_construida_m2: s.iptu_construida_m2,
  };
}

export type ResumoBackfill = {
  total_vendas: number;
  preencheria: number;
  com_area_util_ou_terreno: number;
  sem_area: number;
  so_tipo: number;
  por_tipo: Record<string, number>;
  divergentes: { codigo: string; corretor: string | null; matricula_m2: number | null; iptu_m2: number | null }[];
};

export function resumir(planos: PlanoVenda[]): ResumoBackfill {
  const preenche = planos.filter((p) => Object.keys(p.set).length > 0);
  const porTipo: Record<string, number> = {};
  for (const p of preenche) {
    const t = p.set.tipo_imovel ?? "(sem tipo)";
    porTipo[t] = (porTipo[t] ?? 0) + 1;
  }
  return {
    total_vendas: planos.length,
    preencheria: preenche.length,
    com_area_util_ou_terreno: planos.filter((p) => !p.sem_area).length,
    sem_area: planos.filter((p) => p.sem_area).length,
    so_tipo: preenche.filter((p) => p.sem_area).length,
    por_tipo: porTipo,
    divergentes: planos
      .filter((p) => p.divergente)
      .map((p) => ({
        codigo: p.codigo,
        corretor: p.corretor,
        matricula_m2: p.matricula_construida_m2,
        iptu_m2: p.iptu_construida_m2,
      })),
  };
}

const lit = (v: string | number) =>
  typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

/**
 * SQL do preenchimento. `aplicar=false` (padrão) termina em ROLLBACK: serve de ensaio.
 * Cada UPDATE só grava em coluna ainda vazia (coalesce) e marca area_origem = 'documento' sem
 * confirmação. Não altera status nem dispara a trava (a trava só olha mudança de status).
 */
export function sqlPreenchimento(planos: PlanoVenda[], aplicar = false): string {
  const linhas = ["BEGIN;"];
  for (const p of planos) {
    const cols = Object.entries(p.set) as [string, string | number][];
    if (!cols.length) continue;
    const sets = cols.map(([c, v]) => `${c} = coalesce(${c}, ${lit(v)})`);
    if (p.set.area_util_m2 != null || p.set.area_terreno_m2 != null)
      sets.push("area_origem = coalesce(area_origem, 'documento')");
    linhas.push(`UPDATE public.sales SET ${sets.join(", ")} WHERE id = ${lit(p.id)};`);
  }
  linhas.push(aplicar ? "COMMIT;" : "ROLLBACK;");
  return linhas.join("\n") + "\n";
}
