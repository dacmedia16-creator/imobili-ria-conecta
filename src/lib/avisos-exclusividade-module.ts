// Cliente das telas dos avisos de exclusividade (cartão t_c337fc12). RPCs/tabelas da migration
// 20261108140000 (ainda fora do types.ts gerado). Módulo desligado ou erro = tudo fechado/vazio.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const avisosDb = supabase as unknown as SupabaseClient;

export type Reuniao = { id: string; met_on: string; notes: string; created_at: string };

/** Módulo "avisos_exclusividade" ligado na imobiliária atual. Falha = desligado. */
export async function avisosExclusividadeEnabled(): Promise<boolean> {
  try {
    const { data, error } = await avisosDb.rpc("avisos_exclusividade_enabled");
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Reuniões das captações (o banco devolve só as que quem está logado pode ver). */
export async function listarReunioes(captureIds?: string[]): Promise<Map<string, Reuniao[]>> {
  let q = avisosDb
    .from("exclusive_owner_meetings")
    .select("id, capture_id, met_on, notes, created_at")
    .order("met_on", { ascending: false });
  if (captureIds) {
    if (!captureIds.length) return new Map();
    q = q.in("capture_id", captureIds);
  }
  const { data, error } = await q;
  const out = new Map<string, Reuniao[]>();
  if (error || !data) return out;
  for (const r of data as (Reuniao & { capture_id: string })[]) {
    const l = out.get(r.capture_id) ?? [];
    l.push({ id: r.id, met_on: r.met_on, notes: r.notes, created_at: r.created_at });
    out.set(r.capture_id, l);
  }
  return out;
}

export async function registrarReuniao(captureId: string, data: string, texto: string) {
  const { data: id, error } = await avisosDb.rpc("exclusive_reuniao_registrar", {
    _capture: captureId,
    _data: data,
    _texto: texto,
  });
  if (error) throw new Error(error.message);
  return id as string;
}

export type PreferenciasAviso = { push: boolean; whatsapp: boolean };

export async function lerPreferencias(userId: string): Promise<PreferenciasAviso> {
  const { data } = await avisosDb
    .from("aviso_preferencias")
    .select("push, whatsapp")
    .eq("user_id", userId)
    .maybeSingle();
  return { push: data?.push ?? true, whatsapp: data?.whatsapp ?? true };
}

export async function salvarPreferencias(p: PreferenciasAviso) {
  const { error } = await avisosDb.rpc("aviso_preferencias_salvar", {
    _push: p.push,
    _whatsapp: p.whatsapp,
  });
  if (error) throw new Error(error.message);
}

// --- Web push ----------------------------------------------------------------------------------

export type SituacaoPush =
  | "sem_suporte"
  | "iphone_sem_instalar"
  | "bloqueado"
  | "pode_ativar"
  | "ativo";

export function ehIphone(ua = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  return /iPhone|iPad|iPod/i.test(ua);
}
export function instaladoNaTelaInicial() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function situacaoPush(): Promise<SituacaoPush> {
  if (typeof window === "undefined") return "sem_suporte";
  const suporte = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!suporte) return ehIphone() && !instaladoNaTelaInicial() ? "iphone_sem_instalar" : "sem_suporte";
  if (Notification.permission === "denied") return "bloqueado";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "ativo" : "pode_ativar";
}

function chaveParaBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Pede a permissão (precisa vir de um clique), inscreve o aparelho e grava no banco. */
export async function ativarPush(chavePublica: string): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permissão de notificação não concedida.");
  const reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveParaBytes(chavePublica),
    }));
  const j = sub.toJSON();
  const { error } = await avisosDb.rpc("push_inscrever", {
    _endpoint: j.endpoint,
    _p256dh: j.keys?.p256dh,
    _auth: j.keys?.auth,
    _aparelho: navigator.userAgent.slice(0, 200),
  });
  if (error) throw new Error(error.message);
}

export async function desativarPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await avisosDb.rpc("push_cancelar", { _endpoint: sub.endpoint });
  await sub.unsubscribe();
}
