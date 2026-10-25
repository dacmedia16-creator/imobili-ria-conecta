import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  mensagemErroLead,
  normalizarTelefone,
  type CapturaOpcao,
  type Etapa,
  type Lead,
  type LeadEvento,
  type MotivoPerda,
  type NovoLeadForm,
  type Pessoa,
} from "@/lib/leads";

// Tabelas/RPCs da migração 20261025120000_leads_piloto (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

const LEAD_COLS =
  "id,nome,telefone,email,origem,mensagem,etapa,etapa_em,responsavel_id,atribuido_em,capture_id,captador_id,motivo_perda_id,motivo_perda_obs,created_at,updated_at";

function falha(error: { message?: string } | null): never {
  throw new Error(mensagemErroLead(error?.message ?? ""));
}

/** Módulo Leads ligado na imobiliária atual. Falha = fechado. */
export async function leadsEnabled(): Promise<boolean> {
  const { data, error } = await db.rpc("leads_enabled");
  if (error) return false;
  return data === true;
}

/** Guarda das rotas; o banco repete a checagem (policy RESTRICTIVE + RPCs). */
export async function guardLeadsRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !(await leadsEnabled())) throw redirect({ to: "/dashboard" });
}

/** Leads visíveis para quem está logado (a RLS decide: próprio, equipe ou imobiliária). */
export async function listarLeads(opts: { responsavel?: string } = {}): Promise<Lead[]> {
  let q = db.from("leads").select(LEAD_COLS).order("created_at", { ascending: false }).limit(500);
  if (opts.responsavel) q = q.eq("responsavel_id", opts.responsavel);
  const { data, error } = await q;
  if (error) falha(error);
  return (data ?? []) as Lead[];
}

export async function listarEventos(leadId: string): Promise<LeadEvento[]> {
  const { data, error } = await db
    .from("lead_eventos")
    .select("id,lead_id,tipo,de,para,nota,autor_id,created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  if (error) falha(error);
  return (data ?? []) as LeadEvento[];
}

export async function listarMotivos(): Promise<MotivoPerda[]> {
  const { data, error } = await db
    .from("lead_motivos_perda")
    .select("id,nome,ordem,ativo")
    .eq("ativo", true)
    .order("ordem");
  if (error) falha(error);
  return (data ?? []) as MotivoPerda[];
}

export async function carregarOpcoes(): Promise<{
  responsaveis: Pessoa[];
  capturas: CapturaOpcao[];
}> {
  const { data, error } = await db.rpc("lead_opcoes");
  if (error) falha(error);
  const d = (data ?? {}) as { responsaveis?: Pessoa[]; capturas?: CapturaOpcao[] };
  return { responsaveis: d.responsaveis ?? [], capturas: d.capturas ?? [] };
}

export async function criarLead(f: NovoLeadForm): Promise<string> {
  const { data, error } = await db.rpc("lead_criar", {
    _nome: f.nome.trim(),
    _telefone: normalizarTelefone(f.telefone) || null,
    _email: f.email.trim() || null,
    _origem: f.origem,
    _mensagem: f.mensagem.trim() || null,
    _capture_id: f.captureId || null,
    _responsavel_id: f.responsavelId || null,
  });
  if (error) falha(error);
  return data as string;
}

export async function mudarEtapa(leadId: string, etapa: Etapa, motivoId?: string, obs?: string) {
  const { error } = await db.rpc("lead_mudar_etapa", {
    _lead: leadId,
    _etapa: etapa,
    _motivo_perda_id: motivoId || null,
    _obs: obs?.trim() || null,
  });
  if (error) falha(error);
}

export async function atribuirLead(leadId: string, responsavelId: string) {
  const { error } = await db.rpc("lead_atribuir", {
    _lead: leadId,
    _responsavel_id: responsavelId,
  });
  if (error) falha(error);
}

export async function anotarLead(leadId: string, nota: string) {
  const { error } = await db.rpc("lead_anotar", { _lead: leadId, _nota: nota });
  if (error) falha(error);
}
