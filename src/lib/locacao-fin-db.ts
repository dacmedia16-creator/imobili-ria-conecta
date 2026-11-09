// Cliente das RPCs do Financeiro da locação (t_be750361; migration 20261111120000, ainda fora do types.ts gerado).
// Chamadas com o login de quem está na tela: o banco confere papel 'financeiro', imobiliária e módulo ligado.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as unknown as SupabaseClient;

async function rpc<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(nome, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const painelFin = (competencia: string | null) =>
  rpc<unknown>("locacao_fin_painel", { _competencia: competencia });
export const contratoFin = (id: string) => rpc<unknown>("locacao_fin_contrato", { _id: id });
export const salvarContratoFin = (id: string, dados: Record<string, unknown>) =>
  rpc<unknown>("locacao_fin_contrato_salvar", { _id: id, _dados: dados });
export const ativarContratoFin = (id: string) =>
  rpc<unknown>("locacao_fin_contrato_ativar", { _id: id });
export const gerarCobrancasFin = (competencia: string) =>
  rpc<{ geradas: number }>("locacao_fin_gerar_cobrancas", { _competencia: competencia });
export const baixaFin = (cobranca: string, pagoEm: string, valorPago: number, obs: string | null) =>
  rpc<unknown>("locacao_fin_baixa", {
    _cobranca: cobranca,
    _pago_em: pagoEm,
    _valor_pago: valorPago,
    _obs: obs,
  });
export const estornarFin = (cobranca: string, motivo: string) =>
  rpc<unknown>("locacao_fin_estornar", { _cobranca: cobranca, _motivo: motivo });
export const cancelarFin = (cobranca: string, motivo: string) =>
  rpc<unknown>("locacao_fin_cancelar", { _cobranca: cobranca, _motivo: motivo });
export const descontoFin = (cobranca: string, descricao: string, valor: number) =>
  rpc<unknown>("locacao_fin_desconto", {
    _cobranca: cobranca,
    _descricao: descricao,
    _valor: valor,
  });
export const removerDescontoFin = (desconto: string) =>
  rpc<boolean>("locacao_fin_desconto_remover", { _desconto: desconto });
export const repasseFeitoFin = (cobranca: string, feitoEm: string, comprovante: string | null) =>
  rpc<unknown>("locacao_fin_repasse_feito", {
    _cobranca: cobranca,
    _feito_em: feitoEm,
    _comprovante: comprovante,
  });
export const desfazerRepasseFin = (repasse: string, motivo: string) =>
  rpc<boolean>("locacao_fin_repasse_desfazer", { _repasse: repasse, _motivo: motivo });
export const extratoFin = (proprietario: string) =>
  rpc<unknown>("locacao_fin_extrato", { _proprietario: proprietario });
export const salvarConfigFin = (dados: Record<string, unknown>) =>
  rpc<unknown>("locacao_fin_config_salvar", { _dados: dados });
