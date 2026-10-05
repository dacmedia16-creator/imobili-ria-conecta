import type { BankAccountRow, SaleRow } from "@/lib/database.types";

export type BankMode = "unica" | "por_vendedor";
export type BankFields = Pick<BankAccountRow, "titular" | "banco" | "agencia" | "conta" | "pix">;

// NULL na venda significa legado: deduzir sem alterar ou eliminar nenhuma linha antiga.
export function bankMode(
  flag: SaleRow["contas_vendedores_individuais"],
  banks: Record<string, BankAccountRow>,
): BankMode {
  if (flag !== null) return flag ? "por_vendedor" : "unica";
  const unique = new Set(
    Object.entries(banks)
      .filter(([papel]) => /^vendedor_\d+$/.test(papel))
      .map(([, b]) => [b.banco, b.agencia, b.conta, b.pix].map((v) => (v ?? "").trim()).join("\u0000"))
      .filter((s) => s.replaceAll("\u0000", "").length > 0),
  );
  return unique.size > 1 ? "por_vendedor" : "unica";
}

export function sharedBank(banks: Record<string, BankAccountRow>): BankAccountRow | null {
  if (banks.recebimento) return banks.recebimento;
  return (
    Object.entries(banks)
      .filter(([papel]) => /^vendedor_\d+$/.test(papel))
      .sort(([a], [b]) => Number(a.split("_")[1]) - Number(b.split("_")[1]))
      .map(([, b]) => b)
      .find((b) => [b.banco, b.agencia, b.conta, b.pix].some((v) => !!v?.trim())) ?? null
  );
}
