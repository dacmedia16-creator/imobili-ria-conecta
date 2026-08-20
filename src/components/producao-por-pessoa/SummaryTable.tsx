import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ResumoPessoa } from "@/lib/producao-por-pessoa-types";
import { formatMoney, formatQtd } from "./format";

export function SummaryTable({ resumo }: { resumo: ResumoPessoa[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resumo consolidado por pessoa ({resumo.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[70vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead>Equipe</TableHead>
                <TableHead className="text-right">Vendas equiv.</TableHead>
                <TableHead className="text-right">VGV gerado</TableHead>
                <TableHead className="text-right">Comissão gerada</TableHead>
                <TableHead className="text-right">Qtd. captação</TableHead>
                <TableHead className="text-right">Qtd. venda</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumo.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma produção encontrada no período/filtro selecionado.
                  </TableCell>
                </TableRow>
              )}
              {resumo.map((r, i) => (
                <TableRow key={r.chave} className={i % 2 === 1 ? "bg-muted/25" : undefined}>
                  <TableCell className="font-medium">
                    {r.pessoaNome}
                    {!r.pessoaId && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                        (sem cadastro vinculado)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.teamNome ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQtd(r.qtdVendas)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.vgv)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.comissao)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatQtd(r.qtdCaptacao)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatQtd(r.qtdVenda)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
