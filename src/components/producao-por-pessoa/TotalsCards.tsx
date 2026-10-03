import { Card, CardContent } from "@/components/ui/card";
import { InfoDot } from "@/components/dashboard/shared";
import type { TotaisProducao } from "@/lib/producao-por-pessoa-types";
import { formatMoney, formatQtd } from "./format";

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
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card1
          destaque
          label="VGV atribuído à REMAX"
          valor={formatMoney(totais.vgv)}
          info="VGV proporcional gerado pelas pessoas filtradas, sem a participação de parceiros externos."
        />
        <Card1
          destaque
          label="Comissão gerada pela REMAX"
          valor={formatMoney(totais.comissao)}
          info="Comissão própria atribuída às pessoas filtradas, depois de descontar parceria externa."
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card1
          label="Vendas equivalentes"
          valor={formatQtd(totais.qtdVendas)}
          info="Participações somadas proporcionalmente. Uma captação e uma venda podem representar partes da mesma operação."
        />
        <Card1
          label="Participações em captação"
          valor={formatQtd(totais.qtdCaptacao)}
          info="Quantidade proporcional de participações na ponta de captação."
        />
        <Card1
          label="Participações em venda"
          valor={formatQtd(totais.qtdVenda)}
          info="Quantidade proporcional de participações na ponta de venda."
        />
      </div>
    </div>
  );
}
