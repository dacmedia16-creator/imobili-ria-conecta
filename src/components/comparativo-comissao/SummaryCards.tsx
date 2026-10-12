import { Building2, Calculator, Hash, Percent, Scale, Wallet } from "lucide-react";
import { InfoDot } from "@/components/dashboard/shared";
import { KpiTile } from "@/components/visual/base";
import type { ResumoComparativo } from "@/lib/comparativo-comissao-types";
import { formatMoney, formatPercent } from "./format";

export function SummaryCards({ resumo }: { resumo: ResumoComparativo }) {
  const diferencaTone =
    resumo.diferencaTotal > 0
      ? "text-destructive"
      : resumo.diferencaTotal < 0
        ? "text-blue-700 dark:text-blue-400"
        : "";
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <KpiTile
        icon={Hash}
        tom="slate"
        label="Quantidade de vendas"
        value={String(resumo.quantidade)}
        info={<InfoDot text="Vendas efetivadas que atendem aos filtros aplicados." />}
      />
      <KpiTile
        icon={Building2}
        tom="blue"
        label="VGV atribuído à REMAX"
        value={formatMoney(resumo.vgvRealTotal)}
        info={
          <InfoDot text="VGV proporcional à parte da comissão que ficou com a REMAX, sem parceria externa." />
        }
      />
      <KpiTile
        icon={Wallet}
        tom="green"
        label="Comissão gerada pela REMAX"
        value={formatMoney(resumo.comissaoTotal)}
        info={
          <InfoDot text="Comissão própria gerada pelas vendas do período, após descontar parceria externa." />
        }
      />
      <KpiTile
        icon={Percent}
        tom="violet"
        label="Percentual médio de comissão"
        value={formatPercent(resumo.percentualMedioPonderado)}
        info={
          <InfoDot text="Percentual médio ponderado da comissão própria da REMAX sobre o VGV atribuído à empresa." />
        }
      />
      <KpiTile
        icon={Calculator}
        tom="amber"
        label="VGV equivalente a 6%"
        value={formatMoney(resumo.vgvEquivalente6Total)}
        info={
          <InfoDot text="VGV que produziria a mesma comissão caso todas as vendas tivessem comissão de 6%." />
        }
      />
      <KpiTile
        icon={Scale}
        tom="red"
        label="Diferença para o padrão de 6%"
        value={formatMoney(resumo.diferencaTotal)}
        valueClassName={diferencaTone}
        info={
          <InfoDot text="Diferença entre o VGV atribuído à REMAX e o VGV equivalente calculado com comissão de 6%." />
        }
      />
    </div>
  );
}
