import { supabase } from "@/integrations/supabase/client";

/** Formato bruto esperado da RPC dashboard_movimentacao_periodo() — chaves em snake_case como o
 * Postgres devolve; valores numéricos podem vir como number OU string (jsonb->numeric costuma
 * virar string no client JS pra não perder precisão). Só usado como referência de forma pros
 * testes — o mapeamento real (mapearMovimentacaoPeriodo) NÃO confia nesse tipo em runtime, valida
 * campo a campo, porque a resposta chega como `unknown`. */
export type MovimentacaoPeriodoRaw = {
  futuras_quantidade: number;
  futuras_vgv: number | string;
  confirmadas_contrato_quantidade: number;
  confirmadas_contrato_vgv: number | string;
  confirmadas_lancamento_quantidade: number;
  confirmadas_lancamento_vgv: number | string;
  encerradas_quantidade: number;
  sem_data_futura: number;
  sem_data_confirmada: number;
  sem_data_encerrada: number;
};

export type MovimentacaoPeriodo = {
  futurasQuantidade: number;
  futurasVgv: number;
  // "confirmada" se divide por modalidade: contrato = contrato assinado de verdade (venda padrão);
  // lancamento = enviada direto ao financeiro pela modalidade Lançamento, que nunca passa por
  // contrato assinado (ver comentário na migration 20260819020000). Misturar os dois num só número
  // foi o bug reportado pelo usuário na auditoria de 2026-08-18.
  confirmadasContratoQuantidade: number;
  confirmadasContratoVgv: number;
  confirmadasLancamentoQuantidade: number;
  confirmadasLancamentoVgv: number;
  encerradasQuantidade: number;
  semDataFutura: number;
  semDataConfirmada: number;
  semDataEncerrada: number;
};

const CAMPOS_ESPERADOS = [
  "futuras_quantidade",
  "futuras_vgv",
  "confirmadas_contrato_quantidade",
  "confirmadas_contrato_vgv",
  "confirmadas_lancamento_quantidade",
  "confirmadas_lancamento_vgv",
  "encerradas_quantidade",
  "sem_data_futura",
  "sem_data_confirmada",
  "sem_data_encerrada",
] as const;

/** `Number("")`, `Number(null)` e `Number([])` são todos finitos por acidente de coerção do JS
 * (viram 0) — por isso a checagem é explícita sobre o valor original, não só `Number.isFinite`
 * do resultado convertido. */
function ehNumericoValido(v: unknown): v is number | string {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.trim() !== "" && Number.isFinite(Number(v));
  return false;
}

/** Arredonda pra exatamente 2 casas decimais — VGV é dinheiro, não pode carregar erro de ponto
 * flutuante (ex.: 1234.5670000000001) pra exibição. */
function arredondarMoeda(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pura — separada do fetch só pra poder ser testada sem rede/Supabase. Recebe `unknown` de
 * propósito: a RPC devolve `Json` (pode ser null, um array, uma string, ou um objeto faltando
 * campos), e sem essa validação um retorno incompleto viraria NaN silenciosamente nos cards.
 * Lança erro descritivo em vez de deixar `Number(undefined)` (= NaN) vazar pra interface.
 */
export function mapearMovimentacaoPeriodo(raw: unknown): MovimentacaoPeriodo {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("dashboard_movimentacao_periodo: resposta não é um objeto.");
  }
  const r = raw as Record<string, unknown>;
  for (const campo of CAMPOS_ESPERADOS) {
    if (!ehNumericoValido(r[campo])) {
      throw new Error(`dashboard_movimentacao_periodo: campo "${campo}" ausente ou não numérico.`);
    }
  }
  return {
    futurasQuantidade: Number(r.futuras_quantidade),
    futurasVgv: arredondarMoeda(Number(r.futuras_vgv)),
    confirmadasContratoQuantidade: Number(r.confirmadas_contrato_quantidade),
    confirmadasContratoVgv: arredondarMoeda(Number(r.confirmadas_contrato_vgv)),
    confirmadasLancamentoQuantidade: Number(r.confirmadas_lancamento_quantidade),
    confirmadasLancamentoVgv: arredondarMoeda(Number(r.confirmadas_lancamento_vgv)),
    encerradasQuantidade: Number(r.encerradas_quantidade),
    semDataFutura: Number(r.sem_data_futura),
    semDataConfirmada: Number(r.sem_data_confirmada),
    semDataEncerrada: Number(r.sem_data_encerrada),
  };
}

/**
 * dashboard_movimentacao_periodo() é tipada manualmente em src/integrations/supabase/types.ts
 * (Functions.dashboard_movimentacao_periodo) até a próxima regeneração via `supabase gen types` —
 * ver comentário lá. Isso deixa o `supabase.rpc(...)` abaixo com Args/Returns tipados sem `as any`.
 */
export async function fetchMovimentacaoPeriodo(
  inicioUtc: string,
  fimExclusivoUtc: string,
): Promise<MovimentacaoPeriodo> {
  const { data, error } = await supabase.rpc("dashboard_movimentacao_periodo", {
    _inicio: inicioUtc,
    _fim: fimExclusivoUtc,
  });
  if (error) throw error;
  return mapearMovimentacaoPeriodo(data);
}
