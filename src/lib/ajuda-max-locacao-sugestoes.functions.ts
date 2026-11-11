// Ajuda MAX na Locação — fatia 2/2 (t_365484dc). Registro de ideia / erro / dúvida sem resposta (vira chamado
// support_tickets com origem 'locacao') e link do print. Toda permissão é decidida pelo banco com o JWT de quem chama
// (RPCs ajuda_max_locacao_*); a service_role só entra depois, para o bucket privado support-attachments.
// O print NUNCA vai à IA. Sem aviso (sino/WhatsApp/Telegram) nesta fase.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assinaturaBate,
  caminhoDoPrint,
  decodificarPrint,
  PRINT_TIPOS,
} from "@/lib/ajuda-sugestoes";
import { TEXTO_MAX, TEXTO_MIN, textoDoEnvio } from "@/lib/ajuda-max-locacao-sugestoes";

const BUCKET = "support-attachments";

type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
const rpc = (c: SupabaseClient, fn: string, args?: Record<string, unknown>) =>
  (c.rpc as unknown as Rpc).call(c, fn, args);

function erroDoBanco(e: { message: string } | null, padrao: string): never {
  throw new Error(e?.message ? e.message.replace(/^.*?:\s*/, "") || padrao : padrao);
}

const RegistrarInput = z
  .object({
    tipo: z.enum(["sugestao", "erro", "duvida"]),
    texto: z.string().trim().min(TEXTO_MIN).max(TEXTO_MAX),
    telaRota: z
      .string()
      .max(300)
      .regex(/^\/locacoes/),
    telaNome: z.string().max(120),
    userAgent: z.string().max(400).optional(),
    print: z
      .object({ base64: z.string().min(1).max(7_200_000), contentType: z.enum(PRINT_TIPOS) })
      .optional(),
  })
  // Dúvida sem resposta é só texto (a pergunta feita ao assistente).
  .refine((d) => !(d.tipo === "duvida" && d.print), { message: "Dúvida não leva anexo." });

/** Registra o envio. O print (opcional) vai ao bucket privado pelo servidor; nunca à IA. */
export const registrarEnvioLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RegistrarInput.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const userId = context.userId as string;

    // Chave + Locação conferidas antes de subir qualquer arquivo.
    const { data: ligado } = await rpc(user, "ajuda_max_locacao_enabled");
    if (ligado !== true) throw new Error("O Ajuda MAX não está liberado nesta imobiliária.");

    let printPath: string | null = null;
    let admin: SupabaseClient | null = null;
    if (data.print) {
      const { bytes, ext } = decodificarPrint(data.print);
      if (!assinaturaBate(bytes, data.print.contentType))
        throw new Error("O arquivo não é uma imagem válida.");
      const { data: orgId, error } = await rpc(user, "current_org_id");
      if (error || typeof orgId !== "string" || !orgId)
        throw new Error("Usuário sem imobiliária ativa.");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      admin = supabaseAdmin as unknown as SupabaseClient;
      printPath = caminhoDoPrint(orgId, userId, crypto.randomUUID(), ext);
      const up = await admin.storage
        .from(BUCKET)
        .upload(printPath, bytes, { contentType: data.print.contentType, upsert: false });
      if (up.error) throw new Error("Não foi possível enviar o print. Tente sem ele.");
    }

    const { data: r, error } = await rpc(user, "ajuda_max_locacao_registrar", {
      _tipo: data.tipo,
      _texto: textoDoEnvio(data.tipo, data.texto),
      _tela_rota: data.telaRota,
      _tela_nome: data.telaNome,
      _user_agent: data.userAgent ?? null,
      _print_path: printPath,
    });
    const reg = (r ?? {}) as { id?: unknown; numero?: unknown };
    if (error || typeof reg.id !== "string") {
      if (printPath && admin) await admin.storage.from(BUCKET).remove([printPath]);
      erroDoBanco(error, "Não foi possível registrar o envio.");
    }
    console.log(`[ajuda-max] envio registrado tipo=${data.tipo} print=${printPath ? 1 : 0}`);
    return { id: reg.id as string, numero: typeof reg.numero === "number" ? reg.numero : null };
  });

/** Link temporário (5 min) do print: autor ou gestão da mesma imobiliária (o banco decide). */
export const linkDoPrintLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: path, error } = await rpc(user, "ajuda_max_locacao_sugestao_print", {
      _ticket: data.ticketId,
    });
    if (error || typeof path !== "string" || !path) throw new Error("Print indisponível.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const { data: signed, error: e2 } = await admin.storage.from(BUCKET).createSignedUrl(path, 300);
    if (e2 || !signed?.signedUrl) throw new Error("Print indisponível.");
    return { url: signed.signedUrl };
  });
