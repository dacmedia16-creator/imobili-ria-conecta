/**
 * Wiki MAX — link temporário do vídeo de um guia.
 *
 * Só para quem está logado (requireSupabaseAuth). A chave é conferida contra a lista fixa
 * WIKI_VIDEOS: o navegador nunca escolhe o caminho do arquivo. O bucket "wiki-midia" é privado e
 * não tem policy para authenticated; o link sai pela service_role depois da checagem de login.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  WIKI_VIDEO_BUCKET,
  WIKI_VIDEO_CHAVES,
  WIKI_VIDEO_LINK_SEGUNDOS,
  WIKI_VIDEOS,
} from "@/lib/wiki-max/videos";

export const linkDoVideoWiki = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ chave: z.enum(WIKI_VIDEO_CHAVES) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const { data: signed, error } = await admin.storage
      .from(WIKI_VIDEO_BUCKET)
      .createSignedUrl(WIKI_VIDEOS[data.chave], WIKI_VIDEO_LINK_SEGUNDOS);
    if (error || !signed?.signedUrl) throw new Error("Vídeo indisponível no momento.");
    return { url: signed.signedUrl };
  });
