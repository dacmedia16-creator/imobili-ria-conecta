import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money } from "@/components/vendas/shared";
import type { ResumoComissoesPeriodo as Resumo } from "@/lib/financeiro-dashboard-types";

/** Resumo único do período (aba Comissões Calculadas): mesma coleção filtrada da tabela abaixo.
 * "Recebida" é sempre "recebida pela imobiliária" — o sistema não registra pagamento ao corretor. */
export function ResumoComissoesPeriodo({
  resumo,
  parceriaExterna,
  periodoLabel,
  onExportar,
}: {
  resumo: Resumo;
  /** null = valor não comparável com o filtro atual (ex.: filtro por papel). */
  parceriaExterna: number | null;
  periodoLabel: string;
  onExportar: () => void;
}) {
  const { total, porEquipe } = resumo;
  const cards = [
    { label: "Transações (vendas)", valor: String(total.transacoes), hint: "vendas, não linhas" },
    { label: "Comissão calculada", valor: money(total.calculada), hint: "competência" },
    {
      label: "Recebida pela imobiliária",
      valor: money(total.recebida),
      hint: "até hoje, proporcional às parcelas",
    },
    { label: "Pendente", valor: money(total.pendente), hint: "calculada − recebida" },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Resumo do período</CardTitle>
          <p className="text-xs text-muted-foreground">{periodoLabel}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onExportar} disabled={porEquipe.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Exportar resumo
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-lg font-semibold tabular-nums">{c.valor}</p>
              <p className="text-[11px] text-muted-foreground">{c.hint}</p>
            </div>
          ))}
        </div>

        {/* Celular: uma equipe por cartão, sem rolagem lateral. */}
        <div className="space-y-2 md:hidden print:hidden">
          {porEquipe.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma venda com comissão calculada no filtro atual.
            </p>
          )}
          {[...porEquipe, ...(porEquipe.length > 0 ? [total] : [])].map((l) => (
            <div
              key={l.chave}
              className={`rounded-lg border p-3 ${l.chave === "total" ? "bg-muted/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium">{l.label}</p>
                <p className="shrink-0 text-xs text-muted-foreground">{l.transacoes} venda(s)</p>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Calculada</dt>
                  <dd className="font-semibold tabular-nums">{money(l.calculada)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Recebida (imob.)</dt>
                  <dd className="font-semibold tabular-nums">{money(l.recebida)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pendente</dt>
                  <dd className="font-semibold tabular-nums">{money(l.pendente)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block print:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipe</TableHead>
                <TableHead className="text-right">Transações</TableHead>
                <TableHead className="text-right">Calculada</TableHead>
                <TableHead className="text-right">Recebida pela imobiliária</TableHead>
                <TableHead className="text-right">Pendente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porEquipe.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    Nenhuma venda com comissão calculada no filtro atual.
                  </TableCell>
                </TableRow>
              )}
              {porEquipe.map((l) => (
                <TableRow key={l.chave}>
                  <TableCell className="font-medium">{l.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.transacoes}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.calculada)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.recebida)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.pendente)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {porEquipe.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total geral</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {total.transacoes}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {money(total.calculada)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {money(total.recebida)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {money(total.pendente)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>

        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            <strong>Recebida pela imobiliária</strong>: parte da comissão cujas parcelas da venda já
            entraram na imobiliária até hoje (mesmo que depois do fim do período). Não indica
            pagamento ao corretor (o sistema ainda não registra esse pagamento).
          </li>
          <li>
            <strong>Parceiro externo fica fora destes totais</strong> (regra atual)
            {parceriaExterna != null && parceriaExterna > 0 ? (
              <>: {money(parceriaExterna)} de parceria externa nas vendas do período, à parte.</>
            ) : (
              "."
            )}
          </li>
          <li>Cada venda conta na equipe do corretor principal da venda.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
