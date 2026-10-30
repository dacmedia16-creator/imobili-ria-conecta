/**
 * Remoção de documento da captação e limpeza do arquivo antigo ao substituir (t_5ab6dad4).
 *
 * A permissão é sempre do banco: `exclusive_remove_document` (JWT do usuário) decide quem remove e
 * devolve o caminho do arquivo. O Storage não aceita DELETE por SQL e o bucket não tem policy de
 * DELETE, então o arquivo sai aqui com service_role, e só se:
 *  1. o caminho for `<org do usuário>/<captação>/<uuid>.<ext>` (o mesmo formato que o registro aceita;
 *     provas do plano em `/plano/` ficam de fora);
 *  2. nenhuma linha de exclusive_documents ainda apontar para ele.
 * Este arquivo é só a regra (sem Supabase), para ser testado com dublês.
 */

export type DependenciasArquivo = {
  /** Organização atual do usuário (current_org_id com o JWT dele). */
  orgDoUsuario: () => Promise<string | null>;
  /** true se alguma linha de exclusive_documents usa o caminho (lido com service_role). */
  caminhoEmUso: (path: string) => Promise<boolean>;
  /** Apaga o objeto do bucket exclusive-captures (service_role). */
  apagarArquivo: (path: string) => Promise<{ erro: string | null }>;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Caminho de documento da própria captação, no formato aceito por exclusive_register_document. */
export function caminhoDaCaptacao(path: string, org: string, captureId: string): boolean {
  if (!new RegExp(`^${UUID}$`).test(org) || !new RegExp(`^${UUID}$`).test(captureId)) return false;
  return new RegExp(`^${org}/${captureId}/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$`).test(path);
}

export type ResultadoLimpeza = "apagado" | "ignorado";

/**
 * Apaga o arquivo se ele for da captação e estiver sem uso. Nunca lança por causa do Storage:
 * a linha do documento já saiu; um arquivo que sobrar não aparece em lugar nenhum.
 */
export async function apagarArquivoSemUso(
  deps: DependenciasArquivo,
  captureId: string,
  path: string,
): Promise<ResultadoLimpeza> {
  const org = await deps.orgDoUsuario();
  if (!org || !caminhoDaCaptacao(path, org, captureId)) return "ignorado";
  if (await deps.caminhoEmUso(path)) return "ignorado";
  const { erro } = await deps.apagarArquivo(path);
  return erro ? "ignorado" : "apagado";
}
