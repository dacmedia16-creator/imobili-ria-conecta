import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { money, dateBR } from "@/components/vendas/shared";
import { CardField, EmptyState, Pill, type Tom } from "@/components/visual/base";
import { COMISSAO_PAPEIS } from "@/lib/status";
import { agruparComissoes } from "@/lib/financeiro-dashboard-calc";
import type { AgrupamentoComissao, ComissaoCalculada } from "@/lib/financeiro-dashboard-types";

const PAPEL_LABEL: Record<string, string> = Object.fromEntries(
  COMISSAO_PAPEIS.map((p) => [p.key, p.label]),
);

const AGRUPAMENTO_LABEL: Record<AgrupamentoComissao, string> = {
  beneficiario: "Beneficiário",
  gestor: "Gestor",
  equipe: "Equipe",
  papel: "Papel",
  mes: "Mês",
  geral: "Geral",
};

const SITUACAO_RECEBIMENTO_LABEL = {
  nao_recebido: "Não recebido",
  parcial: "Parcial",
  recebido: "Recebido",
} as const;
const SITUACAO_RECEBIMENTO_TONE = {
  nao_recebido: "text-muted-foreground",
  parcial: "text-amber-700 dark:text-amber-400",
  recebido: "text-emerald-700 dark:text-emerald-400",
} as const;
const SITUACAO_RECEBIMENTO_TOM: Record<keyof typeof SITUACAO_RECEBIMENTO_LABEL, Tom> = {
  nao_recebido: "slate",
  parcial: "amber",
  recebido: "green",
};

export function ComissoesCalculadasTable({ rows }: { rows: ComissaoCalculada[] }) {
  const [agrupamento, setAgrupamento] = useState<AgrupamentoComissao>("beneficiario");
  const grupos = agruparComissoes(rows, agrupamento);
  const total = rows.reduce((s, r) => s + r.valor, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">Agrupar por</Label>
          <Select
            value={agrupamento}
            onValueChange={(v) => setAgrupamento(v as AgrupamentoComissao)}
          >
            <SelectTrigger aria-label="Agrupar por" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AGRUPAMENTO_LABEL) as AgrupamentoComissao[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {AGRUPAMENTO_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          Total geral: <span className="font-semibold text-foreground">{money(total)}</span> —
          competência, não pagamento
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{AGRUPAMENTO_LABEL[agrupamento]}</TableHead>
            <TableHead className="text-right">Qtd.</TableHead>
            <TableHead className="text-right">Valor calculado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grupos.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma comissão calculada no filtro atual.
              </TableCell>
            </TableRow>
          )}
          {grupos.map((g) => (
            <TableRow key={g.chave}>
              <TableCell className="font-medium">
                {agrupamento === "papel" ? (PAPEL_LABEL[g.label] ?? g.label) : g.label}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{g.quantidade}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {money(g.valorTotal)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Celular: mesmas comissões em cartões, sem rolagem lateral. */}
      <div className="space-y-3 md:hidden print:hidden">
        {rows.length === 0 && <EmptyState>Nenhuma comissão calculada no filtro atual.</EmptyState>}
        {rows.map((r) => (
          <div key={r.id} className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link
                to="/vendas/$id"
                params={{ id: r.saleId }}
                className="min-w-0 break-words font-medium hover:underline"
              >
                {r.imovelLabel}
              </Link>
              <Pill tom={SITUACAO_RECEBIMENTO_TOM[r.situacaoRecebimentoVenda]}>
                {SITUACAO_RECEBIMENTO_LABEL[r.situacaoRecebimentoVenda]}
              </Pill>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              <CardField label="Valor calculado">
                <span className="font-semibold">{money(r.valor)}</span>
              </CardField>
              <CardField label="%">{r.percentual != null ? `${r.percentual}%` : "—"}</CardField>
              <CardField label="Beneficiário">
                <span className={r.semVinculoUsuario ? "text-amber-700 dark:text-amber-400" : ""}>
                  {r.beneficiarioNome ?? "—"}
                  {r.semVinculoUsuario && " (sem vínculo)"}
                </span>
              </CardField>
              <CardField label="Papel">{PAPEL_LABEL[r.papel] ?? r.papel}</CardField>
              <CardField label="Efetivada em">
                {r.dataEfetivacao ? dateBR(r.dataEfetivacao) : "—"}
              </CardField>
              <CardField label="Origem">
                {r.origem === "manual" ? "Ajuste manual" : "Automática"}
              </CardField>
              <CardField label="Equipe">{r.teamNome ?? "—"}</CardField>
              <CardField label="Gestor">{r.gestorNome ?? "—"}</CardField>
            </dl>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block print:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imóvel</TableHead>
              <TableHead>Efetivada em</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Beneficiário</TableHead>
              <TableHead>Equipe</TableHead>
              <TableHead>Gestor</TableHead>
              <TableHead>%</TableHead>
              <TableHead className="text-right">Valor calculado</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Recebimento da venda</TableHead>
              <TableHead>Divergência</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma comissão calculada no filtro atual.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  <Link to="/vendas/$id" params={{ id: r.saleId }} className="hover:underline">
                    {r.imovelLabel}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.dataEfetivacao ? dateBR(r.dataEfetivacao) : "—"}
                </TableCell>
                <TableCell>{PAPEL_LABEL[r.papel] ?? r.papel}</TableCell>
                <TableCell
                  className={r.semVinculoUsuario ? "text-amber-700 dark:text-amber-400" : ""}
                >
                  {r.beneficiarioNome ?? "—"}
                  {r.semVinculoUsuario && <span className="ml-1 text-xs">(sem vínculo)</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.teamNome ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.gestorNome ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.percentual != null ? `${r.percentual}%` : "—"}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{money(r.valor)}</TableCell>
                <TableCell>
                  <Badge variant={r.origem === "manual" ? "outline" : "secondary"}>
                    {r.origem === "manual" ? "Ajuste manual" : "Automática"}
                  </Badge>
                </TableCell>
                <TableCell className={SITUACAO_RECEBIMENTO_TONE[r.situacaoRecebimentoVenda]}>
                  {SITUACAO_RECEBIMENTO_LABEL[r.situacaoRecebimentoVenda]}
                </TableCell>
                <TableCell>
                  {r.semVinculoUsuario ? (
                    <span className="text-amber-700 dark:text-amber-400">Sim</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
