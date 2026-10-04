import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { contarOperacoes, formatarTotalOperacoes } from "@/lib/producao-por-pessoa-calc";
import { formatDateTimeBR, formatMoney, formatQtd } from "./format";

const TIPO_LABEL: Record<ProducaoPonta["tipo"], string> = { captacao: "Captação", venda: "Venda" };

export function DetailTable({
  pontas,
  pessoaNome = null,
  onLimparPessoa,
}: {
  pontas: ProducaoPonta[];
  /** Pessoa escolhida em "Ver" no resumo; null = todas as pessoas do filtro. */
  pessoaNome?: string | null;
  onLimparPessoa?: () => void;
}) {
  const ordenadas = [...pontas].sort((a, b) => b.concluidaEm.localeCompare(a.concluidaEm));
  // O que a pessoa fez em cada venda: as duas pontas (= 1) ou só uma (= 0,5).
  const chavePessoa = (p: ProducaoPonta) => `${p.saleId}|${p.pessoaId ?? `sem:${p.pessoaNome}`}`;
  const tiposPorPessoaVenda = new Map<string, Set<ProducaoPonta["tipo"]>>();
  for (const p of pontas) {
    const k = chavePessoa(p);
    if (!tiposPorPessoaVenda.has(k)) tiposPorPessoaVenda.set(k, new Set());
    tiposPorPessoaVenda.get(k)!.add(p.tipo);
  }
  const participacao = (p: ProducaoPonta) => {
    if (p.modalidade === "lancamento") return "Venda de Lançamento";
    const tipos = tiposPorPessoaVenda.get(chavePessoa(p));
    if (tipos?.has("captacao") && tipos.has("venda")) return "Duas pontas";
    return p.tipo === "captacao" ? "Só captação" : "Só venda";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex flex-wrap items-baseline gap-x-1 text-base" aria-live="polite">
          <span>Detalhado por operação</span>
          {pessoaNome && <span>— {pessoaNome}</span>}
          <span className="text-sm font-normal text-muted-foreground">
            ({formatarTotalOperacoes(contarOperacoes(ordenadas))})
          </span>
        </CardTitle>
        {pessoaNome && onLimparPessoa && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="print:hidden"
            onClick={onLimparPessoa}
          >
            <X className="mr-1 h-4 w-4" />
            Mostrar todas as pessoas
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="max-h-[70vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Operação</TableHead>
                <TableHead>Data da venda</TableHead>
                <TableHead>Ponta</TableHead>
                <TableHead>Pessoa</TableHead>
                <TableHead>Equipe</TableHead>
                <TableHead>Participação</TableHead>
                <TableHead className="text-right">Conta como</TableHead>
                <TableHead className="text-right">VGV</TableHead>
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
                  // Venda com vários vendedores gera várias pontas "venda": a chave precisa da
                  // pessoa, senão o React reaproveita linhas erradas e deixa linha fantasma.
                  key={`${p.saleId}-${p.tipo}-${p.pessoaId ?? `sem-vinculo:${p.pessoaNome}`}-${i}`}
                  className={i % 2 === 1 ? "bg-muted/25" : undefined}
                >
                  <TableCell className="font-medium">
                    <Link to="/vendas/$id" params={{ id: p.saleId }} className="hover:underline">
                      {p.imovelId || p.codigoInterno || `Venda #${p.saleId.slice(0, 8)}`}
                    </Link>
                    <Badge
                      variant="outline"
                      className={`ml-2 align-middle text-xs ${p.modalidade === "lancamento" ? "border-amber-400 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
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
                      <span className="ml-1.5 text-xs text-muted-foreground">(sem cadastro)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.teamNome ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {participacao(p)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQtd(p.qtd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.vgv)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
