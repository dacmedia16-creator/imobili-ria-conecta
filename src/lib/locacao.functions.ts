import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Arquivos da locação (t_74426f94). O bucket "locacao-documentos" é privado e não tem política para o navegador:
 * 1) o banco confere quem pode (RPC com o login de quem clicou) e devolve o caminho;
 * 2) só então o servidor (service_role) gera a URL assinada de envio ou de leitura (curta).
 * Assim um corretor não grava nem lê arquivo de outra locação, mesmo montando o caminho na mão.
 */
const BUCKET = "locacao-documentos";

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export const prepararEnvioDocumentoLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        locacaoId: z.string().uuid(),
        item: z.string().min(1).max(200),
        ext: z.enum(["pdf", "jpg", "jpeg", "png", "webp"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: prep, error } = await user.rpc("locacao_documento_preparar", {
      _id: data.locacaoId,
      _item: data.item,
      _ext: data.ext,
    });
    if (error) throw new Error(error.message);
    const path = (prep as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || !path) throw new Error("Não foi possível preparar o envio.");
    const { data: signed, error: e2 } = await (
      await admin()
    ).storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (e2 || !signed?.token) throw new Error("Não foi possível preparar o envio.");
    return { path, token: signed.token };
  });

export const linkDocumentoLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ documentoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: doc, error } = await user.rpc("locacao_documento_ver", {
      _doc: data.documentoId,
    });
    if (error) throw new Error(error.message);
    const path = (doc as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || !path) throw new Error("Documento indisponível.");
    const { data: signed, error: e2 } = await (
      await admin()
    ).storage
      .from(BUCKET)
      .createSignedUrl(path, 300);
    if (e2 || !signed?.signedUrl) throw new Error("Documento indisponível.");
    return { url: signed.signedUrl };
  });
