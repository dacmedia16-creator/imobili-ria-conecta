import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ZIONTALK_TIMEOUT_MS,
  ZIONTALK_URL,
  avisosSuprimidosNoContexto,
  normalizePhone,
  paraWhatsapp,
} from "@/lib/sale-notifications.functions";
import { docsFinaisWhatsappLigado, mensagemFinal, nomeAnexoFinal } from "@/lib/locacao-finais";

const BUCKET = "locacao-documentos";
const MAX_BYTES = 16 * 1024 * 1024;
const tipo = z.enum(["contrato_locacao", "contrato_adm", "laudo"]);

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

/** Preparação e leitura usam a identidade autenticada na RPC; Storage só é acessado pelo servidor. */
export const prepararFinalLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ locacaoId: z.string().uuid(), tipo }).parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: prep, error } = await user.rpc("locacao_final_preparar", {
      _id: data.locacaoId,
      _tipo: data.tipo,
    });
    if (error) throw new Error(error.message);
    const path = (prep as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || !path)
      throw new Error("Não foi possível preparar o documento.");
    const { data: signed, error: e2 } = await (
      await admin()
    ).storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (e2 || !signed?.token) throw new Error("Não foi possível preparar o documento.");
    return { path, token: signed.token };
  });

export const registrarFinalLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        locacaoId: z.string().uuid(),
        tipo,
        path: z.string().max(220),
        nome: z.string().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    // Rejeita caminhos de fora desta locação ANTES da leitura com service_role.
    if (!new RegExp(`^[0-9a-f-]{36}/${data.locacaoId}/finais/[0-9a-f-]{36}\\.pdf$`).test(data.path))
      throw new Error("Caminho do documento inválido.");
    // A RPC confere papel, etapa, caminho/objeto e tipo; o hash vem do arquivo, não do navegador.
    const storage = (await admin()).storage.from(BUCKET);
    const { data: blob, error: e1 } = await storage.download(data.path);
    if (e1 || !blob || blob.size < 5 || blob.size > MAX_BYTES || blob.type !== "application/pdf")
      throw new Error("Envie um PDF válido de até 16 MB.");
    const bytes = await blob.arrayBuffer();
    if (new Uint8Array(bytes).slice(0, 5).toString() !== "37,80,68,70,45")
      throw new Error("O arquivo não parece ser um PDF.");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join(
      "",
    );
    const { data: reg, error } = await user.rpc("locacao_final_registrar", {
      _id: data.locacaoId,
      _tipo: data.tipo,
      _path: data.path,
      _nome: data.nome,
      _sha256: hash,
    });
    if (error) throw new Error(error.message);
    const result = reg as { id?: unknown; repetido?: unknown } | null;
    if (typeof result?.id !== "string") throw new Error("Documento não registrado.");
    if (result.repetido === true) await storage.remove([data.path]).catch(() => undefined);
    // A chamada automática é executada ANTES da resposta ao navegador: fechar a aba após o retorno não corta o envio.
    // O PDF continua guardado se a integração falhar; a chave própria, desligada por padrão, protege o envio real.
    let envio: {
      desligado: boolean;
      enviados: number;
      falhas: number;
      semTelefone: number;
    } | null = null;
    if (result.repetido !== true) {
      try {
        envio = await enviarFinalInterno(result.id, "auto", null, user, context.userId);
      } catch {
        envio = { desligado: false, enviados: 0, falhas: 1, semTelefone: 0 };
      }
    }
    return { id: result.id, repetido: result.repetido === true, envio };
  });

export const linkFinalLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ documentoId: z.string().uuid(), baixar: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: doc, error } = await user.rpc("locacao_final_ver", { _doc: data.documentoId });
    if (error) throw new Error(error.message);
    const { path, nome } = (doc ?? {}) as { path?: unknown; nome?: unknown };
    if (typeof path !== "string" || !path) throw new Error("Documento indisponível.");
    const limpo =
      typeof nome === "string"
        ? nome
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\w .()-]/g, "_")
        : "documento.pdf";
    const { data: signed, error: e2 } = await (
      await admin()
    ).storage
      .from(BUCKET)
      .createSignedUrl(path, 300, data.baixar ? { download: limpo } : undefined);
    if (e2 || !signed?.signedUrl) throw new Error("Documento indisponível.");
    return { url: signed.signedUrl };
  });

type Reserva = {
  envio_id: string;
  destinatario: string;
  telefone: string;
  storage_path: string;
  tipo: "contrato_locacao" | "contrato_adm" | "laudo";
  codigo: string;
};

/** Trava separada dos avisos internos da locação. NUNCA habilitar sem teste controlado e autorização de Denis. */
async function enviarFinalInterno(
  documentoId: string,
  origem: "auto" | "reenvio",
  destinatario: "locatario" | "proprietario" | null,
  user: SupabaseClient,
  userId: string,
) {
  if (!docsFinaisWhatsappLigado(process.env.LOCACAO_DOCS_FINAIS_WHATSAPP))
    return { desligado: true, enviados: 0, falhas: 0, semTelefone: 0 };
  const { data: doc, error } = await user.rpc("locacao_final_ver", { _doc: documentoId });
  if (error || !doc) throw new Error("Sem acesso ao documento.");
  if (await avisosSuprimidosNoContexto(user))
    return { desligado: true, enviados: 0, falhas: 0, semTelefone: 0 };
  const key = process.env.ZIONTALK_API_KEY;
  if (!key) return { desligado: true, enviados: 0, falhas: 0, semTelefone: 0 };
  const a = await admin();
  const { data: reservados, error: e2 } = await a.rpc("locacao_final_reservar", {
    _doc: documentoId,
    _origem: origem,
    _destinatario: destinatario,
    _ator: userId,
  });
  if (e2 || !Array.isArray(reservados))
    throw new Error("Não foi possível registrar a tentativa de envio.");
  let enviados = 0,
    falhas = 0;
  for (const r of (reservados as Reserva[]).slice(0, 2)) {
    const phone = normalizePhone(r.telefone);
    if (!phone || !/^55\d{10,11}$/.test(phone)) {
      falhas++;
      await a.rpc("locacao_final_concluir", {
        _envio: r.envio_id,
        _status: "falhou",
        _erro: "telefone inválido",
      });
      continue;
    }
    let status: "enviado" | "falhou" | "incerto" = "incerto";
    let motivo: string | null = null;
    try {
      const { data: file, error: downloadError } = await a.storage
        .from(BUCKET)
        .download(r.storage_path);
      if (
        downloadError ||
        !file ||
        file.size < 5 ||
        file.size > MAX_BYTES ||
        file.type !== "application/pdf"
      )
        throw new Error("Arquivo indisponível");
      const form = new FormData();
      form.append("msg", paraWhatsapp(mensagemFinal(r.tipo)));
      form.append("mobile_phone", phone);
      // Nome genérico: não revelar dados pessoais do arquivo no texto nem no nome do anexo.
      form.append("attachments", file, nomeAnexoFinal(r.tipo));
      const response = await fetch(ZIONTALK_URL, {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
        body: form,
        signal: AbortSignal.timeout(ZIONTALK_TIMEOUT_MS),
      });
      status = response.status === 201 ? "enviado" : response.status >= 500 ? "incerto" : "falhou";
      if (status !== "enviado") motivo = `HTTP ${response.status}`;
    } catch (err) {
      // Download falhou antes do POST = falha certa; timeout/rede durante o POST = entrega incerta, sem retry automático.
      motivo =
        err instanceof Error && err.message === "Arquivo indisponível"
          ? "arquivo indisponível"
          : "rede ou timeout";
      status = motivo === "arquivo indisponível" ? "falhou" : "incerto";
    }
    const { error: concluirErro } = await a.rpc("locacao_final_concluir", {
      _envio: r.envio_id,
      _status: status,
      _erro: motivo,
    });
    if (concluirErro)
      throw new Error("Envio registrado, mas não foi possível atualizar o histórico.");
    if (status === "enviado") enviados++;
    else falhas++;
  }
  return { desligado: false, enviados, falhas, semTelefone: 0 };
}

export const enviarFinalLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        documentoId: z.string().uuid(),
        origem: z.literal("reenvio"),
        destinatario: z.enum(["locatario", "proprietario"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    enviarFinalInterno(
      data.documentoId,
      "reenvio",
      data.destinatario,
      context.supabase as unknown as SupabaseClient,
      context.userId,
    ),
  );
