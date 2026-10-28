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
  type LeadContato,
  type LeadSemContato,
  juntarContatos,
  type LeadEvento,
  type OrigemSimulador,
  type MotivoPerda,
  type NovoLeadForm,
  type Pessoa,
} from "@/lib/leads";
import type { ConversaIa, IaConfig, MensagemIa } from "@/lib/leads-ia";

// Tabelas/RPCs da migração 20261025120000_leads_piloto (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

const LEAD_COLS =
  "id,nome,origem,mensagem,etapa,etapa_em,responsavel_id,atribuido_em,capture_id,captador_id,motivo_perda_id,motivo_perda_obs,created_at,updated_at,aceito_em,ultima_interacao_em,no_banco_desde,simulado,anuncio_codigo,anuncio_portal_id,portal_tipo,portal_temperatura,portal_transacao";

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
  const leads = (data ?? []) as LeadSemContato[];
  return juntarContatos(leads, await lerContatos(leads.map((l) => l.id)));
}

/**
 * Telefone/e-mail vêm só pela RPC lead_contatos: o banco entrega para gestor/admin sempre e para o
 * responsável (ou o Team Leader dele) só depois do aceite. A tabela leads não entrega essas colunas ao app.
 */
async function lerContatos(ids: string[]): Promise<LeadContato[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db.rpc("lead_contatos", { _ids: ids });
  if (error) falha(error);
  return (data ?? []) as LeadContato[];
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
      "prazo_aceite_min,prazo_primeira_interacao_dias,prazo_sem_interacao_dias,distribuicao,form_publico_ativo,form_token,grupo_olx_token_em",
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

/**
 * Grupo ZAP ("Receber leads no CRM"): "gerar" devolve um token novo (aparece só agora; o banco guarda
 * o hash e o anterior para na hora); "desligar" apaga o token.
 */
export async function tokenGrupoOlx(acao: "gerar" | "desligar"): Promise<string | null> {
  const { data, error } = await db.rpc("lead_grupo_olx_token", { _acao: acao });
  if (error) falha(error);
  return (data as string | null) ?? null;
}

/** Liga/desliga o formulário público de teste; devolve o token do link. */
export async function configurarFormulario(ativo: boolean): Promise<string> {
  const { data, error } = await db.rpc("lead_form_configurar", { _ativo: ativo });
  if (error) falha(error);
  return data as string;
}

// --- IA de atendimento (migration 20261025180000, card t_8046ecb0) --------------------------------

/** Conversa da IA do lead (a RLS só entrega para gestor/admin e para o responsável depois do aceite). */
export async function lerConversaIa(
  leadId: string,
): Promise<{ conversa: ConversaIa | null; mensagens: MensagemIa[] }> {
  const { data, error } = await db
    .from("lead_conversas")
    .select("id,lead_id,canal,estado,passo,motivo_fim,resumo,created_at")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) falha(error);
  if (!data) return { conversa: null, mensagens: [] };
  const conversa = data as ConversaIa;
  const { data: m, error: e2 } = await db
    .from("lead_mensagens")
    .select("id,autor,texto,status,created_at")
    .eq("conversa_id", conversa.id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (e2) falha(e2);
  return { conversa, mensagens: (m ?? []) as MensagemIa[] };
}

export async function pararIa(leadId: string) {
  const { error } = await db.rpc("lead_ia_parar", { _lead: leadId });
  if (error) falha(error);
}

export async function lerIaConfig(): Promise<IaConfig> {
  const { data, error } = await db
    .from("lead_config")
    .select("ia_ativa,ia_nome,ia_boas_vindas,ia_canal")
    .maybeSingle();
  if (error) falha(error);
  // Roteiro novo (migration 20261026170000): lido à parte para a tela seguir funcionando sem ela.
  const { data: rot } = await db.from("lead_config").select("ia_primeira_msg,ia_reengajar").maybeSingle();
  // Lembrete de 15 min (migration 20261028190000, t_b3f753a5): lido à parte; sem a coluna, fica desligado.
  const { data: t15 } = await db.from("lead_config").select("ia_toque15").maybeSingle();
  return {
    ia_ativa: false,
    ia_nome: "Nicole",
    ia_boas_vindas: null,
    ia_canal: "teste",
    ia_primeira_msg: null,
    ia_reengajar: false,
    ia_toque15: false,
    ...((data ?? {}) as Partial<IaConfig>),
    ...((rot ?? {}) as Partial<IaConfig>),
    ...((t15 ?? {}) as Partial<IaConfig>),
  };
}

/** Texto da 1ª mensagem e reengajamento (só administrador; o banco confere e recusa link). */
export async function salvarRoteiroIa(c: Pick<IaConfig, "ia_primeira_msg" | "ia_reengajar">) {
  const { error } = await db.rpc("lead_ia_roteiro_salvar", {
    _primeira_msg: c.ia_primeira_msg?.trim() || null,
    _reengajar: c.ia_reengajar === true,
  });
  if (error) falha(error);
}

/** Lembrete de 15 min (só administrador; o banco confere). Só chama se mudou, para a tela seguir sem a migration. */
export async function salvarToque15Ia(ligado: boolean) {
  const { error } = await db.rpc("lead_ia_toque15_salvar", { _ligado: ligado });
  if (error) falha(error);
}

/** Nome da imobiliária do usuário (a RLS entrega só a própria), para a prévia da 1ª mensagem. */
export async function nomeImobiliaria(): Promise<string | null> {
  const { data: org } = await db.rpc("current_org_id");
  if (!org) return null;
  const { data } = await db.from("organizations").select("nome").eq("id", org as string).maybeSingle();
  return (data as { nome?: string } | null)?.nome ?? null;
}

// --- Retorno ZionTalk e escolha de modelo (migration 20261025200000, card t_6f688b4b) ----------------

export type IaRetornoConfig = {
  ia_retorno_token_em: string | null;
  ia_modelo_provedor: "gemini" | "openrouter";
  ia_modelo: string | null;
};

export async function lerIaRetornoConfig(): Promise<IaRetornoConfig> {
  const { data, error } = await db
    .from("lead_config")
    .select("ia_retorno_token_em,ia_modelo_provedor,ia_modelo")
    .maybeSingle();
  if (error) falha(error);
  return {
    ia_retorno_token_em: null,
    ia_modelo_provedor: "gemini",
    ia_modelo: null,
    ...((data ?? {}) as Partial<IaRetornoConfig>),
  };
}

/** "gerar" devolve o token novo UMA vez (o banco guarda só o hash; o anterior para na hora). */
export async function tokenRetornoIa(acao: "gerar" | "desligar"): Promise<string | null> {
  const { data, error } = await db.rpc("lead_ia_retorno_token", { _acao: acao });
  if (error) falha(error);
  return (data as string | null) ?? null;
}

export async function salvarModeloIa(provedor: "gemini" | "openrouter", modelo: string | null) {
  const { error } = await db.rpc("lead_ia_modelo_salvar", { _provedor: provedor, _modelo: modelo });
  if (error) falha(error);
}

export async function salvarIaConfig(c: Pick<IaConfig, "ia_ativa" | "ia_nome" | "ia_boas_vindas">) {
  const { error } = await db.rpc("lead_ia_config_salvar", {
    _ativa: c.ia_ativa,
    _nome: c.ia_nome.trim(),
    _boas_vindas: c.ia_boas_vindas?.trim() || null,
  });
  if (error) falha(error);
}
