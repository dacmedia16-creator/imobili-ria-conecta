import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { apagarArquivoSemUso, type DependenciasArquivo } from "@/lib/captacao-remover-documento";

const BUCKET = "exclusive-captures";
const KINDS = [
  "rg",
  "cpf",
  "cnh",
  "residencia",
  "iptu",
  "matricula",
  "gerado",
  "assinado",
] as const;

const RemoverInput = z.object({
  captureId: z.string().uuid(),
  kind: z.enum(KINDS),
  owner: z.number().int().min(0).max(60),
});
const LimparInput = z.object({
  captureId: z.string().uuid(),
  path: z.string().min(10).max(300),
});

async function dependencias(user: SupabaseClient): Promise<DependenciasArquivo> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as SupabaseClient;
  return {
    orgDoUsuario: async () => {
      const { data, error } = await user.rpc("current_org_id");
      return error || typeof data !== "string" ? null : data;
    },
    caminhoEmUso: async (path) => {
      const { data, error } = await admin
        .from("exclusive_documents")
        .select("id")
        .eq("storage_path", path)
        .limit(1);
      // Na dúvida, trata como em uso (não apaga).
      return error ? true : (data ?? []).length > 0;
    },
    apagarArquivo: async (path) => {
      const { error } = await admin.storage.from(BUCKET).remove([path]);
      return { erro: error?.message ?? null };
    },
  };
}

/**
 * Remove um documento da captação (t_5ab6dad4). Quem decide é o banco, com o JWT do usuário
 * (exclusive_remove_document: editor, rascunho/devolvida; nunca 'gerado' nem o 'assinado' da
 * captação normal). Depois apaga o arquivo do Storage, se for desta captação e estiver sem uso.
 */
export const removerDocumentoCaptacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RemoverInput.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: path, error } = await user.rpc("exclusive_remove_document", {
      _id: data.captureId,
      _kind: data.kind,
      _owner: data.owner,
    });
    if (error) throw new Error(error.message);
    const arquivo =
      typeof path === "string"
        ? await apagarArquivoSemUso(await dependencias(user), data.captureId, path).catch(
            () => "ignorado" as const,
          )
        : "ignorado";
    return { ok: true as const, arquivo };
  });

const RemoverProprietarioInput = z.object({
  captureId: z.string().uuid(),
  owner: z.number().int().min(2).max(60),
  total: z.number().int().min(2).max(60),
});

/**
 * Remove o proprietário N com os documentos dele (t_b3a9ed4f). O banco decide e faz tudo numa
 * transação (exclusive_remove_owner: editor, rascunho/devolvida; apaga os documentos do N e desce
 * os dos seguintes um número). Depois apaga do Storage os arquivos que ficaram sem uso.
 */
export const removerProprietarioCaptacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RemoverProprietarioInput.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: paths, error } = await user.rpc("exclusive_remove_owner", {
      _id: data.captureId,
      _n: data.owner,
      _total: data.total,
    });
    if (error) throw new Error(error.message);
    const lista = Array.isArray(paths)
      ? paths.filter((p): p is string => typeof p === "string")
      : [];
    if (!lista.length) return { ok: true as const, apagados: 0 };
    const deps = await dependencias(user);
    const r = await Promise.all(
      lista.map((p) =>
        apagarArquivoSemUso(deps, data.captureId, p).catch(() => "ignorado" as const),
      ),
    );
    return { ok: true as const, apagados: r.filter((x) => x === "apagado").length };
  });

/**
 * Substituir: apaga o arquivo ANTIGO depois que o novo foi registrado. Só para o editor da captação
 * (rascunho/devolvida — mesmo momento em que ele pode remover), só caminho desta captação e só se
 * nenhuma linha usar mais o arquivo. A tela só chama para documentos que não são contrato.
 */
export const limparArquivoSubstituido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => LimparInput.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: pode, error } = await user.rpc("exclusive_is_editor", {
      _id: data.captureId,
      _actor: context.userId,
    });
    if (error || pode !== true) return { arquivo: "ignorado" as const };
    const arquivo = await apagarArquivoSemUso(
      await dependencias(user),
      data.captureId,
      data.path,
    ).catch(() => "ignorado" as const);
    return { arquivo };
  });
