import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LOGO_TYPES, LOGO_MAX_BYTES } from "@/lib/platform-organizations";

/** Storage não tem policy de escrita pública; só o servidor, após a RPC de autorização. */
export const uploadAgencyLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        base64: z.string().min(1).max(1_500_000),
        contentType: z.enum(LOGO_TYPES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const user = context.supabase as SupabaseClient;
    const { data: allowed, error: authError } = await user.rpc("agency_can_edit");
    if (authError || allowed !== true) throw new Error("Sem permissão para editar a marca.");
    const { data: orgId, error: scopeError } = await user.rpc("current_org_id");
    if (scopeError || !orgId) throw new Error("Imobiliária não identificada.");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    } catch {
      throw new Error("Arquivo inválido.");
    }
    if (!bytes.length || bytes.length > LOGO_MAX_BYTES) throw new Error("Logo deve ter até 1 MB.");
    const signature = Array.from(bytes.slice(0, 12));
    const valid =
      data.contentType === "image/png"
        ? signature.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
        : data.contentType === "image/jpeg"
          ? signature.slice(0, 3).join(",") === "255,216,255"
          : String.fromCharCode(...signature.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...signature.slice(8, 12)) === "WEBP";
    if (!valid) throw new Error("Formato do logo não corresponde ao arquivo.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const { data: current, error: readError } = await user
      .from("organizations")
      .select("logo_path")
      .eq("id", orgId)
      .single();
    if (readError || !current) throw new Error("Não foi possível identificar o logo anterior.");
    const ext =
      data.contentType === "image/png" ? "png" : data.contentType === "image/webp" ? "webp" : "jpg";
    const path = `${orgId}/logo-${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from("organization-logos")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (uploadError) throw new Error("Não foi possível enviar o logo.");
    const { error } = await user.rpc("agency_profile_save", { _data: { logo_path: path } });
    if (error) {
      await admin.storage.from("organization-logos").remove([path]);
      throw new Error("Não foi possível vincular o logo à imobiliária.");
    }
    if (current.logo_path?.startsWith(`${orgId}/`) && current.logo_path !== path)
      await admin.storage.from("organization-logos").remove([current.logo_path]);
    return {
      path,
      url: admin.storage.from("organization-logos").getPublicUrl(path).data.publicUrl,
    };
  });
