import type { AppRole } from "@/lib/auth";
import type {
  SaleRow,
  CommissionExtraRow,
  OccurrenceCommissionRow,
  OccurrencePartnerRow,
} from "@/lib/database.types";
import { getSaleRoleFlags, gestorPodeEditar, isSaleLocked } from "@/lib/sale-permissions";
import { papelDaExtra, userIdParaExtra } from "@/lib/sale-financial-calc";

// Mesmas capacidades da tela e trava de aceite. RLS continua sendo a autoridade final.
export function podeSincronizarResumo(
  roles: AppRole[],
  sale: SaleRow,
  userId: string | undefined,
  teamIds: Set<string>,
  aceitaFin: boolean,
): boolean {
  const flags = getSaleRoleFlags(roles, sale.corretor_id, userId);
  return (
    flags.isFinanceiro ||
    (gestorPodeEditar(flags.isGestor, sale.status, teamIds.has(sale.corretor_id)) &&
      !isSaleLocked(sale.status, aceitaFin))
  );
}

export function temEdicaoFinanceiraResumo(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((key) =>
    /^(corretor_|indicador_|lider_|coordenador_id$|team_leader_id$|valor_|percentual_|parceria_|previsao_recebimento)/.test(
      key,
    ),
  );
}

// Compara o contrato gerenciado de sync_occurrence_commissions, sem calcular comissão em JS.
// Os líquidos vêm EXCLUSIVAMENTE da RPC oficial; NULL é diferente de zero no contrato SQL.
export function resumoTemPendencia(
  sale: SaleRow,
  dist: { liquido_captador: number; liquido_vendedor: number },
  commissions: OccurrenceCommissionRow[],
  extras: CommissionExtraRow[],
  partners: OccurrencePartnerRow[],
): boolean {
  const sameValue = (a: number | null, b: number | null) =>
    a == null || b == null ? a === b : Number(a) === Number(b);
  const expected = [];
  for (const side of ["captador", "vendedor"] as const) {
    // Resíduo já persistido exige revisão mesmo quando a linha derivada coincide com ele.
    if (
      !sale[`indicador_${side}`] &&
      !sale[`indicador_${side}_id`] &&
      sale[`valor_comissao_indicador_${side}`] != null
    )
      return true;
    expected.push(
      {
        papel: `corretor_${side}`,
        nome: sale[`corretor_${side}`],
        bruto: sale[`valor_comissao_${side}`],
        valor: dist[`liquido_${side}`],
        user_id: sale[`corretor_${side}_id`],
      },
      {
        papel: `indicador_${side}`,
        nome: sale[`indicador_${side}`],
        bruto: sale[`valor_comissao_indicador_${side}`],
        valor: sale[`valor_comissao_indicador_${side}`],
        user_id: sale[`indicador_${side}_id`],
      },
      {
        papel: `lider_${side}`,
        nome: sale[`lider_${side}_nome`],
        bruto: sale[`valor_comissao_lider_${side}`],
        valor: sale[`valor_comissao_lider_${side}`],
        user_id: sale[`lider_${side}_id`],
      },
    );
  }
  for (const e of expected) {
    const rows = commissions.filter(
      (r) => r.managed_by_sale && !r.sale_commission_extra_id && r.papel === e.papel,
    );
    if (e.nome == null && e.bruto == null && e.user_id == null) {
      if (rows.length) return true;
    } else if (
      rows.length !== 1 ||
      rows[0].nome !== e.nome ||
      rows[0].user_id !== e.user_id ||
      !sameValue(rows[0].valor, e.valor)
    )
      return true;
  }
  for (const e of extras) {
    const rows = commissions.filter((r) => r.sale_commission_extra_id === e.id);
    const papel = papelDaExtra(e.papel);
    if (
      rows.length !== 1 ||
      !rows[0].managed_by_sale ||
      rows[0].papel !== papel ||
      rows[0].nome !== e.nome ||
      rows[0].user_id !== userIdParaExtra(papel, sale, e) ||
      !sameValue(rows[0].valor, e.valor) ||
      rows[0].lado !== e.lado ||
      rows[0].sem_cadastro_confirmado !== e.sem_cadastro_confirmado
    )
      return true;
  }
  if (
    commissions.some(
      (r) => r.sale_commission_extra_id && !extras.some((e) => e.id === r.sale_commission_extra_id),
    )
  )
    return true;
  const managedPartners = partners.filter((r) => r.from_sale);
  if (!sale.parceria_tipo) return managedPartners.length > 0;
  const row = managedPartners[0];
  return (
    managedPartners.length !== 1 ||
    row.tipo !== sale.parceria_tipo ||
    row.nome !== sale.parceria_nome ||
    row.cpf_cnpj !== sale.parceria_cpf_cnpj ||
    Number(row.percentual ?? 0) !== Number(sale.parceria_percentual ?? 0) ||
    Number(row.valor ?? 0) !== Number(sale.parceria_valor ?? 0)
  );
}
