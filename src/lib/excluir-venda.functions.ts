import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { executarExclusaoVenda, type DependenciasExclusao } from "@/lib/excluir-venda";

const Input = z.object({ saleId: z.string().uuid() });
const BUCKET = "sale-documents";

/**
 * Exclui uma venda em rascunho junto com os arquivos do storage (t_42d1f0bb).
 *
 * - Leitura da venda, checagem de permissão e o DELETE em `sales` usam o JWT de quem chama
 *   (RLS + as mesmas funções da policy delete_sales_por_papel).
 * - Listar e remover os arquivos usa service_role, porque o RLS esconde do corretor os documentos
 *   arquivados (deleted_at) e eles também precisam sair do bucket. Só roda DEPOIS da checagem de
 *   permissão e sempre filtrado pelo sale_id já validado.
 */
export const excluirVenda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;

    const rpcBool = async (fn: string, args: Record<string, unknown>) => {
      const { data: v, error } = await user.rpc(fn, args);
      if (error) throw new Error(`Falha ao conferir permissão (${fn})`);
      return v === true;
    };

    const deps: DependenciasExclusao = {
      lerVenda: async (saleId) => {
        const { data: v, error } = await user
          .from("sales")
          .select("id, corretor_id, status")
          .eq("id", saleId)
          .maybeSingle();
        if (error) throw new Error("Falha ao ler a venda");
        return v as { id: string; corretor_id: string | null; status: string | null } | null;
      },
      usuarioAtivo: (userId) => rpcBool("is_active_user", { _user: userId }),
      temPapel: (userId, papeis) => rpcBool("has_any_role", { _user_id: userId, _roles: papeis }),
      lideraCorretor: (userId, corretorId) =>
        rpcBool("is_lead_of", { _lider: userId, _membro: corretorId }),
      listarCaminhos: async (saleId) => {
        const { data: docs, error } = await admin
          .from("sale_documents")
          .select("storage_path")
          .eq("sale_id", saleId);
        if (error) throw new Error("Falha ao listar os documentos da venda");
        return (docs ?? [])
          .map((d: { storage_path: string | null }) => d.storage_path)
          .filter((p): p is string => Boolean(p));
      },
      removerArquivos: async (paths) => {
        const { data: removed, error } = await admin.storage.from(BUCKET).remove(paths);
        return { removidos: (removed ?? []).map((o) => o.name), erro: error?.message ?? null };
      },
      apagarVenda: async (saleId) => {
        const { data: rows, error } = await user
          .from("sales")
          .delete()
          .eq("id", saleId)
          .select("id");
        return { apagadas: rows?.length ?? 0, erro: error?.message ?? null };
      },
    };

    return executarExclusaoVenda(deps, context.userId, data.saleId);
  });
