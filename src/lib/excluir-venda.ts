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
 * delete_sales_por_papel); 2) confere que TODOS os caminhos são da própria venda
 * (`<org_da_venda>/<sale_id>/…` ou o legado `<sale_id>/…`); se um só não for, recusa tudo
 * (t_33a6990f: storage_path é gravável pelo usuário e o remove roda com service_role);
 * 3) apaga os arquivos enquanto a venda ainda existe; 4) confere o RESULTADO FINAL: nenhum dos
 * caminhos pode continuar no bucket (não compara contagem, então o "tente de novo" depois de
 * remoção parcial ou de recusa do banco funciona); 5) só então apaga a venda (o RLS do banco
 * continua sendo a palavra final). Se 2 ou 4 falhar, a venda NÃO é apagada e o usuário recebe
 * um erro claro.
 *
 * Este arquivo é só a regra (sem Supabase), para poder ser testado com dublês.
 */

export type VendaParaExcluir = {
  id: string;
  corretor_id: string | null;
  status: string | null;
  organization_id: string | null;
};

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
  /** Dos caminhos informados, devolve os que AINDA existem no bucket (lança se não conseguir conferir). */
  arquivosRestantes: (paths: string[]) => Promise<string[]>;
  /** Apaga a venda com o cliente do usuário; devolve quantas linhas o banco apagou. */
  apagarVenda: (saleId: string) => Promise<{ apagadas: number; erro: string | null }>;
};

export class ExclusaoVendaError extends Error {
  constructor(
    message: string,
    readonly motivo: "nao_encontrada" | "sem_permissao" | "caminho_invalido" | "storage" | "banco",
  ) {
    super(message);
    this.name = "ExclusaoVendaError";
  }
}

export const MSG_SEM_PERMISSAO = "Você não tem permissão para excluir esta venda.";
export const MSG_NAO_ENCONTRADA = "Venda não encontrada.";
export const msgStorage = (restantes: number, total: number) =>
  `Não foi possível apagar os documentos da venda (${restantes} de ${total} ainda no armazenamento). ` +
  "A venda NÃO foi excluída. Tente de novo; se continuar, avise o suporte.";
export const MSG_CAMINHO_INVALIDO =
  "Esta venda tem documento com caminho de arquivo fora da própria venda. " +
  "Por segurança, nada foi apagado e a venda NÃO foi excluída. Avise o suporte.";

/**
 * Caminho aceito: `<org_da_venda>/<sale_id>/…` ou o legado `<sale_id>/…`, com pelo menos um nível
 * depois do sale_id e sem segmento vazio, `.`, `..`, barra invertida ou caractere de controle.
 */
export function caminhoDaVenda(path: string, saleId: string, orgId: string | null): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c /* \ */) return false;
  }
  const seg = path.split("/");
  if (seg.some((s) => s === "" || s === "." || s === "..")) return false;
  // Comparação exata: nomes no Storage diferenciam maiúsculas e o banco devolve UUID minúsculo.
  if (orgId && seg.length >= 3 && seg[0] === orgId && seg[1] === saleId) return true;
  return seg.length >= 2 && seg[0] === saleId;
}
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
  // Falha fechada: um único caminho fora da própria venda/imobiliária barra a exclusão inteira,
  // antes de qualquer remove com service_role.
  const invalidos = paths.filter((p) => !caminhoDaVenda(p, venda.id, venda.organization_id));
  if (invalidos.length > 0) {
    console.error(
      `[excluir-venda] ${invalidos.length} caminho(s) fora da venda ${saleId}; exclusão recusada`,
    );
    throw new ExclusaoVendaError(MSG_CAMINHO_INVALIDO, "caminho_invalido");
  }
  if (paths.length > 0) {
    const { erro } = await deps.removerArquivos(paths);
    // Confere o resultado final, não a contagem do remove: arquivo já apagado numa tentativa
    // anterior não volta na lista de removidos, mas também não está mais no bucket.
    let restantes: string[];
    try {
      restantes = await deps.arquivosRestantes(paths);
    } catch (e) {
      console.error(
        `[excluir-venda] não foi possível conferir o bucket da venda ${saleId}: ${e instanceof Error ? e.message : e}`,
      );
      restantes = paths;
    }
    if (restantes.length > 0) {
      console.error(
        `[excluir-venda] ${restantes.length}/${paths.length} arquivo(s) ainda no bucket da venda ${saleId}${erro ? `: ${erro}` : ""}`,
      );
      throw new ExclusaoVendaError(msgStorage(restantes.length, paths.length), "storage");
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

export const PAGINA_LIST = 1000;

/**
 * Dos caminhos, devolve os que ainda estão no bucket, listando cada pasta. Só uma listagem bem
 * sucedida prova que o arquivo sumiu: erro na listagem lança (a venda é mantida). Para de paginar
 * só com página vazia (não confia que o servidor respeite o limit). Itens de pasta são ignorados.
 */
export async function conferirRestantes(
  paths: string[],
  listar: (pasta: string, offset: number) => Promise<Array<{ name: string; pasta: boolean }>>,
): Promise<string[]> {
  const porPasta = new Map<string, Set<string>>();
  for (const p of paths) {
    const i = p.lastIndexOf("/");
    const pasta = p.slice(0, i);
    if (!porPasta.has(pasta)) porPasta.set(pasta, new Set());
    porPasta.get(pasta)!.add(p.slice(i + 1));
  }
  const restam: string[] = [];
  for (const [pasta, nomes] of porPasta) {
    const vistos = new Set<string>();
    for (let offset = 0; offset < 100 * PAGINA_LIST;) {
      const itens = await listar(pasta, offset);
      if (itens.length === 0) break;
      for (const it of itens) if (!it.pasta && nomes.has(it.name)) vistos.add(it.name);
      offset += itens.length;
      // shortcut: até 100 mil itens por pasta; acima disso considera tudo como restante.
      if (offset >= 100 * PAGINA_LIST) throw new Error("Pasta grande demais para conferir");
    }
    for (const n of vistos) restam.push(`${pasta}/${n}`);
  }
  return restam;
}
