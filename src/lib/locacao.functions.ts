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

/** Minuta (t_f8f83f9f): só o setor de contratos prepara; o banco devolve o caminho na pasta minutas/ da locação. */
export const prepararEnvioMinutaLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ locacaoId: z.string().uuid(), ext: z.enum(["pdf", "doc", "docx"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: prep, error } = await user.rpc("locacao_minuta_preparar", {
      _id: data.locacaoId,
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

/**
 * Link de uma versão da minuta: o banco confere quem vê a locação; URL assinada de 5 min.
 * Padrão: responde como anexo, com o nome do arquivo (baixar). `baixar: false` é para o olho e o imprimir.
 */
export const linkMinutaLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ minutaId: z.string().uuid(), baixar: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: m, error } = await user.rpc("locacao_minuta_ver", { _minuta: data.minutaId });
    if (error) throw new Error(error.message);
    const { path, nome } = (m ?? {}) as { path?: unknown; nome?: unknown };
    if (typeof path !== "string" || !path) throw new Error("Minuta indisponível.");
    // O Storage codifica duas vezes nomes com acento ("fian%C3%A7a"): baixa com o nome sem acento.
    const limpo =
      typeof nome === "string"
        ? nome
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\w .()-]/g, "_")
        : "";
    const { data: signed, error: e2 } = await (
      await admin()
    ).storage
      .from(BUCKET)
      .createSignedUrl(path, 300, data.baixar === false ? undefined : { download: limpo || true });
    if (e2 || !signed?.signedUrl) throw new Error("Minuta indisponível.");
    return { url: signed.signedUrl };
  });

export const prepararEnvioAnexoLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        locacaoId: z.string().uuid(),
        tipo: z.enum(["apolice", "loft_termos"]),
        ext: z.enum(["pdf", "jpg", "jpeg", "png", "webp"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: prep, error } = await user.rpc("locacao_anexo_preparar", {
      _id: data.locacaoId,
      _tipo: data.tipo,
      _ext: data.ext,
    });
    if (error) throw new Error(error.message);
    const path = (prep as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || !path) throw new Error("Não foi possível preparar o anexo.");
    const { data: signed, error: e2 } = await (
      await admin()
    ).storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (e2 || !signed?.token) throw new Error("Não foi possível preparar o anexo.");
    return { path, token: signed.token };
  });

export const linkAnexoLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ anexoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: anexo, error } = await user.rpc("locacao_anexo_ver", { _anexo: data.anexoId });
    if (error) throw new Error(error.message);
    const path = (anexo as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || !path) throw new Error("Anexo indisponível.");
    const { data: signed, error: e2 } = await (
      await admin()
    ).storage
      .from(BUCKET)
      .createSignedUrl(path, 300);
    if (e2 || !signed?.signedUrl) throw new Error("Anexo indisponível.");
    return { url: signed.signedUrl };
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

/**
 * Pacote para a administradora do condomínio (t_40cff7e4): 1) o banco confere quem pode (corretor da locação, gerência
 * ou gestora), ficha e RGs completos e devolve os dados; 2) o servidor lê os RGs do bucket privado e monta um único PDF;
 * 3) o banco registra quem baixou e quando. Nada é enviado por e-mail: o PDF volta só para quem clicou.
 */
export const baixarPacoteAdministradora = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ locacaoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: prep, error } = await user.rpc("locacao_pacote_preparar", {
      _id: data.locacaoId,
    });
    if (error) throw new Error(error.message);
    const { lerMoradoresRpc } = await import("@/lib/locacao-moradores");
    const { montarPacotePdf, nomeArquivoPacote, tipoArquivo, PACOTE_MAX_BYTES } =
      await import("@/lib/locacao-pacote-pdf");
    const { hojeSaoPaulo } = await import("@/lib/hoje-sao-paulo");
    const p = (prep ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    const loc = (p.locatario ?? {}) as Record<string, unknown>;
    const rgs = (Array.isArray(p.rgs) ? p.rgs : []) as { item?: unknown; path?: unknown }[];
    const sb = await admin();
    const arquivos = [];
    let total = 0;
    for (const r of rgs) {
      const path = s(r.path);
      const prefixo = `${data.locacaoId}/`;
      // Defesa extra: só arquivo desta locação (o caminho é <org>/<locação>/<uuid>.<ext>).
      if (!path || path.split("/")[1] + "/" !== prefixo)
        throw new Error("Cópia do RG indisponível.");
      const { data: blob, error: e2 } = await sb.storage.from(BUCKET).download(path);
      if (e2 || !blob) throw new Error("Cópia do RG indisponível.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // Teto de tamanho: evita estourar memória do servidor e um PDF grande demais para mandar à administradora.
      total += bytes.byteLength;
      if (total > PACOTE_MAX_BYTES)
        throw new Error(
          "Pacote grande demais (cópias de RG somam mais de 25 MB). Reenvie as cópias em tamanho menor.",
        );
      arquivos.push({ item: s(r.item), bytes, tipo: tipoArquivo(bytes) });
    }
    const { data: perfil } = await sb
      .from("profiles")
      .select("nome")
      .eq("id", context.userId)
      .maybeSingle();
    const pdf = await montarPacotePdf(
      {
        codigo: s(p.codigo) || "LOC",
        locatario: {
          nome: s(loc.nome),
          cpf: s(loc.cpf),
          nascimento: s(loc.nascimento),
          email: s(loc.email),
          telefone: s(loc.telefone),
        },
        moradores: lerMoradoresRpc({ pessoas: p.moradores }).pessoas,
        endereco: s(p.endereco),
        unidade: s(p.unidade) || null,
        entrada: s(p.entrada) || null,
        referencia: s(p.referencia),
      },
      arquivos,
      hojeSaoPaulo(),
      s((perfil as { nome?: unknown } | null)?.nome) || "usuário do ADM MAX",
    );
    const { error: e3 } = await user.rpc("locacao_pacote_registrar", { _id: data.locacaoId });
    if (e3) throw new Error(e3.message);
    return {
      nome: nomeArquivoPacote(s(p.codigo) || "LOC"),
      base64: Buffer.from(pdf).toString("base64"),
    };
  });
