import { Card, CardContent } from "@/components/ui/card";
import { InfoDot } from "@/components/dashboard/shared";
import type { TotaisProducao } from "@/lib/producao-por-pessoa-types";
import { formatQtd } from "./format";

function Card1({
  label,
  valor,
  info,
  destaque = false,
}: {
  label: string;
  valor: string;
  info: string;
  /** VGV e comissão são os números de decisão: ganham mais peso visual que as participações. */
  destaque?: boolean;
}) {
  return (
    <Card className={`relative ${destaque ? "border-primary/40 bg-primary/5" : ""}`}>
      <InfoDot text={info} />
      <CardContent className="pt-6">
        <p className={`pr-4 text-muted-foreground ${destaque ? "text-sm font-medium" : "text-xs"}`}>
          {label}
        </p>
        <p
          className={`font-semibold tabular-nums ${destaque ? "text-2xl text-foreground" : "text-lg"}`}
        >
          {valor}
        </p>
      </CardContent>
    </Card>
  );
}

export function TotalsCards({ totais }: { totais: TotaisProducao }) {
  // VGV e comissão ficam no Desempenho (Resumo da Operação). Aqui só a contagem de pontas.
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Card1
        destaque
        label="Vendas equivalentes"
        valor={formatQtd(totais.qtdVendas)}
        info="Duas pontas (captou e vendeu) = 1 venda. Só captação ou só venda = 0,5. Parceria com outra imobiliária = 1 para a nossa ponta. Lançamento: 1 venda inteira para quem vendeu. Quem dividiu a ponta com outro corretor conta a ponta inteira; o total da empresa conta cada venda uma vez só."
      />
      <Card1
        label="Pontas de captação"
        valor={formatQtd(totais.qtdCaptacao)}
        info="Cada captação conta 0,5; se outra imobiliária vendeu, conta 1."
      />
      <Card1
        label="Pontas de venda"
        valor={formatQtd(totais.qtdVenda)}
        info="Cada venda padrão conta 0,5; se outra imobiliária captou, conta 1. Lançamento conta a venda inteira para quem vendeu."
      />
    </div>
  );
}
