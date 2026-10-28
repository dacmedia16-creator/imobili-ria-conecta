// Transferência de captação entre corretores (sugestão 1047 do Odyr; "aprovado" de Denis em 28/10/2026,
// t_997545e5). As regras de verdade ficam no banco (exclusive_transferir): aqui só textos, prévia e
// chamadas. Quem pode: dono/gestor da imobiliária (team leader sozinho e corretor não).
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Capture, CaptureEvent } from "./exclusive-captures";

const db = supabase as unknown as SupabaseClient;

export const MOTIVOS_TRANSFERENCIA = [
  "Corretor saiu da imobiliária",
  "Redistribuição da carteira",
] as const;
export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 500;
export const LOTE_MAX = 500;

/** Mesma regra do banco (papel): gestor, admin ou super_admin. Team leader sozinho não transfere. */
export function papelPodeTransferir<R extends string>(hasAny: (roles: R[]) => boolean): boolean {
  return hasAny(["gestor", "admin", "super_admin"] as R[]);
}

export type ContratoNaTransferencia = "atualizado" | "mantido" | "bloqueado";

/** O que acontece com o contrato (regras 6, 7 e 8 de Denis). */
export function contratoNaTransferencia(
  c: Pick<Capture, "status" | "manual">,
  envelopeAtivo = false,
): ContratoNaTransferencia {
  if (c.status === "em_assinatura" || envelopeAtivo) return "bloqueado";
  if (c.status === "aprovada" || c.manual) return "mantido";
  return "atualizado";
}

export const TEXTO_CONTRATO: Record<ContratoNaTransferencia, string> = {
  atualizado: "O contrato ainda não foi assinado: passa a sair com nome, CPF e CRECI do novo corretor.",
  mantido:
    "O contrato já assinado continua como está, no nome de quem assinou. Só a responsabilidade muda.",
  bloqueado:
    "Contrato em assinatura na Clicksign: conclua ou cancele o envio antes de transferir.",
};

/** Motivo: escolhido da lista ou "Outro" com texto livre. Devolve o erro ou null. */
export function erroMotivo(motivo: string): string | null {
  const t = motivo.trim();
  if (t.length < MOTIVO_MIN) return "Informe o motivo da transferência.";
  if (t.length > MOTIVO_MAX) return `Motivo muito longo (máximo ${MOTIVO_MAX} caracteres).`;
  return null;
}

export type ItemPrevia = {
  id: string;
  endereco: string;
  bairro: string | null;
  status: Capture["status"];
  manual: boolean;
  arquivada: boolean;
  bloqueio: string | null;
  contrato: ContratoNaTransferencia;
  leads_abertos: number;
};

/** Na prévia do lote, já vem marcado tudo o que pode ir (bloqueadas ficam desmarcadas e travadas). */
export function marcadosIniciais(itens: ItemPrevia[]): Set<string> {
  return new Set(itens.filter((i) => !i.bloqueio).map((i) => i.id));
}

export function resumoLote(itens: ItemPrevia[], marcados: Set<string>) {
  const sel = itens.filter((i) => marcados.has(i.id) && !i.bloqueio);
  return {
    ids: sel.map((i) => i.id),
    total: sel.length,
    atualizados: sel.filter((i) => i.contrato === "atualizado").length,
    mantidos: sel.filter((i) => i.contrato === "mantido").length,
    leads: sel.reduce((n, i) => n + (i.leads_abertos || 0), 0),
    bloqueadas: itens.filter((i) => i.bloqueio).length,
  };
}

export type DetalheTransferencia = {
  de: string | null;
  de_nome: string;
  para: string | null;
  para_nome: string;
  motivo: string;
  contrato: "atualizado" | "mantido" | null;
  leads: number;
};

/** Lê o detail JSON gravado pela RPC (histórico 'transferida'); tolera texto antigo/estragado. */
export function lerTransferencia(detail: string | null): DetalheTransferencia {
  let d: Record<string, unknown> = {};
  try {
    const p = detail ? JSON.parse(detail) : {};
    if (p && typeof p === "object") d = p as Record<string, unknown>;
  } catch {
    d = {};
  }
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const c = s(d.contrato);
  return {
    de: s(d.de),
    de_nome: s(d.de_nome) ?? "—",
    para: s(d.para),
    para_nome: s(d.para_nome) ?? "—",
    motivo: s(d.motivo) ?? "—",
    contrato: c === "atualizado" || c === "mantido" ? c : null,
    leads: Number(d.leads) > 0 ? Number(d.leads) : 0,
  };
}

/** "Transferida de Carlos para Bruno · motivo: … (contrato mantido no nome de quem assinou)". */
export function textoTransferencia(d: DetalheTransferencia): string {
  const contrato =
    d.contrato === "mantido"
      ? " · contrato assinado mantido no nome de quem assinou"
      : d.contrato === "atualizado"
        ? " · contrato passa a sair no nome do novo corretor"
        : "";
  const leads = d.leads ? ` · ${d.leads} lead${d.leads === 1 ? "" : "s"} aberto${d.leads === 1 ? "" : "s"} transferido${d.leads === 1 ? "" : "s"}` : "";
  return `Transferida de ${d.de_nome} para ${d.para_nome} · motivo: ${d.motivo}${contrato}${leads}`;
}

/**
 * Aviso na ficha (regra 6): contrato assinado no nome de um corretor e captação hoje com outro.
 * null quando não há o que avisar.
 */
export function avisoContratoOutroCorretor(
  c: Pick<Capture, "status" | "manual" | "broker_name" | "captador_original_id">,
  history: Pick<CaptureEvent, "action" | "detail">[],
): string | null {
  if (!c.captador_original_id) return null;
  if (c.status !== "aprovada" && !c.manual) return null;
  const ultima = history.find((h) => h.action === "transferida");
  const atual = ultima ? lerTransferencia(ultima.detail).para_nome : null;
  const assinado = c.broker_name?.trim() || "corretor anterior";
  if (atual && atual === assinado) return null;
  return `Esta captação foi transferida${atual ? ` para ${atual}` : ""}. O contrato assinado continua no nome de ${assinado} e não é alterado.`;
}

/** Corretores de origem para o lote: quem tem captação na lista (nome atual do perfil quando há). */
export function origensDoLote(
  captures: Pick<Capture, "captor_id" | "broker_name" | "captador_original_id">[],
  nomes: Map<string, string>,
): { id: string; nome: string }[] {
  const porId = new Map<string, string>();
  for (const c of captures) {
    if (porId.has(c.captor_id) && nomes.has(c.captor_id)) continue;
    // broker_name só é confiável quando a captação nunca foi transferida.
    const nome =
      nomes.get(c.captor_id) ??
      (!c.captador_original_id && c.broker_name?.trim() ? c.broker_name.trim() : undefined);
    if (nome) porId.set(c.captor_id, nome);
    else if (!porId.has(c.captor_id)) porId.set(c.captor_id, "Corretor sem nome");
  }
  return [...porId].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
}

// ---- chamadas ao banco ------------------------------------------------------------------------
const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export async function destinosTransferencia(): Promise<{ id: string; nome: string }[]> {
  const { data, error } = await db.rpc("exclusive_transferencia_destinos");
  check(error);
  return (data ?? []) as { id: string; nome: string }[];
}

export async function previaTransferencia(de: string): Promise<ItemPrevia[]> {
  const { data, error } = await db.rpc("exclusive_transferencia_previa", { _de: de });
  check(error);
  return (data ?? []) as ItemPrevia[];
}

export async function podeTransferir(id: string, userId: string): Promise<boolean> {
  const { data, error } = await db.rpc("exclusive_pode_transferir", { _id: id, _actor: userId });
  if (error) return false; // migration ainda não aplicada: botão fica escondido
  return data === true;
}

export async function transferirCaptacoes(
  ids: string[],
  destino: string,
  motivo: string,
): Promise<{ transferidas: number; contratos_atualizados: number; contratos_mantidos: number; leads: number }> {
  const { data, error } = await db.rpc("exclusive_transferir", {
    _ids: ids,
    _destino: destino,
    _motivo: motivo.trim(),
  });
  check(error);
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    transferidas: Number(o.transferidas ?? 0),
    contratos_atualizados: Number(o.contratos_atualizados ?? 0),
    contratos_mantidos: Number(o.contratos_mantidos ?? 0),
    leads: Number(o.leads ?? 0),
  };
}
