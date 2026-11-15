// Tela do aquecimento de leads parados (t_a2cae373). Tudo passa por funções do banco (lead_aquecer_*), que conferem
// papel e imobiliária pela sessão: o navegador nunca lê as tabelas nem manda organization_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErroLead } from "@/lib/leads";

const db = supabase as unknown as SupabaseClient;

export type AquecerConfig = {
  ativo: boolean;
  dias: number;
  limite_dia: number;
  rampa_inicio: number;
  rampa_passo: number;
  lembrete_dias: number;
  pausado_em: string | null;
  pausa_motivo: string | null;
  limite_hoje: number;
  enviados_hoje: number;
  chip: string | null; // mascarado pelo banco
  retorno_em: string | null;
  ia_ativa: boolean;
  ia_nome: string;
  elegiveis: number;
};

export type AquecerPainel = {
  dias: number;
  enviados: number;
  enviados_teste: number;
  lembretes: number;
  falhas: number;
  responderam: number;
  voltaram: number;
  visitas: number;
  nao: number;
  optouts: number;
  frios: number;
  aguardando: number;
  pausas: number;
  ultima_pausa: { motivo: string; em: string; retomada_em: string | null } | null;
};

export type AquecerSalvar = Pick<
  AquecerConfig,
  "ativo" | "dias" | "limite_dia" | "rampa_inicio" | "rampa_passo" | "lembrete_dias"
>;

function falha(error: { message?: string } | null): never {
  throw new Error(mensagemErroLead(error?.message ?? ""));
}

/** Validação da tela (o banco confere de novo com os mesmos limites). null = ok. */
export function validarAquecer(c: AquecerSalvar): string | null {
  const ent = (v: number, a: number, b: number) => Number.isInteger(v) && v >= a && v <= b;
  if (!ent(c.dias, 7, 365)) return "Dias sem conversa: de 7 a 365.";
  if (!ent(c.limite_dia, 1, 50)) return "Limite por dia: de 1 a 50.";
  if (!ent(c.rampa_inicio, 1, 50) || c.rampa_inicio > c.limite_dia)
    return "Início da rampa: de 1 até o limite por dia.";
  if (!ent(c.rampa_passo, 0, 20)) return "Aumento por dia: de 0 a 20.";
  if (!ent(c.lembrete_dias, 1, 14)) return "Lembrete: de 1 a 14 dias.";
  return null;
}

export async function lerAquecerConfig(): Promise<AquecerConfig | null> {
  const { data, error } = await db.rpc("lead_aquecer_config");
  if (error) return null; // migration ausente ou sem permissão: o bloco não aparece
  return data as AquecerConfig;
}

export async function lerAquecerPainel(dias = 30): Promise<AquecerPainel | null> {
  const { data, error } = await db.rpc("lead_aquecer_painel", { _dias: dias });
  if (error) return null;
  return data as AquecerPainel;
}

export async function lerAquecerPrevia(): Promise<string[]> {
  const { data, error } = await db.rpc("lead_aquecer_previa");
  if (error) return [];
  return (data as string[] | null) ?? [];
}

export async function salvarAquecer(c: AquecerSalvar) {
  const { error } = await db.rpc("lead_aquecer_salvar", {
    _ativo: c.ativo,
    _dias: c.dias,
    _limite_dia: c.limite_dia,
    _rampa_inicio: c.rampa_inicio,
    _rampa_passo: c.rampa_passo,
    _lembrete_dias: c.lembrete_dias,
  });
  if (error) falha(error);
}

export async function pausarAquecer(pausar: boolean) {
  const { error } = await db.rpc("lead_aquecer_pausar", { _pausar: pausar });
  if (error) falha(error);
}

/** "gerar" devolve o token UMA vez (o banco guarda só o hash). */
export async function tokenRetornoAquecer(acao: "gerar" | "desligar"): Promise<string | null> {
  const { data, error } = await db.rpc("lead_aquecer_retorno_token", { _acao: acao });
  if (error) falha(error);
  return (data as string | null) ?? null;
}
