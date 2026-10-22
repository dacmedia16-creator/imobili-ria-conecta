import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErroRpcNascimento } from "@/lib/data-nascimento";

// RPCs/tabela fora do types.ts gerado: isola o cast aqui (mesmo padrão de exclusive-captures-db.ts).
const db = supabase as unknown as SupabaseClient;

/** A própria data (política da tabela: só o dono lê). null = ainda não preenchida. */
export async function minhaDataNascimento(userId: string): Promise<string | null> {
  const { data, error } = await db
    .from("profile_birthdates")
    .select("data_nascimento")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { data_nascimento: string } | null)?.data_nascimento ?? null;
}

/** Grava (ou apaga com null) a própria data. O banco valida 1900..hoje e 16 anos. */
export async function salvarMinhaDataNascimento(data: string | null): Promise<void> {
  const { error } = await db.rpc("profile_set_birthdate", { _data: data });
  if (error) throw new Error(mensagemErroRpcNascimento(error));
}

/** Gestão: lê a data de UM usuário (o banco recusa quem não pode gerenciar esse usuário). */
export async function dataNascimentoDoUsuario(userId: string): Promise<string | null> {
  const { data, error } = await db.rpc("profile_birthdate_get_for_user", { _user: userId });
  if (error) throw new Error(mensagemErroRpcNascimento(error));
  return (data as string | null) ?? null;
}

/** Gestão: grava (ou apaga com null) a data de UM usuário. */
export async function salvarDataNascimentoDoUsuario(
  userId: string,
  data: string | null,
): Promise<void> {
  const { error } = await db.rpc("profile_birthdate_set_for_user", { _user: userId, _data: data });
  if (error) throw new Error(mensagemErroRpcNascimento(error));
}
