import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  parseSpecialistRegions,
  type PositioningRegion,
  type PublicSpecialist,
} from "@/lib/positioning";

// RPCs da migration 20261029150000 ainda não constam do types.ts gerado.
const db = supabase as unknown as SupabaseClient;

export type PublicAgency = {
  slug: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  especialistas: number;
};

/** Situação de uma região para a imobiliária atual (aprovação é por imobiliária). */
export type OrgRegionStatus = "ativa" | "pendente" | "recusada" | "juntada";

export type OrgRegion = PositioningRegion & {
  uf: string;
  status: OrgRegionStatus;
  motivo: string | null;
  juntada_em: number | null;
  origem_nome: string;
  da_minha: boolean;
  corretores_meus: number;
  usada_por_outras: boolean;
  pedido_por: string | null;
  created_at: string;
};

export type PlatformPendingRegion = {
  region_id: number;
  nome: string;
  cidade: string;
  uf: string;
  origem_nome: string;
  para_nome: string;
  created_at: string;
};

export type RegionCreateResult = {
  region_id: number;
  resultado: "criada" | "vinculada" | "ja_ativa";
  pendentes: number;
};

function fail(error: { message: string } | null, fallback: string): never | void {
  if (error) throw new Error(error.message || fallback);
}

// --- Página pública ------------------------------------------------------------------------------------
export async function listPublicAgencies(): Promise<PublicAgency[]> {
  const { data, error } = await db.rpc("list_public_specialist_agencies");
  fail(error, "Não foi possível carregar as imobiliárias.");
  return ((data ?? []) as PublicAgency[]).map((a) => ({ ...a, especialistas: Number(a.especialistas) }));
}

export async function listPublicOrgRegions(slug: string): Promise<PositioningRegion[]> {
  const { data, error } = await db.rpc("list_public_org_regions", { _slug: slug });
  fail(error, "Não foi possível carregar as regiões.");
  return (data ?? []) as PositioningRegion[];
}

export async function listPublicOrgSpecialists(
  slug: string,
  search: string,
  regionId: number | null,
): Promise<PublicSpecialist[]> {
  const { data, error } = await db.rpc("list_public_org_specialists", {
    _slug: slug,
    _search: search.trim() || null,
    _region_id: regionId,
  });
  fail(error, "Não foi possível carregar os especialistas.");
  return ((data ?? []) as PublicSpecialist[]).map((row) => ({
    ...row,
    regioes: parseSpecialistRegions(row.regioes),
  }));
}

// --- Corretor ------------------------------------------------------------------------------------------
export async function listMyPositioningRegions(): Promise<PositioningRegion[]> {
  const { data, error } = await db.rpc("my_positioning_regions");
  fail(error, "Não foi possível carregar as regiões.");
  return (data ?? []) as PositioningRegion[];
}

// --- Administrador da imobiliária ---------------------------------------------------------------------
export async function listOrgRegions(): Promise<OrgRegion[]> {
  const { data, error } = await db.rpc("positioning_org_regions");
  fail(error, "Não foi possível carregar as regiões da imobiliária.");
  return ((data ?? []) as OrgRegion[]).map((r) => ({
    ...r,
    corretores_meus: Number(r.corretores_meus),
  }));
}

export async function createOrgRegion(input: {
  cidade: string;
  uf: string;
  zona: string;
  nome: string;
  tipo: string;
}): Promise<RegionCreateResult> {
  const { data, error } = await db.rpc("positioning_region_create", {
    _cidade: input.cidade,
    _uf: input.uf,
    _zona: input.zona,
    _nome: input.nome,
    _tipo: input.tipo,
  });
  fail(error, "Não foi possível criar a região.");
  return data as RegionCreateResult;
}

export async function decideOrgRegion(
  regionId: number,
  decisao: "aprovar" | "recusar" | "juntar",
  motivo?: string,
  juntarEm?: number,
): Promise<OrgRegionStatus> {
  const { data, error } = await db.rpc("positioning_region_decidir", {
    _region_id: regionId,
    _decisao: decisao,
    _motivo: motivo ?? null,
    _juntar_em: juntarEm ?? null,
  });
  fail(error, "Não foi possível registrar a decisão.");
  return data as OrgRegionStatus;
}

export async function editRegion(
  regionId: number,
  input: { nome: string; zona: string; tipo: string; ativo: boolean },
): Promise<void> {
  const { error } = await db.rpc("positioning_region_editar", {
    _region_id: regionId,
    _nome: input.nome,
    _zona: input.zona,
    _tipo: input.tipo,
    _ativo: input.ativo,
  });
  fail(error, "Não foi possível alterar a região.");
}

// --- Administrador da plataforma (somente leitura) -----------------------------------------------------
export async function listPlatformPendingRegions(): Promise<PlatformPendingRegion[]> {
  const { data, error } = await db.rpc("positioning_region_platform_pending");
  fail(error, "Não foi possível carregar os pedidos.");
  return (data ?? []) as PlatformPendingRegion[];
}
