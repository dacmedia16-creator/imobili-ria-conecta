/** Erro de RPC inexistente (banco sem a migration): o recurso simplesmente não está ativo. */
export function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function/i.test(error.message ?? "")
  );
}
