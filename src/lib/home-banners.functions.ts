// Banner do Início (t_75786f5c). As imagens ficam no bucket PRIVADO "home-banners", sem política para o navegador.
// 1) o banco decide quem pode (RPC com o login de quem chamou) e devolve só caminhos da imobiliária dele;
// 2) só então o servidor (service_role) gera a URL assinada de envio/leitura ou apaga o arquivo trocado.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BannerAtivo, BannerCadastro } from "@/lib/home-banners";

const BUCKET = "home-banners";
const LEITURA_SEG = 3600;

type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc = (c: SupabaseClient, fn: string, args?: Record<string, unknown>) =>
  (c.rpc as unknown as Rpc).call(c, fn, args);

function erroDoBanco(e: { message: string } | null, padrao: string): never {
  throw new Error(e?.message || padrao);
}

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

/** URLs assinadas (curtas) para os caminhos que o banco já autorizou. */
async function assinar(paths: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!paths.length) return mapa;
  const { data } = await (await admin()).storage.from(BUCKET).createSignedUrls(paths, LEITURA_SEG);
  for (const s of data ?? []) if (s.path && s.signedUrl) mapa.set(s.path, s.signedUrl);
  return mapa;
}

async function apagar(path: unknown): Promise<void> {
  if (typeof path !== "string" || !path) return;
  // Falha ao apagar não desfaz o cadastro: o arquivo fica órfão no bucket privado (sem acesso de ninguém).
  await (await admin()).storage.from(BUCKET).remove([path]);
}

/** Banners que o usuário logado vê agora no Início (público, datas e ativo decididos pelo banco). */
export const bannersDoInicio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BannerAtivo[]> => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data, error } = await rpc(user, "home_banners_ativos");
    if (error) erroDoBanco(error, "Não foi possível carregar os banners.");
    const lista = (Array.isArray(data) ? data : []) as {
      id: string;
      titulo: string;
      link: string | null;
      imagem_path: string;
    }[];
    const urls = await assinar(lista.map((b) => b.imagem_path));
    return lista
      .filter((b) => urls.has(b.imagem_path))
      .map((b) => ({ id: b.id, titulo: b.titulo, link: b.link, url: urls.get(b.imagem_path)! }));
  });

/** Lista do cadastro (só admin, administrador principal ou staff da imobiliária). */
export const bannersCadastro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BannerCadastro[]> => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data, error } = await rpc(user, "home_banners_lista");
    if (error) erroDoBanco(error, "Não foi possível carregar os banners.");
    const lista = (Array.isArray(data) ? data : []) as Omit<BannerCadastro, "url">[];
    const urls = await assinar(lista.map((b) => b.imagem_path));
    return lista.map((b) => ({ ...b, url: urls.get(b.imagem_path) ?? null }));
  });

export const prepararEnvioBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ ext: z.enum(["jpg", "png", "webp"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: prep, error } = await rpc(user, "home_banner_preparar_envio", { _ext: data.ext });
    if (error) erroDoBanco(error, "Não foi possível preparar o envio.");
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

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SalvarInput = z.object({
  id: z.string().uuid().nullable(),
  titulo: z.string().trim().min(2).max(80),
  imagemPath: z.string().min(10).max(200),
  link: z.string().trim().max(500).nullable(),
  inicio: dia,
  fim: dia,
  publico: z.array(z.string().max(40)).max(20),
  ordem: z.number().int().min(0).max(999),
  ativo: z.boolean(),
});

export const salvarBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SalvarInput.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: r, error } = await rpc(user, "home_banner_salvar", {
      _id: data.id,
      _titulo: data.titulo,
      _imagem_path: data.imagemPath,
      _link: data.link || null,
      _inicio: data.inicio,
      _fim: data.fim,
      _publico: data.publico,
      _ordem: data.ordem,
      _ativo: data.ativo,
    });
    if (error) erroDoBanco(error, "Não foi possível salvar o banner.");
    const res = r as { id?: string; path_antigo?: string | null } | null;
    await apagar(res?.path_antigo);
    return { id: res?.id ?? null };
  });

export const ativarBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), ativo: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { error } = await rpc(user, "home_banner_ativar", { _id: data.id, _ativo: data.ativo });
    if (error) erroDoBanco(error, "Não foi possível alterar o banner.");
    return { ok: true };
  });

export const excluirBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: r, error } = await rpc(user, "home_banner_excluir", { _id: data.id });
    if (error) erroDoBanco(error, "Não foi possível excluir o banner.");
    await apagar((r as { path?: unknown } | null)?.path);
    return { ok: true };
  });
