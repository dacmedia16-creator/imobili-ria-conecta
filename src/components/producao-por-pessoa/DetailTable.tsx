import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProducaoPonta } from "@/lib/producao-por-pessoa-types";
import { formatDateTimeBR, formatMoney, formatQtd } from "./format";

const TIPO_LABEL: Record<ProducaoPonta["tipo"], string> = { captacao: "Captação", venda: "Venda" };

export function DetailTable({ pontas }: { pontas: ProducaoPonta[] }) {
  const ordenadas = [...pontas].sort((a, b) => b.concluidaEm.localeCompare(a.concluidaEm));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Detalhado por operação ({ordenadas.length} pontas)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[70vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Operação</TableHead>
                <TableHead>Concluída em</TableHead>
                <TableHead>Ponta</TableHead>
                <TableHead>Pessoa</TableHead>
                <TableHead>Equipe</TableHead>
                <TableHead className="text-right">Qtd.</TableHead>
                <TableHead className="text-right">VGV</TableHead>
                <TableHead className="text-right">Comissão gerada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenadas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma operação encontrada no período/filtro selecionado.
                  </TableCell>
                </TableRow>
              )}
              {ordenadas.map((p, i) => (
                <TableRow
                  key={`${p.saleId}-${p.tipo}`}
                  className={i % 2 === 1 ? "bg-muted/25" : undefined}
                >
                  <TableCell className="font-medium">
                    <Link to="/vendas/$id" params={{ id: p.saleId }} className="hover:underline">
                      {p.codigoInterno || `Venda #${p.saleId.slice(0, 8)}`}
                    </Link>
                    <Badge
                      variant="outline"
                      className={`ml-2 align-middle text-[10px] ${p.modalidade === "lancamento" ? "border-amber-400 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                    >
                      {p.modalidade === "lancamento" ? "Lançamento" : "Padrão"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTimeBR(p.concluidaEm)}
                  </TableCell>
                  <TableCell>{TIPO_LABEL[p.tipo]}</TableCell>
                  <TableCell>
                    {p.pessoaNome}
                    {!p.pessoaId && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        (sem cadastro)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.teamNome ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQtd(p.qtd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.vgv)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(p.comissao)}
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
