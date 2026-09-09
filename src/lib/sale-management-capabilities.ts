import type { Json } from "@/integrations/supabase/types";

export interface SaleManagementCapabilities {
  canManage: boolean;
  canEdit: boolean;
  teamOwner: boolean;
  auxiliary: boolean;
}

/** Fail closed on failed/missing RPC, including deployment before the migration. */
export function saleManagementCapabilities(data: Json | null): SaleManagementCapabilities {
  const value = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  return {
    canManage: value.can_manage === true,
    canEdit: value.can_edit === true,
    teamOwner: value.team_owner === true,
    auxiliary: value.auxiliary === true,
  };
}
