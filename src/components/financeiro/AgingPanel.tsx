import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money, dateBR } from "@/components/vendas/shared";
import { calcularAging } from "@/lib/financeiro-dashboard-calc";
import type { AgingFaixa, ParcelaRecebimento } from "@/lib/financeiro-dashboard-types";

function FaixaCard({
  faixa,
  tone,
  onClick,
}: {
  faixa: AgingFaixa;
  tone: string;
  onClick: () => void;
}) {
  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-muted/50 ${faixa.quantidade > 0 ? "" : "opacity-60"}`}
      onClick={faixa.quantidade > 0 ? onClick : undefined}
    >
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{faixa.label}</p>
        <p className={`text-lg font-semibold ${tone}`}>{money(faixa.valor)}</p>
        <p className="text-xs text-muted-foreground">{faixa.quantidade} parcela(s)</p>
      </CardContent>
    </Card>
  );
}

export function AgingPanel({ parcelas, hoje }: { parcelas: ParcelaRecebimento[]; hoje: string }) {
  const { aVencer, vencido } = calcularAging(parcelas, hoje);
  const [aberta, setAberta] = useState<AgingFaixa | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">A vencer</h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {aVencer.map((f) => (
            <FaixaCard key={f.key} faixa={f} tone="" onClick={() => setAberta(f)} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Vencido</h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {vencido.map((f) => (
            <FaixaCard key={f.key} faixa={f} tone="text-destructive" onClick={() => setAberta(f)} />
          ))}
        </div>
      </div>

      <Dialog open={!!aberta} onOpenChange={(o) => !o && setAberta(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {aberta?.label} — {aberta?.quantidade} parcela(s), {aberta ? money(aberta.valor) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2">Imóvel</th>
                  <th className="py-1 pr-2">Corretor</th>
                  <th className="py-1 pr-2">Data prevista</th>
                  <th className="py-1 pr-2">Valor líquido</th>
                </tr>
              </thead>
              <tbody>
                {(aberta?.parcelas ?? []).map((p) => (
                  <tr key={p.key} className="border-t">
                    <td className="py-1.5 pr-2">{p.imovelLabel}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{p.corretorNome}</td>
                    <td className="py-1.5 pr-2">{dateBR(p.dataPrevista)}</td>
                    <td className="py-1.5 pr-2 font-medium">{money(p.valorLiquidoPrevisto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
