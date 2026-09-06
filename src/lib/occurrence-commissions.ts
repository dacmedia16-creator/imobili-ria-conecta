type OccurrenceCommissionLike = {
  papel: string;
  managed_by_sale?: boolean | null;
  sale_commission_extra_id?: string | null;
};

/**
 * Remove linhas fixas legadas quando a ocorrência já possui a versão sincronizada pela venda.
 * Comissões extras continuam visíveis porque carregam sale_commission_extra_id.
 */
export function visibleOccurrenceCommissions<T extends OccurrenceCommissionLike>(rows: T[]): T[] {
  const managedRoles = new Set(
    rows
      .filter((row) => row.managed_by_sale === true && !row.sale_commission_extra_id)
      .map((row) => row.papel),
  );

  return rows.filter(
    (row) =>
      row.managed_by_sale === true ||
      Boolean(row.sale_commission_extra_id) ||
      !managedRoles.has(row.papel),
  );
}
