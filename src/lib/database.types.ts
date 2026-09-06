import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/integrations/supabase/types";

export type ActivityLogRow = Tables<"activity_logs">;
export type BankAccountRow = Tables<"sale_bank_accounts">;
export type CommentRow = Tables<"sale_comments">;
export type CommissionExtraRow = Tables<"sale_commission_extras">;
export type DocumentRow = Tables<"sale_documents">;
export type NotificationRow = Tables<"notifications">;
export type OccurrenceCommissionRow = Tables<"occurrence_commissions">;
export type OccurrencePartnerRow = Tables<"occurrence_partners">;
export type OccurrenceRow = Tables<"occurrences">;
export type PartyRow = Tables<"sale_parties">;
export type PaymentRow = Tables<"sale_payment">;
export type ProfileRow = Tables<"profiles">;
export type SaleRow = Tables<"sales">;
export type SaleHistoryRow = Tables<"sale_status_history">;
export type TeamCoLeaderRow = Tables<"team_co_leaders">;
export type TeamMemberRow = Tables<"team_members">;
export type TeamRow = Tables<"teams">;

export type SaleInsert = TablesInsert<"sales">;
export type SaleUpdate = TablesUpdate<"sales">;
export type PaymentUpdate = TablesUpdate<"sale_payment">;
export type PartyUpdate = TablesUpdate<"sale_parties">;
export type OccurrenceUpdate = TablesUpdate<"occurrences">;
export type CommissionUpdate = TablesUpdate<"occurrence_commissions">;
export type PartnerUpdate = TablesUpdate<"occurrence_partners">;

export type DistributionResult = Extract<
  Database["public"]["Functions"]["calcular_distribuicao_venda"],
  { Args: { p_sale_id: string } }
>["Returns"];

export type { Json };
