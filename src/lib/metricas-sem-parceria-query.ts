import { supabase } from "@/integrations/supabase/client";
import { metricasSemParceria } from "@/lib/metricas-sem-parceria";

type Row = { sale_id: string; vgv: number; comissao_bruta: number; parceria_externa: number };

export async function fetchMetricasSemParceria(): Promise<
  Map<string, ReturnType<typeof metricasSemParceria>>
> {
  const { data, error } = await supabase.rpc("metricas_venda_sem_parceria" as never);
  if (error) throw error;
  const mapa = new Map<string, ReturnType<typeof metricasSemParceria>>();
  for (const row of (data ?? []) as Row[]) {
    mapa.set(
      row.sale_id,
      metricasSemParceria({
        vgv: row.vgv,
        comissaoBruta: row.comissao_bruta,
        parceriaExterna: row.parceria_externa,
      }),
    );
  }
  return mapa;
}
