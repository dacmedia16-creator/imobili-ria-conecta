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
import { formatarTotalPessoas } from "@/lib/producao-por-pessoa-calc";
import { formatMoney, formatQtd } from "./format";

type SummaryTableProps = {
  resumo: ResumoPessoa[];
  operacoesPorPessoa: Map<string, number>;
  pessoaSelecionada: string | null;
  onSelecionarPessoa: (chave: string) => void;
};

export function SummaryTable({
  resumo,
  operacoesPorPessoa,
  pessoaSelecionada,
  onSelecionarPessoa,
}: SummaryTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-1 text-base">
          <span>Resumo consolidado por pessoa</span>
          <span className="text-sm font-normal text-muted-foreground">
            ({formatarTotalPessoas(resumo.length)})
          </span>
        </CardTitle>
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
                <TableHead className="text-right">Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumo.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma produção encontrada no período/filtro selecionado.
                  </TableCell>
                </TableRow>
              )}
              {resumo.map((r, i) => (
                <TableRow
                  key={r.chave}
                  className={`${i % 2 === 1 ? "bg-muted/25 " : ""}${pessoaSelecionada === r.chave ? "bg-primary/10" : ""}`}
                >
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
                  <TableCell className="text-right">
                    <button
                      type="button"
                      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => onSelecionarPessoa(r.chave)}
                      aria-pressed={pessoaSelecionada === r.chave}
                    >
                      {pessoaSelecionada === r.chave ? "Ocultar" : "Ver"} (
                      {operacoesPorPessoa.get(r.chave) ?? 0})
                    </button>
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
