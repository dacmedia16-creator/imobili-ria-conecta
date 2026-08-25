import { Card, CardContent } from "@/components/ui/card";
import { InfoDot } from "@/components/dashboard/shared";
import type { TotaisProducao } from "@/lib/producao-por-pessoa-types";
import { formatMoney, formatQtd } from "./format";

function Card1({ label, valor, info }: { label: string; valor: string; info: string }) {
  return (
    <Card className="relative">
      <InfoDot text={info} />
      <CardContent className="pt-6">
        <p className="pr-4 text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{valor}</p>
      </CardContent>
    </Card>
  );
}

export function TotalsCards({ totais }: { totais: TotaisProducao }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Card1 label="Vendas equivalentes" valor={formatQtd(totais.qtdVendas)} info="Participações somadas proporcionalmente. Uma captação e uma venda podem representar partes da mesma operação." />
      <Card1 label="VGV atribuído à REMAX" valor={formatMoney(totais.vgv)} info="VGV proporcional gerado pelas pessoas filtradas, sem a participação de parceiros externos." />
      <Card1 label="Comissão gerada pela REMAX" valor={formatMoney(totais.comissao)} info="Comissão própria atribuída às pessoas filtradas, depois de descontar parceria externa." />
      <Card1 label="Participações em captação" valor={formatQtd(totais.qtdCaptacao)} info="Quantidade proporcional de participações na ponta de captação." />
      <Card1 label="Participações em venda" valor={formatQtd(totais.qtdVenda)} info="Quantidade proporcional de participações na ponta de venda." />
    </div>
  );
}
