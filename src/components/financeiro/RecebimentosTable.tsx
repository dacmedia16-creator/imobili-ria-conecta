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
import { CardField, EmptyState, Pill, type Tom } from "@/components/visual/base";
import { SITUACAO_PARCELA_LABEL } from "@/lib/financeiro-dashboard-types";
import type { ParcelaRecebimento, SituacaoParcela } from "@/lib/financeiro-dashboard-types";

const SITUACAO_TOM: Record<SituacaoParcela, Tom> = {
  recebido: "green",
  recebido_parcial: "amber",
  recebido_diferenca: "amber",
  a_vencer: "blue",
  vencido: "red",
  sem_previsao: "slate",
  cancelado_arquivado: "slate",
};

function Situacao({ situacao }: { situacao: SituacaoParcela }) {
  return <Pill tom={SITUACAO_TOM[situacao]}>{SITUACAO_PARCELA_LABEL[situacao]}</Pill>;
}

const temDiferenca = (p: ParcelaRecebimento) => p.diferenca != null && Math.abs(p.diferenca) > 0.01;

/** Somente leitura — marcar/desfazer recebimento continua em Relatórios (Fluxo de caixa), que já
 * tem essa ação operacional (ver PROMPT, item 8). */
export function RecebimentosTable({ parcelas }: { parcelas: ParcelaRecebimento[] }) {
  return (
    <>
      <div className="hidden md:block print:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imóvel</TableHead>
              <TableHead>Ocorrência</TableHead>
              <TableHead>Partes</TableHead>
              <TableHead>Corretor</TableHead>
              <TableHead>Equipe</TableHead>
              <TableHead>Parcela</TableHead>
              <TableHead>Data prevista</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead className="text-right">Bruto</TableHead>
              <TableHead className="text-right">Parceria</TableHead>
              <TableHead className="text-right">Líquido previsto</TableHead>
              <TableHead>Recebido em</TableHead>
              <TableHead className="text-right">Valor recebido</TableHead>
              <TableHead className="text-right">Diferença</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parcelas.length === 0 && (
              <TableRow>
                <TableCell colSpan={15} className="py-8 text-center text-sm text-muted-foreground">
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
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {p.ocorrenciaCodigo ?? p.occId.slice(0, 8)}
                </TableCell>
                <TableCell className="max-w-56 text-muted-foreground">
                  {p.partes?.length ? p.partes.join(" · ") : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">{p.corretorNome}</TableCell>
                <TableCell className="text-muted-foreground">{p.teamNome ?? "—"}</TableCell>
                <TableCell>{p.parcela}ª</TableCell>
                <TableCell>{dateBR(p.dataPrevista)}</TableCell>
                <TableCell className="text-muted-foreground">{p.formaPrevista ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{money(p.valorBrutoPrevisto)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {p.valorParceria > 0 ? money(p.valorParceria) : "—"}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {money(p.valorLiquidoPrevisto)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {p.dataRecebimento ? dateBR(p.dataRecebimento) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {p.valorRecebido != null ? money(p.valorRecebido) : "—"}
                </TableCell>
                <TableCell
                  className={
                    temDiferenca(p)
                      ? "text-right tabular-nums text-amber-700 dark:text-amber-400"
                      : "text-right tabular-nums text-muted-foreground"
                  }
                >
                  {p.diferenca != null ? money(p.diferenca) : "—"}
                </TableCell>
                <TableCell>
                  <Situacao situacao={p.situacao} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Celular: mesmas parcelas e valores em cartões, sem rolagem lateral. */}
      <div className="space-y-3 md:hidden print:hidden">
        {parcelas.length === 0 && <EmptyState>Nenhuma parcela no filtro atual.</EmptyState>}
        {parcelas.map((p) => (
          <div key={p.key} className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  to="/vendas/$id"
                  params={{ id: p.saleId }}
                  className="break-words font-medium hover:underline"
                >
                  {p.imovelLabel}
                </Link>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {p.ocorrenciaCodigo ?? p.occId.slice(0, 8)} · {p.parcela}ª parcela
                </p>
              </div>
              <Situacao situacao={p.situacao} />
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              <CardField label="Líquido previsto">
                <span className="font-semibold">{money(p.valorLiquidoPrevisto)}</span>
              </CardField>
              <CardField label="Data prevista">{dateBR(p.dataPrevista)}</CardField>
              <CardField label="Bruto">{money(p.valorBrutoPrevisto)}</CardField>
              <CardField label="Parceria">
                {p.valorParceria > 0 ? money(p.valorParceria) : "—"}
              </CardField>
              <CardField label="Recebido em">
                {p.dataRecebimento ? dateBR(p.dataRecebimento) : "—"}
              </CardField>
              <CardField label="Valor recebido">
                {p.valorRecebido != null ? money(p.valorRecebido) : "—"}
              </CardField>
              <CardField label="Diferença">
                <span className={temDiferenca(p) ? "text-amber-700 dark:text-amber-400" : ""}>
                  {p.diferenca != null ? money(p.diferenca) : "—"}
                </span>
              </CardField>
              <CardField label="Forma">{p.formaPrevista ?? "—"}</CardField>
              <CardField label="Corretor">{p.corretorNome}</CardField>
              <CardField label="Equipe">{p.teamNome ?? "—"}</CardField>
              <CardField label="Partes" className="col-span-2">
                {p.partes?.length ? p.partes.join(" · ") : "—"}
              </CardField>
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
