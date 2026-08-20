import { Card, CardContent } from "@/components/ui/card";
import type { TotaisProducao } from "@/lib/producao-por-pessoa-types";
import { formatMoney, formatQtd } from "./format";

function Card1({ label, valor }: { label: string; valor: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{valor}</p>
      </CardContent>
    </Card>
  );
}

export function TotalsCards({ totais }: { totais: TotaisProducao }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Card1 label="Vendas equivalentes" valor={formatQtd(totais.qtdVendas)} />
      <Card1 label="VGV gerado" valor={formatMoney(totais.vgv)} />
      <Card1 label="Comissão gerada" valor={formatMoney(totais.comissao)} />
      <Card1 label="Qtd. na ponta captação" valor={formatQtd(totais.qtdCaptacao)} />
      <Card1 label="Qtd. na ponta venda" valor={formatQtd(totais.qtdVenda)} />
    </div>
  );
}
