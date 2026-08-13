import { Card, CardContent } from "@/components/ui/card";
import type { ResumoComparativo } from "@/lib/comparativo-comissao-types";
import { formatMoney, formatPercent } from "./format";

function Card1({ label, valor, tone }: { label: string; valor: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold ${tone ?? ""}`}>{valor}</p>
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ resumo }: { resumo: ResumoComparativo }) {
  const diferencaTone = resumo.diferencaTotal > 0 ? "text-destructive" : resumo.diferencaTotal < 0 ? "text-blue-700 dark:text-blue-400" : "";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Card1 label="Quantidade de vendas" valor={String(resumo.quantidade)} />
      <Card1 label="VGV real total" valor={formatMoney(resumo.vgvRealTotal)} />
      <Card1 label="Comissão total" valor={formatMoney(resumo.comissaoTotal)} />
      <Card1 label="Percentual médio ponderado" valor={formatPercent(resumo.percentualMedioPonderado)} />
      <Card1 label="VGV equivalente a 6%" valor={formatMoney(resumo.vgvEquivalente6Total)} />
      <Card1 label="Diferença (real − equivalente 6%)" valor={formatMoney(resumo.diferencaTotal)} tone={diferencaTone} />
    </div>
  );
}
