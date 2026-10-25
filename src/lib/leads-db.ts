import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  CONFIG_PADRAO,
  mensagemErroLead,
  normalizarTelefone,
  type CapturaOpcao,
  type Etapa,
  type Lead,
  type LeadBanco,
  type LeadConfig,
  type LeadEvento,
  type OrigemSimulador,
  type MotivoPerda,
  type NovoLeadForm,
  type Pessoa,
} from "@/lib/leads";

// Tabelas/RPCs da migração 20261025120000_leads_piloto (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

const LEAD_COLS =
  "id,nome,telefone,email,origem,mensagem,etapa,etapa_em,responsavel_id,atribuido_em,capture_id,captador_id,motivo_perda_id,motivo_perda_obs,created_at,updated_at,aceito_em,ultima_interacao_em,no_banco_desde,simulado";

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

// --- P2/P3 (migration 20261025150000) ------------------------------------------------------------

export async function aceitarLead(leadId: string) {
  const { error } = await db.rpc("lead_aceitar", { _lead: leadId });
  if (error) falha(error);
}

export async function registrarLigacao(leadId: string, nota: string) {
  const { error } = await db.rpc("lead_registrar_ligacao", {
    _lead: leadId,
    _nota: nota.trim() || null,
  });
  if (error) falha(error);
}

/** Banco "Leads da imobiliária": sem telefone/e-mail até alguém pegar. */
export async function listarBanco(): Promise<LeadBanco[]> {
  const { data, error } = await db.rpc("lead_banco_listar");
  if (error) falha(error);
  return (data ?? []) as LeadBanco[];
}

export async function pegarLead(leadId: string) {
  const { error } = await db.rpc("lead_pegar", { _lead: leadId });
  if (error) falha(error);
}

export async function simularLeads(n: number, origem: OrigemSimulador, comCaptacao: boolean) {
  const { data, error } = await db.rpc("lead_simular", {
    _n: n,
    _origem: origem,
    _com_captacao: comCaptacao,
  });
  if (error) falha(error);
  return data as number;
}

/** Configuração da imobiliária (a RLS só entrega a da própria). Sem linha = padrão. */
export async function lerConfig(): Promise<LeadConfig> {
  const { data, error } = await db
    .from("lead_config")
    .select(
      "prazo_aceite_min,prazo_primeira_interacao_dias,prazo_sem_interacao_dias,distribuicao,form_publico_ativo,form_token",
    )
    .maybeSingle();
  if (error) falha(error);
  return { ...CONFIG_PADRAO, ...((data ?? {}) as Partial<LeadConfig>) };
}

export async function salvarConfig(c: LeadConfig) {
  const { error } = await db.rpc("lead_config_salvar", {
    _prazo_aceite_min: c.prazo_aceite_min,
    _prazo_primeira_dias: c.prazo_primeira_interacao_dias,
    _prazo_sem_interacao_dias: c.prazo_sem_interacao_dias,
    _distribuicao: c.distribuicao,
  });
  if (error) falha(error);
}

/** Liga/desliga o formulário público de teste; devolve o token do link. */
export async function configurarFormulario(ativo: boolean): Promise<string> {
  const { data, error } = await db.rpc("lead_form_configurar", { _ativo: ativo });
  if (error) falha(error);
  return data as string;
}
