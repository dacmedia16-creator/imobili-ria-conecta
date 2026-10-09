import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { storageOrganizationPath } from "./storage-org";
import type { ListingCheck, ListingContext, Pendencia, PlanItem } from "./feedback-captacao";
import type { SiteSuggestions } from "./remax-site";

// RPCs das migrations 20261009010000 e 20261009020000 (semanas), ainda fora de types.ts.
const db = supabase as unknown as SupabaseClient;
const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export async function listingContext(capture: string): Promise<ListingContext> {
  const { data, error } = await db.rpc("exclusive_listing_context", { _capture: capture });
  check(error);
  return data as ListingContext;
}
export async function listingCheck(capture: string, code: string): Promise<ListingCheck> {
  const { data, error } = await db.rpc("exclusive_listing_check", {
    _capture: capture,
    _code: code,
  });
  check(error);
  return data as ListingCheck;
}
export async function listingLink(capture: string, code: string): Promise<string> {
  const { data, error } = await db.rpc("exclusive_listing_link", {
    _capture: capture,
    _code: code,
  });
  check(error);
  return data as string;
}
export async function listingUnlink(capture: string, reason: string): Promise<void> {
  const { error } = await db.rpc("exclusive_listing_unlink", {
    _capture: capture,
    _reason: reason,
  });
  check(error);
}
export async function listingDecide(
  link: string,
  approve: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await db.rpc("exclusive_listing_decide", {
    _link: link,
    _approve: approve,
    _reason: reason ?? null,
  });
  check(error);
}
export async function planView(capture: string): Promise<PlanItem[]> {
  const { data, error } = await db.rpc("exclusive_plan_view", { _capture: capture });
  check(error);
  return (data ?? []) as PlanItem[];
}
const PROOF_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const PROOF_ACCEPT = Object.keys(PROOF_EXT).join(",");
export const PROOF_MAX_BYTES = 16 * 1024 * 1024;

/** Marca a ação como feita; a prova (foto/print/PDF) vai para o bucket privado da captação. */
export async function planMark(
  capture: string,
  action: string,
  doneOn: string,
  proof?: File | null,
  semana = 0,
) {
  let path: string | null = null;
  if (proof) {
    const ext = PROOF_EXT[proof.type];
    if (!ext) throw new Error("Prova: envie foto (JPG, PNG, WEBP) ou PDF.");
    if (proof.size > PROOF_MAX_BYTES) throw new Error("Prova acima de 16 MB.");
    path = await storageOrganizationPath(`${capture}/plano/${crypto.randomUUID()}.${ext}`);
    const { error } = await supabase.storage
      .from("exclusive-captures")
      .upload(path, proof, { contentType: proof.type, upsert: false });
    check(error);
  }
  const { error } = await db.rpc("exclusive_plan_mark", {
    _capture: capture,
    _action: action,
    _done_on: doneOn,
    _proof_path: path,
    _proof_name: proof ? proof.name.slice(0, 180) : null,
    _semana: semana,
  });
  check(error);
}
export async function planUnmark(capture: string, action: string, semana = 0): Promise<void> {
  const { error } = await db.rpc("exclusive_plan_unmark", {
    _capture: capture,
    _action: action,
    _semana: semana,
  });
  check(error);
}
export async function proofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("exclusive-captures")
    .createSignedUrl(path, 300);
  check(error);
  return data!.signedUrl;
}
export async function pendencias(dias: number): Promise<Pendencia[]> {
  const { data, error } = await db.rpc("exclusive_feedback_pendencias", { _dias: dias });
  check(error);
  return (data ?? []) as Pendencia[];
}
// Site RE/MAX (migration 20261009040000). Falha = vazio: a captação continua com o código digitado.
export async function siteSuggestions(capture: string): Promise<SiteSuggestions | null> {
  const { data, error } = await db.rpc("exclusive_site_suggestions", { _capture: capture });
  if (error) return null;
  return (data ?? null) as SiteSuggestions | null;
}
export interface SiteProvavel {
  capture_id: string;
  code: string;
  score: number;
  confianca: "alta" | "media";
  url: string | null;
}
export async function siteProvaveis(): Promise<SiteProvavel[]> {
  const { data, error } = await db.rpc("exclusive_site_provaveis");
  if (error) return [];
  return (data ?? []) as SiteProvavel[];
}
/** Nome do site para IDs RE/MAX sem usuário no ADM (só admin recebe; demais = vazio). */
export async function siteAgentNames(): Promise<Record<string, string>> {
  const { data, error } = await db.rpc("remax_site_agent_names");
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const r of data as { agent_id: string; nome: string }[]) out[r.agent_id] = r.nome;
  return out;
}

export interface FeedbackCaptacao {
  capture_id: string;
  link_status: "ativo" | "aguardando_gestor";
  listing_code: string;
  tipo: string | null;
  bairro: string | null;
  proprietario: string | null;
  creci: string | null;
  corretor: string | null;
}
/** Captação ligada ao anúncio (null = sem ligação ou sem permissão). Falha = null, sem travar a tela. */
export async function feedbackCaptacao(code: string): Promise<FeedbackCaptacao | null> {
  const { data, error } = await db.rpc("owner_feedback_captacao", { _code: code });
  if (error) return null;
  return (data ?? null) as FeedbackCaptacao | null;
}
