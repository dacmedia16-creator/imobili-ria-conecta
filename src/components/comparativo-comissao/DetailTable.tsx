import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import type { ComparativoRowComCalculo, OrdenacaoCampo, OrdenacaoDirecao } from "@/lib/comparativo-comissao-types";
import { ordenar } from "@/lib/comparativo-comissao-filters";
import { SituacaoBadge } from "./SituacaoBadge";
import { formatMoney, formatPercent, formatDateBR } from "./format";

const MODALIDADE_LABEL: Record<string, string> = { padrao: "Venda tradicional", lancamento: "Lançamento" };

const COLUNAS: { campo: OrdenacaoCampo; label: string }[] = [
  { campo: "data", label: "Efetivação" },
  { campo: "valor_negociado", label: "Valor do imóvel" },
  { campo: "valor_comissao", label: "Comissão real" },
  { campo: "percentual_real", label: "% real" },
  { campo: "vgv_equivalente", label: "VGV equiv. 6%" },
  { campo: "diferenca", label: "Diferença" },
];

export function DetailTable({ rows }: { rows: ComparativoRowComCalculo[] }) {
  const [campo, setCampo] = useState<OrdenacaoCampo>("data");
  const [direcao, setDirecao] = useState<OrdenacaoDirecao>("desc");

  const sorted = useMemo(() => ordenar(rows, campo, direcao), [rows, campo, direcao]);

  const toggleSort = (c: OrdenacaoCampo) => {
    if (c === campo) setDirecao((d) => (d === "asc" ? "desc" : "asc"));
    else { setCampo(c); setDirecao("desc"); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Vendas ({rows.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              {COLUNAS.map((c) => (
                <TableHead key={c.campo}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort(c.campo)}
                  >
                    {c.label}
                    {campo === c.campo && (direcao === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </TableHead>
              ))}
              <TableHead>Código / imóvel</TableHead>
              <TableHead>Modalidade</TableHead>
              <TableHead>Corretor</TableHead>
              <TableHead>Equipe</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma venda encontrada no período/filtro selecionado.
                </TableCell>
              </TableRow>
            )}
            {sorted.map((r) => (
              <TableRow key={r.sale_id}>
                <TableCell className="whitespace-nowrap">{formatDateBR(r.data_fechamento)}</TableCell>
                <TableCell>{formatMoney(r.valor_negociado)}</TableCell>
                <TableCell>{formatMoney(r.valor_total_comissao)}</TableCell>
                <TableCell>{formatPercent(r.percentualReal)}</TableCell>
                <TableCell>{formatMoney(r.vgvEquivalente6)}</TableCell>
                <TableCell className={r.diferencaVgv != null && r.diferencaVgv > 0 ? "text-destructive" : ""}>
                  {formatMoney(r.diferencaVgv)}
                </TableCell>
                <TableCell className="font-medium">
                  <Link to="/vendas/$id" params={{ id: r.sale_id }} className="hover:underline">
                    {r.codigo_interno || r.imovel_id || `Venda #${r.sale_id.slice(0, 8)}`}
                  </Link>
                  {r.divergenciaCadastro && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400" title="Percentual cadastrado na venda diverge do calculado a partir dos valores">
                      <AlertTriangle className="h-3 w-3" />Divergência no cadastro
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{MODALIDADE_LABEL[r.modalidade] ?? r.modalidade}</TableCell>
                <TableCell className="text-muted-foreground">{r.corretorNome}</TableCell>
                <TableCell className="text-muted-foreground">{r.teamNome ?? "—"}</TableCell>
                <TableCell><SituacaoBadge situacao={r.situacao} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
