import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { COMEMORA_PADRAO, mensagemErroRpcNascimento } from "@/lib/data-nascimento";

// RPCs/tabela fora do types.ts gerado: isola o cast aqui (mesmo padrão de exclusive-captures-db.ts).
const db = supabase as unknown as SupabaseClient;

/** Data (AAAA-MM-DD ou null) + "comemora aniversário?" (padrão Sim quando não há registro). */
export type InfoNascimento = { data: string | null; comemora: boolean };

/** A própria data e escolha (política da tabela: só o dono lê). data null = ainda não preenchida. */
export async function minhaInfoNascimento(userId: string): Promise<InfoNascimento> {
  const { data, error } = await db
    .from("profile_birthdates")
    .select("data_nascimento, comemora_aniversario")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const r = data as { data_nascimento: string; comemora_aniversario?: boolean | null } | null;
  return { data: r?.data_nascimento ?? null, comemora: r?.comemora_aniversario ?? COMEMORA_PADRAO };
}

/**
 * Grava (ou apaga com null) a própria data + escolha. O banco valida 1900..hoje e 16 anos.
 * Apagar a data apaga a escolha junto (a linha some).
 */
export async function salvarMinhaDataNascimento(
  data: string | null,
  comemora: boolean = COMEMORA_PADRAO,
): Promise<void> {
  const { error } = await db.rpc("profile_set_birthdate", {
    _data: data,
    _comemora: data ? comemora : null,
  });
  if (error) throw new Error(mensagemErroRpcNascimento(error));
}

/**
 * Janela "Você comemora aniversário?" depois do login (t_05a37081): true só quando o banco confirma
 * que a pessoa tem data e nunca respondeu. Qualquer erro (inclusive RPC ainda não publicada) = false:
 * nunca pergunta nem trava por falha.
 */
export async function perguntaComemoraPendente(): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("comemora_pergunta_pendente");
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Grava a resposta da janela e marca como respondida (não pergunta de novo). */
export async function responderComemora(comemora: boolean): Promise<void> {
  const { error } = await db.rpc("comemora_responder", { _comemora: comemora });
  if (error) throw new Error(MSG_ERRO_RESPOSTA_COMEMORA);
}

export const MSG_ERRO_RESPOSTA_COMEMORA =
  "Não foi possível salvar sua resposta agora. Você pode mudar depois em Meu acesso.";

/** Gestão: lê data + escolha de UM usuário (o banco recusa quem não pode gerenciar esse usuário). */
export async function infoNascimentoDoUsuario(userId: string): Promise<InfoNascimento> {
  const { data, error } = await db.rpc("profile_birthdate_info_for_user", { _user: userId });
  if (error) throw new Error(mensagemErroRpcNascimento(error));
  const r = data as {
    data_nascimento?: string | null;
    comemora_aniversario?: boolean | null;
  } | null;
  return { data: r?.data_nascimento ?? null, comemora: r?.comemora_aniversario ?? COMEMORA_PADRAO };
}

/** Gestão: grava (ou apaga com null) a data + escolha de UM usuário. */
export async function salvarDataNascimentoDoUsuario(
  userId: string,
  data: string | null,
  comemora: boolean = COMEMORA_PADRAO,
): Promise<void> {
  const { error } = await db.rpc("profile_birthdate_set_for_user", {
    _user: userId,
    _data: data,
    _comemora: data ? comemora : null,
  });
  if (error) throw new Error(mensagemErroRpcNascimento(error));
}
