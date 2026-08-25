import { Card, CardContent } from "@/components/ui/card";
import { InfoDot } from "@/components/dashboard/shared";
import type { ResumoComparativo } from "@/lib/comparativo-comissao-types";
import { formatMoney, formatPercent } from "./format";

function Card1({ label, valor, tone, info }: { label: string; valor: string; tone?: string; info: string }) {
  return (
    <Card className="relative">
      <InfoDot text={info} />
      <CardContent className="pt-6">
        <p className="pr-4 text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold ${tone ?? ""}`}>{valor}</p>
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ resumo }: { resumo: ResumoComparativo }) {
  const diferencaTone = resumo.diferencaTotal > 0 ? "text-destructive" : resumo.diferencaTotal < 0 ? "text-blue-700 dark:text-blue-400" : "";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Card1 label="Quantidade de vendas" valor={String(resumo.quantidade)} info="Vendas efetivadas que atendem aos filtros aplicados." />
      <Card1 label="VGV atribuído à REMAX" valor={formatMoney(resumo.vgvRealTotal)} info="VGV proporcional à parte da comissão que ficou com a REMAX, sem parceria externa." />
      <Card1 label="Comissão gerada pela REMAX" valor={formatMoney(resumo.comissaoTotal)} info="Comissão própria gerada pelas vendas do período, após descontar parceria externa." />
      <Card1 label="Percentual médio de comissão" valor={formatPercent(resumo.percentualMedioPonderado)} info="Percentual médio ponderado da comissão própria da REMAX sobre o VGV atribuído à empresa." />
      <Card1 label="VGV equivalente a 6%" valor={formatMoney(resumo.vgvEquivalente6Total)} info="VGV que produziria a mesma comissão caso todas as vendas tivessem comissão de 6%." />
      <Card1 label="Diferença para o padrão de 6%" valor={formatMoney(resumo.diferencaTotal)} tone={diferencaTone} info="Diferença entre o VGV atribuído à REMAX e o VGV equivalente calculado com comissão de 6%." />
    </div>
  );
}
