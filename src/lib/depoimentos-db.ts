// Acesso ao banco dos depoimentos (migration 20261102120000, t_c7cfaf00). Tudo por RPC: as tabelas
// não têm acesso direto. Falha ao ler a situação = convite não abre (nunca atrapalha o uso).
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { storageOrganizationPath } from "@/lib/storage-org";
import {
  mensagemErroDep,
  paramsEnviar,
  type DepForm,
  type DepModeracao,
  type DepSituacao,
} from "@/lib/depoimentos";

// RPCs fora do types.ts gerado: isola o cast aqui (mesmo padrão de ficha-colaborador-db.ts).
const db = supabase as unknown as SupabaseClient;

export async function minhaSituacaoDepoimento(): Promise<DepSituacao> {
  const { data, error } = await db.rpc("depoimento_minha_situacao");
  if (error) throw new Error(error.message);
  const s = data as DepSituacao;
  if (s.pode_enviar) s.meus = s.meus ?? [];
  return s;
}

export async function responderConvite(resposta: "agora_nao" | "nao_quero"): Promise<void> {
  const { error } = await db.rpc("depoimento_responder_convite", { _resposta: resposta });
  if (error) throw new Error(mensagemErroDep(error));
}

export async function enviarDepoimento(
  form: DepForm,
  termoVersao: string,
  origem: "convite" | "link",
): Promise<{ id: string; status: string; publicavel: boolean }> {
  const { data, error } = await db.rpc("depoimento_enviar", paramsEnviar(form, termoVersao, origem));
  if (error) throw new Error(mensagemErroDep(error));
  return data as { id: string; status: string; publicavel: boolean };
}

export async function retirarDepoimento(id: string): Promise<void> {
  const { error } = await db.rpc("depoimento_retirar", { _id: id });
  if (error) throw new Error(mensagemErroDep(error));
}

/** Foto do cadastro: mesmo bucket e caminho da tela "Meu acesso". Devolve a URL pública. */
export async function enviarFotoCadastro(userId: string, foto: File): Promise<string> {
  const path = await storageOrganizationPath(`${userId}/avatar`);
  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, foto, { upsert: true, contentType: foto.type });
  if (upErr) throw new Error("Não foi possível enviar a foto. Tente de novo.");
  const url = `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?t=${Date.now()}`;
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) throw new Error("Não foi possível salvar a foto. Tente de novo.");
  return url;
}

// ---- Moderação (dono da plataforma; o banco recusa os demais) ---------------------------------
export async function listarModeracao(): Promise<DepModeracao[]> {
  const { data, error } = await db.rpc("depoimento_moderacao_listar");
  if (error) throw new Error(error.code === "42501" ? "Sem permissão." : error.message);
  return (data ?? []) as DepModeracao[];
}

export async function moderarDepoimento(
  id: string,
  acao: "aprovar" | "recusar" | "remover" | "pendente",
  motivo?: string,
): Promise<void> {
  const { error } = await db.rpc("depoimento_moderar", {
    _id: id,
    _acao: acao,
    _motivo: motivo?.trim() || null,
  });
  if (error) throw new Error(error.code === "42501" ? "Sem permissão." : error.message);
}

export async function corrigirDepoimento(
  id: string,
  campos: { mudou: string; tarefa: string; frase: string },
): Promise<void> {
  const { error } = await db.rpc("depoimento_corrigir", {
    _id: id,
    _mudou: campos.mudou.trim() || null,
    _tarefa: campos.tarefa.trim() || null,
    _frase: campos.frase.trim() || null,
  });
  if (error) throw new Error(error.code === "42501" ? "Sem permissão." : error.message);
}
