import { Link } from "@tanstack/react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, dateBR } from "@/components/vendas/shared";
import { SITUACAO_PARCELA_LABEL } from "@/lib/financeiro-dashboard-types";
import type { ParcelaRecebimento, SituacaoParcela } from "@/lib/financeiro-dashboard-types";

const SITUACAO_TONE: Record<SituacaoParcela, string> = {
  recebido: "text-emerald-700 dark:text-emerald-400",
  recebido_parcial: "text-amber-700 dark:text-amber-400",
  recebido_diferenca: "text-amber-700 dark:text-amber-400",
  a_vencer: "text-muted-foreground",
  vencido: "text-destructive",
  sem_previsao: "text-muted-foreground",
  cancelado_arquivado: "text-muted-foreground",
};

/** Somente leitura — marcar/desfazer recebimento continua em Relatórios (Fluxo de caixa), que já
 * tem essa ação operacional (ver PROMPT, item 8). */
export function RecebimentosTable({ parcelas }: { parcelas: ParcelaRecebimento[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Imóvel</TableHead>
          <TableHead>Corretor</TableHead>
          <TableHead>Equipe</TableHead>
          <TableHead>Parcela</TableHead>
          <TableHead>Data prevista</TableHead>
          <TableHead>Forma</TableHead>
          <TableHead>Bruto</TableHead>
          <TableHead>Parceria</TableHead>
          <TableHead>Líquido previsto</TableHead>
          <TableHead>Recebido em</TableHead>
          <TableHead>Valor recebido</TableHead>
          <TableHead>Diferença</TableHead>
          <TableHead>Situação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {parcelas.length === 0 && (
          <TableRow>
            <TableCell colSpan={13} className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma parcela no filtro atual.
            </TableCell>
          </TableRow>
        )}
        {parcelas.map((p) => (
          <TableRow key={p.key}>
            <TableCell className="font-medium">
              <Link to="/vendas/$id" params={{ id: p.saleId }} className="hover:underline">
                {p.imovelLabel}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">{p.corretorNome}</TableCell>
            <TableCell className="text-muted-foreground">{p.teamNome ?? "—"}</TableCell>
            <TableCell>{p.parcela}ª</TableCell>
            <TableCell>{dateBR(p.dataPrevista)}</TableCell>
            <TableCell className="text-muted-foreground">{p.formaPrevista ?? "—"}</TableCell>
            <TableCell>{money(p.valorBrutoPrevisto)}</TableCell>
            <TableCell className="text-muted-foreground">
              {p.valorParceria > 0 ? money(p.valorParceria) : "—"}
            </TableCell>
            <TableCell className="font-medium">{money(p.valorLiquidoPrevisto)}</TableCell>
            <TableCell className="text-muted-foreground">
              {p.dataRecebimento ? dateBR(p.dataRecebimento) : "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {p.valorRecebido != null ? money(p.valorRecebido) : "—"}
            </TableCell>
            <TableCell
              className={
                p.diferenca != null && Math.abs(p.diferenca) > 0.01
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground"
              }
            >
              {p.diferenca != null ? money(p.diferenca) : "—"}
            </TableCell>
            <TableCell className={SITUACAO_TONE[p.situacao]}>
              {SITUACAO_PARCELA_LABEL[p.situacao]}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
