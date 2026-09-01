import type { SaleStatus } from "@/lib/status";

/**
 * Baixar e imprimir seguem a mesma autorização de leitura da venda. O status não reduz esse
 * acesso: participantes continuam consultando os documentos depois da conclusão, sempre em modo
 * somente leitura. A autorização real de leitura continua protegida pelas policies do banco e do
 * bucket privado.
 */
export function podeBaixarDocumentosVenda({
  podeVisualizar,
}: {
  podeVisualizar: boolean;
  status: SaleStatus;
}): boolean {
  return podeVisualizar;
}
