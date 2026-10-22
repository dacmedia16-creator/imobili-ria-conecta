import type { AppRole } from "@/lib/auth";
import { canDeleteSale } from "@/lib/permissions";

/**
 * Exclusão de venda com os documentos do storage (t_42d1f0bb).
 *
 * Antes (bug): a tela apagava `sales` primeiro e só depois chamava `storage.remove`. A policy
 * `docs_delete` exige que a venda ainda exista, então o remove voltava lista vazia SEM erro, a tela
 * dizia "Venda excluída" e os arquivos ficavam órfãos no bucket.
 *
 * Agora (no servidor): 1) confere a permissão de excluir (mesma regra da policy
 * delete_sales_por_papel); 2) apaga os arquivos enquanto a venda ainda existe; 3) confere que a
 * quantidade removida bate com a esperada; 4) só então apaga a venda (o RLS do banco continua sendo
 * a palavra final). Se o passo 3 não bater, a venda NÃO é apagada e o usuário recebe um erro claro.
 *
 * Este arquivo é só a regra (sem Supabase), para poder ser testado com dublês.
 */

export type VendaParaExcluir = { id: string; corretor_id: string | null; status: string | null };

export type DependenciasExclusao = {
  /** Lê a venda com o cliente do usuário (RLS): null = não existe ou não é visível para ele. */
  lerVenda: (saleId: string) => Promise<VendaParaExcluir | null>;
  /** Papéis e situação do usuário, lidos no banco (has_any_role / is_active_user / is_lead_of). */
  usuarioAtivo: (userId: string) => Promise<boolean>;
  temPapel: (userId: string, papeis: AppRole[]) => Promise<boolean>;
  lideraCorretor: (userId: string, corretorId: string) => Promise<boolean>;
  /** Todos os caminhos de arquivo da venda, inclusive de documentos arquivados (deleted_at). */
  listarCaminhos: (saleId: string) => Promise<string[]>;
  /** Remove os arquivos e devolve a lista do que o Storage disse que removeu. */
  removerArquivos: (paths: string[]) => Promise<{ removidos: string[]; erro: string | null }>;
  /** Apaga a venda com o cliente do usuário; devolve quantas linhas o banco apagou. */
  apagarVenda: (saleId: string) => Promise<{ apagadas: number; erro: string | null }>;
};

export class ExclusaoVendaError extends Error {
  constructor(
    message: string,
    readonly motivo: "nao_encontrada" | "sem_permissao" | "storage" | "banco",
  ) {
    super(message);
    this.name = "ExclusaoVendaError";
  }
}

export const MSG_SEM_PERMISSAO = "Você não tem permissão para excluir esta venda.";
export const MSG_NAO_ENCONTRADA = "Venda não encontrada.";
export const msgStorage = (removidos: number, esperados: number) =>
  `Não foi possível apagar os documentos da venda (${removidos} de ${esperados} removidos). ` +
  "A venda NÃO foi excluída. Tente de novo; se continuar, avise o suporte.";
export const MSG_BANCO_APOS_STORAGE =
  "Os documentos foram apagados, mas o banco recusou a exclusão da venda. Avise o suporte.";

export async function executarExclusaoVenda(
  deps: DependenciasExclusao,
  userId: string,
  saleId: string,
): Promise<{ arquivosRemovidos: number }> {
  const venda = await deps.lerVenda(saleId);
  if (!venda) throw new ExclusaoVendaError(MSG_NAO_ENCONTRADA, "nao_encontrada");

  // Mesma regra da policy delete_sales_por_papel (usuário ativo + rascunho + criador, líder da
  // equipe do criador, admin ou super_admin). Reaproveita canDeleteSale, que já espelha a policy.
  const [ativo, adminLike, liderLike] = await Promise.all([
    deps.usuarioAtivo(userId),
    deps.temPapel(userId, ["super_admin", "admin"]),
    deps.temPapel(userId, ["gestor", "team_leader"]),
  ]);
  const lidera =
    liderLike && venda.corretor_id ? await deps.lideraCorretor(userId, venda.corretor_id) : false;
  const papeis: AppRole[] = [
    ...(adminLike ? (["admin"] as AppRole[]) : []),
    ...(liderLike ? (["gestor"] as AppRole[]) : []),
  ];
  const pode =
    ativo &&
    canDeleteSale(
      userId,
      (want) => want.some((r) => papeis.includes(r)),
      { id: venda.id, corretor_id: venda.corretor_id, status: venda.status ?? undefined },
      new Set(lidera && venda.corretor_id ? [venda.corretor_id] : []),
    );
  if (!pode) throw new ExclusaoVendaError(MSG_SEM_PERMISSAO, "sem_permissao");

  const paths = [...new Set((await deps.listarCaminhos(saleId)).filter(Boolean))];
  if (paths.length > 0) {
    const { removidos, erro } = await deps.removerArquivos(paths);
    const esperados = new Set(paths);
    const certos = new Set(removidos.filter((p) => esperados.has(p)));
    if (erro || certos.size !== paths.length) {
      console.error(
        `[excluir-venda] storage removeu ${certos.size}/${paths.length} da venda ${saleId}${erro ? `: ${erro}` : ""}`,
      );
      throw new ExclusaoVendaError(msgStorage(certos.size, paths.length), "storage");
    }
  }

  const { apagadas, erro } = await deps.apagarVenda(saleId);
  if (erro || apagadas !== 1) {
    console.error(
      `[excluir-venda] banco apagou ${apagadas} linha(s) da venda ${saleId}: ${erro ?? ""}`,
    );
    throw new ExclusaoVendaError(
      paths.length > 0 ? MSG_BANCO_APOS_STORAGE : (erro ?? MSG_SEM_PERMISSAO),
      "banco",
    );
  }
  return { arquivosRemovidos: paths.length };
}
