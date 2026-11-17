import { ESTEIRA_STATUSES, type SaleStatus } from "@/lib/status";

/**
 * Totais da esteira de /vendas (t_9f5f3ae2, aprovado por Denis em 17/11).
 *
 * O topo ("X vendas na esteira · R$ Y sem contrato assinado") e o chip "Todas enviadas" somam só
 * as vendas já enviadas. Rascunho ainda não foi enviado para revisão (pode ser teste ou digitação
 * errada) e fica FORA do total, mas continua no próprio chip com quantidade e valor.
 * Mesma regra do card "VGV REMAX em andamento" do Início (grupo "futura", sem rascunho).
 * Metas, VGV efetivado e ranking não usam esta função.
 */
export type ResumoEtapa = { status: SaleStatus; quantidade: number; valor: number };

export function resumoEsteira(linhas: { status: string; valor_negociado: unknown }[]): {
  enviadas: { quantidade: number; valor: number };
  rascunho: { quantidade: number; valor: number };
  porEtapa: ResumoEtapa[];
} {
  const valorDe = (v: unknown) => Number(v) || 0;
  const porEtapa = ESTEIRA_STATUSES.map((st) => {
    const doStatus = linhas.filter((s) => s.status === st);
    return {
      status: st,
      quantidade: doStatus.length,
      valor: doStatus.reduce((acc, s) => acc + valorDe(s.valor_negociado), 0),
    };
  });
  const rascunho = porEtapa.find((e) => e.status === "rascunho") ?? { quantidade: 0, valor: 0 };
  const enviadas = porEtapa
    .filter((e) => e.status !== "rascunho")
    .reduce(
      (acc, e) => ({ quantidade: acc.quantidade + e.quantidade, valor: acc.valor + e.valor }),
      {
        quantidade: 0,
        valor: 0,
      },
    );
  return {
    enviadas,
    rascunho: { quantidade: rascunho.quantidade, valor: rascunho.valor },
    // Rascunho por último: fica visível, mas separado das etapas que entram no total.
    porEtapa: [
      ...porEtapa.filter((e) => e.status !== "rascunho" && e.quantidade > 0),
      ...porEtapa.filter((e) => e.status === "rascunho" && e.quantidade > 0),
    ],
  };
}

/** Chip "Todas enviadas" lista tudo menos rascunho; os outros chips listam só a própria etapa. */
export function linhaNoChipDaEsteira(status: string, chip: string): boolean {
  return chip === "todas" ? status !== "rascunho" : status === chip;
}
