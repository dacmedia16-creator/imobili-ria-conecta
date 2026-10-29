// CRM — dois funis (card t_188fb282). Chamadas ao banco das RPCs crm_* (migration 20261029100000).
// O banco é a proteção real: RLS do módulo Leads + RPCs que exigem módulo ligado, aceite, papel e
// próximo contato. Aqui só traduzimos as mensagens para a tela.
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { juntarContatos, mensagemErroLead, type Lead, type LeadContato, type LeadSemContato } from "@/lib/leads";
import { mensagemErroCrm, type Etapa, type Funil } from "@/lib/crm";

// Tabelas/RPCs ainda fora de types.ts.
const db = supabase as unknown as SupabaseClient;

const CRM_LEAD_COLS =
  "id,nome,origem,mensagem,etapa,etapa_em,responsavel_id,atribuido_em,capture_id,captador_id,motivo_perda_id,motivo_perda_obs,created_at,updated_at,aceito_em,ultima_interacao_em,no_banco_desde,simulado,anuncio_codigo,anuncio_portal_id,portal_tipo,portal_temperatura,portal_transacao," +
  "funil,proximo_contato_em,proximo_contato_motivo,sale_id,capture_convertida_id,convertido_em";

function falha(error: { message?: string } | null): never {
  const msg = error?.message ?? "";
  throw new Error(mensagemErroCrm(msg) ?? mensagemErroLead(msg));
}

/** CRM ligado na imobiliária atual (módulo crm E módulo leads). Falha = fechado. */
export async function crmEnabled(): Promise<boolean> {
  const { data, error } = await db.rpc("crm_enabled");
  if (error) return false;
  return data === true;
}

/** Guarda da rota /crm; o banco repete a checagem em cada RPC. */
export async function guardCrmRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !(await crmEnabled())) throw redirect({ to: "/dashboard" });
}

/** Leads visíveis (a RLS decide: próprio, equipe ou imobiliária) com as colunas do CRM. */
export async function listarLeadsCrm(): Promise<Lead[]> {
  const { data, error } = await db
    .from("leads")
    .select(CRM_LEAD_COLS)
    .order("created_at", { ascending: false })
    .limit(1000); // shortcut: até 1000 leads por tela (piloto); acima disso precisa paginar.
  if (error) falha(error);
  const leads = (data ?? []) as unknown as LeadSemContato[];
  if (leads.length === 0) return [];
  const { data: c, error: e2 } = await db.rpc("lead_contatos", { _ids: leads.map((l) => l.id) });
  if (e2) falha(e2);
  return juntarContatos(leads, (c ?? []) as LeadContato[]);
}

/** Mover no quadro. Etapa aberta exige próximo contato; perdido exige motivo da perda. */
export async function moverLead(
  leadId: string,
  etapa: Etapa,
  p: { proximoEm?: string; proximoMotivo?: string; motivoPerdaId?: string; obs?: string } = {},
) {
  const { error } = await db.rpc("crm_mover", {
    _lead: leadId,
    _etapa: etapa,
    _proximo_em: p.proximoEm || null,
    _proximo_motivo: p.proximoMotivo?.trim() || null,
    _motivo_perda_id: p.motivoPerdaId || null,
    _obs: p.obs?.trim() || null,
  });
  if (error) falha(error);
}

export async function salvarProximo(leadId: string, data: string, motivo: string) {
  const { error } = await db.rpc("crm_proximo_contato", {
    _lead: leadId,
    _proximo_em: data,
    _proximo_motivo: motivo.trim(),
  });
  if (error) falha(error);
}

export async function definirFunil(leadId: string, funil: Funil) {
  const { error } = await db.rpc("crm_definir_funil", { _lead: leadId, _funil: funil });
  if (error) falha(error);
}

/** Cria a venda pré-preenchida (ou devolve a já vinculada) e põe o lead em Fechado. */
export async function converterVenda(leadId: string): Promise<string> {
  const { data, error } = await db.rpc("crm_converter_venda", { _lead: leadId });
  if (error) falha(error);
  return data as string;
}

/** Cria a captação exclusiva (o responsável vira captador) e põe o lead em Captado. */
export async function converterCaptacao(leadId: string, unitId: string): Promise<string> {
  const { data, error } = await db.rpc("crm_converter_captacao", { _lead: leadId, _unit_id: unitId });
  if (error) falha(error);
  return data as string;
}
