// Cliente das telas da Inteligência de gestão (cartão t_01d580b6). RPCs da migration 20261108180000
// (ainda fora do types.ts gerado). Módulo desligado ou erro na checagem = tudo fechado (tela como antes).
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { normalizarFarolDados, type FarolDados } from "./inteligencia-gestao-tela";
import type { Combinado, Pauta } from "./inteligencia-gestao";

export const gestaoDb = supabase as unknown as SupabaseClient;

/** Módulo "inteligencia_gestao" ligado na imobiliária atual. Falha = desligado. */
export async function inteligenciaGestaoEnabled(): Promise<boolean> {
  try {
    const { data, error } = await gestaoDb.rpc("inteligencia_gestao_enabled");
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Dados do farol: sem corretor = a equipe que eu vejo; com corretor = só ele (ou eu mesmo). */
export async function carregarFarol(ano: number, corretor?: string): Promise<FarolDados> {
  const { data, error } = await gestaoDb.rpc(
    "gestao_farol_dados",
    corretor ? { _ano: ano, _corretor: corretor } : { _ano: ano },
  );
  if (error) throw error;
  return normalizarFarolDados(data);
}

export type PendenciaCorretor = {
  kind: string;
  capture_id: string;
  imovel: string | null;
  detalhe: string;
  prazo: string | null;
  dias: number | null;
};

/** "O que fazer hoje" do corretor (pauta da 1:1). */
export async function pendenciasDoCorretor(corretor: string): Promise<PendenciaCorretor[]> {
  const { data, error } = await gestaoDb.rpc("gestao_pendencias_corretor", {
    _corretor: corretor,
  });
  if (error) throw error;
  return (data ?? []) as PendenciaCorretor[];
}

export async function salvar1a1(i: {
  corretor: string;
  data: string;
  pauta: Pauta;
  combinados: Combinado[];
  proxima: string;
}): Promise<string> {
  const { data, error } = await gestaoDb.rpc("gestao_1a1_salvar", {
    _corretor: i.corretor,
    _data: i.data,
    _pauta: i.pauta,
    _combinados: i.combinados,
    _proxima: i.proxima,
  });
  if (error) throw error;
  return String(data);
}

/** Mensagem curta para os erros das RPCs de gestão. */
export function erroGestao(e: unknown, padrao: string): string {
  const m = e && typeof e === "object" && "message" in e ? String(e.message) : "";
  if (/não está ligada/i.test(m))
    return "A Inteligência de gestão não está ligada nesta imobiliária.";
  if (/Login necessário/i.test(m)) return "Sua sessão expirou. Entre de novo.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Sem conexão. Tente de novo.";
  return m || padrao;
}
