import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  mensagemErroFicha,
  paramsSalvarFicha,
  type Colaborador,
  type FichaForm,
  type SituacaoFicha,
} from "@/lib/ficha-colaborador";

// RPCs fora do types.ts gerado: isola o cast aqui (mesmo padrão de data-nascimento-db.ts).
const db = supabase as unknown as SupabaseClient;

/** Situação da própria ficha. O banco decide se bloqueia (relógio do servidor). */
export async function minhaSituacaoFicha(): Promise<SituacaoFicha> {
  const { data, error } = await db.rpc("ficha_minha_situacao");
  if (error) throw new Error(error.message);
  return data as SituacaoFicha;
}

export async function salvarMinhaFicha(form: FichaForm): Promise<SituacaoFicha> {
  const { data, error } = await db.rpc("ficha_salvar_minha", paramsSalvarFicha(form));
  if (error) throw new Error(mensagemErroFicha(error));
  return data as SituacaoFicha;
}

export async function podeVerFichasColaboradores(): Promise<boolean> {
  const { data, error } = await db.rpc("ficha_pode_ver_colaboradores");
  return !error && data === true;
}

export async function listarFichasColaboradores(): Promise<{
  obrigatoria_a_partir_de: string;
  colaboradores: Colaborador[];
}> {
  const { data, error } = await db.rpc("ficha_colaboradores_listar");
  if (error) throw new Error(error.code === "42501" ? "Sem permissão." : error.message);
  const d = data as { obrigatoria_a_partir_de: string; colaboradores: Colaborador[] | null };
  return {
    obrigatoria_a_partir_de: d.obrigatoria_a_partir_de,
    colaboradores: (d.colaboradores ?? []).map((c) => ({
      ...c,
      papeis: c.papeis ?? [],
      equipes: c.equipes ?? [],
    })),
  };
}

/** Registra quem exportou (formato e total; sem dados pessoais). */
export async function registrarExportacaoFichas(formato: "excel" | "pdf", total: number) {
  const { error } = await db.rpc("ficha_colaboradores_registrar_exportacao", {
    _formato: formato,
    _total: total,
  });
  if (error) throw new Error("Não foi possível registrar a exportação.");
}

export async function salvarPrazoFicha(iso: string): Promise<string> {
  const { data, error } = await db.rpc("ficha_config_salvar", { _obrigatoria_a_partir_de: iso });
  if (error) throw new Error(error.code === "22023" ? "Data inválida." : "Sem permissão.");
  return data as string;
}
