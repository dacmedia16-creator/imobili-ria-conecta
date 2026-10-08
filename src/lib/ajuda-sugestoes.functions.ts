/**
 * "Ajuda e sugestões" — funções de servidor.
 *
 * Toda permissão é decidida pelo banco com o JWT de quem chama (RPCs support_ticket_*). O cliente
 * service_role só entra DEPOIS dessa checagem, para: enviar o print ao bucket privado
 * support-attachments, gerar o link assinado (5 min) e gravar os avisos (sino + WhatsApp).
 * O WhatsApp reaproveita o helper das captações e fica DESLIGADO (SUPORTE_WHATSAPP_LIGADO).
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  APP_URL,
  erroSemDadosPessoais,
  normalizePhone,
  paraWhatsapp,
  ZIONTALK_TIMEOUT_MS,
  ZIONTALK_URL,
} from "@/lib/sale-notifications.functions";
import { enviarAvisosCaptacao, type DestinoAviso } from "@/lib/captacao-auditoria";
import {
  caminhoDoPrint,
  decodificarPrint,
  PRINT_TIPOS,
  SUPORTE_WHATSAPP_LIGADO,
  textoAvisoSuporte,
} from "@/lib/ajuda-sugestoes";

const BUCKET = "support-attachments";

type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;
const rpc = (c: SupabaseClient, fn: string, args?: Record<string, unknown>) =>
  (c.rpc as unknown as Rpc).call(c, fn, args);

function erroDoBanco(e: { message: string } | null, padrao: string): never {
  throw new Error(e?.message ? e.message.replace(/^.*?:\s*/, "") || padrao : padrao);
}

/** Confere a assinatura do arquivo (não confia só no tipo enviado pelo navegador). */
function assinaturaBate(bytes: Uint8Array, tipo: string): boolean {
  const s = Array.from(bytes.slice(0, 12));
  if (tipo === "image/png") return s.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  if (tipo === "image/jpeg") return s.slice(0, 3).join(",") === "255,216,255";
  return (
    String.fromCharCode(...s.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...s.slice(8, 12)) === "WEBP"
  );
}

type Ticket = {
  id: string;
  numero: number;
  organization_id: string;
  author_id: string;
  tipo: string;
};

/** Avisos (sino + WhatsApp desligado). Nunca lança: o chamado/resposta já foi gravado. */
async function avisar(p: {
  admin: SupabaseClient;
  evento: "novo" | "resposta";
  ticket: Ticket;
  quemAgiu: string;
}) {
  try {
    const { admin, ticket } = p;
    const [{ data: org }, { data: autor }] = await Promise.all([
      admin.from("organizations").select("nome").eq("id", ticket.organization_id).maybeSingle(),
      admin.from("profiles").select("nome").eq("id", ticket.author_id).maybeSingle(),
    ]);

    let alvo: string[];
    if (p.evento === "novo") {
      const { data } = await admin.from("platform_admins").select("user_id");
      alvo = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
    } else {
      alvo = [ticket.author_id];
    }
    alvo = Array.from(new Set(alvo)).filter((id) => id !== p.quemAgiu);
    if (!alvo.length) return;

    // Cada aviso fica na imobiliária de quem recebe (FK de notifications.organization_id).
    const { data: perfis } = await admin
      .from("profiles")
      .select("id, telefone, ativo, organization_id")
      .in("id", alvo);
    const linhas = (perfis ?? []) as {
      id: string;
      telefone: string | null;
      ativo: boolean | null;
      organization_id: string | null;
    }[];
    const orgDe = new Map(linhas.map((l) => [l.id, l.organization_id]));
    const destinos: DestinoAviso[] = linhas
      .filter((l) => l.organization_id)
      .filter((l) => p.evento === "novo" || l.organization_id === ticket.organization_id)
      .map((l) => ({ id: l.id, telefone: l.telefone, ativo: l.ativo, querWhatsapp: true }));

    const texto = textoAvisoSuporte({
      evento: p.evento,
      numero: ticket.numero,
      tipo: ticket.tipo,
      organizacao: (org as { nome?: string } | null)?.nome ?? "Imobiliaria",
      autor: (autor as { nome?: string } | null)?.nome ?? "Usuario",
      appUrl: APP_URL,
    });

    await enviarAvisosCaptacao({
      texto,
      destinos,
      gravarSino: async (rows) => {
        const { error } = await admin.from("notifications").insert(
          rows.map((row) => ({
            ...row,
            organization_id: orgDe.get(row.user_id) as string,
            support_ticket_id: ticket.id,
            tipo: `suporte_${p.evento}`,
          })),
        );
        if (error) throw new Error(error.message);
      },
      registrar: async (res) => {
        if (!SUPORTE_WHATSAPP_LIGADO) return;
        await admin.from("activity_logs").insert({
          organization_id: ticket.organization_id,
          autor_id: p.quemAgiu,
          acao: "whatsapp_notification_result",
          payload: {
            chamado_id: ticket.id,
            evento: `suporte_${p.evento}`,
            enviados: res.enviados,
            falhas: res.falhas,
            ignorados: res.ignorados,
            notificados_interno: res.notificados,
            ...(res.erros.length ? { erros: res.erros } : {}),
          },
        });
      },
      // Desligado: sem chave, o helper grava só o sino e não chama o ZionTalk.
      apiKey: SUPORTE_WHATSAPP_LIGADO ? process.env.ZIONTALK_API_KEY : undefined,
      fetchImpl: fetch,
      url: ZIONTALK_URL,
      timeoutMs: ZIONTALK_TIMEOUT_MS,
      normalizePhone,
      paraWhatsapp,
      semDadosPessoais: erroSemDadosPessoais,
    });
  } catch (e) {
    console.error("avisoSuporte", erroSemDadosPessoais(String(e)));
  }
}

async function lerTicket(admin: SupabaseClient, id: string): Promise<Ticket | null> {
  const { data } = await admin
    .from("support_tickets" as never)
    .select("id, numero, organization_id, author_id, tipo")
    .eq("id", id)
    .maybeSingle();
  return (data as Ticket | null) ?? null;
}

const CriarInput = z.object({
  tipo: z.enum(["erro", "duvida", "sugestao"]),
  texto: z.string().trim().min(5).max(4000),
  telaRota: z.string().max(300).optional(),
  telaNome: z.string().max(120).optional(),
  userAgent: z.string().max(400).optional(),
  print: z
    .object({
      base64: z.string().min(1).max(7_200_000),
      contentType: z.enum(PRINT_TIPOS),
    })
    .optional(),
});

/** Abre o chamado. O print (opcional) vai ao bucket privado pelo servidor. */
export const criarChamado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CriarInput.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as SupabaseClient;
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;

    let printPath: string | null = null;
    if (data.print) {
      const { bytes, ext } = decodificarPrint(data.print);
      if (!assinaturaBate(bytes, data.print.contentType))
        throw new Error("O arquivo não é uma imagem válida.");
      const { data: orgId, error } = await rpc(user, "current_org_id");
      if (error || typeof orgId !== "string" || !orgId)
        throw new Error("Usuário sem imobiliária ativa.");
      printPath = caminhoDoPrint(orgId, userId, crypto.randomUUID(), ext);
      const up = await admin.storage
        .from(BUCKET)
        .upload(printPath, bytes, { contentType: data.print.contentType, upsert: false });
      if (up.error) throw new Error("Não foi possível enviar o print. Tente sem ele.");
    }

    const { data: id, error } = await rpc(user, "support_ticket_create", {
      _tipo: data.tipo,
      _texto: data.texto,
      _tela_rota: data.telaRota ?? null,
      _tela_nome: data.telaNome ?? null,
      _user_agent: data.userAgent ?? null,
      _print_path: printPath,
    });
    if (error || typeof id !== "string") {
      if (printPath) await admin.storage.from(BUCKET).remove([printPath]);
      erroDoBanco(error, "Não foi possível abrir o chamado.");
    }

    const ticket = await lerTicket(admin, id);
    if (ticket) await avisar({ admin, evento: "novo", ticket, quemAgiu: userId });
    return { id, numero: ticket?.numero ?? null };
  });

const ResponderInput = z.object({
  ticketId: z.string().uuid(),
  texto: z.string().trim().min(1).max(4000),
  interna: z.boolean().default(false),
});

/** Responde (equipe MAX ou autor). Resposta da equipe avisa o autor; nota interna não avisa. */
export const responderChamado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResponderInput.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as SupabaseClient;
    const { data: status, error } = await rpc(user, "support_ticket_reply", {
      _ticket: data.ticketId,
      _texto: data.texto,
      _interna: data.interna,
    });
    if (error) erroDoBanco(error, "Não foi possível responder.");

    const { data: equipe } = await rpc(user, "is_platform_super_admin");
    if (equipe === true && !data.interna) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as SupabaseClient;
      const ticket = await lerTicket(admin, data.ticketId);
      if (ticket) await avisar({ admin, evento: "resposta", ticket, quemAgiu: context.userId });
    }
    return { status: status as string };
  });

/** Link temporário (5 min) do print: só autor e equipe MAX (o banco decide). */
export const linkDoPrint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as SupabaseClient;
    const { data: path, error } = await rpc(user, "support_ticket_print_path", {
      _ticket: data.ticketId,
    });
    if (error || typeof path !== "string" || !path) throw new Error("Print indisponível.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const { data: signed, error: e2 } = await admin.storage.from(BUCKET).createSignedUrl(path, 300);
    if (e2 || !signed?.signedUrl) throw new Error("Print indisponível.");
    return { url: signed.signedUrl };
  });
