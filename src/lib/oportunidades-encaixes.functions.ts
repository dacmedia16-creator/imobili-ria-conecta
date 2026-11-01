import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  VALIDADE_DIAS,
  captureCandidate,
  encaixesVisiveis,
  pairKey,
  type EncaixesVisiveis,
  type OpportunityPost,
} from "@/lib/oportunidades";

const VAZIO: EncaixesVisiveis = { grupo: {}, equipe: {} };

type PostRow = Omit<OpportunityPost, "valor_min" | "valor_max" | "valor"> & {
  valor_min: number | string | null;
  valor_max: number | string | null;
  valor: number | string | null;
};

const num = (v: number | string | null) => (v == null ? null : Number(v));

/**
 * Encaixes do mural de Oportunidades que o usuário logado pode ver (t_6dd4a31b).
 *
 * Quem decide a imobiliária, o módulo ligado e se a pessoa é staff é o banco, com o JWT dela
 * (RPC opportunity_viewer: vazio = módulo desligado / sem imobiliária → nada). Só depois o
 * service_role lê posts (com o autor), captações e pares ocultos DAQUELA imobiliária, e o filtro
 * de envolvimento devolve a cada um só os pares de que ele faz parte. O captor_id e o autor dos
 * posts não saem do servidor.
 */
export const encaixesDoMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EncaixesVisiveis> => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: v, error: vErr } = await user.rpc("opportunity_viewer");
    if (vErr) throw new Error("Não foi possível conferir o acesso ao mural.");
    const viewer = (Array.isArray(v) ? v[0] : v) as {
      org_id: string | null;
      is_staff: boolean;
    } | null;
    if (!viewer?.org_id) return VAZIO;
    const orgId = viewer.org_id;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const desde = new Date(Date.now() - (VALIDADE_DIAS + 2) * 86_400_000).toISOString();
    const [p, c, h] = await Promise.all([
      admin
        .from("opportunity_posts")
        .select(
          "id,kind,tipo,finalidade,bairro,valor_min,valor_max,valor,corretor,texto,posted_at,author_profile_id",
        )
        .eq("organization_id", orgId)
        .in("kind", ["procura", "oferta"])
        .gte("posted_at", desde)
        .order("posted_at", { ascending: false })
        .limit(500),
      // Só os campos do encaixe: nada de endereço, proprietário ou documentos.
      admin
        .from("exclusive_captures")
        .select(
          "id,captor_id,broker_name,tipo_imovel:form_data->imovel->>tipo_imovel,bairro:form_data->imovel->>bairro,municipio:form_data->imovel->>municipio,valor_imovel:form_data->imovel->>valor_imovel",
        )
        .eq("organization_id", orgId)
        .eq("status", "aprovada")
        .is("archived_at", null)
        .is("discarded_at", null),
      admin
        .from("opportunity_hidden_pairs")
        .select("post_id,target_id")
        .eq("organization_id", orgId),
    ]);
    if (p.error || c.error || h.error) throw new Error("Não foi possível calcular os encaixes.");

    const capRows = (c.data ?? []) as {
      id: string;
      captor_id: string;
      broker_name: string | null;
      tipo_imovel: string | null;
      bairro: string | null;
      municipio: string | null;
      valor_imovel: string | null;
    }[];
    const semNome = [
      ...new Set(capRows.filter((r) => !r.broker_name?.trim()).map((r) => r.captor_id)),
    ];
    const nomes = new Map<string, string | null>();
    if (semNome.length) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id,nome")
        .eq("organization_id", orgId)
        .in("id", semNome);
      for (const x of (profs ?? []) as { id: string; nome: string | null }[])
        nomes.set(x.id, x.nome);
    }
    const captures = capRows.map((r) =>
      captureCandidate({
        ...r,
        captor_nome: r.broker_name?.trim() || nomes.get(r.captor_id) || null,
      }),
    );
    const posts: OpportunityPost[] = ((p.data ?? []) as PostRow[]).map((r) => ({
      ...r,
      valor_min: num(r.valor_min),
      valor_max: num(r.valor_max),
      valor: num(r.valor),
    }));
    const hidden = new Set(
      ((h.data ?? []) as { post_id: string; target_id: string }[]).map((x) =>
        pairKey(x.post_id, x.target_id),
      ),
    );
    return encaixesVisiveis(posts, captures, hidden, {
      userId: context.userId,
      isStaff: viewer.is_staff === true,
    });
  });
