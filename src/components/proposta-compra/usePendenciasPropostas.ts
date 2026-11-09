import { useEffect, useState } from "react";
import { pendenciasProposta } from "@/lib/proposta-compra-db";
import { lerPendencias, type PendenciaProposta } from "@/lib/proposta-compra-tela";

/**
 * "O que fazer hoje" do corretor (t_da0dac53): proposta vencendo em até 2 dias e parte que ainda não assinou.
 * proposta_pendencias() devolve vazio com o módulo desligado; falha = nada (não atrapalha o resto do quadro).
 */
export function usePendenciasPropostas(userId: string | null): PendenciaProposta[] {
  const [itens, setItens] = useState<PendenciaProposta[]>([]);
  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    pendenciasProposta()
      .then((r) => vivo && setItens(lerPendencias(r)))
      .catch(() => vivo && setItens([]));
    return () => {
      vivo = false;
    };
  }, [userId]);
  return itens;
}
